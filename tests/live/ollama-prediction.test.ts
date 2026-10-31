import { loadConfig } from "../../src/config/config.js";
import { createOllamaPredictionModel } from "../../src/infrastructure/agent/prediction-harness.js";
import { errorLogContext } from "../../src/observability/logger.js";

describe("live Ollama G1/G2 prediction", () => {
  it("FR-48, FR-49, FR-50: returns valid predictions without Feeling", async () => {
    const config = await loadConfig();
    let output;
    try {
      output = await createOllamaPredictionModel(config.chat).predict({
        agentId: "live-agent",
        observation: { eventId: "live-event", summary: "ユーザーが技術の話を続けた", facts: [], observedAt: "2026-10-13T00:00:00.000Z" } as never,
        recentExperiences: [],
        memoryCandidates: []
      }, AbortSignal.timeout(300_000));
    } catch (error) {
      throw new Error(`Live prediction failed: ${JSON.stringify(errorLogContext(error))}`);
    }
    expect(output.predictions.g1.candidates).toBeInstanceOf(Array);
    expect(output.predictions.g2.candidates).toBeInstanceOf(Array);
    expect(output.predictionEvaluations).toBeInstanceOf(Array);
    expect(output).not.toHaveProperty("feeling");
  });
});
