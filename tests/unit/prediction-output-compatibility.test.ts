import { describe, expect, it } from "vitest";

import { normalizeLegacyPredictionOutput, normalizeLegacyPredictionRecords } from "../../src/application/legacy-prediction-normalization.js";

const legacyOutput = {
  predictions: { g1: { candidates: [] }, g2: { candidates: [] } },
  predictionEvaluations: [],
  g3: { needsG3: false, targetLayers: [], priority: "medium" },
  remember: [],
  observationCandidates: []
};

describe("Prediction output compatibility", () => {
  it("FR-48: removes only retired root fields from a persisted legacy Prediction", () => {
    expect(normalizeLegacyPredictionOutput(legacyOutput)).toEqual({
      predictions: legacyOutput.predictions,
      predictionEvaluations: [],
      g3: legacyOutput.g3
    });
  });

  it("FR-62: leaves a current Prediction representation unchanged", () => {
    const current = { predictions: legacyOutput.predictions, predictionEvaluations: [], g3: legacyOutput.g3 };
    expect(normalizeLegacyPredictionOutput(current)).toEqual(current);
  });

  it("FR-48, FR-62: normalizes only legacy rows and leaves current rows untouched", async () => {
    const updates: unknown[][] = [];
    const store = { query: <Result,>(query: string, values?: readonly unknown[]) => {
      if (query.startsWith("SELECT")) return Promise.resolve({ rows: [{ id: "legacy", output: legacyOutput }, { id: "current", output: { predictions: legacyOutput.predictions, predictionEvaluations: [], g3: legacyOutput.g3 } }] } as Result);
      updates.push([...values ?? []]); return Promise.resolve({ rows: [] } as Result);
    } };
    await expect(normalizeLegacyPredictionRecords(store, "shiro")).resolves.toBe(1);
    expect(updates).toEqual([["legacy", JSON.stringify({ predictions: legacyOutput.predictions, predictionEvaluations: [], g3: legacyOutput.g3 })]]);
  });
});
