import { ExperienceIntegration, ExperienceIntegrationOutputSchema, memorySubjectsForIntegration, type ExperienceIntegrationOutput } from "../../src/application/experience-integration.js";
import { createCanonicalSubjectResolver } from "../../src/application/canonical-subject.js";
import { z } from "zod";
import { eventExperienceRepairInput, eventExperienceSystemPrompt, experienceIntegrationMaxModelCalls, experienceIntegrationModelInput, experienceIntegrationRepairInstruction, experienceIntegrationSystemPrompt, focusConcernIntegrationSystemPrompt, memoryIntegrationSystemPrompt, relationshipIntegrationSystemPrompt } from "../../src/infrastructure/agent/experience-integration-harness.js";
import { projectExperienceEvidenceForModel } from "../../src/infrastructure/agent/tool-result-model-view.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { parseDecisionInput } from "../../src/infrastructure/persistence/postgres-experience-integration.js";

const input = () => {
  const core = agentCoreInputFixture();
  core.observation = { ...core.observation, actor: { id: "user-1", type: "human" } };
  return { integrationId: "integration-1", agentId: core.run.agentId, sourceEvent: { id: core.run.eventId, agentId: core.run.agentId, kind: "user-message" as const, occurredAt: core.run.occurredAt, payload: {} }, sourceRunId: core.run.runId, input: core, result: { output: { desire: "会話を続けたい", action: { type: "respond" as const, content: "了解" } }, toolExecutions: [] } };
};

