import { z } from "zod";

import { applyDriveProposals } from "../../src/application/state-update-service.js";
import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentHarness, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

describe("Self → Drive → autonomous action", () => {
  it("carries configured Self into a bounded Intention-free review and Tool decision", async () => {
    const [ao, aka] = await Promise.all([loadInitialSelfFile("config/initial-self/ao.yaml"), loadInitialSelfFile("config/initial-self/aka.yaml")]);
    expect(ao.family.sharedDisposition).toBe(aka.family.sharedDisposition);
    expect(ao.agent.initialDisposition).not.toBe(aka.agent.initialDisposition);

    const base = agentCoreInputFixture();
    const formed = applyDriveProposals({ ...base.dynamicState, drives: [] }, [{ operation: "create", description: "未知の仕組みを理解したい", reason: "アオの好奇心と過去の調査経験にとって意味がある", evidenceIds: [base.run.eventId] }], fixtureInstant);
    expect(formed.state.drives[0]).toMatchObject({ description: "未知の仕組みを理解したい", sourceEvidenceIds: [base.run.eventId] });

    let toolCalls = 0;
    const registry = new ToolRegistry([{ name: "web_page", description: "Read and archive a page", schema: z.object({ url: z.url() }), execute: () => { toolCalls += 1; return Promise.resolve({ ok: true, value: { docs: [], archivedSnapshots: [{ snapshotId: "snapshot-1" }] } }); } }]);
    const invoker: DeepAgentInvoker = { invoke: async (modelInput, options) => {
      const prompt = modelInput.messages[0]?.content ?? "";
      expect(prompt).toContain(ao.agent.initialDisposition); expect(prompt).toContain("未知の仕組みを理解したい"); expect(prompt).toContain("HNSW"); expect(prompt).toContain("以前の調査経験");
      const context = createDeepAgentToolRunContext({ agentId: options.agentId, runId: options.runId, eventId: options.eventId, maxToolCalls: options.maxToolCalls, signal: options.signal });
      const [webPage] = createDeepAgentTools(registry, () => new Date(fixtureInstant)); await webPage?.invoke({ url: "https://example.com/hnsw" }, { context });
      return { structuredResponse: { interpretation: { subjectiveMeaning: "自分の関心を一歩進める根拠を確認できた" }, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-action", reason: "外部へ通知する必要はない" } }, toolExecutions: context.collector.executions };
    } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(["web_page"]) });
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let claimed = false; const completions: (Date | null)[] = [];
    const target: ScheduledTarget = { id: "autonomy-review:ao", agentId: "ao", kind: "autonomy-review", reason: "Self、Drive、Current Interest、関連Memoryから再検討する" };
    const scheduler = new Scheduler({ repository: { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: async (event, signal) => {
      const input = agentCoreInputFixture(); input.run = { runId: "autonomy-run", eventId: event.id, agentId: "ao", occurredAt: event.occurredAt }; input.observation = { eventId: event.id, kind: "internal", summary: target.reason, facts: ["Active Intentionはない"], observedAt: event.occurredAt, content: event.payload }; input.self = { ...input.self, id: "ao", familyId: ao.family.id, identity: ao.agent.identity, disposition: { shared: ao.family.sharedDisposition, initial: ao.agent.initialDisposition, acquired: "経験から形成された傾向はまだない" }, values: ao.agent.values, selfNarrative: ao.agent.selfNarrative, selfContinuity: ao.agent.selfContinuity }; input.dynamicState = { ...formed.state, agentId: "ao", currentInterests: ["HNSW"] }; input.memories = [{ id: "memory-1", agentId: "ao", kind: "episodic", content: "以前の調査経験で索引方式に未解決点が残った", occurredAt: fixtureInstant, createdAt: fixtureInstant, relatedSubjectIds: [], relatedIntentionIds: [], importance: "現在の関心に関係する", retrievalPriority: "normal", evidenceEventIds: [base.run.eventId] }]; input.intentions = []; input.availableTools = [{ name: "web_page", description: "Read and archive a page", inputSchema: {} }];
      return (await harness.run(input, signal)).output.action;
    } }, queue: { publish: () => Promise.reject(new Error("no external delivery expected")), subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date(fixtureInstant)), ids: new SequenceIdGenerator(["autonomy-event"]), lifecycle, defaultDestination: () => undefined, autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000, persistentDriveReviewIntervalMs: 86_400_000 });

    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(1);
    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(toolCalls).toBe(1); expect(completions[0]?.toISOString()).toBe("2026-01-03T03:04:05.000Z");
  });
});
