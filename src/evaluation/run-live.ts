import { appendFile, mkdir } from "node:fs/promises";

import { loadConfig } from "../config/config.js";
import { createOllamaDeepAgentInvoker, DeepAgentHarness } from "../infrastructure/agent/deep-agent-harness.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { createArtifactMetadata } from "../operations/operations.js";
import { AgentCoreScenarioExecutor, OllamaEvaluator } from "./ollama-live.js";
import { runEvaluation } from "./runner.js";
import { evaluationScenarios } from "./scenarios.js";
import { ToolRegistry } from "../application/tool-registry.js";
import { errorLogContext } from "../observability/logger.js";
import { z } from "zod";

async function modelMetadata(baseUrl: string, model: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(new URL("/api/tags", baseUrl), { headers }); if (!response.ok) return { model, available: false, httpStatus: response.status };
  const body: unknown = await response.json(); if (typeof body !== "object" || body === null || !("models" in body) || !Array.isArray(body.models)) return { model, available: false };
  const normalized = model.replace(/:cloud$/u, ""); const match = (body.models as unknown[]).find((entry) => typeof entry === "object" && entry !== null && "name" in entry && (entry.name === model || entry.name === normalized));
  return match ?? { model, available: false };
}

const config = await loadConfig(); const embedding = new OllamaEmbeddingProvider(config.embedding); const controller = new AbortController(); process.once("SIGINT", () => { controller.abort(); });
await mkdir("artifacts/evaluation", { recursive: true });
const tracePath = `artifacts/evaluation/agent-core-trace-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.jsonl`;
const evaluationTools = new ToolRegistry([{ name: "evaluation_lookup", description: "評価用の隔離された情報源から、指定topicの追加情報を調べる", schema: z.object({ topic: z.string().min(1) }), resultPolicy: { kind: "standard" }, execute: ({ topic }: { topic: string }) => Promise.resolve({ ok: true, value: { topic, finding: `${topic}について未解決点を一つ確認した` } }) }]);
const baseInvoker = createOllamaDeepAgentInvoker({ ...config.chat, toolRegistry: evaluationTools });
const harness = new DeepAgentHarness({ invoker: {
  invoke: async (input, options) => {
  const startedAt = new Date();
  await appendFile(tracePath, `${JSON.stringify({ stage: "agent-core", phase: "start", at: startedAt.toISOString(), runId: options.runId, eventId: options.eventId, inputCharacters: input.messages.reduce((total, message) => total + message.content.length, 0) })}\n`);
  try {
    const result = await baseInvoker.invoke(input, options);
    await appendFile(tracePath, `${JSON.stringify({ stage: "agent-core", phase: "finish", at: new Date().toISOString(), runId: options.runId, eventId: options.eventId, elapsedMs: Date.now() - startedAt.getTime(), toolCalls: result.toolExecutions?.length ?? 0 })}\n`);
    return result;
  } catch (error) {
    await appendFile(tracePath, `${JSON.stringify({ stage: "agent-core", phase: "error", at: new Date().toISOString(), runId: options.runId, eventId: options.eventId, elapsedMs: Date.now() - startedAt.getTime(), ...errorLogContext(error) })}\n`);
    throw error;
  }
} }, registeredToolNames: new Set(evaluationTools.definitions().map(({ name }) => name)), maxRepairs: 1 });
const selectedScenarios = process.env.EVALUATION_SCENARIO_ID !== undefined
  ? evaluationScenarios.filter(({ id }) => id === process.env.EVALUATION_SCENARIO_ID)
  : process.env.EVALUATION_PAIR_ID !== undefined
    ? evaluationScenarios.filter(({ pairId }) => pairId === process.env.EVALUATION_PAIR_ID)
    : evaluationScenarios;
if (selectedScenarios.length === 0) throw new Error(`Unknown evaluation selection: scenario=${String(process.env.EVALUATION_SCENARIO_ID)}, pair=${String(process.env.EVALUATION_PAIR_ID)}`);
const repetitions = process.env.EVALUATION_REPETITIONS === undefined ? 3 : Number.parseInt(process.env.EVALUATION_REPETITIONS, 10);
if (!Number.isSafeInteger(repetitions) || repetitions < 3) throw new Error("EVALUATION_REPETITIONS must be an integer of at least 3 for the live gate");
const concurrency = process.env.EVALUATION_CONCURRENCY === undefined ? 4 : Number.parseInt(process.env.EVALUATION_CONCURRENCY, 10);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("EVALUATION_CONCURRENCY must be an integer from 1 to 8");
const evaluatorTimeoutMs = process.env.EVALUATION_TIMEOUT_MS === undefined ? Math.max(config.runDeadlineMs, 180_000) : Number.parseInt(process.env.EVALUATION_TIMEOUT_MS, 10);
if (!Number.isSafeInteger(evaluatorTimeoutMs) || evaluatorTimeoutMs < 30_000) throw new Error("EVALUATION_TIMEOUT_MS must be an integer of at least 30000");
process.stdout.write(`${JSON.stringify({ tracePath })}\n`);
const [chatMetadata, embeddingMetadata] = await Promise.all([modelMetadata(config.chat.baseUrl, config.chat.model, { Authorization: `Bearer ${config.chat.apiKey}` }), modelMetadata(config.embedding.baseUrl, config.embedding.model)]);
const evaluator = new OllamaEvaluator({ ...config.chat, timeoutMs: evaluatorTimeoutMs });
const tracedEvaluator = { evaluate: async (...args: Parameters<OllamaEvaluator["evaluate"]>) => {
  const startedAt = new Date(); await appendFile(tracePath, `${JSON.stringify({ stage: "evaluator", phase: "start", at: startedAt.toISOString(), scenarioId: args[0].id })}\n`);
  try { const result = await evaluator.evaluate(...args); await appendFile(tracePath, `${JSON.stringify({ stage: "evaluator", phase: "finish", at: new Date().toISOString(), scenarioId: args[0].id, elapsedMs: Date.now() - startedAt.getTime() })}\n`); return result; }
  catch (error) { await appendFile(tracePath, `${JSON.stringify({ stage: "evaluator", phase: "error", at: new Date().toISOString(), scenarioId: args[0].id, elapsedMs: Date.now() - startedAt.getTime(), ...errorLogContext(error) })}\n`); throw error; }
} };
const summary = await runEvaluation({ scenarios: selectedScenarios, repetitions, minimumRepetitions: 3, concurrency, executor: new AgentCoreScenarioExecutor(harness, async (text, signal) => { await embedding.embed([text], signal); }), evaluator: tracedEvaluator, artifactRoot: "artifacts/evaluation", metadata: createArtifactMetadata({ now: new Date(), buildRevision: process.env.BUILD_REVISION ?? "working-tree", promptVersion: "agent-core-v3-ja/evaluator-v2-ja", config: { chat: { baseUrl: config.chat.baseUrl, model: config.chat.model, metadata: chatMetadata }, embedding: { ...config.embedding, metadata: embeddingMetadata } } }), signal: controller.signal, ...(process.env.EVALUATION_RESUME_GROUP_ID === undefined ? {} : { resumeGroupId: process.env.EVALUATION_RESUME_GROUP_ID }) });
process.stdout.write(`${JSON.stringify({ groupId: summary.groupId, scenarios: summary.scenarios, passed: summary.passed }, null, 2)}\n`); if (!summary.passed) process.exitCode = 1;
