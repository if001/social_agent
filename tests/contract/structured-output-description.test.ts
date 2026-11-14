import { describe, expect, it } from "vitest";

import { G3OutputSchema, PredictionOutputSchema } from "../../src/domain/contracts.js";
import { AgentCoreModelOutputJsonSchema } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { modelJsonSchema } from "../../src/infrastructure/agent/model-json-schema.js";

describe("FR-65, NFR-20, AC-19: structured output descriptions", () => {
  it("preserves field descriptions in the JSON Schema passed to the model", () => {
    const prediction = modelJsonSchema(PredictionOutputSchema);
    const serialized = JSON.stringify(prediction);
    expect(serialized).toContain("次ターンのユーザー発話");
    expect(serialized).toContain("candidateIndex");
    expect(serialized).toContain("expectation");
    expect(prediction).not.toHaveProperty("$schema");
    const g3 = modelJsonSchema(G3OutputSchema);
    expect(JSON.stringify(g3)).toContain("前回仮説の評価");
    expect(JSON.stringify(g3)).toContain("G3が意味づけたMemory候補");
    expect(JSON.stringify(g3)).toContain("今後も再利用できる経験として残す短い内容");
    expect(JSON.stringify(g3)).toContain("この候補を残す理由");
  });

  it("keeps MainAgent and G1/G2 schema descriptions available for DeepAgent toolStrategy", () => {
    expect(JSON.stringify(AgentCoreModelOutputJsonSchema)).toContain("今回のEvent");
    expect(JSON.stringify(AgentCoreModelOutputJsonSchema)).toContain("今回確定するAction");
    expect(JSON.stringify(modelJsonSchema(PredictionOutputSchema))).toContain("G1/G2の予測");
  });
});
