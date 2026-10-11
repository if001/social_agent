import type { Pool } from "pg";

import type { InitialSelfConfig } from "../domain/contracts.js";
import type { SchedulerTimings } from "../config/config.js";

import type { AddressedFileQueue, DeadLetter } from "../infrastructure/queue/addressed-file-queue.js";
import type { LifecycleState } from "../bootstrap/lifecycle.js";
import { redactSecrets } from "../observability/redaction.js";

export async function initializeAgent(pool: Pool, config: InitialSelfConfig, timings: Pick<SchedulerTimings, "autonomyReviewIntervalMs" | "stateReviewIntervalMs" | "memoryRecallIntervalMs"> = { autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000 }, options: { readonly overwriteConfiguredSelf?: boolean } = {}): Promise<void> {
  const { family, agent, initialState } = config;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [family.id, family.name, family.sharedDisposition, family.baseInstruction]);
    await client.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [agent.id, family.id, agent.identity, agent.initialDisposition]);
    const disposition = [family.sharedDisposition, agent.initialDisposition, agent.values].join("\n");
    const selfStory = [agent.selfNarrative, agent.selfContinuity].join("\n");
    const commitments = [...agent.roles, ...(agent.raisonDetre === undefined ? [] : [agent.raisonDetre])];
    await client.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,acquired_disposition,values,interests,preferences,roles,raison_detre,self_narrative,self_continuity,mood,motives) VALUES ($1,$2,$3,$4,'[]','[]','経験から形成された傾向はまだない',$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (agent_id) DO NOTHING", [agent.id, disposition, selfStory, JSON.stringify(commitments), agent.values, JSON.stringify(agent.interests), JSON.stringify(agent.preferences), JSON.stringify(agent.roles), agent.raisonDetre ?? null, agent.selfNarrative, agent.selfContinuity, initialState.mood, JSON.stringify(initialState.motives)]);
    if (options.overwriteConfiguredSelf === true) {
      await client.query("UPDATE agent_families SET name=$2,shared_disposition=$3,base_instruction=$4,updated_at=now() WHERE id=$1", [family.id, family.name, family.sharedDisposition, family.baseInstruction]);
      await client.query("UPDATE agents SET family_id=$2,identity=$3,initial_disposition=$4,updated_at=now() WHERE id=$1", [agent.id, family.id, agent.identity, agent.initialDisposition]);
      await client.query("UPDATE agent_states SET disposition=$2,self_story=$3,commitments=$4,values=$5,interests=$6,preferences=$7,roles=$8,raison_detre=$9,self_narrative=$10,self_continuity=$11,version=version+1,updated_at=now() WHERE agent_id=$1", [agent.id, disposition, selfStory, JSON.stringify(commitments), agent.values, JSON.stringify(agent.interests), JSON.stringify(agent.preferences), JSON.stringify(agent.roles), agent.raisonDetre ?? null, agent.selfNarrative, agent.selfContinuity]);
    }
    await client.query("DELETE FROM autonomous_schedules WHERE agent_id=$1 AND kind=ANY($2::text[])", [agent.id, ["state-review", "memory-recall", "autonomy-review"]]);
    await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'idle',$3,now()+$4*interval '1 millisecond') ON CONFLICT (id) DO NOTHING", [`idle:${agent.id}`, agent.id, "一定期間の無活動を契機に、現在のSelf、State、Memoryから行動を検討する", timings.autonomyReviewIntervalMs]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export type HealthSnapshot = { readonly state: LifecycleState; readonly accepting: boolean; readonly ready: boolean; readonly dependencies: Readonly<Record<string, "up" | "down">> };
export function healthSnapshot(state: LifecycleState, dependencies: Readonly<Record<string, "up" | "down">>): HealthSnapshot {
  const dependencyReady = Object.values(dependencies).every((value) => value === "up");
  return { state, accepting: state === "ready" || state === "degraded", ready: state === "ready" && dependencyReady, dependencies };
}

export type ArtifactMetadata = { readonly createdAt: string; readonly buildRevision: string; readonly promptVersion: string; readonly config: unknown };
export function createArtifactMetadata(input: { readonly now: Date; readonly buildRevision: string; readonly promptVersion: string; readonly config: unknown }): ArtifactMetadata {
  return { createdAt: input.now.toISOString(), buildRevision: input.buildRevision, promptVersion: input.promptVersion, config: redactSecrets(input.config) };
}

export const backupTargets = ["PostgreSQL database", "Addressed File Queue root", "evaluation artifacts", "feedback exports"] as const;
export async function listDeadLetters(queue: AddressedFileQueue, destination: string): Promise<readonly DeadLetter[]> { return queue.inspectDeadLetters(destination); }
export async function requeueDeadLetter(queue: AddressedFileQueue, destination: string, file: string): Promise<void> { await queue.requeueDeadLetter(destination, file); }
