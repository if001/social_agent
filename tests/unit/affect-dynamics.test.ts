import { describe, expect, it } from "vitest";

import { evolveMood } from "../../src/application/affect-dynamics.js";

describe("affect dynamics", () => {
  const dynamics = { default: { halfLifeMs: 1_000, gain: 2, maxLevel: 20 }, emotions: {} } as const;

  it("decays prior affect by its configured half-life", () => {
    expect(evolveMood({ updatedAt: "2026-01-01T00:00:00.000Z", levels: { anger: 8 } }, new Date("2026-01-01T00:00:01.000Z"), undefined, dynamics)).toEqual({ updatedAt: "2026-01-01T00:00:01.000Z", levels: { anger: 4 } });
  });

  it("adds this Event's structured Feeling after decay and preserves unrelated affects", () => {
    expect(evolveMood({ updatedAt: "2026-01-01T00:00:00.000Z", levels: { curiosity: 8, anger: 2 } }, new Date("2026-01-01T00:00:01.000Z"), [{ emotion: "anger", intensity: 3 }], dynamics)).toEqual({ updatedAt: "2026-01-01T00:00:01.000Z", levels: { curiosity: 4, anger: 7 } });
  });
});
