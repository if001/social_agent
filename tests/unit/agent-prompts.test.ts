import { agentCoreStructuredOutputRepairMessage, completeAgentCoreSystemPrompt } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { reflectionStructuredOutputRepairMessage, reflectionSystemPrompt } from "../../src/infrastructure/agent/reflection-harness.js";

describe("Agent prompts", () => {
  it("gives idle exploration modes concrete and distinct behavior", () => {
    expect(completeAgentCoreSystemPrompt).toContain("deepen:");
    expect(completeAgentCoreSystemPrompt).toContain("bridge:");
    expect(completeAgentCoreSystemPrompt).toContain("distant:");
    expect(completeAgentCoreSystemPrompt).toContain("固有で検証可能な対象");
  });

  it("keeps user-facing content concise, concrete, and separate from internal state", () => {
    expect(completeAgentCoreSystemPrompt).toContain("ユーザーへ実際に届ける文章だけ");
    expect(completeAgentCoreSystemPrompt).toContain("内部情報や管理情報を開示しません");
    expect(completeAgentCoreSystemPrompt).toContain("1〜3文程度");
    expect(completeAgentCoreSystemPrompt).toContain("具体的な結果だけ");
    expect(completeAgentCoreSystemPrompt).toContain("入力とTool結果にない事実を作りません");
  });

  it("treats the user as a person to know without turning conversation into a profile checklist", () => {
    expect(completeAgentCoreSystemPrompt).toContain("継続して関係を築く具体的な相手");
    expect(completeAgentCoreSystemPrompt).toContain("回答や共有を行ったうえで具体的な質問を一度に最大1件");
    expect(completeAgentCoreSystemPrompt).toContain("プロフィール項目を順番に埋める質問");
    expect(completeAgentCoreSystemPrompt).toContain("memory_searchまたはrelationship_search");
    expect(completeAgentCoreSystemPrompt).toContain("プロフィール事実ではなく");
    expect(completeAgentCoreSystemPrompt).toContain("既知のユーザーの好み、仕事、経験、最近の話題");
  });

  it.each([completeAgentCoreSystemPrompt, reflectionSystemPrompt])("closes or changes saturated concerns", (prompt) => {
    expect(prompt).toContain("Concernライフサイクル");
    expect(prompt).toContain("進展なしで反復");
    expect(prompt).toContain("satisfied / abandoned / remove");
    expect(prompt).toContain("一律の経過時間だけでは終了させず");
  });

  it("keeps provider errors and stack traces out of structured-output repair prompts", () => {
    for (const prompt of [agentCoreStructuredOutputRepairMessage, reflectionStructuredOutputRepairMessage]) {
      expect(prompt).not.toContain("検証エラー:");
      expect(prompt).not.toContain("DynamicStructuredTool");
      expect(prompt).not.toContain("Error:");
      expect(prompt).toContain("構造化出力専用Toolを1回だけ");
    }
    expect(agentCoreStructuredOutputRepairMessage).toContain("actionTypeがrespondならcontent");
    expect(reflectionStructuredOutputRepairMessage).toContain("変更がなければ空配列");
  });
});
