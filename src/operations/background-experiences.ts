import type { Pool } from "pg";

import type { BackgroundExperienceFile } from "../domain/contracts.js";
import { validateBackgroundExperienceFile } from "../config/background-experience.js";

/**
 * Replaces the configured background experiences for one agent.
 * This is intentionally an initialization operation; it is not called during normal conversation.
 */
export async function replaceBackgroundExperiences(pool: Pool, file: BackgroundExperienceFile, expectedAgentId: string): Promise<number> {
  const validated = validateBackgroundExperienceFile(file);
  if (validated.agentId !== expectedAgentId) throw new Error("Background Experience agentId does not match the target agent");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM background_experiences WHERE agent_id=$1", [validated.agentId]);
    for (const experience of validated.experiences) {
      await client.query(
        `INSERT INTO background_experiences(
          id,agent_id,occurred_at,phase,place,participants,relationship,action,feeling,outcome,lesson,importance,tags,embedding_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')`,
        [
          experience.id,
          validated.agentId,
          experience.occurredAt,
          experience.phase,
          experience.place,
          JSON.stringify(experience.participants),
          experience.relationship,
          experience.action,
          experience.feeling,
          experience.outcome,
          experience.lesson,
          experience.importance,
          JSON.stringify(experience.tags)
        ]
      );
    }
    await client.query("COMMIT");
    return validated.experiences.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
