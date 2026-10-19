import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("ST-06 restart recovery", () => {
  it("NFR-9: retains a pending message across queue instances", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const now = () => new Date("2026-01-02T03:04:05Z"); await new AddressedFileQueue(root, { now }).publish(messageFixture({ destination: "agent" }));
    let delivered = 0; const controller = new AbortController(); await new AddressedFileQueue(root, { now }).subscribe("agent", () => { delivered += 1; controller.abort(); return Promise.resolve(); }, controller.signal); expect(delivered).toBe(1); await scope.close();
  });
});
