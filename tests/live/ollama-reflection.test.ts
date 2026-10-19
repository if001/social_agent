import { loadConfig } from "../../src/config/config.js";
import type { ReflectionInput } from "../../src/application/reflection.js";
import { OllamaReflectionModel } from "../../src/infrastructure/agent/reflection-harness.js";
import { errorLogContext } from "../../src/observability/logger.js";

describe("live Ollama Reflection", () => {
  it("FR-42, NFR-4: returns a valid maintenance result through the production structured-output path", async () => {
    const config = await loadConfig();
    const input: ReflectionInput = {
      reflectionId: "live-reflection",
      agentId: "live-agent",
      expectedVersion: 1,
      self: { identity: "検証用Agent", disposition: "事実を慎重に扱う", selfStory: "対話を始めたばかり", commitments: ["約束を守る"] },
      state: { mood: "落ち着いている", concerns: [], relationships: [] },
      events: [{ id: "live-event", occurredAt: "2026-10-13T00:00:00.000Z", summary: "短い挨拶に丁寧に返答した" }],
      memories: []
    };
    let output;
    try {
      output = await new OllamaReflectionModel(config.chat).reflect(input, AbortSignal.timeout(300_000));
    } catch (error) {
      throw new Error(`Live Reflection failed: ${JSON.stringify(errorLogContext(error))}`);
    }
    expect(output.memories).toBeInstanceOf(Array);
    expect(output.concernChanges).toBeInstanceOf(Array);
    expect(output.relationshipChanges).toBeInstanceOf(Array);
    expect(output.evidenceMemoryIds).toEqual([]);
  });
});
