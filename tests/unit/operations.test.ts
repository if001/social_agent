import { backupTargets, createArtifactMetadata, healthSnapshot } from "../../src/operations/operations.js";

describe("operations", () => {
  it("reports health and readiness separately", () => { expect(healthSnapshot("ready", { database: "up", queue: "up" })).toMatchObject({ accepting: true, ready: true }); expect(healthSnapshot("degraded", { database: "up", queue: "down" })).toMatchObject({ accepting: true, ready: false }); });
  it("creates reproducible secret-free artifact metadata", () => { const metadata = createArtifactMetadata({ now: new Date("2026-01-01T00:00:00Z"), buildRevision: "abc", promptVersion: "v1", config: { OLLAMA_API_KEY: "secret", model: "chat" } }); expect(metadata).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", buildRevision: "abc", promptVersion: "v1", config: { OLLAMA_API_KEY: "[REDACTED]", model: "chat" } }); });
  it("declares every stateful backup target", () => { expect(backupTargets).toContain("PostgreSQL database"); expect(backupTargets).toContain("Addressed File Queue root"); });
});
