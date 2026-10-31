import { describe, expect, it, vi } from "vitest";

import { G3Service, MemoryG3ResultSink, type G3Input, type G3Output, type G3Task, type G3TaskRepository } from "../../src/application/g3.js";
import type { PredictionOutput } from "../../src/domain/contracts.js";

const prediction: PredictionOutput = {
  predictions: { g1: { candidates: [] }, g2: { candidates: [] } },
  predictionEvaluations: [],
  remember: [],
  observationCandidates: [],
  g3: { needsG3: true, targetLayers: ["L4"], priority: "high" }
};
const input: G3Input = { agentId: "a", sourceEventId: "event-1", sourcePredictionId: "prediction-1", observation: { eventId: "event-1", summary: "技術の話", facts: [] } as never, prediction };
const output: G3Output = { hypothesisEvaluations: [{ statement: "技術に関心がある", status: "supported", evidenceEventIds: ["event-1"], rationale: "話題が続いた" }], newHypotheses: ["次は実装の話を聞く"], findings: ["関心が継続"], remember: [{ content: "技術の話を好む", reason: "継続", evidenceEventIds: ["event-1"], confidence: "medium", target: "semantic" }] };

describe("FR-51, FR-52, AC-16: G3", () => {
  it("FR-51: completes a G3 task and passes MemoryIntent to the result sink", async () => {
    const tasks: G3Task[] = [];
    const completed: string[] = [];
    const repo: G3TaskRepository = { save: (task) => { tasks.push(task); return Promise.resolve(); }, complete: (id) => { completed.push(id); return Promise.resolve(); }, fail: () => Promise.resolve() };
    const result = { handle: vi.fn(() => Promise.resolve()) };
    const service = new G3Service(repo, { analyze: () => Promise.resolve(output) }, result, { next: () => "g3-task" }, () => new Date("2026-11-01T00:00:00Z"));
    await expect(service.run(input, new AbortController().signal)).resolves.toEqual(output);
    expect(tasks[0]).toMatchObject({ status: "pending", sourcePredictionId: "prediction-1" });
    expect(completed).toEqual(["g3-task"]);
    expect(result.handle).toHaveBeenCalledWith(output, input);
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

  it("FR-52, AC-16: forwards G3 remember through the memory-update sink", async () => {
    const enqueue = vi.fn(() => Promise.resolve());
    await new MemoryG3ResultSink({ enqueue }).handle(output, input);
    expect(enqueue).toHaveBeenCalledWith({ agentId: "a", sourceEventId: "event-1", intents: output.remember });
  });
});
