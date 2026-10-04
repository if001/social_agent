import type { Pool } from "pg";

import type { AddressedFileQueue, DeadLetter } from "../infrastructure/queue/addressed-file-queue.js";
import type { LifecycleState } from "../bootstrap/lifecycle.js";
import { redactSecrets } from "../observability/redaction.js";

export type AgentSeed = { readonly familyId: string; readonly familyName: string; readonly agentId: string; readonly identity: string; readonly sharedDisposition: string; readonly initialDisposition: string; readonly capabilities: readonly string[] };
export async function initializeAgent(pool: Pool, seed: AgentSeed): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO agent_families(id,name,shared_disposition,capabilities,base_instruction) VALUES ($1,$2,$3,$4,'') ON CONFLICT (id) DO UPDATE SET capabilities=EXCLUDED.capabilities,updated_at=now()", [seed.familyId, seed.familyName, seed.sharedDisposition, JSON.stringify([...new Set(seed.capabilities)])]);
    await client.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [seed.agentId, seed.familyId, seed.identity, seed.initialDisposition]);
    await client.query("INSERT INTO agent_states(agent_id,acquired_disposition,values,role,roles,self_narrative,self_continuity,mood,drives) VALUES ($1,'Still learning','To be discovered','Assistant','[\"Assistant\"]','I am beginning','I continue through memory','Calm','[]') ON CONFLICT (agent_id) DO NOTHING", [seed.agentId]);
    await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'state-review',$3,now()+interval '1 day') ON CONFLICT (id) DO NOTHING", [`state-review:${seed.agentId}`, seed.agentId, "時間経過によるMood、Drive、Current Interestの再評価"]);
    await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'memory-recall',$3,now()+interval '7 days') ON CONFLICT (id) DO NOTHING", [`memory-recall:${seed.agentId}`, seed.agentId, "現在の状態と未完了Intentionに関連するMemoryの再検討"]);
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
