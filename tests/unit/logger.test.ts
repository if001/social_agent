import { createStdoutLogger } from "../../src/observability/logger.js";

describe("stdout logger", () => {
  it("writes one structured JSON line with inherited context and omits undefined fields", () => {
    const lines: string[] = [];
    const logger = createStdoutLogger({ botId: "ao", secret: undefined }, (line) => { lines.push(line); }, () => new Date("2026-01-01T00:00:00Z"));
    logger.child({ eventId: "event-1" }).log("info", "agent_core.started", { runId: "run-1" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", step: "agent_core.started", botId: "ao", eventId: "event-1", runId: "run-1" });
  });
});
