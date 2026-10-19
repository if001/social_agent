import { providerFailure } from "../../src/infrastructure/agent/ollama-provider.js";
import { errorLogContext } from "../../src/observability/logger.js";

describe("provider error boundary", () => {
  it("NFR-5: preserves the inner error for diagnostics", () => {
    const cause = new Error("unavailable");
    const error = providerFailure("Review", cause, new AbortController().signal);
    expect(error).toMatchObject({ code: "EXTERNAL", cause });
    expect(errorLogContext(error).errorCauses).toContain("unavailable");
  });
  it("NFR-5: distinguishes cancellation from deadline expiration", () => {
    const cancel = new AbortController(); cancel.abort();
    const timeout = new AbortController(); timeout.abort(new DOMException("deadline", "TimeoutError"));
    expect(providerFailure("Review", new Error("stopped"), cancel.signal).code).toBe("ABORTED");
    expect(providerFailure("Review", new Error("stopped"), timeout.signal).code).toBe("TIMEOUT");
  });
});
