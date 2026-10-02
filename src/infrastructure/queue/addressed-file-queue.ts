import { link, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import type { MessageQueue } from "../../application/ports.js";
import { MessageEnvelopeSchema, type MessageEnvelope } from "../../domain/contracts.js";

export type FileQueueOptions = {
  readonly maxAttempts?: number;
  readonly pollIntervalMs?: number;
  readonly leaseMs?: number;
  readonly retryDelayMs?: (attempt: number) => number;
  readonly now?: () => Date;
};
export type DeadLetter = { readonly file: string; readonly messageId?: string; readonly reason: string };

const encode = (value: string): string => Buffer.from(value).toString("base64url");

export class AddressedFileQueue implements MessageQueue {
  readonly #root: string;
  readonly #maxAttempts: number;
  readonly #pollIntervalMs: number;
  readonly #leaseMs: number;
  readonly #retryDelayMs: (attempt: number) => number;
  readonly #now: () => Date;

  constructor(root: string, options: FileQueueOptions = {}) {
    this.#root = resolve(root);
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#pollIntervalMs = options.pollIntervalMs ?? 25;
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.#retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(30_000, 100 * 2 ** (attempt - 1)));
    this.#now = options.now ?? (() => new Date());
  }

  #directory(destination: string, state: "pending" | "processing" | "dead"): string {
    const directory = resolve(this.#root, encode(destination), state);
    if (!directory.startsWith(`${this.#root}${sep}`)) throw new Error("Queue destination escapes root");
    return directory;
  }

  async #prepare(destination: string): Promise<void> {
    await Promise.all(["pending", "processing", "dead"].map((state) => mkdir(this.#directory(destination, state as "pending"), { recursive: true })));
  }

  async #atomicCreate(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, path); } finally { await unlink(temporary).catch(() => undefined); }
  }

  async publish(message: MessageEnvelope): Promise<void> {
    const envelope = MessageEnvelopeSchema.parse(message);
    await this.#prepare(envelope.destination);
    const path = join(this.#directory(envelope.destination, "pending"), `${encode(envelope.id)}.json`);
    try { await this.#atomicCreate(path, JSON.stringify(envelope)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      throw error;
    }
  }

  async #deadLetter(destination: string, processingPath: string, reason: string): Promise<void> {
    const target = join(this.#directory(destination, "dead"), `${basename(processingPath, ".json")}.${encode(reason)}.json`);
    await rename(processingPath, target);
  }

  async #recoverExpired(destination: string): Promise<void> {
    const processing = this.#directory(destination, "processing");
    for (const file of await readdir(processing)) {
      if (!file.endsWith(".json")) continue;
      const path = join(processing, file);
      const details = await stat(path).catch(() => undefined);
      if (details !== undefined && this.#now().getTime() - details.mtimeMs >= this.#leaseMs) {
        await rename(path, join(this.#directory(destination, "pending"), file)).catch(() => undefined);
      }
    }
  }

  async #next(destination: string): Promise<string | undefined> {
    await this.#recoverExpired(destination);
    const pending = this.#directory(destination, "pending");
    for (const file of (await readdir(pending)).filter((item) => item.endsWith(".json")).sort()) {
      const source = join(pending, file); const claimed = join(this.#directory(destination, "processing"), file);
      try { await rename(source, claimed); return claimed; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return undefined;
  }

  async #consumeOne(destination: string, handler: (message: MessageEnvelope) => Promise<void>): Promise<boolean> {
    const path = await this.#next(destination);
    if (path === undefined) return false;
    let message: MessageEnvelope;
    try { message = MessageEnvelopeSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch { await this.#deadLetter(destination, path, "invalid-envelope"); return true; }
    const now = this.#now().getTime();
    if (Date.parse(message.expiresAt) <= now) { await this.#deadLetter(destination, path, "expired"); return true; }
    if (Date.parse(message.availableAt) > now) {
      await rename(path, join(this.#directory(destination, "pending"), basename(path)));
      return false;
    }
    try { await handler(message); await unlink(path); }
    catch {
      const attempt = message.attempt + 1;
      if (attempt >= this.#maxAttempts) await this.#deadLetter(destination, path, "attempt-limit");
      else {
        const retried = { ...message, attempt, availableAt: new Date(now + this.#retryDelayMs(attempt)).toISOString() };
        const target = join(this.#directory(destination, "pending"), basename(path));
        await writeFile(path, JSON.stringify(retried)); await rename(path, target);
      }
    }
    return true;
  }

  async subscribe(destination: string, handler: (message: MessageEnvelope) => Promise<void>, signal: AbortSignal): Promise<void> {
    await this.#prepare(destination);
    while (!signal.aborted) {
      if (await this.#consumeOne(destination, handler)) continue;
      await new Promise<void>((resolveDelay) => {
        const onAbort = (): void => { clearTimeout(timer); resolveDelay(); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolveDelay(); }, this.#pollIntervalMs);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  async listDeadLetters(destination: string): Promise<readonly string[]> {
    await this.#prepare(destination);
    return (await readdir(this.#directory(destination, "dead"))).sort();
  }

  async inspectDeadLetters(destination: string): Promise<readonly DeadLetter[]> {
    return (await this.listDeadLetters(destination)).map((file) => {
      const parts = file.slice(0, -5).split(".");
      let messageId: string | undefined; let reason = "unknown";
      try { if (parts[0] !== undefined) messageId = Buffer.from(parts[0], "base64url").toString(); } catch { /* malformed dead-letter filename */ }
      try { if (parts[1] !== undefined) reason = Buffer.from(parts[1], "base64url").toString(); } catch { /* malformed reason */ }
      return { file, ...(messageId === undefined ? {} : { messageId }), reason };
    });
  }

  async requeueDeadLetter(destination: string, file: string): Promise<void> {
    if (basename(file) !== file || !file.endsWith(".json")) throw new Error("Invalid dead-letter filename");
    await this.#prepare(destination); const source = join(this.#directory(destination, "dead"), file);
    const envelope = MessageEnvelopeSchema.parse(JSON.parse(await readFile(source, "utf8")));
    const revived = { ...envelope, attempt: 0, availableAt: this.#now().toISOString() };
    const target = join(this.#directory(destination, "pending"), `${encode(envelope.id)}.json`);
    try { await this.#atomicCreate(target, JSON.stringify(revived)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await unlink(source);
  }
}
