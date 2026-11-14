import { loadConfig } from "../../src/config/config.js";
import { createOllamaG3Model } from "../../src/infrastructure/agent/g3-harness.js";
import { errorLogContext } from "../../src/observability/logger.js";

describe("live Ollama G3", () => {
  it("FR-51, NFR-20: returns the flat G3 schema through the Tool-free structured-output path", async () => {
    const config = await loadConfig();
    let result;
    try {
      result = await createOllamaG3Model(config.chat).analyze({
        agentId: "live-agent",
        sourceEventId: "live-g3-event",
        sourceRunId: "live-g3-run",
        sourcePredictionId: "live-g3-prediction",
        observation: { eventId: "live-g3-event", summary: "ユーザーは小さな展示を見に行き、予想より音の作品が印象に残ったと話した", facts: ["展示を見に行った", "音の作品が印象に残った"] },
        prediction: { predictions: { g1: { candidates: [] }, g2: { candidates: [] } }, predictionEvaluations: [], g3: { needsG3: true, targetLayers: ["L4"], priority: "medium" } }
      }, AbortSignal.timeout(300_000));
    } catch (error) {
      throw new Error(`Live G3 failed: ${JSON.stringify(errorLogContext(error))}`);
    }
    expect(result.output.hypothesisEvaluations).toBeInstanceOf(Array);
    expect(result.output.newHypotheses).toBeInstanceOf(Array);
    expect(result.output.findings).toBeInstanceOf(Array);
    expect(result.output.memories).toBeInstanceOf(Array);
  });
});
