import { mkdir } from "node:fs/promises";

import { loadConfig } from "../config/config.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { createArtifactMetadata } from "../operations/operations.js";
import { OllamaEvaluator, OllamaScenarioExecutor } from "./ollama-live.js";
import { runEvaluation } from "./runner.js";
import { evaluationScenarios } from "./scenarios.js";

const config = await loadConfig(); const embedding = new OllamaEmbeddingProvider(config.embedding); const controller = new AbortController(); process.once("SIGINT", () => { controller.abort(); });
await mkdir("artifacts/evaluation", { recursive: true });
const summary = await runEvaluation({ scenarios: evaluationScenarios, repetitions: 5, executor: new OllamaScenarioExecutor(config.chat, async (text, signal) => { await embedding.embed([text], signal); }), evaluator: new OllamaEvaluator(config.chat), artifactRoot: "artifacts/evaluation", metadata: createArtifactMetadata({ now: new Date(), buildRevision: process.env.BUILD_REVISION ?? "working-tree", promptVersion: "evaluation-v1", config: { chat: { baseUrl: config.chat.baseUrl, model: config.chat.model }, embedding: config.embedding } }), signal: controller.signal });
process.stdout.write(`${JSON.stringify({ groupId: summary.groupId, scenarios: summary.scenarios, passed: summary.passed }, null, 2)}\n`); if (!summary.passed) process.exitCode = 1;
