import { describe, expect, it } from "vitest";

import { createOllamaChatModel } from "../../src/infrastructure/agent/ollama-provider.js";

describe("Ollama thinking levels", () => {
  it("passes the configured thinking level to ChatOllama", () => {
    const model = createOllamaChatModel({ baseUrl: "http://localhost:11434", apiKey: "test", model: "test", think: "high" });
    expect((model as unknown as { think: string }).think).toBe("high");
  });
});
