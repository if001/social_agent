import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { DomainError } from "../../src/domain/contracts.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

const encoded = (value: string): string => Buffer.from(value).toString("base64url");
const fixedNow = (): Date => new Date("2026-01-02T03:04:05.000Z");
const eventually = async (assertion: () => Promise<void> | void): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { await assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
};

describe("MessageQueue contract", () => {
  let scope: ResourceScope; let root: string; let controller: AbortController; let subscriptions: Promise<void>[];
  beforeEach(async () => { scope = new ResourceScope(); root = await temporaryDirectory(scope); controller = new AbortController(); subscriptions = []; });
  afterEach(async () => { controller.abort(); await Promise.all(subscriptions); await scope.close(); });

  it("NFR-9: delivers only to the addressed destination and acknowledges success", async () => {
    const queue = new AddressedFileQueue(root, { now: fixedNow }); const received: string[] = [];
    subscriptions.push(queue.subscribe("a", (message) => { received.push(message.id); return Promise.resolve(); }, controller.signal));
    subscriptions.push(queue.subscribe("b", () => Promise.reject(new Error("wrong destination")), controller.signal));
    await queue.publish(messageFixture({ id: "for-a", destination: "a" }));
    await eventually(() => { expect(received).toEqual(["for-a"]); });
  });

  it("NFR-10: allows only one concurrent claim", async () => {
    const queue = new AddressedFileQueue(root, { now: fixedNow }); let calls = 0;
    const handler = async (): Promise<void> => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); };
    subscriptions.push(queue.subscribe("a", handler, controller.signal), queue.subscribe("a", handler, controller.signal));
    await queue.publish(messageFixture({ destination: "a" })); await eventually(() => { expect(calls).toBe(1); });
  });

  it("NFR-9: retries failures and dead-letters at the attempt limit", async () => {
    const queue = new AddressedFileQueue(root, { maxAttempts: 2, retryDelayMs: () => 0, now: fixedNow }); let calls = 0;
    subscriptions.push(queue.subscribe("a", () => { calls += 1; return Promise.reject(new Error("fail")); }, controller.signal));
    await queue.publish(messageFixture({ destination: "a" }));
    await eventually(() => { expect(calls).toBe(2); }); await eventually(async () => { expect(await queue.listDeadLetters("a")).toHaveLength(1); });
  });

  it("NFR-9: dead-letters non-retryable policy failures immediately", async () => {
    const queue = new AddressedFileQueue(root, { maxAttempts: 3, now: fixedNow }); let calls = 0;
    subscriptions.push(queue.subscribe("a", () => { calls += 1; return Promise.reject(new DomainError("VALIDATION", "hop limit")); }, controller.signal));
    await queue.publish(messageFixture({ destination: "a" }));
    await eventually(async () => { expect((await queue.inspectDeadLetters("a"))[0]?.reason).toBe("non-retryable-validation"); });
    expect(calls).toBe(1);
  });

  it("NFR-9: dead-letters invalid JSON and ignores duplicate IDs", async () => {
    const queue = new AddressedFileQueue(root, { now: fixedNow }); await queue.publish(messageFixture({ destination: "a" })); await queue.publish(messageFixture({ destination: "a", payload: { changed: true } }));
    const pending = join(root, encoded("a"), "pending"); await writeFile(join(pending, "invalid.json"), "{");
    const received: unknown[] = []; subscriptions.push(queue.subscribe("a", (message) => { received.push(message.payload); return Promise.resolve(); }, controller.signal));
    await eventually(() => { expect(received).toEqual([{}]); }); await eventually(async () => { expect(await queue.listDeadLetters("a")).toHaveLength(1); });
  });

  it("NFR-10: recovers an expired processing lease", async () => {
    const queue = new AddressedFileQueue(root, { leaseMs: 1, now: fixedNow }); const destination = encoded("a");
    await mkdir(join(root, destination, "processing"), { recursive: true }); await mkdir(join(root, destination, "pending"), { recursive: true }); await mkdir(join(root, destination, "dead"), { recursive: true });
    const path = join(root, destination, "processing", "leased.json"); await writeFile(path, JSON.stringify(messageFixture({ destination: "a" }))); await utimes(path, new Date(0), new Date(0));
    let received = false; subscriptions.push(queue.subscribe("a", () => { received = true; return Promise.resolve(); }, controller.signal));
    await eventually(() => { expect(received).toBe(true); });
  });

  it("NFR-9: lists dead-letter reasons and requeues a valid envelope", async () => {
    const queue = new AddressedFileQueue(root, { maxAttempts: 1, retryDelayMs: () => 0, now: fixedNow });
    subscriptions.push(queue.subscribe("a", () => Promise.reject(new Error("fail")), controller.signal)); await queue.publish(messageFixture({ destination: "a" }));
    await eventually(async () => { expect(await queue.inspectDeadLetters("a")).toHaveLength(1); }); controller.abort(); await Promise.all(subscriptions);
    const dead = (await queue.inspectDeadLetters("a"))[0]; expect(dead?.reason).toBe("attempt-limit"); await queue.requeueDeadLetter("a", dead?.file ?? "");
    controller = new AbortController(); let delivered = false; subscriptions = [queue.subscribe("a", () => { delivered = true; controller.abort(); return Promise.resolve(); }, controller.signal)];
    await eventually(() => { expect(delivered).toBe(true); });
  });

  it("NFR-10: encodes malicious destinations under the configured root", async () => {
    const queue = new AddressedFileQueue(root, { now: fixedNow }); await queue.publish(messageFixture({ destination: "../../outside" }));
    expect(await queue.listDeadLetters("../../outside")).toEqual([]);
  });
});
