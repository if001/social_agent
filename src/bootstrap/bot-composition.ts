import type { Pool } from "pg";

import { AgentEventRouter } from "../application/agent-event-router.js";
import { AgentRuntime, OutboxDispatcher } from "../application/agent-runtime.js";
import { LongTermReviewService } from "../application/long-term-review.js";
import type { Clock, IdGenerator, MessageQueue } from "../application/ports.js";
import { ToolRegistry } from "../application/tool-registry.js";
import type { AppConfig } from "../config/config.js";
import type { RunLimits } from "../domain/contracts.js";
import { DeepAgentHarness, createOllamaDeepAgentInvoker } from "../infrastructure/agent/deep-agent-harness.js";
import { LongTermReviewDeepAgentHarness, createOllamaLongTermReviewInvoker } from "../infrastructure/agent/long-term-review-harness.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresAgentContextLoader } from "../infrastructure/persistence/postgres-agent-context-loader.js";
import { PostgresLongTermReviewRepository } from "../infrastructure/persistence/postgres-long-term-review.js";
import { PostgresMemoryEmbeddingLifecycle } from "../infrastructure/persistence/postgres-memory-embedding.js";
import { PostgresWebArchive } from "../infrastructure/persistence/postgres-web-archive.js";
import { PostgresRuntimePersistence } from "../infrastructure/persistence/postgres-runtime-persistence.js";
import { AddressedFileQueue } from "../infrastructure/queue/addressed-file-queue.js";
import { SystemClock, UuidGenerator } from "../infrastructure/system.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { createAgentSendTool } from "../infrastructure/tools/agent-send-tool.js";
import { createFileTools } from "../infrastructure/tools/file-tools.js";
import { createWebTools } from "../infrastructure/tools/web-tools.js";

export type BotCompositionOptions = {
  readonly pool: Pool;
  readonly config: AppConfig;
  readonly queue?: MessageQueue;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly limits?: Partial<RunLimits>;
  readonly logger?: Logger;
};

export function createBotComposition(options: BotCompositionOptions) {
  const { config, pool } = options;
  const logger = options.logger ?? noopLogger;
  const clock = options.clock ?? new SystemClock(); const ids = options.ids ?? new UuidGenerator();
  const queue = options.queue ?? new AddressedFileQueue(config.queueRoot);
  const limits: RunLimits = { deadlineMs: config.runDeadlineMs, maxSteps: 12, maxToolCalls: 8, maxHops: 4, maxAttempts: 3, ...options.limits };
  const embeddingProvider = new OllamaEmbeddingProvider(config.embedding);
  const webArchive = new PostgresWebArchive(pool, embeddingProvider, ids, () => clock.now(), config.embedding.model);
  const configuredTools = [
    ...createWebTools(config.web.baseUrl, { archive: webArchive }),
    ...createFileTools(config.fileToolRoots),
    createAgentSendTool({ queue, clock, maxHops: limits.maxHops, provenance: (context) => ({
      parentHop: context.transport?.hop ?? 0,
      expiresAt: context.transport?.expiresAt ?? new Date(clock.now().getTime() + 86_400_000).toISOString(),
      ...(context.transport?.replyTo === undefined ? {} : { replyTo: context.transport.replyTo })
    }) })
  ];
  const toolRegistry = new ToolRegistry(configuredTools);
  const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, embeddingProvider, config.embedding.model);
  const contextLoader = new PostgresAgentContextLoader({
    pool, ids, tools: toolRegistry,
    embedding: embeddingProvider,
    budget: { maxTokens: 24_000, maxMemories: 24, maxSocialContexts: 24 },
    limits,
    ...(config.persona === undefined ? {} : { persona: config.persona })
  });
  const persistence = new PostgresRuntimePersistence(pool, (event) => contextLoader.load(event), ids, () => clock.now(), memoryEmbedding);
  const harness = new DeepAgentHarness({
    invoker: createOllamaDeepAgentInvoker({ ...config.chat, toolRegistry, logger, now: () => clock.now() }), logger,
    registeredToolNames: new Set(toolRegistry.definitions().map(({ name }) => name))
  });
  const runtime = new AgentRuntime({ destination: config.botId, defaultOutputDestination: config.defaultOutputDestination, queue, harness, persistence, ids, logger, now: () => clock.now(), maxHops: limits.maxHops, maxAttempts: limits.maxAttempts });
  const reviewRepository = new PostgresLongTermReviewRepository(pool, () => ids.next(), memoryEmbedding);
  const review = new LongTermReviewService(reviewRepository, new LongTermReviewDeepAgentHarness(createOllamaLongTermReviewInvoker(config.chat)));
  const router = new AgentEventRouter(runtime, review);
  const outbox = new OutboxDispatcher(persistence, queue, logger);
  return { queue, clock, ids, limits, toolRegistry, contextLoader, persistence, harness, runtime, review, router, outbox };
}
