import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { loadBackgroundExperienceFile, validateBackgroundExperienceFile } from "../../src/config/background-experience.js";

const profile = {
  nature: "AI" as const,
  createdBy: "if001" as const,
  origin: "if001によって、対話を通じて経験を積むAgentとして作成された",
  purpose: "対話から自分の視点を育てる",
  experienceScope: ["複数ユーザーとの対話", "Web探索"],
  values: ["誠実さ", "好奇心"],
  recurringTopics: ["対話", "探索"],
  communicationHabits: ["結論から話す"]
};

const experience = (id: string, occurredAt: string, phase: "最初期" | "初期" | "中期" | "最近", overrides: Record<string, unknown> = {}) => ({
  id,
  occurredAt,
  phase,
  place: "対話環境",
  participants: ["ユーザーA"],
  relationship: "対話相手",
  action: "会話から発見を得た",
  feeling: "落ち着いた",
  outcome: "新しい見方を得た",
  lesson: "対話で考えが動く",
  importance: "普通",
  tags: ["対話", "発見"],
  ...overrides
});

const file = (experiences: ReturnType<typeof experience>[]) => ({ version: 1 as const, agentId: "aka", profile, experiences });

describe("FR-53, FR-54, NFR-19: Background Experience YAML", () => {
  it("FR-53, NFR-19: accepts a chronological AI experience file", async () => {
    const valid = file([experience("e1", "2024-04-01T00:00:00+09:00", "初期"), experience("e2", "2025-04-01T00:00:00+09:00", "中期", { tags: ["探索", "学び"], importance: "高い" })]);
    expect(validateBackgroundExperienceFile(valid).experiences).toHaveLength(2);
    const directory = await mkdtemp(join(tmpdir(), "background-experience-"));
    try {
      const path = join(directory, "aka.yaml");
      await writeFile(path, stringify(valid), "utf8");
      await expect(loadBackgroundExperienceFile(path)).resolves.toMatchObject({ agentId: "aka" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("FR-54, NFR-19: rejects duplicate IDs, non-chronological entries, the current user and identifiable people", () => {
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2024-04-01T00:00:00+09:00", "初期"), experience("e1", "2025-04-01T00:00:00+09:00", "中期")]))).toThrow(/duplicate/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2025-04-01T00:00:00+09:00", "中期"), experience("e2", "2024-04-01T00:00:00+09:00", "初期")]))).toThrow(/chronological/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2024-04-01T00:00:00+09:00", "初期", { participants: ["owner"] })]))).toThrow(/current user/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2024-04-01T00:00:00+09:00", "初期", { participants: ["山田太郎"] })]))).toThrow(/identifiable real person/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2024-04-01T00:00:00+09:00", "初期", { participants: ["if001"] })]))).not.toThrow();
  });

  it("NFR-19: rejects a decreasing phase and future experiences", () => {
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2024-04-01T00:00:00+09:00", "中期"), experience("e2", "2025-04-01T00:00:00+09:00", "初期")]))).toThrow(/phase decreases/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2099-04-01T00:00:00+09:00", "最近")]))).toThrow(/future/);
  });

  it("NFR-19: rejects a skewed distribution in a full history", () => {
    const phaseAt = (index: number): "最初期" | "初期" | "中期" | "最近" => index < 3 ? "最初期" : index < 6 ? "初期" : index < 8 ? "中期" : "最近";
    const experiences = Array.from({ length: 10 }, (_, index) => experience(`e${String(index)}`, `${String(2016 + index)}-04-01T00:00:00+09:00`, phaseAt(index), { tags: ["同じ"], feeling: "同じ", importance: "普通" }));
    expect(() => validateBackgroundExperienceFile(file(experiences))).toThrow(/tags are not distributed|feelings are not distributed/);
    const samePhase = Array.from({ length: 10 }, (_, index) => experience(`p${String(index)}`, `${String(2016 + index)}-04-01T00:00:00+09:00`, "最近", { tags: [`t${String(index % 5)}`], feeling: `f${String(index % 3)}`, importance: index % 2 === 0 ? "普通" : "高い" }));
    expect(() => validateBackgroundExperienceFile(file(samePhase))).toThrow(/phases are not distributed/);
  });

  it("FR-53, FR-54, NFR-19: validates the generated aka and shiro histories", async () => {
    for (const agentId of ["aka", "shiro"]) {
      const generated = await loadBackgroundExperienceFile(`config/background-experiences/${agentId}.yaml`);
      expect(generated.agentId).toBe(agentId);
      expect(generated.experiences).toHaveLength(100);
      expect(generated.profile.nature).toBe("AI");
      expect(generated.profile.createdBy).toBe("if001");
    }
  });
});
