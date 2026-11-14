import { describe, expect, it, vi } from "vitest";

import { G3Service, MemoryG3ResultSink, type G3Input, type G3ModelResult, type G3Output, type G3ResultSink, type G3Task, type G3TaskRepository } from "../../src/application/g3.js";
import { DomainError } from "../../src/domain/contracts.js";
import type { PredictionOutput } from "../../src/domain/contracts.js";

const prediction: PredictionOutput = {
  predictions: { g1: { candidates: [] }, g2: { candidates: [] } },
  predictionEvaluations: [],
  g3: { needsG3: true, targetLayers: ["L4"], priority: "high" }
};
const input: G3Input = { agentId: "a", sourceEventId: "event-1", sourceRunId: "run-1", sourcePredictionId: "prediction-1", observation: { eventId: "event-1", summary: "技術の話", facts: [] } as never, prediction };
const output: G3Output = { hypothesisEvaluations: [{ statement: "技術に関心がある", status: "supported", rationale: "話題が続いた" }], newHypotheses: ["次は実装の話を聞く"], findings: ["関心が継続"], memories: [{ content: "技術の話を好む", reason: "継続", target: "semantic", perspective: "user" }] };
const modelResult: G3ModelResult = { output, toolEvidence: [{ name: "retrieval_search", ok: true, result: { items: [{ id: "memory-1", summary: "技術の話" }] } }] };

describe("FR-51, FR-52, AC-16: G3", () => {
  it("FR-84: completes a G3 task and keeps Tool evidence in the Runtime-only result pool", async () => {
    const tasks: G3Task[] = [];
    const completed: string[] = [];
    const repo: G3TaskRepository = { save: (task) => { tasks.push(task); return Promise.resolve(); }, claim: (_id, _now, leaseUntil) => { const saved = tasks[0]; return Promise.resolve(saved === undefined ? undefined : { ...saved, status: "running", attempt: 1, leaseUntil }); }, claimDue: () => Promise.resolve(undefined), saveResult: () => Promise.resolve(true), complete: (id) => { completed.push(id); return Promise.resolve(true); }, retryOrFail: () => Promise.resolve() };
    const result = { handle: vi.fn(() => Promise.resolve()) };
    const service = new G3Service(repo, { analyze: () => Promise.resolve(modelResult) }, result, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toEqual(output);
    expect(tasks[0]).toMatchObject({ status: "pending", attempt: 0, sourcePredictionId: "prediction-1", sourceEventId: "event-1", sourceRunId: "run-1", deadlineAt: "2026-11-01T00:05:00.000Z" });
    expect(completed).toEqual(["g3-task"]);
    expect(result.handle).toHaveBeenCalledWith(modelResult, input);
  });

  it("FR-51, AC-16: records failure and does not pass a failed result", async () => {
    const failed: string[] = [];
    const result = { handle: vi.fn(() => Promise.resolve()) };
    const task: G3Task = { id: "g3-task", agentId: "a", sourcePredictionId: "prediction-1", sourceEventId: "event-1", sourceRunId: "run-1", status: "running", attempt: 1, deadlineAt: "2026-11-01T00:01:00.000Z", leaseUntil: "2026-11-01T00:01:00.000Z", input, createdAt: "2026-11-01T00:00:00.000Z" };
    const repo: G3TaskRepository = { save: () => Promise.resolve(), claim: () => Promise.resolve(task), claimDue: () => Promise.resolve(undefined), saveResult: () => Promise.resolve(true), complete: () => Promise.resolve(true), retryOrFail: (_id, _lease, reason) => { failed.push(reason); return Promise.resolve(); } };
    const providerError = new DomainError("EXTERNAL", "G3 provider failed", { cause: new Error("structured output rejected") });
    const service = new G3Service(repo, { analyze: () => Promise.reject(providerError) }, result, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toBeUndefined();
    expect(JSON.parse(failed[0] ?? "{}")).toMatchObject({ errorType: "DomainError", errorCode: "EXTERNAL", errorMessage: "G3 provider failed", causes: [{ type: "Error", message: "structured output rejected" }] });
    expect(result.handle).not.toHaveBeenCalled();
  });

  it("FR-51: keeps a delivered model result retryable until the Runtime result Event commits", async () => {
    const calls: string[] = [];
    const task: G3Task = { id: "g3-task", agentId: "a", sourcePredictionId: "prediction-1", sourceEventId: "event-1", sourceRunId: "run-1", status: "running", attempt: 1, deadlineAt: "2026-11-01T00:01:00.000Z", leaseUntil: "2026-11-01T00:01:00.000Z", input, createdAt: "2026-11-01T00:00:00.000Z" };
    const repo: G3TaskRepository = { save: () => Promise.resolve(), claim: () => Promise.resolve(task), claimDue: () => Promise.resolve(undefined), saveResult: () => { calls.push("result-pending"); return Promise.resolve(true); }, complete: () => { calls.push("completed"); return Promise.resolve(true); }, retryOrFail: () => { calls.push("retry"); return Promise.resolve(); } };
    const service = new G3Service(repo, { analyze: () => Promise.resolve(modelResult) }, { handle: () => Promise.reject(new Error("runtime unavailable")) }, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toBeUndefined();
    expect(calls).toEqual(["result-pending", "retry"]);
  });

  it("FR-84: does not grant G3 direct Memory persistence authority", async () => {
    const sink: G3ResultSink = new MemoryG3ResultSink();
    await expect(sink.handle(modelResult, input)).resolves.toBeUndefined();
  });
});
