import { describe, expect, it } from "vitest";

import { PredictionContextSchema, PredictionOutputSchema } from "../../src/domain/contracts.js";

const output = {
  predictions: {
    g1: { candidates: [{ candidateIndex: 0, feature: "語彙", content: "技術の話を続ける", expectation: "medium" as const, contextSummary: "技術の話題", rationale: "直前の話題" }] },
    g2: { candidates: [{ candidateIndex: 0, speechAct: "質問", content: "技術について質問する", expectation: "medium" as const, contextSummary: "技術の話題", rationale: "関心が続いている" }] }
  },
  predictionEvaluations: [{ group: "g2" as const, candidateIndex: 0, match: "primary" as const, surprise: "none" as const, difference: "大きなずれはない", interpretation: "話題を続けたい", uncertainty: "低い", observed: "技術の話題を続けた", errorDirection: "matched" as const, effect: "unchanged" as const }],
  remember: [{ content: "相手は技術の話を好む", reason: "次の対話で再利用する", evidenceEventIds: ["event-1"], confidence: "medium" as const, target: "semantic" as const }],
  observationCandidates: [{ kind: "semantic" as const, content: "技術の話題を好む", subjectIds: ["user-a"], importance: "普通", evidenceEventIds: ["event-1"], rationale: "会話で繰り返した", explicitness: "explicit" as const }],
  g3: { needsG3: false, targetLayers: [], priority: "medium" as const }
};

describe("FR-48, FR-49, FR-50: prediction contracts", () => {
  it("FR-49, FR-50: parses g1/g2 predictions, candidate evaluations, observations and remember without Feeling", () => {
    expect(PredictionOutputSchema.parse(output).predictions.g1.candidates[0]?.content).toBe("技術の話を続ける");
    expect(PredictionOutputSchema.safeParse({ ...output, feeling: "嬉しい" }).success).toBe(false);
    expect(PredictionOutputSchema.safeParse({ ...output, predictionEvaluations: [{ ...output.predictionEvaluations[0], surprise: 0.5 }] }).success).toBe(false);
  });

  it("FR-50, FR-62: parses a prediction context with previous prediction, G3 intents and effect", () => {
    const context = PredictionContextSchema.parse({
      agentId: "a",
      previousPrediction: { id: "prediction-1", createdAt: "2026-10-31T00:00:00+00:00", output },
      g3MemoryIntents: output.remember,
      recentExperienceEffect: { eventId: "event-1", effect: "unchanged" },
      memoryCandidates: []
    });
    expect(context.previousPrediction?.id).toBe("prediction-1");
    expect(context.g3MemoryIntents[0]?.target).toBe("semantic");
  });
});
