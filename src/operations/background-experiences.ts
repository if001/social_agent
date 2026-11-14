import type { Pool } from "pg";

import type { BackgroundExperienceFile } from "../domain/contracts.js";
import { validateBackgroundExperienceFile } from "../config/background-experience.js";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { backgroundExperiences } from "../infrastructure/persistence/schema.js";
import { eq } from "drizzle-orm";

/**
 * Replaces the configured background experiences for one agent.
 * This is intentionally an initialization operation; it is not called during normal conversation.
 */
export async function replaceBackgroundExperiences(pool: Pool, file: BackgroundExperienceFile, expectedAgentId: string): Promise<number> {
  const validated = validateBackgroundExperienceFile(file);
  if (validated.agentId !== expectedAgentId) throw new Error("Background Experience agentId does not match the target agent");
  const database = createRuntimeDatabase(pool);
  await database.transaction(async (tx) => {
    await tx.delete(backgroundExperiences).where(eq(backgroundExperiences.agentId, validated.agentId));
    if (validated.experiences.length > 0) await tx.insert(backgroundExperiences).values(validated.experiences.map((experience) => ({
      id: experience.id, agentId: validated.agentId, occurredAt: new Date(experience.occurredAt), phase: experience.phase,
      place: experience.place, participants: experience.participants, relationship: experience.relationship,
      action: experience.action, feeling: experience.feeling, outcome: experience.outcome, lesson: experience.lesson,
      importance: experience.importance, tags: experience.tags, embeddingStatus: "pending"
    })));
  });
  return validated.experiences.length;
}
