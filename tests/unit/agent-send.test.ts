import { ToolRegistry } from "../../src/application/tool-registry.js";
import { FixedClock } from "../../src/infrastructure/system.js";
import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { createAgentSendTool } from "../../src/infrastructure/tools/agent-send-tool.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("agent_send", () => {
  it("uses a stable idempotency ID and preserves provenance, hop and TTL", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const registry = new ToolRegistry([createAgentSendTool({ queue, clock, maxHops: 3, provenance: () => ({ parentHop: 1, expiresAt: "2026-01-02T00:00:00Z", replyTo: "agent-a" }) })]); const context = { agentId: "agent-a", runId: "run", idempotencyKey: "run:call" };
    const first = await registry.execute("agent_send", { destinationAgentId: "agent-b", content: "A reported fact" }, context, new AbortController().signal); const second = await registry.execute("agent_send", { destinationAgentId: "agent-b", content: "A reported fact" }, context, new AbortController().signal);
    expect(first).toEqual(second); const received: unknown[] = []; const controller = new AbortController(); const running = queue.subscribe("agent-b", (message) => { received.push(message); controller.abort(); return Promise.resolve(); }, controller.signal); await running;
    expect(received).toMatchObject([{ source: "agent-a", destination: "agent-b", replyTo: "agent-a", hop: 2, payload: { type: "agent-message", senderAgentId: "agent-a", content: "A reported fact" } }]); await scope.close();
  });
  it("stops expired and excessive-hop messages", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-02T00:00:00Z")); const queue = new AddressedFileQueue(root); const context = { agentId: "a", runId: "r", idempotencyKey: "k" };
    const execute = (parentHop: number, expiresAt: string) => new ToolRegistry([createAgentSendTool({ queue, clock, maxHops: 2, provenance: () => ({ parentHop, expiresAt }) })]).execute("agent_send", { destinationAgentId: "b", content: "x" }, context, new AbortController().signal);
    await expect(execute(2, "2026-01-03T00:00:00Z")).rejects.toThrow("hop limit"); await expect(execute(0, "2026-01-01T00:00:00Z")).rejects.toThrow("TTL"); await scope.close();
  });
});
