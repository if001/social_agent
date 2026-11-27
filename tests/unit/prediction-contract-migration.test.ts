import { describe, expect, it } from "vitest";

import { migrateG3Output, migratePredictionOutput } from "../../src/application/prediction-contract-migration.js";

describe("Prediction contract migration", () => {
  it("reduces legacy candidates, evaluations and G3 initiation to the current contract", () => {
    expect(migratePredictionOutput({
      predictions: { g1: { candidates: [{ candidateIndex: 2, content: "語彙", expectation: "medium", contextSummary: "会話", rationale: "直前", feature: "語彙" }, { content: "捨てる", expectation: "low", contextSummary: "x", rationale: "x", feature: "x" }] }, g2: { candidates: [] } },
      predictionEvaluations: [{ group: "g1", candidateIndex: 2, match: "primary", surprise: "low", interpretation: "一致", effect: "ignored" }],
      g3: { needsG3: true, reason: "矛盾を確かめる", targetLayers: ["L4"], priority: "high" }, remember: []
    })).toEqual({ predictions: { g1: { candidates: [{ content: "語彙", expectation: "medium", contextSummary: "会話", rationale: "直前", feature: "語彙" }] }, g2: { candidates: [] } }, predictionEvaluations: [{ group: "g1", match: "primary", surprise: "low", interpretation: "一致" }], investigation: { reason: "矛盾を確かめる" } });
  });

  it("maps the old G3 hypothesis key and rejects invalid current data", () => {
    expect(migrateG3Output({ findings: ["確認済み"], newHypotheses: ["仮説"] })).toEqual({ findings: ["確認済み"], hypotheses: ["仮説"] });
    expect(() => migratePredictionOutput({ predictions: { g1: { candidates: [{ content: "x", expectation: "wrong" }] }, g2: { candidates: [] } }, predictionEvaluations: [] })).toThrow();
  });
});