describe("ExperienceIntegration", () => {
  it("FR-30, FR-82, NFR-7: converts only the legacy peer response in a persisted decision snapshot", () => {
    const core = agentCoreInputFixture();
    const legacy = structuredClone(core) as unknown as Record<string, unknown>;
    legacy.recentExperiences = [{ eventId: "old-event", runId: "old-run", agentId: core.run.agentId, occurredAt: core.run.occurredAt, eventKind: "message-received", observation: { summary: "旧peer応答", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "旧形式の返答", peer: { name: "aka", content: "旧形式の返答" } } }], progressChanged: false }];
    expect(parseDecisionInput(legacy).recentExperiences[0]?.steps[0]).toEqual({ type: "action", action: { type: "respond", content: "旧形式の返答" } });
  });

  it("NFR-8: keeps rejecting an unrelated unknown Action field in a persisted snapshot", () => {
    const core = agentCoreInputFixture();
    const invalid = structuredClone(core) as unknown as Record<string, unknown>;
    invalid.recentExperiences = [{ eventId: "invalid-event", runId: "invalid-run", agentId: core.run.agentId, occurredAt: core.run.occurredAt, eventKind: "message-received", observation: { summary: "不正な応答", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "返答", arbitraryRoute: "somewhere" } }], progressChanged: false }];
    expect(() => parseDecisionInput(invalid)).toThrow("arbitraryRoute");
  });

  it("NFR-8: rejects a peer value that does not match the known legacy peer schema", () => {
    const core = agentCoreInputFixture();
    for (const peer of [{ name: "aka", content: "返答", arbitraryRoute: "somewhere" }, { name: "   ", content: "返答" }, { name: "aka", content: "   " }, { name: "a".repeat(121), content: "返答" }, { name: "aka", content: "a".repeat(6_001) }]) {
      const invalid = structuredClone(core) as unknown as Record<string, unknown>;
      invalid.recentExperiences = [{ eventId: "invalid-peer-event", runId: "invalid-peer-run", agentId: core.run.agentId, occurredAt: core.run.occurredAt, eventKind: "message-received", observation: { summary: "壊れた旧peer応答", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "返答", peer } }], progressChanged: false }];
      expect(() => parseDecisionInput(invalid)).toThrow("peer");
    }
  });

  it("NFR-8: rejects an otherwise valid field added to the known legacy Action shape", () => {
    const core = agentCoreInputFixture();
    const invalid = structuredClone(core) as unknown as Record<string, unknown>;
    invalid.recentExperiences = [{ eventId: "mixed-action-event", runId: "mixed-action-run", agentId: core.run.agentId, occurredAt: core.run.occurredAt, eventKind: "message-received", observation: { summary: "新旧混在応答", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "返答", recipient: "channel", peer: { name: "aka", content: "返答" } } }], progressChanged: false }];
    expect(() => parseDecisionInput(invalid)).toThrow("peer");
  });

  it("FR-82: requires an Event-specific Experience even when no long-term Memory is retained", () => {
    expect(ExperienceIntegrationOutputSchema.safeParse({ experience: null, memories: [] }).success).toBe(false);
    expect(ExperienceIntegrationOutputSchema.parse({ experience: { summary: "展示の予定を確認した", facts: ["ユーザーは週末に展示へ行く予定だと話した"] }, memories: [] })).toMatchObject({ experience: { summary: "展示の予定を確認した" }, memories: [] });
    expect(ExperienceIntegrationOutputSchema.parse({ experience: { summary: "展示の予定を確認した", facts: [] } }).memories).toEqual([]);
    expect(ExperienceIntegrationOutputSchema.safeParse({ experience: { summary: "展示の予定を確認した", facts: [] }, memory: [] }).success).toBe(false);
  });

  it("FR-82: tells Event Experience repair that facts are limited to four", () => {
    expect(eventExperienceSystemPrompt).toContain("最大4件");
    expect(experienceIntegrationRepairInstruction).toContain("factsは最大4件");
  });

  it("FR-82, NFR-8: keeps Experience Integration Memory candidates short", () => {
    const base = { experience: { summary: "展示の予定を確認した", facts: [] }, memories: [{ content: "要点", reason: "再利用する", target: "episodic", perspective: "user" }] };
    expect(ExperienceIntegrationOutputSchema.safeParse(base).success).toBe(true);
    expect(ExperienceIntegrationOutputSchema.safeParse({ ...base, memories: [{ ...base.memories[0], content: "あ".repeat(801) }] }).success).toBe(false);
    expect(ExperienceIntegrationOutputSchema.safeParse({ ...base, memories: [{ ...base.memories[0], reason: "あ".repeat(401) }] }).success).toBe(false);
  });

  it("FR-37: shares the ToolRegistry projection but gives Integration only explicit evidence", () => {
    const request = input();
    const body = "本文-".repeat(1_000);
    const tools = new ToolRegistry([
      { name: "reader", description: "read", schema: z.object({ path: z.string() }), resultPolicy: { kind: "content-read" as const, defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, experienceEvidence: true, execute: () => Promise.resolve({ ok: true }) },
      { name: "lookup", description: "lookup", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" as const }, execute: () => Promise.resolve({ ok: true }) }
    ]);
    const executions = [
      { callId: "tool-1", runId: request.sourceRunId, eventId: request.sourceEvent.id, name: "reader", input: { path: "notes/a.md", content: body }, ok: true, result: { content: body, matches: [{ snippet: body }] }, startedAt: request.sourceEvent.occurredAt, finishedAt: request.sourceEvent.occurredAt },
      { callId: "tool-2", runId: request.sourceRunId, eventId: request.sourceEvent.id, name: "lookup", input: { query: body }, ok: true, result: { items: body }, startedAt: request.sourceEvent.occurredAt, finishedAt: request.sourceEvent.occurredAt }
    ];
    const withTools = { ...request, result: { ...request.result, toolExecutions: executions } };
    const expected = projectExperienceEvidenceForModel(executions, tools);
    const integrationView = experienceIntegrationModelInput(withTools, tools);
    const repairView = eventExperienceRepairInput(withTools, tools);
    expect((integrationView.eventExperience as { evidence: unknown[] }).evidence).toEqual(expected);
    expect((repairView as { evidence: unknown[] }).evidence).toEqual(expected);
    expect(JSON.stringify(integrationView)).not.toContain(body);
    expect(JSON.stringify(repairView)).not.toContain(body);
    expect(JSON.stringify(integrationView)).not.toContain("currentSelf");
    expect(JSON.stringify(integrationView)).not.toContain("relationships");
  });

  it("NFR-21: bounds Experience Integration to five small decisions and one syntax retry each", () => {
    expect(experienceIntegrationMaxModelCalls).toBe(10);
  });

  it("NFR-21: bounds Integration evidence to six shared compact Tool projections", () => {
    const tools = new ToolRegistry([{ name: "reader", description: "read", schema: z.object({ path: z.string() }), resultPolicy: { kind: "standard" as const }, experienceEvidence: true, execute: () => Promise.resolve({ ok: true }) }]);
    const request = input();
    const executions = Array.from({ length: 7 }, (_, index) => ({ callId: `tool-${index}`, runId: request.sourceRunId, eventId: request.sourceEvent.id, name: "reader", input: { path: `notes/${index}.md` }, ok: true as const, result: { fact: index }, startedAt: request.sourceEvent.occurredAt, finishedAt: request.sourceEvent.occurredAt }));
    expect(projectExperienceEvidenceForModel(executions, tools)).toHaveLength(6);
  });

  it("FR-82: states the ID-free Memory candidate contract and the empty-memory form", () => {
    for (const field of ["content", "reason", "target", "perspective", '{"memories":[]}']) expect(memoryIntegrationSystemPrompt).toContain(field);
    expect(memoryIntegrationSystemPrompt).not.toContain("evidenceEventIds");
    expect(memoryIntegrationSystemPrompt).toContain("必ず");
    expect(memoryIntegrationSystemPrompt).not.toContain("省略");
  });

  it("FR-95: permits only an ID-free Focus Concern outcome when Runtime supplied a Focus", () => {
    const output = ExperienceIntegrationOutputSchema.parse({ experience: { summary: "展示の記録を比較した", facts: ["二つの記録方式を確認した"] }, memories: [], focusConcern: { outcome: "progress", reason: "比較できる観察が増えた" } });
    expect(output.focusConcern).toEqual({ outcome: "progress", reason: "比較できる観察が増えた" });
    expect(ExperienceIntegrationOutputSchema.safeParse({ experience: { summary: "展示の記録を比較した", facts: [] }, memories: [], focusConcern: { outcome: "satisfied", reason: "満たされた", concernId: "foreign-id" } }).success).toBe(false);
    for (const phrase of ["focusConcern", "ID", "検索失敗", "unchanged"]) expect(focusConcernIntegrationSystemPrompt).toContain(phrase);
  });

  it("FR-95: discards a Focus Concern judgement when Runtime did not bind a Focus", async () => {
    const request = input(); const applied: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ experience: { summary: "展示を確認した", facts: [] }, memories: [], focusConcern: { outcome: "satisfied", reason: "対象が満たされた" } }) });
    await integration.process(request, new AbortController().signal);
    expect(applied).toMatchObject([{ focusConcern: undefined }]);
  });

  it("FR-82: describes every Relationship candidate field as durable current state", () => {
    const schema = z.toJSONSchema(ExperienceIntegrationOutputSchema);
    const relationship = (schema.properties as Record<string, Record<string, unknown>>).relationship;
    const properties = relationship?.properties as Record<string, Record<string, unknown>>;
    expect(properties.operation?.description).toContain("持続的な関係");
    expect(properties.currentDescription?.description).toContain("現在のRelationship本文");
    expect(properties.description?.description).toContain("現在の関係の型");
    expect(properties.reason?.description).toContain("持続的な変化");
    expect(experienceIntegrationSystemPrompt).toContain("現在の関係の型");
    expect(experienceIntegrationSystemPrompt).toContain("人物プロフィール");
  });

  it("FR-82, FR-95, NFR-8: rejects legacy Concern status and incomplete Relationship output", () => {
    const invalid = ExperienceIntegrationOutputSchema.safeParse({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "update", description: "展示の話題を共有する相手" }, concernStatus: "satisfied" });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues.some((issue) => issue.path.join(".") === "relationship.operation")).toBe(true);
    expect(invalid.error.issues.some((issue) => issue.path.join(".") === "relationship.reason")).toBe(true);
    expect(invalid.error.issues.some((issue) => issue.path.length === 0 && issue.message.includes("concernStatus"))).toBe(true);
  });

  it("FR-82, NFR-8: rejects Event audit fields and a Relationship target supplied by the model", () => {
    const invalid = ExperienceIntegrationOutputSchema.safeParse({
      experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"], occurredAt: "2026-11-25T00:00:00.000Z", kind: "user-message" },
      memories: [],
      relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "今後も展示の話題を共有する前提が生じた", target: "user-main" }
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues.some((issue) => issue.path.join(".") === "experience" && issue.message.includes("occurredAt"))).toBe(true);
    expect(invalid.error.issues.some((issue) => issue.path.join(".") === "experience" && issue.message.includes("kind"))).toBe(true);
    expect(invalid.error.issues.some((issue) => issue.path.join(".") === "relationship" && issue.message.includes("target"))).toBe(true);
  });

  it("FR-82, NFR-8: repairs an invalid Relationship and legacy Concern status before applying", async () => {
    const request = input(); const applied: unknown[] = []; const repairs: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, {
      integrate: () => Promise.resolve({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "update", description: "展示の話題を共有する相手" }, concernStatus: "satisfied" } as never),
      repair: (_input, issues) => { repairs.push(issues); return Promise.resolve({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "展示の予定を繰り返し話し、今後も共有する前提が生じた" } }); }
    }, createCanonicalSubjectResolver(["user-1"]));
    await integration.process(request, new AbortController().signal);
    expect(repairs).toHaveLength(1);
    expect(JSON.stringify(repairs[0])).toContain("concernStatus");
    expect(applied).toEqual([expect.objectContaining({ relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "展示の予定を繰り返し話し、今後も共有する前提が生じた" } })]);
  });

  it("FR-82, NFR-8: repairs audit fields and a Relationship target before applying", async () => {
    const request = input(); const applied: unknown[] = []; const repairs: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, {
      integrate: () => Promise.resolve({
        experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"], occurredAt: "2026-11-25T00:00:00.000Z", kind: "user-message" },
        memories: [],
        relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "今後も展示の話題を共有する前提が生じた", target: "user-main" }
      } as never),
      repair: (_input, issues) => { repairs.push(issues); return Promise.resolve({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "今後も展示の話題を共有する前提が生じた" } }); }
    }, createCanonicalSubjectResolver(["user-1"]));
    await integration.process(request, new AbortController().signal);
    expect(repairs).toHaveLength(1);
    expect(JSON.stringify(repairs[0])).toContain("occurredAt");
    expect(JSON.stringify(repairs[0])).toContain("target");
    expect(applied).toEqual([expect.objectContaining({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, relationship: { operation: "upsert", description: "展示の話題を共有する相手", reason: "今後も展示の話題を共有する前提が生じた" } })]);
  });

  it("FR-82, NFR-8: keeps the Event Experience when repeated repair cannot shorten an optional Relationship", async () => {
    const request = input(); const applied: ExperienceIntegrationOutput[] = [];
    const tooLong = "関係の説明".repeat(101);
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, {
      integrate: () => Promise.resolve({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "upsert", description: tooLong, reason: "関係が変化した" } } as never),
      repair: () => Promise.resolve({ experience: { summary: "ユーザーが展示の予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [], relationship: { operation: "upsert", description: tooLong, reason: "関係が変化した" } } as never)
    }, createCanonicalSubjectResolver(["user-1"]));
    await integration.process(request, new AbortController().signal);
    expect(applied[0]?.experience.summary).toBe("ユーザーが展示の予定を話した");
    expect(applied[0]?.relationship).toBeUndefined();
  });

  it("FR-82, FR-95: states the Relationship and Focus Concern output boundary explicitly", () => {
    for (const phrase of ["upsert|remove", "reasonは必須", "ID", "Concern"]) expect(relationshipIntegrationSystemPrompt).toContain(phrase);
    for (const phrase of ["許可されていないfield", "memories", "JSON object"]) expect(experienceIntegrationRepairInstruction).toContain(phrase);
  });

  it("FR-9, FR-82: leaves Mood to Runtime and rejects a Mood candidate", () => {
    expect(ExperienceIntegrationOutputSchema.safeParse({ experience: { summary: "展示の予定を確認した", facts: [] }, memories: [], mood: { levels: { joy: 5 } } }).success).toBe(false);
    expect(experienceIntegrationSystemPrompt).not.toContain("Mood候補");
  });

  it("AC-017-1: uses the committed Core context and saves user memory with only the current actor as subject", async () => {
    const request = input(); const applied: unknown[] = [];
    const subjects = createCanonicalSubjectResolver(["user-1"]);
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ experience: { summary: "ユーザーが来週の旅行予定を話した", facts: ["来週に旅行へ行く予定がある"] }, memories: [{ content: "ユーザーは来週旅行に行く予定だと話した", reason: "次回の自然な問いかけに使う", target: "episodic", perspective: "user" }] }) }, subjects);
    await integration.process(request, new AbortController().signal);
    expect(memorySubjectsForIntegration(request, (applied[0] as { memories: [] }).memories, subjects)).toEqual([["user-main"]]);
  });

  it("FR-82, FR-88: attaches an allowlisted peer only to the owning agent's self experience", () => {
    const request = input(); request.input.observation = { ...request.input.observation };
    const subjects = createCanonicalSubjectResolver(["user-1"], [{ agentId: "aka", displayName: "アカ", discordUserId: "discord-aka", channelId: "channel" }]);
    const actor = { id: "discord-aka", type: "agent" as const };
    expect(memorySubjectsForIntegration(request, [{ perspective: "self" }], subjects, actor)).toEqual([["agent:aka"]]);
    expect(memorySubjectsForIntegration(request, [{ perspective: "user" }], subjects, actor)).toEqual([["agent:aka"]]);
  });

  it("AC-017-3: records an Integration failure without changing the already committed runtime result", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, { integrate: () => Promise.reject(new Error("provider unavailable")) });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow("provider unavailable");
    expect(failed).toHaveLength(1);
    expect(request.result.output.action).toEqual({ type: "respond", content: "了解" });
  });

  it("FR-82: does not accept model-supplied Event evidence", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, { integrate: () => Promise.resolve({ memories: [{ content: "根拠のない記憶", reason: "test", evidenceEventIds: ["foreign-event"], target: "episodic", perspective: "self" }] }) });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow("evidenceEventIds");
    expect(failed).toHaveLength(1);
  });

  it("AC-017-6: retries a persisted pending Integration during a later drain", async () => {
    const request = input(); let applied = 0;
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("duplicate" as const), pending: () => Promise.resolve([request]), apply: () => { applied += 1; return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ experience: { summary: "予定を確認した", facts: ["ユーザーの予定を確認した"] }, memories: [] }) });
    await integration.retryPending(new AbortController().signal);
    expect(applied).toBe(1);
  });

  it("AC-017-7: processes a reserved record only after it wins the atomic claim", async () => {
    const request = input(); let invoked = 0;
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), claim: () => Promise.resolve(false), apply: () => Promise.resolve(), fail: () => Promise.resolve() }, { integrate: () => { invoked += 1; return Promise.resolve({ memories: [] }); } });
    await integration.processReserved(request, new AbortController().signal);
    expect(invoked).toBe(0);
  });

  it("C-03: repairs one invalid MemoryIntent output with its validation issues before applying it", async () => {
    const request = input(); const applied: unknown[] = []; const repairs: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, {
      integrate: () => Promise.resolve({ memories: [{ content: "ユーザーは週末に展示へ行く予定", perspective: "user", purpose: "user-context" }] } as never),
      repair: (_input, issues) => { repairs.push(issues); return Promise.resolve({ experience: { summary: "ユーザーが週末の展示予定を話した", facts: ["週末に展示へ行く予定がある"] }, memories: [{ content: "ユーザーは週末に展示へ行く予定", reason: "週明けに結果を自然に尋ねられる", target: "episodic", perspective: "user" }] }); }
    });
    await integration.process(request, new AbortController().signal);
    expect(repairs).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  it("C-16: records a failed Integration when its one schema repair is still invalid", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, {
      integrate: () => Promise.resolve({ memories: [{ content: "不完全な記憶" }] } as never),
      repair: () => Promise.resolve({ memories: [{ content: "まだ不完全" }] } as never)
    });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow();
    expect(failed).toHaveLength(1);
  });
});
