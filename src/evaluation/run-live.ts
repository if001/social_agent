import { mkdir } from "node:fs/promises";

import { loadConfig } from "../config/config.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { createArtifactMetadata } from "../operations/operations.js";
import { OllamaEvaluator, OllamaScenarioExecutor } from "./ollama-live.js";
import { runEvaluation } from "./runner.js";
import { evaluationScenarios } from "./scenarios.js";

async function modelMetadata(baseUrl: string, model: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(new URL("/api/tags", baseUrl), { headers }); if (!response.ok) return { model, available: false, httpStatus: response.status };
  const body: unknown = await response.json(); if (typeof body !== "object" || body === null || !("models" in body) || !Array.isArray(body.models)) return { model, available: false };
  const normalized = model.replace(/:cloud$/u, ""); const match = (body.models as unknown[]).find((entry) => typeof entry === "object" && entry !== null && "name" in entry && (entry.name === model || entry.name === normalized));
  return match ?? { model, available: false };
}

const config = await loadConfig(); const embedding = new OllamaEmbeddingProvider(config.embedding); const controller = new AbortController(); process.once("SIGINT", () => { controller.abort(); });
await mkdir("artifacts/evaluation", { recursive: true });
const [chatMetadata, embeddingMetadata] = await Promise.all([modelMetadata(config.chat.baseUrl, config.chat.model, { Authorization: `Bearer ${config.chat.apiKey}` }), modelMetadata(config.embedding.baseUrl, config.embedding.model)]);
const summary = await runEvaluation({ scenarios: evaluationScenarios, repetitions: 5, executor: new OllamaScenarioExecutor(config.chat, async (text, signal) => { await embedding.embed([text], signal); }), evaluator: new OllamaEvaluator(config.chat), artifactRoot: "artifacts/evaluation", metadata: createArtifactMetadata({ now: new Date(), buildRevision: process.env.BUILD_REVISION ?? "working-tree", promptVersion: "evaluation-v1", config: { chat: { baseUrl: config.chat.baseUrl, model: config.chat.model, metadata: chatMetadata }, embedding: { ...config.embedding, metadata: embeddingMetadata } } }), signal: controller.signal });
process.stdout.write(`${JSON.stringify({ groupId: summary.groupId, scenarios: summary.scenarios, passed: summary.passed }, null, 2)}\n`); if (!summary.passed) process.exitCode = 1;
