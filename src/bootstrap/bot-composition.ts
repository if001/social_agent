import type { Pool } from "pg";

import { resolve } from "node:path";
import { AgentEventRouter } from "../application/agent-event-router.js";
import { AgentRuntime, OutboxDispatcher } from "../application/agent-runtime.js";
import { PredictionLoop } from "../application/prediction-loop.js";
import { DirectMemoryUpdateSink, MemoryUpdateHandler } from "../application/memory-update.js";
import { DirectExperienceIntegrationSink, ExperienceIntegration } from "../application/experience-integration.js";
import { createCanonicalSubjectResolver } from "../application/canonical-subject.js";
import { DirectG3Sink, G3Service, MemoryG3ResultSink, type G3ResultSink } from "../application/g3.js";
import { TargetedReflection } from "../application/reflection.js";
import type { Clock, IdGenerator, MessageQueue } from "../application/ports.js";
import { ToolRegistry } from "../application/tool-registry.js";
import type { AppConfig } from "../config/config.js";
import type { RunLimits } from "../domain/contracts.js";
import { DeepAgentHarness, createOllamaDeepAgentInvoker } from "../infrastructure/agent/deep-agent-harness.js";
import { OllamaTargetedReflectionModel } from "../infrastructure/agent/reflection-harness.js";
import { createOllamaWebPageSummarizer } from "../infrastructure/agent/web-summary-harness.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresAgentContextLoader } from "../infrastructure/persistence/postgres-agent-context-loader.js";
import { PostgresMemoryEmbeddingLifecycle } from "../infrastructure/persistence/postgres-memory-embedding.js";
import { PostgresRetrievalService } from "../infrastructure/persistence/postgres-retrieval-service.js";
import { PostgresPredictionRepository } from "../infrastructure/persistence/postgres-prediction-repository.js";
import { PostgresG3TaskRepository } from "../infrastructure/persistence/postgres-g3-task-repository.js";
import { createOllamaPredictionModel } from "../infrastructure/agent/prediction-harness.js";
import { createOllamaG3Model } from "../infrastructure/agent/g3-harness.js";
import { PostgresWebArchive } from "../infrastructure/persistence/postgres-web-archive.js";
import { PostgresRuntimePersistence } from "../infrastructure/persistence/postgres-runtime-persistence.js";
import { PostgresExperienceIntegrationRepository } from "../infrastructure/persistence/postgres-experience-integration.js";
import { createOllamaExperienceIntegrationModel } from "../infrastructure/agent/experience-integration-harness.js";
import { PostgresReflectionRepository } from "../infrastructure/persistence/postgres-reflection.js";
import { PostgresScheduledTaskToolRepository } from "../infrastructure/persistence/postgres-scheduled-task-tool-repository.js";
import { PostgresAgentContextToolRepository } from "../infrastructure/persistence/postgres-agent-context-tool-repository.js";
import { PostgresMemoryUpdateRepository } from "../infrastructure/persistence/postgres-memory-update-repository.js";
import { ObservationGate } from "../application/observation-gate.js";
import { createOllamaObservationGateModel } from "../infrastructure/agent/observation-gate-model.js";
import { PostgresObservationGateContext } from "../infrastructure/persistence/postgres-observation-gate-context.js";
import { PostgresConversationRepository } from "../infrastructure/persistence/postgres-conversation-repository.js";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { AddressedFileQueue } from "../infrastructure/queue/addressed-file-queue.js";
import { SystemClock, UuidGenerator } from "../infrastructure/system.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { createFileTools } from "../infrastructure/tools/file-tools.js";
import { createSkillTools } from "../infrastructure/tools/skill-tools.js";
import { createWebTools } from "../infrastructure/tools/web-tools.js";
import { createScheduledTaskTools } from "../infrastructure/tools/scheduled-task-tools.js";
import { createAgentContextTools } from "../infrastructure/tools/agent-context-tools.js";

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
  const limits: RunLimits = { deadlineMs: config.runDeadlineMs, maxSteps: 27, maxToolCalls: 25, maxHops: config.runtimeMaxHops, maxAttempts: 3, ...options.limits };
  const embeddingProvider = new OllamaEmbeddingProvider(config.embedding);
  const database = createRuntimeDatabase(pool);
  const retrievalService = new PostgresRetrievalService(pool, embeddingProvider);
  const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(database, embeddingProvider, config.embedding.model);
  const predictionRepository = new PostgresPredictionRepository(database);
  const memoryUpdateHandler = new MemoryUpdateHandler(new PostgresMemoryUpdateRepository(database, ids, () => clock.now(), retrievalService, memoryEmbedding));
  const memoryUpdateSink = new DirectMemoryUpdateSink(memoryUpdateHandler, () => clock.now());
  const subjects = createCanonicalSubjectResolver(config.discord?.ownerIds ?? [], config.peers.peers);
  const experienceIntegration = new DirectExperienceIntegrationSink(new ExperienceIntegration(new PostgresExperienceIntegrationRepository(database, ids, () => clock.now(), memoryEmbedding, subjects), createOllamaExperienceIntegrationModel(config.chat, logger), subjects), ids);
  const runtimeRef: { current?: AgentRuntime } = {};
  const fallbackG3Result: G3ResultSink = new MemoryG3ResultSink();
  const g3ResultSink: G3ResultSink = { async handle(result, g3Input) {
    if (runtimeRef.current === undefined) { await fallbackG3Result.handle(result, g3Input); return; }
    await runtimeRef.current.process({ id: `${g3Input.sourcePredictionId}:g3-result`, agentId: g3Input.agentId, kind: "internal", occurredAt: clock.now().toISOString(), payload: { targetKind: "prediction-g3-result", output: result.output, toolEvidence: result.toolEvidence, sourcePredictionId: g3Input.sourcePredictionId } }, AbortSignal.timeout(config.runDeadlineMs));
  } };
  const webArchive = new PostgresWebArchive(database, embeddingProvider, createOllamaWebPageSummarizer(config.chat, logger), ids, () => clock.now(), config.embedding.model, config.webArchiveRoot);
  const configuredTools = [
    ...createAgentContextTools(new PostgresAgentContextToolRepository(database, retrievalService), subjects),
    ...createWebTools(config.web.baseUrl, { archive: webArchive }),
    ...createFileTools({ readRoots: config.fileReadRoots, writeRoots: config.fileWriteRoots }),
    ...createSkillTools({ skillsRoot: resolve(process.cwd(), "skills") }),
    ...createScheduledTaskTools(new PostgresScheduledTaskToolRepository(database), ids, () => clock.now())
  ];
  const toolRegistry = new ToolRegistry(configuredTools);
  const g3Service = new G3Service(new PostgresG3TaskRepository(database, config.botId), createOllamaG3Model({ ...config.chat, toolRegistry }), g3ResultSink, ids, () => clock.now(), config.runDeadlineMs, config.runDeadlineMs, 3);
  const g3Sink = new DirectG3Sink(g3Service, config.runDeadlineMs);
  const prediction = new PredictionLoop({ repository: predictionRepository, model: createOllamaPredictionModel(config.chat, logger), ids, now: () => clock.now(), retrieval: retrievalService, memoryUpdateSink, g3Sink, limits: { deadlineMs: 180_000, maxAttempts: 1 }, logger });
  const contextLoader = new PostgresAgentContextLoader({
    database, ids, tools: toolRegistry,
    embedding: embeddingProvider,
    predictionRepository,
    retrievalService,
    budget: { maxTokens: 4_500, maxMemories: 5, maxSocialContexts: 1 },
    limits, logger,
    ...(config.persona === undefined ? {} : { persona: config.persona })
  });
  const persistence = new PostgresRuntimePersistence(database, (event) => contextLoader.load(event), ids, () => clock.now(), config.botId, config.runtimeCorrelationTtlMs, config.runtimeRateWindowRetentionMs, memoryEmbedding);
  const observationGate = new ObservationGate(new PostgresObservationGateContext(database, retrievalService), createOllamaObservationGateModel(config.chat, logger));
  const conversationRepository = new PostgresConversationRepository(database);
  const harness = new DeepAgentHarness({
    invoker: createOllamaDeepAgentInvoker({ ...config.chat, toolRegistry, logger, now: () => clock.now() }), logger,
    registeredToolNames: new Set(toolRegistry.definitions().map(({ name }) => name)),
    maxRepairs: 2
  });
  const runtime = new AgentRuntime({ destination: config.botId, defaultOutputDestination: config.defaultOutputDestination, queue, harness, persistence, ids, ...(config.discord?.ownerIds[0] === undefined ? {} : { ownerDiscordUserId: config.discord.ownerIds[0] }), logger, now: () => clock.now(), maxHops: limits.maxHops, maxAttempts: limits.maxAttempts, prediction, memoryUpdateHandler, experienceIntegration, observationGate, subjects });
  runtimeRef.current = runtime;
  const reflection = new TargetedReflection(new PostgresReflectionRepository(database, ids, () => clock.now(), memoryUpdateSink, memoryEmbedding, { staleAfterMs: config.schedulerTimings.concernStaleAfterMs, minReflectionSessions: config.schedulerTimings.concernStaleMinReflectionSessions }), new OllamaTargetedReflectionModel(config.chat, logger, toolRegistry));
  const router = new AgentEventRouter(runtime);
  const outbox = new OutboxDispatcher(persistence, queue, logger);
  return { queue, clock, ids, limits, toolRegistry, contextLoader, persistence, harness, runtime, reflection, router, outbox, experienceIntegration, conversationRepository, g3: g3Service };
}
