import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentCoreModelOutputJsonSchema, agentCoreStructuredOutputRepairMessage, completeAgentCoreSystemPrompt, createDefaultDeepAgentFactory } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { agentCoreSystemPrompt, resolveEventSkills } from "../../src/infrastructure/agent/deep-agent-prompt.js";
import { reflectionStructuredOutputRepairMessage, reflectionSystemPrompt, targetedReflectionSystemPrompt } from "../../src/infrastructure/agent/reflection-harness.js";
import { createSkillTools } from "../../src/infrastructure/tools/skill-tools.js";
import { stripSkillsSystemPrompt } from "../../src/infrastructure/agent/deep-agent-middleware.js";
import { SystemMessage } from "langchain";
import { createSkillsMiddleware, FilesystemBackend, listSkills, type createDeepAgent } from "deepagents";

const skill = (name: string): string => readFileSync(join(process.cwd(), "skills", name, "SKILL.md"), "utf8");
const socialMessageSkill = skill("social-message");
const idleSkill = skill("idle");
const lifecycleSkill = skill("concern-lifecycle");
const dueSkill = skill("concern-due");
const scheduledTaskSkill = skill("scheduled-task");
const socialPrompt = completeAgentCoreSystemPrompt + socialMessageSkill + idleSkill + lifecycleSkill;

