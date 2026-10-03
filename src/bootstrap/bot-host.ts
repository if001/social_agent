import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import { Scheduler } from "../application/scheduler.js";
import type { AppConfig } from "../config/config.js";
import { DomainError } from "../domain/contracts.js";
import { checkOllamaChatCapability } from "../infrastructure/agent/deep-agent-harness.js";
import { checkOllamaEmbeddingCapability } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresScheduleRepository } from "../infrastructure/persistence/postgres-schedule-repository.js";
import { DiscordAdapter } from "../infrastructure/ui/discord-adapter.js";
import { DiscordJsGateway } from "../infrastructure/ui/discord-js-gateway.js";
import { createBotComposition } from "./bot-composition.js";
import { ProcessLifecycle } from "./lifecycle.js";

type Runtime = { start(signal: AbortSignal): Promise<void>; drain(): Promise<void> };
type Tick = { tick(signal: AbortSignal): Promise<number> };
type Outbox = { dispatch(limit?: number): Promise<number> };
type Discord = { startInbound(signal: AbortSignal): Promise<void>; startOutbound(signal: AbortSignal): Promise<void> };

export type BotHostOptions = {
  readonly pool: Pool; readonly agentId: string; readonly lifecycle: ProcessLifecycle;
  readonly runtime: Runtime; readonly scheduler: Tick; readonly outbox: Outbox; readonly discord: Discord;
  readonly schedulerIntervalMs: number; readonly outboxIntervalMs: number; readonly capabilityCheck: () => Promise<void>;
  readonly closePool?: boolean; readonly retryDelayMs?: number;
};

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});
const agentLockKey = (agentId: string): string => createHash("sha256").update(agentId).digest().readBigInt64BE().toString();

export class BotHost {
  readonly #tasks: Promise<void>[] = [];
  #lockClient: PoolClient | undefined; #started = false; #stopped = false;
  constructor(private readonly options: BotHostOptions) {}

  async start(): Promise<void> {
    if (this.#started) throw new Error("Bot Host already started");
    this.#started = true;
    try {
      await this.options.pool.query("SELECT 1");
      const agent = await this.options.pool.query<{ active: boolean }>("SELECT active FROM agents WHERE id=$1", [this.options.agentId]);
      if (agent.rows[0]?.active !== true) throw new DomainError("NOT_FOUND", `Active Agent not found: ${this.options.agentId}`);
      await this.options.capabilityCheck();
      await this.#acquireLock();
      this.options.lifecycle.transition("ready");
      const signal = this.options.lifecycle.signal;
      this.#tasks.push(
        this.#restartable(() => this.options.runtime.start(signal), signal),
        this.#restartable(() => this.options.discord.startInbound(signal), signal),
        this.#restartable(() => this.options.discord.startOutbound(signal), signal),
        this.#periodic(() => this.options.scheduler.tick(signal), this.options.schedulerIntervalMs, signal),
        this.#periodic(() => this.options.outbox.dispatch(), this.options.outboxIntervalMs, signal)
      );
    } catch (error) { await this.#cleanupAfterFailedStart(); throw error; }
  }

  async wait(): Promise<void> { await Promise.all(this.#tasks); }
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.options.lifecycle.state !== "stopping" && this.options.lifecycle.state !== "stopped") this.options.lifecycle.transition("stopping");
    await Promise.allSettled(this.#tasks);
    await this.options.runtime.drain();
    await this.#releaseLock();
    if (this.options.closePool === true) await this.options.pool.end();
    if (this.options.lifecycle.state === "stopping") this.options.lifecycle.transition("stopped");
  }

  async #acquireLock(): Promise<void> {
    const client = await this.options.pool.connect();
    try {
      await client.query("INSERT INTO agent_lock_keys(agent_id,lock_key) VALUES ($1,$2) ON CONFLICT (agent_id) DO NOTHING", [this.options.agentId, agentLockKey(this.options.agentId)]);
      const stored = await client.query<{ lock_key: string }>("SELECT lock_key::text AS lock_key FROM agent_lock_keys WHERE agent_id=$1", [this.options.agentId]);
      const lockKey = stored.rows[0]?.lock_key; if (lockKey === undefined) throw new Error("Agent lock key is unavailable");
      const acquired = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [lockKey]);
      if (acquired.rows[0]?.acquired !== true) throw new DomainError("CONFLICT", `Agent is already running: ${this.options.agentId}`);
      this.#lockClient = client;
    } catch (error) { client.release(); throw error; }
  }
  async #releaseLock(): Promise<void> {
    const client = this.#lockClient; if (client === undefined) return;
    this.#lockClient = undefined;
    try { await client.query("SELECT pg_advisory_unlock_all()"); } finally { client.release(); }
  }
  async #cleanupAfterFailedStart(): Promise<void> {
    if (this.options.lifecycle.state !== "stopping" && this.options.lifecycle.state !== "stopped") this.options.lifecycle.transition("stopping");
    await this.#releaseLock();
    if (this.options.closePool === true) await this.options.pool.end();
    if (this.options.lifecycle.state === "stopping") this.options.lifecycle.transition("stopped");
  }
  async #restartable(run: () => Promise<void>, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await run(); this.#degrade(); } catch { this.#degrade(); }
      await delay(this.options.retryDelayMs ?? 1_000, signal);
    }
  }
  async #periodic(run: () => Promise<unknown>, intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await run(); this.#recover(); } catch { this.#degrade(); }
      await delay(intervalMs, signal);
    }
  }
  #degrade(): void { if (this.options.lifecycle.state === "ready") this.options.lifecycle.transition("degraded"); }
  #recover(): void { if (this.options.lifecycle.state === "degraded") this.options.lifecycle.transition("ready"); }
}

export function createProductionBotHost(config: AppConfig): BotHost {
  if (config.discord === undefined) throw new Error("Discord configuration is required");
  const pool = new Pool({ connectionString: config.database.url.replace("postgresql+psycopg://", "postgresql://") });
  const composition = createBotComposition({ pool, config }); const lifecycle = new ProcessLifecycle();
  const scheduler = new Scheduler({ repository: new PostgresScheduleRepository(pool, 60_000, config.botId), runtime: composition.router, queue: composition.queue, clock: composition.clock, ids: composition.ids, lifecycle, defaultDestination: () => config.defaultOutputDestination, reviewIntervalMs: 86_400_000 });
  const discord = new DiscordAdapter({ gateway: new DiscordJsGateway(config.discord.token), queue: composition.queue, clock: composition.clock, ids: composition.ids, agentId: config.botId, ownerIds: new Set(config.discord.ownerIds), guildIds: new Set(config.discord.guildIds), channelIds: new Set(config.discord.channelIds), queueDestination: config.discord.queueDestination });
  return new BotHost({ pool, agentId: config.botId, lifecycle, runtime: composition.runtime, scheduler, outbox: composition.outbox, discord, schedulerIntervalMs: config.schedulerIntervalMs, outboxIntervalMs: config.outboxIntervalMs, closePool: true, capabilityCheck: async () => {
    await checkOllamaChatCapability(config.chat); await checkOllamaEmbeddingCapability(config.embedding);
  } });
}
