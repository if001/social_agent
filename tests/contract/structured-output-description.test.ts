import { describe, expect, it } from "vitest";

import { ConcernProposalSchema, G3OutputSchema, PredictionOutputSchema } from "../../src/domain/contracts.js";
import { ConcernReflectorOutputSchema } from "../../src/application/reflection.js";
import { ConcernNormalizationDecisionSchema, ConcernNormalizationModelInputSchema } from "../../src/application/concern-normalization.js";
import { concernNormalizationSystemPrompt } from "../../src/infrastructure/agent/concern-normalization-model.js";
import { concernImpactSystemPrompt } from "../../src/infrastructure/agent/concern-impact-harness.js";
import { eventExperienceRepairSystemPrompt, experienceIntegrationRepairInstruction, experienceIntegrationSystemPrompt } from "../../src/infrastructure/agent/experience-integration-harness.js";
import { AgentCoreModelOutputJsonSchema } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { modelJsonSchema } from "../../src/infrastructure/agent/model-json-schema.js";
import { observationGateSystemPrompt } from "../../src/infrastructure/agent/observation-gate-model.js";
import { predictionSystemPrompt } from "../../src/infrastructure/agent/prediction-harness.js";
import { webSummarySystemPrompt } from "../../src/infrastructure/agent/web-summary-harness.js";

describe("FR-65, NFR-20, AC-19: structured output descriptions", () => {
  it("FR-65, NFR-23, AC-24: requires JSON from every normal structured-output prompt", () => {
    for (const prompt of [concernImpactSystemPrompt, concernNormalizationSystemPrompt, eventExperienceRepairSystemPrompt, experienceIntegrationSystemPrompt, experienceIntegrationRepairInstruction, observationGateSystemPrompt, predictionSystemPrompt, webSummarySystemPrompt]) {
      expect(prompt).toMatch(/JSON (?:object|payload)|JSON object/u);
    }
  });

  it("preserves field descriptions in the JSON Schema passed to the model", () => {
    const prediction = modelJsonSchema(PredictionOutputSchema);
    const serialized = JSON.stringify(prediction);
    expect(serialized).toContain("次ターンのユーザー発話");
    expect(serialized).toContain("candidateIndex");
    expect(serialized).toContain("expectation");
    expect(prediction).not.toHaveProperty("$schema");
    const g3 = modelJsonSchema(G3OutputSchema);
    expect(JSON.stringify(g3)).toContain("確認済みの情報");
    expect(JSON.stringify(g3)).toContain("未確定の解釈");
    expect(Object.keys((g3.properties ?? {}) as Record<string, unknown>)).toEqual(["findings", "hypotheses"]);
  });

  it("keeps MainAgent and G1/G2 schema descriptions available for DeepAgent toolStrategy", () => {
    expect(JSON.stringify(AgentCoreModelOutputJsonSchema)).toContain("今回のEvent");
    expect(JSON.stringify(AgentCoreModelOutputJsonSchema)).toContain("今回確定するAction");
    expect(JSON.stringify(modelJsonSchema(PredictionOutputSchema))).toContain("G1/G2の予測");
  });

  it("FR-8: tells every Concern writer to emit the persistent interest core instead of a research log", () => {
    for (const schema of [ConcernProposalSchema, ConcernReflectorOutputSchema]) {
      const serialized = JSON.stringify(modelJsonSchema(schema));
      expect(serialized).toContain("複数Event");
      expect(serialized).toContain("一つの持続する関心");
      expect(serialized).toContain("経緯");
      expect(serialized).toContain("実行手順");
      if (schema === ConcernProposalSchema) expect(serialized).toContain("親Concernから別のConcernをforkする理由");
    }
  });

  it("FR-8: keeps Concern normalization ID-free and lets Runtime derive keep or normalize by equality", () => {
    const inputSchema = modelJsonSchema(ConcernNormalizationModelInputSchema);
    const outputSchema = modelJsonSchema(ConcernNormalizationDecisionSchema);
    const input = JSON.stringify(inputSchema);
    const output = JSON.stringify(outputSchema);
    expect(Object.keys((inputSchema.properties ?? {}) as Record<string, unknown>)).toEqual(["description", "whyItMatters"]);
    expect(input).not.toContain("concernId");
    expect(input).not.toContain("reconsiderAt");
    expect(output).not.toContain("concernId");
    expect(output).not.toContain("status");
    expect(output).not.toContain("reconsiderAt");
    expect(output).toContain("一つの持続する関心");
    expect(Object.keys((outputSchema.properties ?? {}) as Record<string, unknown>)).toEqual(["description", "whyItMatters"]);
    expect(concernNormalizationSystemPrompt).toContain("入力にない事実、関心、動機を追加しない");
    expect(concernNormalizationSystemPrompt).toContain("分割、作成、終了");
    expect(concernNormalizationSystemPrompt).toContain("維持する場合は入力を一字も変えず");
    expect(concernNormalizationSystemPrompt).toContain("作業の完了、運用方針、共有条件、約束の履行、再開判断、手順の確定をConcernの核にしない");
    expect(concernNormalizationSystemPrompt).toContain("対象への知りたい、確かめたい、見届けたい、守りたいという向き");
  });
});
