import { describe, expect, it } from "vitest";

import { ConcernNormalizationService, type ConcernNormalizationModel, type ConcernNormalizationRepository } from "../../src/application/concern-normalization.js";
import { parseConcernNormalizationOptions } from "../../src/application/concern-normalization-cli.js";

const concerns = [
  { id: "c-long", description: "長い研究経緯", whyItMatters: "自分の好奇心に残る", status: "active" as const },
  { id: "c-keep", description: "記憶の変質が気になる", whyItMatters: "曖昧さへの好奇心", status: "active" as const }
];

describe("Concern normalization", () => {
  it("FR-8: binds each active Concern outside the model and dry-runs keep or normalize without IDs", async () => {
    const inputs: unknown[] = [];
    const model: ConcernNormalizationModel = { normalize: (input) => {
      inputs.push(input);
      return Promise.resolve(input.description.startsWith("長い")
        ? { description: "記憶が変質する条件を知りたい", whyItMatters: "曖昧さへの好奇心が続いている" }
        : { description: input.description, whyItMatters: input.whyItMatters });
    } };
    let applyCalls = 0;
    const repository: ConcernNormalizationRepository = {
      loadActive: () => Promise.resolve({ version: 4, concerns }),
      apply: () => { applyCalls += 1; return Promise.resolve(5); }
    };

    const result = await new ConcernNormalizationService(model, repository).run({ agentId: "aka", apply: false, runId: "run-1", occurredAt: new Date("2026-11-22T00:00:00Z") });

    expect(inputs).toEqual(concerns.map(({ description, whyItMatters }) => ({ description, whyItMatters })));
    expect(JSON.stringify(inputs)).not.toContain("c-long");
    expect(applyCalls).toBe(0);
    expect(result).toMatchObject({ agentId: "aka", apply: false, version: 4, normalizedCount: 1, keptCount: 1 });
    expect(result.results[0]).toMatchObject({ concernId: "c-long", operation: "normalize" });
  });

  it("NFR-8: collects every model result before one atomic apply", async () => {
    const applied: unknown[] = [];
    const model: ConcernNormalizationModel = { normalize: (input) => Promise.resolve(input.description.startsWith("長い") ? { description: "核", whyItMatters: "理由" } : input) };
    const repository: ConcernNormalizationRepository = {
      loadActive: () => Promise.resolve({ version: 4, concerns }),
      apply: (request) => { applied.push(request); return Promise.resolve(5); }
    };
    const occurredAt = new Date("2026-11-22T00:00:00Z");

    const result = await new ConcernNormalizationService(model, repository).run({ agentId: "aka", apply: true, runId: "run-1", occurredAt });

    expect(applied).toEqual([{ agentId: "aka", expectedVersion: 4, runId: "run-1", occurredAt, changes: [{ concernId: "c-long", description: "核", whyItMatters: "理由" }] }]);
    expect(result.version).toBe(5);
  });

  it("NFR-8: reports the failed target and does not apply partial results when one model call fails", async () => {
    let calls = 0; let applied = false;
    const model: ConcernNormalizationModel = { normalize: (input) => { calls += 1; return calls === 2 ? Promise.reject(new Error("provider failed")) : Promise.resolve(input); } };
    const repository: ConcernNormalizationRepository = { loadActive: () => Promise.resolve({ version: 4, concerns }), apply: () => { applied = true; return Promise.resolve(5); } };

    const result = await new ConcernNormalizationService(model, repository).run({ agentId: "aka", apply: true, runId: "run-1", occurredAt: new Date() });
    expect(applied).toBe(false);
    expect(result).toMatchObject({ apply: true, applied: false, failureCount: 1 });
    expect(result.results[1]).toEqual({ concernId: "c-keep", operation: "failed", error: "provider failed" });
  });

  it("NFR-8: requires an Agent and defaults the CLI to dry-run", () => {
    expect(parseConcernNormalizationOptions(["--agent-id", "aka"])).toEqual({ agentId: "aka", apply: false });
    expect(parseConcernNormalizationOptions(["--", "--apply", "--agent-id", "aka"])).toEqual({ agentId: "aka", apply: true });
    expect(() => parseConcernNormalizationOptions([])).toThrow("--agent-id is required");
    expect(() => parseConcernNormalizationOptions(["--agent-id"])).toThrow("--agent-id requires a value");
  });
});
