import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentCoreStructuredOutputRepairMessage, completeAgentCoreSystemPrompt, createDefaultDeepAgentFactory } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { agentCoreSystemPrompt, resolveEventSkills } from "../../src/infrastructure/agent/deep-agent-prompt.js";
import { reflectionStructuredOutputRepairMessage, reflectionSystemPrompt } from "../../src/infrastructure/agent/reflection-harness.js";
import { createSkillTools } from "../../src/infrastructure/tools/skill-tools.js";
import { stripSkillsSystemPrompt } from "../../src/infrastructure/agent/deep-agent-middleware.js";
import { SystemMessage } from "langchain";
import { createSkillsMiddleware, FilesystemBackend, listSkills, type createDeepAgent } from "deepagents";

const skill = (name: string): string => readFileSync(join(process.cwd(), "skills", name, "SKILL.md"), "utf8");
const userMessageSkill = skill("user-message");
const idleSkill = skill("idle");
const lifecycleSkill = skill("concern-lifecycle");
const socialPrompt = completeAgentCoreSystemPrompt + userMessageSkill + idleSkill + lifecycleSkill;

describe("Agent prompts", () => {
  it("FR-26, FR-27: gives idle exploration modes concrete and distinct behavior", () => {
    expect(idleSkill).toContain("deepen:");
    expect(idleSkill).toContain("bridge:");
    expect(idleSkill).toContain("distant:");
    expect(idleSkill).toContain("固有で検証可能な対象");
  });

  it("FR-17: keeps user-facing content concise, concrete, and separate from internal state", () => {
    expect(completeAgentCoreSystemPrompt).toContain("ユーザーへ実際に届ける文章だけ");
    expect(completeAgentCoreSystemPrompt).toContain("内部情報や管理情報を開示しません");
    expect(completeAgentCoreSystemPrompt).toContain("1〜3文程度");
    expect(completeAgentCoreSystemPrompt).toContain("具体的な結果だけ");
    expect(completeAgentCoreSystemPrompt).toContain("入力とTool結果にない事実を作りません");
  });

  it("FR-7: treats the user as a person to know without turning conversation into a profile checklist", () => {
    expect(socialPrompt).toContain("継続して関係を築く具体的な相手");
    expect(socialPrompt).toContain("質問は一度に最大1件");
    expect(socialPrompt).toContain("プロフィール項目を順番に収集しません");
    expect(socialPrompt).toContain("user_context_get");
    expect(socialPrompt).toContain("好奇心、期待、戸惑い、軽い不安");
    expect(socialPrompt).toContain("挨拶または雑談でも");
    expect(socialPrompt).toContain("0件も選びます");
    expect(socialPrompt).toContain("現在の話題から1段だけ離れた軽い話題");
    expect(socialPrompt).toContain("プロフィール事実ではなく");
    expect(socialPrompt).toContain("既知のユーザーの好み、仕事、経験、最近の話題");
  });

  it("FR-46, AC-8: provides a shared social baseline and leaves depth to Disposition", () => {
    for (const text of ["共通の社会基盤", "直前の発話内容へ触れて", "1段だけ深く", "共通点は、現在の話題", "0件も選びます", "Relationship / Memoryに関係の根拠がある場合だけ触れます", "返答を要求せず", "Memoryにない共有体験を作りません", "現在の話題、共有している文脈、自分の小さな開示", "相手を理解することに価値を感じやすいDisposition", "1 Eventで尋ねる質問も最大1件", "相手の反応次第で0件も選べる", "同じ問いを繰り返さない"]) expect(socialPrompt).toContain(text);
    expect(socialPrompt).not.toContain("住む地域、仕事、趣味");
    expect(socialPrompt).not.toContain("通常の返答に軽い質問を1件添えます");
  });

  it("AC-9: keeps the base and effective skill prompt compact", async () => {
    expect(agentCoreSystemPrompt.length).toBeLessThanOrEqual(4_500);
    const skillsMiddleware = createSkillsMiddleware({ backend: new FilesystemBackend({ rootDir: join(process.cwd(), "skills"), virtualMode: true }), sources: ["/"] });
    const beforeModel = skillsMiddleware.beforeModel as unknown as (state: { skillsMetadata: undefined }) => Promise<{ skillsMetadata: unknown }>;
    const wrapModelCall = skillsMiddleware.wrapModelCall as unknown as (request: unknown, handler: (request: { systemMessage: { content: unknown } }) => Promise<unknown>) => Promise<unknown>;
    const state = await beforeModel({ skillsMetadata: undefined });
    let effectivePrompt = "";
    await wrapModelCall({ systemMessage: new SystemMessage(agentCoreSystemPrompt), state, messages: [], tools: [] }, (request) => {
      effectivePrompt = String(request.systemMessage.content);
      return Promise.resolve({});
    });
    const sanitized = stripSkillsSystemPrompt(effectivePrompt);
    expect(sanitized.length).toBeLessThanOrEqual(4_500);
    expect(sanitized).not.toContain("read_file");
    expect(sanitized).toContain("skill_read");
    expect(stripSkillsSystemPrompt("base## Skills System\nUse read_file on /user-message/SKILL.md\n")).toBe("base");
  });

  it("FR-33, AC-5: limits user-message retrieval to self_get and keeps Concern Tools for autonomous Events", () => {
    expect(userMessageSkill).toContain("user-messageでは、必要に応じてself_get");
    expect(userMessageSkill).toContain("Concernの取得・作成は行いません");
    expect(idleSkill).toContain("自律Eventでは最初にconcern_listを使います");
  });

  it("FR-3, FR-43: carries previous Desire as a non-binding prior with elapsed time", () => {
    expect(completeAgentCoreSystemPrompt).toContain("previousDesire");
    expect(completeAgentCoreSystemPrompt).toContain("前回の意図");
    expect(completeAgentCoreSystemPrompt).toContain("義務ではありません");
    expect(completeAgentCoreSystemPrompt).toContain("古い、満たされた、無関係なDesire");
    expect(completeAgentCoreSystemPrompt).toContain("既存Concernの言い換えにしません");
  });

  it("FR-45: treats respond/refuse as the normal idle path and notification as operational", () => {
    expect(idleSkill).toContain("respondまたはrefuseを通常経路");
    expect(idleSkill).toContain("notify-no-executionを発話を避ける代替にしません");
    expect(idleSkill).toContain("no-external-actionを既定にしません");
  });

  it("FR-25, FR-44: gives concerns a bounded lifecycle and does not force creation on empty", () => {
    expect(lifecycleSkill).toContain("相手を知るConcernは同時に1件");
    expect(lifecycleSkill).toContain("答えがなければ拒絶と推測せず");
    expect(lifecycleSkill).toContain("機微情報");
    expect(lifecycleSkill).toContain("未解決課題だけに限らず");
    expect(idleSkill).toContain("直ちにConcernを作る必要はありません");
    expect(idleSkill + lifecycleSkill).not.toContain("原則1件作ります");
  });

  it.each([lifecycleSkill, reflectionSystemPrompt])("FR-25: closes or changes saturated concerns", (prompt) => {
    expect(prompt).toContain("Concernライフサイクル");
    expect(prompt).toContain("進展なしで反復");
    expect(prompt).toContain("satisfied / abandoned / remove");
    expect(prompt).toContain("一律の経過時間だけでは終了させず");
  });

  it("FR-47, AC-10: loads SKILL.md metadata and allowed tools", () => {
    const skills = listSkills({ projectSkillsDir: join(process.cwd(), "skills") });
    const names = skills.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["user-message", "idle", "concern-due", "scheduled-task", "concern-lifecycle"]));
    expect(userMessageSkill).toContain("使うToolの目安: self_get");
    expect(idleSkill).toContain("使うToolの目安: concern_list");
  });

  it("FR-47, AC-10: routes Event kinds to separate skills", () => {
    expect(resolveEventSkills("user-message", undefined)).toEqual(["user-message"]);
    expect(resolveEventSkills("internal", "idle")).toEqual(["idle", "concern-lifecycle"]);
    expect(resolveEventSkills("internal", "concern-due")).toEqual(["concern-due", "concern-lifecycle"]);
    expect(resolveEventSkills("system", "scheduled-task")).toEqual(["scheduled-task"]);
    expect(resolveEventSkills("internal", "external-change")).toEqual(["idle"]);
    expect(resolveEventSkills("time", undefined)).toEqual([]);
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=user-message");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=idle");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=concern-due");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=scheduled-task");
  });

  it("FR-47, AC-10: reads a skill through the Registry tool", async () => {
    const [read] = createSkillTools({ skillsRoot: join(process.cwd(), "skills") });
    if (read === undefined) throw new Error("skill_read is missing");
    await expect(read.execute({ name: "user-message" }, {} as never, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { name: "user-message" } });
    await expect(read.execute({ name: "../user-message" }, {} as never, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(read.resultPolicy).toMatchObject({ kind: "content-read", defaultRequestCharacters: 1_200, runCharacterBudget: 4_000 });
  });

  it("FR-47, AC-10: wires skills and a FilesystemBackend into the default Deep Agent factory", async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeCreateDeepAgent = ((options: Record<string, unknown>) => {
      captured = options;
      return { invoke: () => Promise.resolve({}) };
    }) as unknown as typeof createDeepAgent;
    const factory = createDefaultDeepAgentFactory(join(process.cwd(), "skills"), fakeCreateDeepAgent);
    factory({ model: {} as never, tools: [] as never, systemPrompt: "system", responseFormat: {} as never, contextSchema: {} as never, middleware: [] });
    expect(captured?.skills).toEqual(["/"]);
    const backend = captured?.backend;
    expect(backend).toBeInstanceOf(FilesystemBackend);
    const read = await (backend as FilesystemBackend).read("/user-message/SKILL.md");
    expect(JSON.stringify(read)).toContain("user-message");
  });

  it("FR-14, FR-42: keeps provider errors and stack traces out of structured-output repair prompts", () => {
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
