import { completeAgentCoreSystemPrompt } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { reflectionSystemPrompt } from "../../src/infrastructure/agent/reflection-harness.js";

describe("Agent prompts", () => {
  it("gives idle exploration modes concrete and distinct behavior", () => {
    expect(completeAgentCoreSystemPrompt).toContain("deepen:");
    expect(completeAgentCoreSystemPrompt).toContain("bridge:");
    expect(completeAgentCoreSystemPrompt).toContain("distant:");
    expect(completeAgentCoreSystemPrompt).toContain("固有で検証可能な対象");
  });

  it.each([completeAgentCoreSystemPrompt, reflectionSystemPrompt])("closes or changes saturated concerns", (prompt) => {
    expect(prompt).toContain("Concernライフサイクル");
    expect(prompt).toContain("進展なしで反復");
    expect(prompt).toContain("satisfied / abandoned / remove");
    expect(prompt).toContain("一律の経過時間だけでは終了させず");
  });
});
