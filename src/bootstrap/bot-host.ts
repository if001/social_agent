import { abortableDelay } from "../shared/abortable-delay.js";
import { Pool, type PoolClient } from "pg";

import { Scheduler } from "../application/scheduler.js";
import type { AppConfig } from "../config/config.js";
import { checkOllamaChatCapability } from "../infrastructure/agent/deep-agent-harness.js";
import { checkOllamaEmbeddingCapability } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresScheduleRepository } from "../infrastructure/persistence/postgres-schedule-repository.js";
import { PostgresAgentLeaseRepository } from "../infrastructure/persistence/postgres-agent-lease-repository.js";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { DiscordAdapter } from "../infrastructure/ui/discord-adapter.js";
import { DiscordJsGateway } from "../infrastructure/ui/discord-js-gateway.js";
import { createStdoutLogger, errorLogContext, noopLogger, type Logger } from "../observability/logger.js";
import { createBotComposition } from "./bot-composition.js";
import { ProcessLifecycle } from "./lifecycle.js";

type Runtime = { start(signal: AbortSignal): Promise<void>; drain(): Promise<void> };
type Tick = { tick(signal: AbortSignal): Promise<number> };
type Outbox = { dispatch(limit?: number): Promise<number> };
type Discord = { startInbound(signal: AbortSignal): Promise<void>; startOutbound(signal: AbortSignal): Promise<void> };
type Integration = { drain(signal: AbortSignal): Promise<void> };

export type BotHostOptions = {
  readonly pool: Pool; readonly agentId: string; readonly lifecycle: ProcessLifecycle;
  readonly runtime: Runtime; readonly scheduler: Tick; readonly outbox: Outbox; readonly discord: Discord; readonly experienceIntegration?: Integration; readonly g3?: Integration;
  readonly schedulerIntervalMs: number; readonly outboxIntervalMs: number; readonly capabilityCheck: () => Promise<void>;
  readonly closePool?: boolean; readonly retryDelayMs?: number;
  readonly logger?: Logger;
};


const isAborted = (signal: AbortSignal): boolean => signal.aborted;

