import { AgentRuntime, OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { loadConfig } from "../../src/config/config.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";
import { createOllamaDeepAgentInvoker, DeepAgentHarness, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { errorLogContext } from "../../src/observability/logger.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";

describe("live Ollama user response", () => {
  it("FR-11, FR-17: answers a cold-start greeting and asks one light question with real Ollama", async () => {
    const config = await loadConfig();
    const harness = new DeepAgentHarness({
      invoker: createOllamaDeepAgentInvoker(config.chat),
      registeredToolNames: new Set(),
      maxRepairs: 1
    });
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture();
      const text = typeof event.payload.text === "string" ? event.payload.text : "";
      input.run = { runId: "live-user-run", eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt };
      input.observation = { eventId: event.id, summary: text, facts: ["ユーザーの生活、仕事、趣味、習慣はまだ分からない"], observedAt: event.occurredAt, kind: "user-message", actor: { id: "live-user", type: "human" } };
      input.currentSelf = { ...input.currentSelf, agentId: event.agentId, identity: "簡潔で誠実なテストエージェント", disposition: "人と話すことが好き。相手をまだよく知らないと少しそわそわし、日常や最近楽しかったことを一つ知りたくなる。" };
      input.state = { ...input.state, agentId: event.agentId, concerns: [] };
      input.limits = { ...input.limits, deadlineMs: Math.max(config.runDeadlineMs, 300_000), maxSteps: 8, maxToolCalls: 0 };
      return input;
    });
    const published: MessageEnvelope[] = []; let receive: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = {
      publish: (message: MessageEnvelope) => { published.push(message); return Promise.resolve(); },
      subscribe: (_destination: string, handler: (message: MessageEnvelope) => Promise<void>) => { receive = handler; return Promise.resolve(); }
    };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "live-user", queue, harness, persistence, ids: new SequenceIdGenerator(["live-event", "live-response"]), now: () => new Date("2026-10-12T00:00:00.000Z") });
    await runtime.start(new AbortController().signal);
    try {
      await receive?.(messageFixture({ id: "live-user-message", destination: "agent-a", source: "live-user", replyTo: "live-user", sentAt: "2026-10-12T00:00:00.000Z", availableAt: "2026-10-12T00:00:00.000Z", expiresAt: "2026-10-13T00:00:00.000Z", payload: { type: "user-message", text: "こんにちは。今日は少し話したいです。" } }));
    } catch (error) { throw new Error(`Live Agent failed: ${JSON.stringify(errorLogContext(error))}`); }

    const pending = await persistence.pendingOutbox(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.envelope.payload).toMatchObject({ type: "agent-response", agentId: "agent-a" });
    const payload = pending[0]?.envelope.payload;
    expect(payload !== undefined && payload.type === "agent-response" && typeof payload.text === "string" && payload.text.trim().length > 0).toBe(true);
    if (payload === undefined || payload.type !== "agent-response" || typeof payload.text !== "string") throw new Error("Expected Agent response text");
    const questionSentences = payload.text.split(/(?<=[。！？?])/u).filter((sentence) => /[?？]|教えて(?:ください)?|聞かせて(?:ください)?/u.test(sentence));
    if (questionSentences.length !== 1) throw new Error(`Expected one question, received ${String(questionSentences.length)}: ${payload.text}`);
    await expect(new OutboxDispatcher(persistence, queue).dispatch()).resolves.toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.destination).toBe("live-user");
  });

  it("FR-14, AC-2: uses real Ollama to repair an invalid first Agent Turn and then commits the response", async () => {
    const config = await loadConfig(); const base = createOllamaDeepAgentInvoker(config.chat); let decisionCalls = 0;
    const invoker: DeepAgentInvoker = {
      invoke: (input, options) => {
        decisionCalls += 1;
        if (decisionCalls === 1) return Promise.resolve({ structuredResponse: { desire: "回答したい", action: "respond" }, modelCalls: 1 });
        return base.invoke(input, options);
      }
    };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 });
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture(); input.run = { runId: "live-repair-run", eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt };
      input.observation = { eventId: event.id, summary: "日本語で一文だけ返答してください", facts: [], observedAt: event.occurredAt, kind: "user-message" };
      input.currentSelf = { ...input.currentSelf, agentId: event.agentId }; input.state = { ...input.state, agentId: event.agentId, concerns: [] };
      input.limits = { ...input.limits, deadlineMs: Math.max(config.runDeadlineMs, 300_000), maxSteps: 8, maxToolCalls: 0 }; return input;
    });
    let receive: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: () => Promise.resolve(), subscribe: (_destination: string, handler: (message: MessageEnvelope) => Promise<void>) => { receive = handler; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "live-user", queue, harness, persistence, ids: new SequenceIdGenerator(["live-repair-event", "live-repair-response"]), now: () => new Date("2026-10-12T00:00:00.000Z") });
    await runtime.start(new AbortController().signal);
    try { await receive?.(messageFixture({ id: "live-repair-message", destination: "agent-a", source: "live-user", replyTo: "live-user", sentAt: "2026-10-12T00:00:00.000Z", availableAt: "2026-10-12T00:00:00.000Z", expiresAt: "2026-10-13T00:00:00.000Z", payload: { type: "user-message", text: "日本語で一文だけ返答してください。" } })); }
    catch (error) { throw new Error(`Live repair failed: ${JSON.stringify(errorLogContext(error))}`); }
    expect(decisionCalls).toBe(2); expect(persistence.events).toHaveLength(1); expect(persistence.receipts.size).toBe(1); expect(await persistence.pendingOutbox(10)).toHaveLength(1); expect(persistence.failures).toHaveLength(0);
  });
});
