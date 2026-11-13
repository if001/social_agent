import { describe, expect, it, vi } from "vitest";

import { G3Service, MemoryG3ResultSink, type G3Input, type G3ModelResult, type G3Output, type G3Task, type G3TaskRepository } from "../../src/application/g3.js";
import type { PredictionOutput } from "../../src/domain/contracts.js";

const prediction: PredictionOutput = {
  predictions: { g1: { candidates: [] }, g2: { candidates: [] } },
  predictionEvaluations: [],
  g3: { needsG3: true, targetLayers: ["L4"], priority: "high" }
};
const input: G3Input = { agentId: "a", sourceEventId: "event-1", sourcePredictionId: "prediction-1", observation: { eventId: "event-1", summary: "技術の話", facts: [] } as never, prediction };
const output: G3Output = { hypothesisEvaluations: [{ statement: "技術に関心がある", status: "supported", rationale: "話題が続いた" }], newHypotheses: ["次は実装の話を聞く"], findings: ["関心が継続"], memories: [{ content: "技術の話を好む", reason: "継続", target: "semantic", perspective: "user" }] };
const modelResult: G3ModelResult = { output, toolEvidence: [{ name: "retrieval_search", ok: true, result: { items: [{ id: "memory-1", summary: "技術の話" }] } }] };

describe("FR-51, FR-52, AC-16: G3", () => {
  it("FR-84: completes a G3 task and keeps Tool evidence in the Runtime-only result pool", async () => {
    const tasks: G3Task[] = [];
    const completed: string[] = [];
    const repo: G3TaskRepository = { save: (task) => { tasks.push(task); return Promise.resolve(); }, complete: (id) => { completed.push(id); return Promise.resolve(); }, fail: () => Promise.resolve() };
    const result = { handle: vi.fn(() => Promise.resolve()) };
    const service = new G3Service(repo, { analyze: () => Promise.resolve(modelResult) }, result, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toEqual(output);
    expect(tasks[0]).toMatchObject({ status: "pending", sourcePredictionId: "prediction-1" });
    expect(completed).toEqual(["g3-task"]);
    expect(result.handle).toHaveBeenCalledWith(modelResult, input);
  });

  it("FR-51, AC-16: records failure and does not pass a failed result", async () => {
    const failed: string[] = [];
    const result = { handle: vi.fn(() => Promise.resolve()) };
    const repo: G3TaskRepository = { save: () => Promise.resolve(), complete: () => Promise.resolve(), fail: (_id, reason) => { failed.push(reason); return Promise.resolve(); } };
    const service = new G3Service(repo, { analyze: () => Promise.reject(new Error("provider")) }, result, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toBeUndefined();
    expect(failed).toEqual(["provider"]);
    expect(result.handle).not.toHaveBeenCalled();
  });

  it("FR-84: does not grant G3 direct Memory persistence authority", async () => {
    await expect(new MemoryG3ResultSink().handle(modelResult, input)).resolves.toBeUndefined();
  });
});