export class BotHost {
  readonly #tasks: Promise<void>[] = [];
  readonly #leaseRepository: PostgresAgentLeaseRepository;
  #lockClient: PoolClient | undefined; #started = false; #stopped = false;
  constructor(private readonly options: BotHostOptions) { this.#leaseRepository = new PostgresAgentLeaseRepository(createRuntimeDatabase(options.pool)); }

  async start(): Promise<void> {
    if (this.#started) throw new Error("Bot Host already started");
    this.#started = true;
    const logger = this.options.logger ?? noopLogger;
    try {
      logger.log("info", "bot.starting");
      await this.#leaseRepository.assertReady(this.options.agentId);
      logger.log("info", "bot.database_ready");
      await this.options.capabilityCheck();
      logger.log("info", "bot.capabilities_ready");
      await this.#acquireLock();
      logger.log("info", "bot.agent_lock_acquired");
      this.options.lifecycle.transition("ready");
      logger.log("info", "bot.ready");
      const signal = this.options.lifecycle.signal;
      const experienceIntegration = this.options.experienceIntegration;
      const g3 = this.options.g3;
      this.#tasks.push(
        this.#restartable("runtime", () => this.options.runtime.start(signal), signal),
        this.#restartable("discord.inbound", () => this.options.discord.startInbound(signal), signal),
        this.#restartable("discord.outbound", () => this.options.discord.startOutbound(signal), signal),
        this.#periodic("scheduler", () => this.options.scheduler.tick(signal), this.options.schedulerIntervalMs, signal),
        this.#periodic("outbox", () => this.options.outbox.dispatch(), this.options.outboxIntervalMs, signal),
        ...(experienceIntegration === undefined ? [] : [this.#periodic("experience_integration", () => experienceIntegration.drain(signal), this.options.schedulerIntervalMs, signal)]),
        ...(g3 === undefined ? [] : [this.#periodic("g3", () => g3.drain(signal), this.options.schedulerIntervalMs, signal)])
      );
    } catch (error) { logger.log("error", "bot.start_failed", errorLogContext(error)); await this.#cleanupAfterFailedStart(); throw error; }
  }

  async wait(): Promise<void> { await Promise.all(this.#tasks); }
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const logger = this.options.logger ?? noopLogger; logger.log("info", "bot.stopping");
    if (this.options.lifecycle.state !== "stopping" && this.options.lifecycle.state !== "stopped") this.options.lifecycle.transition("stopping");
    await Promise.allSettled(this.#tasks);
    await this.options.runtime.drain();
    await this.#releaseLock();
    if (this.options.closePool === true) await this.options.pool.end();
    if (this.options.lifecycle.state === "stopping") this.options.lifecycle.transition("stopped");
    logger.log("info", "bot.stopped");
  }

  async #acquireLock(): Promise<void> {
    this.#lockClient = await this.#leaseRepository.acquire(this.options.agentId);
  }
  async #releaseLock(): Promise<void> {
    const client = this.#lockClient; if (client === undefined) return;
    this.#lockClient = undefined;
    await this.#leaseRepository.release(client);
  }
  async #cleanupAfterFailedStart(): Promise<void> {
    if (this.options.lifecycle.state !== "stopping" && this.options.lifecycle.state !== "stopped") this.options.lifecycle.transition("stopping");
    await this.#releaseLock();
    if (this.options.closePool === true) await this.options.pool.end();
    if (this.options.lifecycle.state === "stopping") this.options.lifecycle.transition("stopped");
    this.#stopped = true;
  }
  async #restartable(component: string, run: () => Promise<void>, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await run(); if (!isAborted(signal)) { (this.options.logger ?? noopLogger).log("warn", "component.stopped", { component }); this.#degrade(); } }
      catch (error) { (this.options.logger ?? noopLogger).log("error", "component.failed", { component, ...errorLogContext(error) }); this.#degrade(); }
      await abortableDelay(this.options.retryDelayMs ?? 1_000, signal);
    }
  }
  async #periodic(component: string, run: () => Promise<unknown>, intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await run(); this.#recover(); }
      catch (error) { (this.options.logger ?? noopLogger).log("error", "component.failed", { component, ...errorLogContext(error) }); this.#degrade(); }
      await abortableDelay(intervalMs, signal);
    }
  }
  #degrade(): void { if (this.options.lifecycle.state === "ready") this.options.lifecycle.transition("degraded"); }
  #recover(): void { if (this.options.lifecycle.state === "degraded") this.options.lifecycle.transition("ready"); }
}

export async function createProductionBotHost(config: AppConfig): Promise<BotHost> {
  if (config.discord === undefined) throw new Error("Discord configuration is required");
  const pool = new Pool({ connectionString: config.database.url.replace("postgresql+psycopg://", "postgresql://") });
  const logger = createStdoutLogger({ botId: config.botId, agentId: config.botId });
  const timings = config.schedulerTimings;
  let composition: ReturnType<typeof createBotComposition>;
  try {
    // Existing agents predate concern-formation.  Install the new recurring
    // schedule without moving an already scheduled next run.
    await new PostgresAgentLeaseRepository(createRuntimeDatabase(pool)).ensureConcernFormation(config.botId, timings.concernFormationIntervalMs);
    composition = createBotComposition({ pool, config, logger });
  }
  catch (error) { await pool.end(); throw error; }
  const lifecycle = new ProcessLifecycle();
  const scheduler = new Scheduler({ repository: new PostgresScheduleRepository(createRuntimeDatabase(pool), timings.leaseMs, config.botId, timings.retryDelayMs), runtime: composition.router, reflection: composition.reflection, clock: composition.clock, ids: composition.ids, lifecycle, logger, defaultDestination: () => config.defaultOutputDestination, defaultReplyContext: () => config.defaultOutputDestination === config.discord?.queueDestination && config.discord.channelIds[0] !== undefined ? { channelId: config.discord.channelIds[0] } : undefined, explorationDomains: config.explorationDomains, autonomyReviewIntervalMs: timings.autonomyReviewIntervalMs, concernFormationIntervalMs: timings.concernFormationIntervalMs, stateReviewIntervalMs: timings.stateReviewIntervalMs, ...(timings.idleQuietHours === undefined ? {} : { idleQuietHours: timings.idleQuietHours }) });
  const discord = new DiscordAdapter({ gateway: new DiscordJsGateway(config.discord.token, logger), queue: composition.queue, clock: composition.clock, ids: composition.ids, agentId: config.botId, botUserId: config.discord.botUserId, ownerIds: new Set(config.discord.ownerIds), peers: config.peers.peers, guildIds: new Set(config.discord.guildIds), channelIds: new Set(config.discord.channelIds), queueDestination: config.discord.queueDestination, logger });
  return new BotHost({ pool, agentId: config.botId, lifecycle, runtime: composition.runtime, scheduler, outbox: composition.outbox, discord, experienceIntegration: composition.experienceIntegration, g3: composition.g3, logger, schedulerIntervalMs: timings.scanIntervalMs, outboxIntervalMs: config.outboxIntervalMs, closePool: true, capabilityCheck: async () => {
    await checkOllamaChatCapability(config.chat); await checkOllamaEmbeddingCapability(config.embedding);
  } });
}
