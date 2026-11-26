import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../src/domain/contracts.js";
import { hasModelJsonSyntaxError, parseModelJson, retryMalformedModelJson } from "../../src/infrastructure/agent/model-json-parser.js";

describe("parseModelJson", () => {
  it("NFR-23: accepts a JSON payload in a json code fence", () => {
    expect(parseModelJson("```json\n{\"summary\":\"一行目\\n二行目\",\"facts\":[\"確認済み\"]}\n```"))
      .toEqual({ summary: "一行目\n二行目", facts: ["確認済み"] });
  });

  it("NFR-23: rejects YAML-like output, prose, and invalid JSON", () => {
    expect(() => parseModelJson("decision: none\nreason: no new evidence")).toThrow(SyntaxError);
    expect(() => parseModelJson("ignore\n\nnot JSON")).toThrow(SyntaxError);
    expect(() => parseModelJson("```\n{\"decision\":\"none\"}\n```")).toThrow(SyntaxError);
    expect(() => parseModelJson("{\"summary\":\"一行目\n二行目\"}")).toThrow(SyntaxError);
  });

  it("NFR-8: detects a syntax failure retained as a provider cause", () => {
    const error = new DomainError("EXTERNAL", "provider failed", { cause: new SyntaxError("Bad control character") });
    expect(hasModelJsonSyntaxError(error)).toBe(true);
    expect(hasModelJsonSyntaxError(new Error("network unavailable"))).toBe(false);
  });

  it("FR-82: retries once only when JSON syntax failed before schema validation", async () => {
    const syntaxFailure = new DomainError("EXTERNAL", "provider failed", { cause: new SyntaxError("Unexpected token") });
    const repair = vi.fn(() => Promise.resolve({ recovered: true }));
    await expect(retryMalformedModelJson(() => Promise.reject(syntaxFailure), repair)).resolves.toEqual({ recovered: true });
    expect(repair).toHaveBeenCalledTimes(1);
    await expect(retryMalformedModelJson(() => Promise.reject(new Error("network unavailable")), repair)).rejects.toThrow("network unavailable");
    expect(repair).toHaveBeenCalledTimes(1);
  });
});
