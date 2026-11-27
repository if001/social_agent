import { describe, expect, it } from "vitest";

import { PredictionContextSchema, PredictionOutputSchema } from "../../src/domain/contracts.js";

const output = {
  predictions: {
    g1: { candidates: [{ feature: "語彙", content: "技術の話を続ける", expectation: "medium" as const, contextSummary: "技術の話題", rationale: "直前の話題" }] },
    g2: { candidates: [{ speechAct: "質問", content: "技術について質問する", expectation: "medium" as const, contextSummary: "技術の話題", rationale: "関心が続いている" }] }
  },
  predictionEvaluations: [{ group: "g2" as const, match: "primary" as const, surprise: "none" as const, interpretation: "話題を続けたい" }]
};

describe("FR-48, FR-49, FR-50: prediction contracts", () => {
  it("FR-49, FR-50, FR-83: parses prediction and evaluation without persistent Memory candidates", () => {
    expect(PredictionOutputSchema.parse(output).predictions.g1.candidates[0]?.content).toBe("技術の話を続ける");
    expect(PredictionOutputSchema.safeParse({ ...output, feeling: "嬉しい" }).success).toBe(false);
    expect(PredictionOutputSchema.safeParse({ ...output, predictionEvaluations: [{ ...output.predictionEvaluations[0], surprise: 0.5 }] }).success).toBe(false);
  });

  it("FR-48, FR-62: parses a minimal prediction context with previous prediction and prior Action", () => {
    const context = PredictionContextSchema.parse({
      agentId: "a",
      previousPrediction: { id: "prediction-1", createdAt: "2026-10-31T00:00:00+00:00", output },
      previousAction: { type: "respond", content: "前回の返答" },
      memoryCandidates: []
    });
    expect(context.previousPrediction?.id).toBe("prediction-1");
    expect(context.previousAction).toEqual({ type: "respond", content: "前回の返答" });
  });
});
