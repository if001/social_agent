import { z } from "zod";

import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentHarness, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

describe("Stable Interest → autonomous action", () => {
  it("starts one bounded Tool exploration without Drive or Current Interest", async () => {
    const [ao, aka] = await Promise.all([loadInitialSelfFile("config/initial-self/ao.yaml"), loadInitialSelfFile("config/initial-self/aka.yaml")]);
    expect(ao.family.sharedDisposition).toBe(aka.family.sharedDisposition);
    expect(ao.agent.initialDisposition).not.toBe(aka.agent.initialDisposition);

    let toolCalls = 0;
    const registry = new ToolRegistry([{ name: "web_page", description: "Read and archive a page", schema: z.object({ urls: z.url() }), resultPolicy: { kind: "standard" }, execute: () => { toolCalls += 1; return Promise.resolve({ ok: true, value: { docs: [], archivedSnapshots: [{ snapshotId: "snapshot-1" }] } }); } }]);
    const invoker: DeepAgentInvoker = { invoke: async (modelInput, options) => {
      const prompt = modelInput.messages[0]?.content ?? "";
      expect(prompt).toContain(ao.agent.initialDisposition); expect(prompt).toContain("Agentが経験や対話から変化していく仕組み"); expect(prompt).toContain('"drives":[]'); expect(prompt).toContain('"currentInterests":[]');
      const context = createDeepAgentToolRunContext({ agentId: options.agentId, runId: options.runId, eventId: options.eventId, maxToolCalls: options.maxToolCalls, signal: options.signal });
      const [webPage] = createDeepAgentTools(registry, () => new Date(fixtureInstant)); await webPage?.invoke({ urls: "https://example.com/hnsw" }, { context });
      return { structuredResponse: { interpretation: { subjectiveMeaning: "自分の関心を一歩進める根拠を確認できた" }, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action", reason: "外部へ通知する必要はない" } }, toolExecutions: context.collector.executions };
    } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(["web_page"]) });
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let claimed = false; const completions: (Date | null)[] = [];
    const target: ScheduledTarget = { id: "autonomy-review:ao", agentId: "ao", kind: "autonomy-review", reason: "Self、Drive、Current Interest、関連Memoryから再検討する" };
    const scheduler = new Scheduler({ repository: { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: async (event, signal) => {
      const input = agentCoreInputFixture(); input.run = { runId: "autonomy-run", eventId: event.id, agentId: "ao", occurredAt: event.occurredAt }; input.observation = { eventId: event.id, kind: "internal", summary: target.reason, facts: ["Drive、Current Interest、継続中のScheduled Taskはない"], observedAt: event.occurredAt, content: event.payload }; input.self = { ...input.self, id: "ao", familyId: ao.family.id, identity: ao.agent.identity, disposition: { shared: ao.family.sharedDisposition, initial: ao.agent.initialDisposition, acquired: "経験から形成された傾向はまだない" }, values: ao.agent.values, interests: ao.agent.interests, preferences: ao.agent.preferences, selfNarrative: ao.agent.selfNarrative, selfContinuity: ao.agent.selfContinuity }; input.dynamicState = { ...input.dynamicState, agentId: "ao", drives: [], currentInterests: [], interestExploration: [] }; input.memories = []; input.availableTools = [{ name: "web_page", description: "Read and archive a page", inputSchema: {} }];
      return (await harness.run(input, signal)).output.action;
    } }, queue: { publish: () => Promise.reject(new Error("no external delivery expected")), subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date(fixtureInstant)), ids: new SequenceIdGenerator(["autonomy-event"]), lifecycle, defaultDestination: () => undefined, autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000, persistentDriveReviewIntervalMs: 86_400_000 });

    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(1);
    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(toolCalls).toBe(1); expect(completions[0]?.toISOString()).toBe("2026-01-03T03:04:05.000Z");
  });
});
