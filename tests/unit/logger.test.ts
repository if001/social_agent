import { createStdoutLogger, errorLogContext } from "../../src/observability/logger.js";

describe("stdout logger", () => {
  it("NFR-13: writes one structured JSON line with inherited context and omits undefined fields", () => {
    const lines: string[] = [];
    const logger = createStdoutLogger({ botId: "ao", secret: undefined }, (line) => { lines.push(line); }, () => new Date("2026-01-01T00:00:00Z"));
    logger.child({ eventId: "event-1" }).log("info", "agent_core.started", { runId: "run-1" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", step: "agent_core.started", botId: "ao", eventId: "event-1", runId: "run-1" });
  });

  it("NFR-13: reports useful database error fields while redacting credentials", () => {
    const error = Object.assign(new Error("relation autonomous_schedules does not exist; password=hunter2 at postgres://user:pass@db/app"), { name: "error", code: "42P01", severity: "ERROR", table: "autonomous_schedules", routine: "parserOpenTable" });
    expect(errorLogContext(error)).toEqual({ errorType: "error", errorCode: "42P01", errorMessage: "relation autonomous_schedules does not exist; password=[REDACTED] at postgres://[REDACTED]@db/app", databaseSeverity: "ERROR", databaseTable: "autonomous_schedules", databaseRoutine: "parserOpenTable" });
  });

  it("NFR-13: preserves nested provider errors and redacts their credentials", () => {
    const root = new Error("schema rejected token=secret");
    root.name = "StructuredOutputParsingError";
    const outer = new Error("Agent provider failed", { cause: { providerError: new Error("Deep Agent invocation failed", { cause: { providerError: root } }) } });
    const context = errorLogContext(outer);
    expect(context.errorCauses).toContain("StructuredOutputParsingError");
    expect(context.errorCauses).not.toContain("token=secret");
    expect(context.errorCauses).toContain("[REDACTED]");
  });

  it("NFR-13: does not expose bearer tokens or multiline stack content", () => {
    const context = errorLogContext(new Error("Authorization: Bearer very-secret-token\nrequest failed"));
    expect(context.errorMessage).toBe("Authorization: [REDACTED] [REDACTED] request failed");
    expect(context).not.toHaveProperty("stack"); expect(context).not.toHaveProperty("cause");
  });
});
