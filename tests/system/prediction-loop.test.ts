import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { PredictionLoop } from "../../src/application/prediction-loop.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { PredictionModel, PredictionRecord, PredictionRepository } from "../../src/application/prediction.js";
import type { AgentCoreInput, DomainEvent, PredictionOutput } from "../../src/domain/contracts.js";

const output: PredictionOutput = {
  predictions: {
    g1: { candidates: [{ candidateIndex: 0, feature: "語彙", content: "次は技術の話を聞く", expectation: "medium", contextSummary: "技術の話題", rationale: "直前の話題" }] },
    g2: { candidates: [{ candidateIndex: 0, speechAct: "質問", content: "技術について質問する", expectation: "medium", contextSummary: "技術の話題", rationale: "関心が続く" }] }
  },
  predictionEvaluations: [{ group: "g2", candidateIndex: 0, match: "primary", surprise: "none", difference: "大きなずれはない", interpretation: "話題を続けたい", uncertainty: "低い", observed: "技術の話題を続けた", errorDirection: "matched", effect: "unchanged" }],
  remember: [{ content: "相手は技術の話を好む", reason: "次の対話で再利用する", evidenceEventIds: ["event-1"], confidence: "medium", target: "semantic" }],
  observationCandidates: [],
  g3: { needsG3: false, targetLayers: [], priority: "medium" }
};

const event = { id: "event-1", agentId: "a", kind: "user-message", occurredAt: "2026-10-31T00:00:00+00:00", payload: {}, correlationId: "c" } as unknown as DomainEvent;
const input = { run: { runId: "run-1" }, observation: { summary: "技術の話をした", facts: [] }, recentExperiences: [] } as unknown as AgentCoreInput;

const repository = (latest?: PredictionRecord) => {
  const saved: PredictionRecord[] = [];
  const repo: PredictionRepository = {
    save: (record) => { saved.push(record); return Promise.resolve(); },
    latest: () => Promise.resolve(latest),
    context: () => Promise.resolve(undefined)
  };
  return { repo, saved };
};

const model = (value: PredictionOutput): PredictionModel => ({ predict: () => Promise.resolve(value) });

describe("FR-48, FR-49, FR-63, NFR-16, AC-11, AC-18: G1/G2 prediction loop", () => {
  it("FR-48, FR-49: saves one prediction after a user response and filters evaluations to the previous record", async () => {
    const previous: PredictionRecord = { id: "previous", agentId: "a", sourceEventId: "old", sourceRunId: "old-run", output: { ...output, predictionEvaluations: [] }, createdAt: "2026-10-30T00:00:00+00:00" };
    const { repo, saved } = repository(previous);
    const enqueue = vi.fn(() => Promise.resolve());
    const loop = new PredictionLoop({ repository: repo, model: model(output), ids: { next: () => "new-prediction" }, now: () => new Date("2026-10-31T01:00:00+00:00"), memoryUpdateSink: { enqueue }, limits: { deadlineMs: 1_000, maxAttempts: 1 } });
    await loop.afterResponse({ event, input, result: {} as never }, new AbortController().signal);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.output.predictionEvaluations).toEqual(output.predictionEvaluations);
    expect(enqueue).toHaveBeenCalledWith({ agentId: "a", sourceEventId: "event-1", intents: output.remember });
  });

  it("FR-63, AC-11: skips non-user events and does not throw when the model fails", async () => {
    const { repo, saved } = repository();
    const loop = new PredictionLoop({ repository: repo, model: { predict: () => Promise.reject(new Error("provider")) }, ids: { next: () => "new" }, now: () => new Date(), limits: { deadlineMs: 1_000, maxAttempts: 1 } });
    await expect(loop.afterResponse({ event: { ...event, kind: "internal" }, input, result: {} as never }, new AbortController().signal)).resolves.toBeUndefined();
    expect(saved).toHaveLength(0);
    await expect(loop.afterResponse({ event, input, result: {} as never }, new AbortController().signal)).resolves.toBeUndefined();
    expect(saved).toHaveLength(0);
  });

  it("FR-48, AC-11: runs the prediction service after a committed response and does not roll it back on failure", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const value = agentCoreInputFixture(); value.run = { ...value.run, eventId: event.id, agentId: event.agentId }; value.observation = { ...value.observation, eventId: event.id, content: event.payload }; return value; });
    let calls = 0;
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: new ScriptedAgentHarness([{ desire: "応答する", action: { type: "respond", content: "了解しました" } }]), persistence, ids: new SequenceIdGenerator(["prediction-event", "prediction-output"]), now: () => new Date("2026-10-31T00:00:00Z"), prediction: { afterResponse: () => { calls += 1; return Promise.reject(new Error("prediction unavailable")); } } });
    const action = await runtime.process({ id: "prediction-event", agentId: "agent-a", kind: "internal", occurredAt: "2026-10-31T00:00:00Z", payload: { targetKind: "state-review", reason: "test", destination: "terminal" } }, new AbortController().signal);
    expect(action).toEqual({ type: "respond", content: "了解しました" });
    expect(calls).toBe(1);
    expect(persistence.events).toHaveLength(1);
  });

  it("FR-63, NFR-16: enforces the prediction deadline even if the provider ignores the signal", async () => {
    const { repo, saved } = repository();
    const loop = new PredictionLoop({ repository: repo, model: { predict: () => new Promise<PredictionOutput>(() => undefined) }, ids: { next: () => "new" }, now: () => new Date(), limits: { deadlineMs: 10, maxAttempts: 1 } });
    await expect(loop.afterResponse({ event, input, result: {} as never }, new AbortController().signal)).resolves.toBeUndefined();
    expect(saved).toHaveLength(0);
  });

  it("FR-63, NFR-16: retries within the configured call budget", async () => {
    const { repo, saved } = repository();
    let calls = 0;
    const loop = new PredictionLoop({ repository: repo, model: { predict: () => { calls += 1; return calls === 1 ? Promise.reject(new Error("temporary")) : Promise.resolve(output); } }, ids: { next: () => "new" }, now: () => new Date(), limits: { deadlineMs: 1_000, maxAttempts: 2 } });
    await loop.afterResponse({ event, input, result: {} as never }, new AbortController().signal);
    expect(calls).toBe(2);
    expect(saved).toHaveLength(1);
  });
});
