import type { Pool } from "pg";

import { AgentEventRouter } from "../application/agent-event-router.js";
import { AgentRuntime, OutboxDispatcher } from "../application/agent-runtime.js";
import { Reflection } from "../application/reflection.js";
import type { Clock, IdGenerator, MessageQueue } from "../application/ports.js";
import { ToolRegistry } from "../application/tool-registry.js";
import type { AppConfig } from "../config/config.js";
import type { RunLimits } from "../domain/contracts.js";
import { DeepAgentHarness, createOllamaDeepAgentInvoker } from "../infrastructure/agent/deep-agent-harness.js";
import { OllamaReflectionModel } from "../infrastructure/agent/reflection-harness.js";
import { createOllamaWebPageSummarizer } from "../infrastructure/agent/web-summary-harness.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresAgentContextLoader } from "../infrastructure/persistence/postgres-agent-context-loader.js";
import { PostgresMemoryEmbeddingLifecycle } from "../infrastructure/persistence/postgres-memory-embedding.js";
import { PostgresWebArchive } from "../infrastructure/persistence/postgres-web-archive.js";
import { PostgresRuntimePersistence } from "../infrastructure/persistence/postgres-runtime-persistence.js";
import { PostgresReflectionRepository } from "../infrastructure/persistence/postgres-reflection.js";
import { AddressedFileQueue } from "../infrastructure/queue/addressed-file-queue.js";
import { SystemClock, UuidGenerator } from "../infrastructure/system.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { createAgentSendTool } from "../infrastructure/tools/agent-send-tool.js";
import { createFileTools } from "../infrastructure/tools/file-tools.js";
import { createWebTools } from "../infrastructure/tools/web-tools.js";
import { createScheduledTaskTools } from "../infrastructure/tools/scheduled-task-tools.js";

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
  const limits: RunLimits = { deadlineMs: config.runDeadlineMs, maxSteps: 27, maxToolCalls: 25, maxHops: 4, maxAttempts: 3, ...options.limits };
  const embeddingProvider = new OllamaEmbeddingProvider(config.embedding);
  const webArchive = new PostgresWebArchive(pool, embeddingProvider, createOllamaWebPageSummarizer(config.chat, logger), ids, () => clock.now(), config.embedding.model, config.webArchiveRoot);
  const configuredTools = [
    ...createWebTools(config.web.baseUrl, { archive: webArchive }),
    ...createFileTools({ readRoots: config.fileReadRoots, writeRoots: config.fileWriteRoots }),
    ...createScheduledTaskTools(pool, ids, () => clock.now()),
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
    budget: { maxTokens: 4_500, maxMemories: 5, maxSocialContexts: 1 },
    limits, logger,
    ...(config.persona === undefined ? {} : { persona: config.persona })
  });
  const persistence = new PostgresRuntimePersistence(pool, (event) => contextLoader.load(event), ids, () => clock.now(), memoryEmbedding, toolRegistry);
  const harness = new DeepAgentHarness({
    invoker: createOllamaDeepAgentInvoker({ ...config.chat, toolRegistry, logger, now: () => clock.now() }), logger,
    registeredToolNames: new Set(toolRegistry.definitions().map(({ name }) => name)),
    maxRepairs: 1
  });
  const runtime = new AgentRuntime({ destination: config.botId, defaultOutputDestination: config.defaultOutputDestination, queue, harness, persistence, ids, logger, now: () => clock.now(), maxHops: limits.maxHops, maxAttempts: limits.maxAttempts });
  const reflection = new Reflection(new PostgresReflectionRepository(pool, ids, () => clock.now()), new OllamaReflectionModel(config.chat));
  const router = new AgentEventRouter(runtime);
  const outbox = new OutboxDispatcher(persistence, queue, logger);
  return { queue, clock, ids, limits, toolRegistry, contextLoader, persistence, harness, runtime, reflection, router, outbox };
}
