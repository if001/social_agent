import { DefaultAffectDynamics, EmotionSchema, MoodSchema, type AffectDynamics, type Feeling, type Mood } from "../domain/contracts.js";

const entries = EmotionSchema.options;

function parameters(dynamics: AffectDynamics, emotion: typeof entries[number]) {
  const override = dynamics.emotions[emotion];
  return { halfLifeMs: override?.halfLifeMs ?? dynamics.default.halfLifeMs, gain: override?.gain ?? dynamics.default.gain, maxLevel: override?.maxLevel ?? dynamics.default.maxLevel };
}

/** FR-9: The Runtime, not an LLM, carries short lived Feeling into Mood. */
export function evolveMood(current: Mood, at: Date, feeling: Feeling | undefined, dynamics: AffectDynamics = DefaultAffectDynamics): Mood {
  const elapsedMs = Math.max(0, at.getTime() - new Date(current.updatedAt).getTime());
  const additions = new Map(feeling?.map(({ emotion, intensity }) => [emotion, intensity]) ?? []);
  const levels: Partial<Record<typeof entries[number], number>> = {};
  for (const emotion of entries) {
    const { halfLifeMs, gain, maxLevel } = parameters(dynamics, emotion);
    const existing = current.levels[emotion] ?? 0;
    const decayed = existing * Math.exp(-Math.LN2 * elapsedMs / halfLifeMs);
    const next = Math.min(maxLevel, Math.max(0, decayed + (additions.get(emotion) ?? 0) * gain));
    if (next > 0.001) levels[emotion] = next;
  }
  return MoodSchema.parse({ updatedAt: at.toISOString(), levels });
}

const labels: Record<typeof entries[number], string> = { joy: "喜び", sadness: "悲しみ", anger: "怒り", surprise: "驚き", anxiety: "不安", vigilance: "警戒", boredom: "退屈", relief: "安堵", pride: "誇り", curiosity: "好奇心" };

/** ID-free compact view shared by every LLM input and the Debug UI. */
export function describeMood(mood: Mood, limit = 3): string {
  const parts = Object.entries(mood.levels)
    .filter((entry): entry is [typeof entries[number], number] => EmotionSchema.safeParse(entry[0]).success && typeof entry[1] === "number")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([emotion, level]) => `${labels[emotion]} ${Math.max(1, Math.min(5, Math.round(level / 4)))}`);
  return parts.length === 0 ? "特に強い気分はない" : parts.join(" / ");
}