describe("Agent prompts", () => {
  it("FR-26, FR-27: gives idle exploration modes concrete and distinct behavior", () => {
    expect(idleSkill).toContain("deepen:");
    expect(idleSkill).toContain("bridge:");
    expect(idleSkill).toContain("distant:");
    expect(idleSkill).toContain("固有で検証可能な対象");
  });

  it("FR-66: lets autonomous Events introduce a topic from the Agent's own state", () => {
    expect(completeAgentCoreSystemPrompt).toContain("話題選択の前提ではありません");
    expect(completeAgentCoreSystemPrompt).toContain("唐突な話題転換も許容します");
    expect(completeAgentCoreSystemPrompt).toContain("ユーザーに有用そうというだけで話題を選びません");
    expect(idleSkill).toContain("接続を必須にしません");
    expect(idleSkill).toContain("なぜ今の自分に気になるか");
    expect(idleSkill).toContain("self_getでDisposition、Self Story、Commitments、Moodを確認");
  });

  it("FR-67: treats no reply as time for autonomous action and permits consecutive speech", () => {
    expect(completeAgentCoreSystemPrompt).toContain("自分の新たな発見、感情、Concern、関心から続けて話しかけてよく");
    expect(idleSkill).toContain("idleごとに自分で選んだ行為または考えを必ず発話します");
    expect(idleSkill + lifecycleSkill).not.toContain("答えがなければ拒絶と推測せず減衰・終了");
    expect(lifecycleSkill).toContain("独立したConcernは並行して保持する");
    expect(reflectionSystemPrompt).toContain("未返信や件数を理由に終了しない");
  });

  it("FR-8: separates a persistent Concern core from Memory, Desire, and scheduling records", () => {
    const prompts = lifecycleSkill + reflectionSystemPrompt + targetedReflectionSystemPrompt("concern");
    expect(prompts).toContain("疑問文である必要はない");
    expect(prompts).toContain("一つの持続する関心");
    expect(prompts).toContain("MemoryまたはEvent Experience");
    expect(prompts).toContain("今回だけの行為はDesire");
    expect(prompts).toContain("実行日時や詳細手順はScheduled Task");
    expect(prompts).toContain("既存Concernが長大");
  });

  it("FR-68: makes idle retain relational curiosity and ground exploration in experience", () => {
    expect(idleSkill).toContain("自分が知りたい具体的な不確かさ");
    expect(idleSkill).not.toContain("idleごとにinteraction_context_getを使い");
    expect(idleSkill).toContain("retrieval_searchで会話MemoryまたはBackground Experienceを必要に応じて確かめます");
    expect(idleSkill).toContain("背景経験は自分の過去として扱い");
    expect(completeAgentCoreSystemPrompt).toContain("Agent自身が知りたい具体的な不確かさ");
  });

  it("C-17, C-14: makes autonomous speech a self-motivated utterance rather than a research report", () => {
    expect(completeAgentCoreSystemPrompt).toContain("自分自身のDesireを満たす");
    expect(completeAgentCoreSystemPrompt).toContain("独り言、仮説、感情、反論、途中経過");
    expect(completeAgentCoreSystemPrompt).toContain("既知Memoryにないユーザー属性や生活型を推測しません");
    expect(idleSkill).toContain("調査結果をユーザーに届けることは目的にしません");
    expect(idleSkill).toContain("独り言、仮説、感情、不満、途中経過");
    expect(dueSkill).toContain("調査結果をユーザーに届けることは目的にしません");
  });

  it("C-14: permits truthful delay, interruption, and digression while preserving commitments", () => {
    expect(idleSkill).toContain("先送り、中断、脱線、方法変更");
    expect(idleSkill).toContain("完了、予約、確認済み、出典を偽りません");
    expect(dueSkill).toContain("先送り、中断、脱線、方法変更");
    expect(scheduledTaskSkill).toContain("役割・約束を実行するEvent");
    expect(scheduledTaskSkill).toContain("実行済み、予約済み、確認済み、出典を偽りません");
  });

  it("FR-87: appraises autonomous exploration without forcing positive emotion", () => {
    expect(completeAgentCoreSystemPrompt).toContain("相手に共有しやすい前向きな感情へ丸めません");
    expect(idleSkill).toContain("喜びだけでなく失望、がっかり、苛立ち、驚き、警戒、怒りを正当なFeelingとして評価");
    expect(idleSkill).toContain("一度のTool失敗だけで怒りを捏造せず");
    expect(idleSkill).toContain("Mood patch、Concern、Relationship、次の探索方法や発話へ具体的に反映");
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
    expect(socialPrompt).toContain("interaction_context_get");
    expect(socialPrompt).toContain("好奇心、期待、戸惑い、軽い不安");
    expect(socialPrompt).toContain("挨拶または雑談でも");
    expect(socialPrompt).toContain("0件も選びます");
    expect(socialPrompt).toContain("現在の話題から1段だけ離れた軽い話題");
    expect(idleSkill).toContain("接続を必須にしません");
  });

  it("FR-46, FR-90: separates common social interaction from event-specific peer policy", () => {
    for (const text of ["senderKind", "addressing", "返答義務はない", "確定事実やpeer自身の視点として保存せず", "recipient", "自分が知りたい具体的な不確かさ"]) expect(socialPrompt).toContain(text);
    expect(socialPrompt).not.toContain("住む地域、仕事、趣味");
    expect(socialPrompt).not.toContain("通常の返答に軽い質問を1件添えます");
  });

  it("FR-21, FR-76, FR-90: lets a direct peer conversation end when its Desire is satisfied", () => {
    expect(socialMessageSkill).toContain("replyだけを理由に発話せず");
    expect(socialMessageSkill).toContain("会話目的が満たされた");
    expect(socialMessageSkill).toContain("定型の感謝、受理、別れ、同意");
    const outputSchema = JSON.stringify(AgentCoreModelOutputJsonSchema);
    expect(outputSchema).toContain("peer/direct");
    expect(outputSchema).toContain("会話目的が満たされた");
  });

  it("FR-40, FR-90: supplies the Scheduled Task creation boundary while deciding a social message", () => {
    expect(resolveEventSkills("message-received", undefined)).toContain("social-message");
    expect(socialMessageSkill).toContain("人から明示された将来・定期実行依頼");
    expect(socialMessageSkill).toContain("Conversationの次の一手");
    expect(socialMessageSkill).toContain("時刻が本質的な例外");
    expect(socialMessageSkill).toContain("reason");
  });

  it("FR-21, FR-76, FR-90, FR-91: keeps observed peer speech concrete and permits silence after engagement", () => {
    expect(socialMessageSkill).toContain("発話義務ではなく");
    expect(socialMessageSkill).toContain("長期的な協力関係");
    expect(socialMessageSkill).toContain("具体的な未解決の問い");
    const outputSchema = JSON.stringify(AgentCoreModelOutputJsonSchema);
    expect(outputSchema).toContain("peer/observed");
    expect(outputSchema).toContain("長期的な協力関係");
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

  it("FR-33, AC-5: limits direct social messages and keeps Concern Tools for autonomous Events", () => {
    expect(socialMessageSkill).toContain("human` / `direct");
    expect(socialMessageSkill).toContain("Concernの取得・作成はしない");
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
    expect(idleSkill).toContain("respondまたはrefuseを必ず選びます");
    expect(idleSkill).toContain("notify-no-executionを発話の代替にしません");
    expect(idleSkill).toContain("no-external-actionは使いません");
  });

  it("FR-25, FR-44, FR-67: keeps multiple grounded concerns without a mechanical count threshold", () => {
    expect(lifecycleSkill).toContain("相手を知るConcernは同時に1件");
    expect(lifecycleSkill).toContain("答えがなくても、それを拒絶、待機、Concernの減衰・終了の根拠にしない");
    expect(lifecycleSkill).toContain("機微情報");
    expect(lifecycleSkill).toContain("未解決課題だけに限らず");
    expect(idleSkill).toContain("複数のConcernを並行して持つのが自然");
    expect(idleSkill).toContain("件数だけを根拠に機械的に作らず");
    expect(idleSkill + lifecycleSkill).not.toContain("3件未満");
  });

  it.each([lifecycleSkill, reflectionSystemPrompt])("FR-25: closes or changes saturated concerns", (prompt) => {
    expect(prompt).toContain("Concernライフサイクル");
    expect(prompt).toContain("進展なしで反復");
    expect(prompt).toContain("satisfied / abandoned / remove");
    expect(prompt).toContain("一律の経過時間だけでは終了させず");
  });

  it("FR-25, NFR-22: leaves semantic closure to the Reflector without keyword rules or mechanical reconsiderAt extension", () => {
    const reflectionConcernSkill = skill("reflection-concern");
    for (const prompt of [lifecycleSkill, reflectionConcernSkill]) {
      expect(prompt).toContain("特定の語句");
      expect(prompt).toContain("意味全体");
      expect(prompt).toContain("単なる延命として再設定しない");
    }
  });

  it("FR-47, AC-10: loads SKILL.md metadata and allowed tools", () => {
    const skills = listSkills({ projectSkillsDir: join(process.cwd(), "skills") });
    const names = skills.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["social-message", "idle", "concern-formation", "concern-due", "scheduled-task", "concern-lifecycle"]));
    expect(socialMessageSkill).toContain("interaction_context_get");
    expect(idleSkill).toContain("使うToolの目安: concern_list");
  });

  it("FR-47, AC-10: routes Event kinds to separate skills", () => {
    expect(resolveEventSkills("message-received", undefined)).toEqual(["social-message"]);
    expect(resolveEventSkills("internal", "idle")).toEqual(["idle", "concern-lifecycle"]);
    expect(resolveEventSkills("internal", "concern-due")).toEqual(["concern-due", "concern-lifecycle"]);
    expect(resolveEventSkills("internal", "concern-formation")).toEqual(["concern-formation", "concern-lifecycle"]);
    expect(resolveEventSkills("system", "scheduled-task")).toEqual(["scheduled-task"]);
    expect(resolveEventSkills("internal", "external-change")).toEqual(["concern-due", "concern-lifecycle"]);
    expect(resolveEventSkills("time", undefined)).toEqual([]);
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=social-message");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=idle");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=concern-due");
    expect(completeAgentCoreSystemPrompt).toContain("skill_read name=scheduled-task");
  });

  it("FR-47, AC-10: reads a skill through the Registry tool", async () => {
    const [read] = createSkillTools({ skillsRoot: join(process.cwd(), "skills") });
    if (read === undefined) throw new Error("skill_read is missing");
    await expect(read.execute({ name: "social-message" }, {} as never, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { name: "social-message" } });
    await expect(read.execute({ name: "../social-message" }, {} as never, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
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
    const read = await (backend as FilesystemBackend).read("/social-message/SKILL.md");
    expect(JSON.stringify(read)).toContain("social-message");
  });

  it("FR-14, FR-42: keeps provider errors and stack traces out of structured-output repair prompts", () => {
    for (const prompt of [agentCoreStructuredOutputRepairMessage, reflectionStructuredOutputRepairMessage]) {
      expect(prompt).not.toContain("検証エラー:");
      expect(prompt).not.toContain("DynamicStructuredTool");
      expect(prompt).not.toContain("Error:");
      expect(prompt).toContain("構造化出力専用Toolを1回だけ");
    }
    expect(agentCoreStructuredOutputRepairMessage).toContain("唯一の本文をcontent");
    expect(agentCoreStructuredOutputRepairMessage).toContain("recipient");
    expect(reflectionStructuredOutputRepairMessage).toContain("変更がなければ空配列");
  });
});
