import { z } from "zod";

import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createDeepAgentTools, createDeepAgentToolRunContext } from "../../src/infrastructure/agent/deep-agent-tools.js";
import { DeepAgentHarness, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

describe("Initial disposition → autonomous action", () => {
  it("FR-26, FR-27, FR-39: starts one bounded Tool exploration without a persisted Concern", async () => {
    const [ao, aka] = await Promise.all([loadInitialSelfFile("config/initial-self/ao.yaml"), loadInitialSelfFile("config/initial-self/aka.yaml")]);
    expect(ao.family.sharedDisposition).toBe(aka.family.sharedDisposition);
    expect(ao.agent.initialDisposition).not.toBe(aka.agent.initialDisposition);

    let toolCalls = 0;
    const registry = new ToolRegistry([{ name: "web_page", description: "Read and archive a page", schema: z.object({ urls: z.url() }), resultPolicy: { kind: "standard" }, execute: () => { toolCalls += 1; return Promise.resolve({ ok: true, value: { docs: [], archivedSnapshots: [{ snapshotId: "snapshot-1" }] } }); } }]);
    const invoker: DeepAgentInvoker = { invoke: async (modelInput, options) => {
      const prompt = modelInput.messages[0]?.content ?? "";
      expect(prompt).not.toContain(ao.agent.initialDisposition); expect(prompt).not.toContain("AIやAgentが経験から変化する仕組み"); expect(prompt).not.toContain("concernSummary");
      const context = createDeepAgentToolRunContext({ agentId: options.agentId, runId: options.runId, eventId: options.eventId, maxToolCalls: options.maxToolCalls, signal: options.signal });
      const [webPage] = createDeepAgentTools(registry, () => new Date(fixtureInstant)); await webPage?.invoke({ urls: "https://example.com/hnsw" }, { context });
      return { structuredResponse: { desire: "関心を一歩進め、発見を共有したい", action: { type: "respond", content: "調べて分かったことを共有する" } }, toolExecutions: context.collector.executions };
    } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(["web_page"]) });
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let claimed = false; const completions: (Date | null)[] = [];
    const target: ScheduledTarget = { id: "idle:ao", agentId: "ao", kind: "idle", reason: "一定期間の無活動を契機に再検討する" };
    const scheduler = new Scheduler({ repository: { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: async (event, signal) => {
      const input = agentCoreInputFixture(); input.run = { runId: "autonomy-run", eventId: event.id, agentId: "ao", occurredAt: event.occurredAt }; input.observation = { eventId: event.id, kind: "internal", summary: target.reason, facts: ["Concernと継続中のScheduled Taskはない"], observedAt: event.occurredAt, content: event.payload }; input.currentSelf = { ...input.currentSelf, agentId: "ao", identity: ao.agent.identity, disposition: `${ao.family.sharedDisposition}\n${ao.agent.initialDisposition}`, selfStory: ao.agent.selfNarrative, commitments: ao.agent.raisonDetre === undefined ? [] : [ao.agent.raisonDetre] }; input.state = { ...input.state, agentId: "ao", concerns: [] }; input.memories = []; input.availableTools = [{ name: "web_page", description: "Read and archive a page", inputSchema: {} }];
      expect(input.observation.content).toMatchObject({ targetKind: "idle" });
      return (await harness.run(input, signal)).output.action;
    } }, clock: new FixedClock(new Date(fixtureInstant)), ids: new SequenceIdGenerator(["autonomy-event"]), lifecycle, defaultDestination: () => undefined, autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000 });

    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(1);
    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(toolCalls).toBe(1); expect(completions[0]?.toISOString()).toBe("2026-01-03T03:04:05.000Z");
  });
});
