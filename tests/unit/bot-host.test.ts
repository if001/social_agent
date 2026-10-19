import type { Pool } from "pg";

import { BotHost } from "../../src/bootstrap/bot-host.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";

describe("BotHost startup failure", () => {
  it("NFR-10: closes an owned pool only once when startup fails", async () => {
    let closes = 0;
    const pool = { query: () => Promise.reject(new Error("database unavailable")), end: () => { closes += 1; return Promise.resolve(); } } as unknown as Pool;
    const host = new BotHost({ pool, agentId: "agent-a", lifecycle: new ProcessLifecycle(), closePool: true, capabilityCheck: () => Promise.resolve(), runtime: { start: () => Promise.resolve(), drain: () => Promise.resolve() }, scheduler: { tick: () => Promise.resolve(0) }, outbox: { dispatch: () => Promise.resolve(0) }, discord: { startInbound: () => Promise.resolve(), startOutbound: () => Promise.resolve() }, schedulerIntervalMs: 1_000, outboxIntervalMs: 1_000 });
    await expect(host.start()).rejects.toThrow("database unavailable");
    await host.stop();
    expect(closes).toBe(1);
  });
});
