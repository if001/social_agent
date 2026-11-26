import { resolve } from "node:path";

import { loadConfig } from "../../src/config/config.js";
import type { ReflectionInput } from "../../src/application/reflection.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { OllamaTargetedReflectionModel } from "../../src/infrastructure/agent/reflection-harness.js";
import { createSkillTools } from "../../src/infrastructure/tools/skill-tools.js";
import { errorLogContext } from "../../src/observability/logger.js";

describe("live Ollama targeted Reflection", () => {
  it("FR-42, NFR-7: selects at most four new Memories through the production target-specific structured-output path", async () => {
    const config = await loadConfig();
    const input: ReflectionInput = {
      reflectionId: "live-targeted-reflection",
      agentId: "live-agent",
      expectedVersion: 1,
      self: { identity: "検証用Agent", disposition: "経験を慎重に選別する", selfStory: "対話から学んでいる", commitments: ["根拠を確かめる"] },
      state: { mood: { updatedAt: "2026-01-01T00:00:00.000Z", levels: {} }, concerns: [], relationships: [] },
      events: Array.from({ length: 16 }, (_, index) => ({ id: `live-event-${String(index + 1)}`, occurredAt: `2026-10-13T${String(index).padStart(2, "0")}:00:00.000Z`, summary: `将来の判断に影響する別々の経験 ${String(index + 1)}` })),
      memories: []
    };
    let result;
    try {
      result = await new OllamaTargetedReflectionModel(config.chat, undefined, new ToolRegistry(createSkillTools({ skillsRoot: resolve(process.cwd(), "skills") })))
        .reflect("memory", input, AbortSignal.timeout(300_000));
    } catch (error) {
      throw new Error(`Live targeted Reflection failed: ${JSON.stringify(errorLogContext(error))}`);
    }
    expect((result.output as { memories: unknown[] }).memories.length).toBeLessThanOrEqual(4);
  });
});
