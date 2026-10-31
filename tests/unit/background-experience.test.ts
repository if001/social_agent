import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { loadBackgroundExperienceFile, validateBackgroundExperienceFile } from "../../src/config/background-experience.js";

const profile = {
  birthYear: 1990,
  currentAge: 35,
  birthplace: "神奈川",
  currentCity: "東京",
  occupation: "編集者",
  family: ["母", "父"],
  closePeople: ["大学の友人"],
  values: ["誠実さ", "好奇心"],
  recurringTopics: ["本", "街歩き"],
  communicationHabits: ["結論から話す"]
};

const experience = (id: string, occurredAt: string, age: number, overrides: Record<string, unknown> = {}) => ({
  id,
  occurredAt,
  age,
  place: "東京",
  participants: ["友人"],
  relationship: "友人",
  action: "街を歩いた",
  feeling: "落ち着いた",
  outcome: "新しい店を見つけた",
  lesson: "歩くと発見がある",
  importance: "普通",
  tags: ["散歩", "発見"],
  ...overrides
});

const file = (experiences: ReturnType<typeof experience>[]) => ({ version: 1 as const, agentId: "aka", profile, experiences });

describe("FR-53, FR-54, NFR-19: Background Experience YAML", () => {
  it("FR-53, NFR-19: accepts a chronological file with a consistent profile", async () => {
    const valid = file([experience("e1", "2018-04-01T00:00:00+09:00", 28), experience("e2", "2020-04-01T00:00:00+09:00", 30, { tags: ["仕事", "学び"], importance: "高い" })]);
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

  it("FR-54, NFR-19: rejects duplicate IDs, non-chronological entries and the current user", () => {
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2018-04-01T00:00:00+09:00", 28), experience("e1", "2020-04-01T00:00:00+09:00", 30)]))).toThrow(/duplicate/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2020-04-01T00:00:00+09:00", 30), experience("e2", "2018-04-01T00:00:00+09:00", 28)]))).toThrow(/chronological/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2018-04-01T00:00:00+09:00", 28, { participants: ["owner"] })]))).toThrow(/current user/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2018-04-01T00:00:00+09:00", 28, { participants: ["山田太郎"] })]))).toThrow(/identifiable real person/);
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2018-04-01T00:00:00+09:00", 28, { participants: ["山田先生"] })]))).toThrow(/identifiable real person/);
  });

  it("NFR-19: rejects age/profile contradictions and an inconsistent current age", () => {
    expect(() => validateBackgroundExperienceFile(file([experience("e1", "2018-04-01T00:00:00+09:00", 32)]))).toThrow(/contradicts/);
    expect(() => validateBackgroundExperienceFile({ ...file([experience("e1", "2018-04-01T00:00:00+09:00", 28)]), profile: { ...profile, currentAge: 20 } })).toThrow(/inconsistent/);
  });

  it("FR-53, FR-54, NFR-19: validates the generated aka and shiro histories", async () => {
    for (const agentId of ["aka", "shiro"]) {
      const generated = await loadBackgroundExperienceFile(`config/background-experiences/${agentId}.yaml`);
      expect(generated.agentId).toBe(agentId);
      expect(generated.experiences).toHaveLength(100);
      expect(new Set(generated.experiences.map(({ tags }) => tags.join("|"))).size).toBeGreaterThan(5);
    }
  });

  it("NFR-19: rejects a skewed distribution in a full history", () => {
    const experiences = Array.from({ length: 10 }, (_, index) => experience(`e${String(index)}`, `${String(2010 + index)}-04-01T00:00:00+09:00`, 20 + index, { tags: ["同じ"], feeling: "同じ", importance: "普通" }));
    expect(() => validateBackgroundExperienceFile(file(experiences))).toThrow(/tags are not distributed|feelings are not distributed/);
    const varied = Array.from({ length: 10 }, (_, index) => experience(`v${String(index)}`, `${String(2010 + index)}-04-01T00:00:00+09:00`, 20 + index, { tags: [`t${String(index % 5)}`], feeling: `f${String(index % 3)}`, importance: "普通" }));
    expect(() => validateBackgroundExperienceFile(file(varied))).toThrow(/importance is not distributed/);
    const sameAge = Array.from({ length: 10 }, (_, index) => experience(`a${String(index)}`, `2010-${String(index + 1).padStart(2, "0")}-01T00:00:00+09:00`, 20, { tags: [`t${String(index % 5)}`], feeling: `f${String(index % 3)}`, importance: index % 2 === 0 ? "普通" : "高い" }));
    expect(() => validateBackgroundExperienceFile(file(sameAge))).toThrow(/ages are not distributed/);
  });
});
