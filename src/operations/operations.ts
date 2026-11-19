import type { Pool } from "pg";

import { initialSelfFromConfig, type BackgroundExperienceFile, type InitialSelfConfig } from "../domain/contracts.js";
import { replaceBackgroundExperiences } from "./background-experiences.js";
import type { SchedulerTimings } from "../config/config.js";

import type { AddressedFileQueue, DeadLetter } from "../infrastructure/queue/addressed-file-queue.js";
import type { LifecycleState } from "../bootstrap/lifecycle.js";
import { redactSecrets } from "../observability/redaction.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { agentFamilies, agents, agentStates, autonomousSchedules } from "../infrastructure/persistence/schema.js";

type InitializationTimings = Pick<SchedulerTimings, "autonomyReviewIntervalMs" | "stateReviewIntervalMs"> & Partial<Pick<SchedulerTimings, "concernFormationIntervalMs">>;

export async function initializeAgent(pool: Pool, config: InitialSelfConfig, timings: InitializationTimings = { autonomyReviewIntervalMs: 86_400_000, concernFormationIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000 }, options: { readonly overwriteConfiguredSelf?: boolean; readonly backgroundExperience?: BackgroundExperienceFile } = {}): Promise<void> {
  const { family, agent, initialState } = config;
  const initialSelf = initialSelfFromConfig(config);
  const database = createRuntimeDatabase(pool);
  await database.transaction(async (tx) => {
    await tx.insert(agentFamilies).values({ id: family.id, name: family.name, sharedDisposition: family.sharedDisposition, baseInstruction: family.baseInstruction }).onConflictDoNothing({ target: agentFamilies.id });
    await tx.insert(agents).values({ id: agent.id, familyId: family.id, identity: agent.identity, initialDisposition: agent.initialDisposition }).onConflictDoNothing({ target: agents.id });
    await tx.insert(agentStates).values({ agentId: agent.id, disposition: initialSelf.disposition, selfStory: initialSelf.selfStory, commitments: initialSelf.commitments, concerns: initialState.concerns, relationships: initialState.relationships, mood: initialState.mood }).onConflictDoNothing({ target: agentStates.agentId });
    if (options.overwriteConfiguredSelf === true) {
      const now = new Date();
      await tx.update(agentFamilies).set({ name: family.name, sharedDisposition: family.sharedDisposition, baseInstruction: family.baseInstruction, updatedAt: now }).where(eq(agentFamilies.id, family.id));
      await tx.update(agents).set({ familyId: family.id, identity: agent.identity, initialDisposition: agent.initialDisposition, updatedAt: now }).where(eq(agents.id, agent.id));
      await tx.update(agentStates).set({ disposition: initialSelf.disposition, selfStory: initialSelf.selfStory, commitments: initialSelf.commitments, version: sql`${agentStates.version}+1`, updatedAt: now }).where(eq(agentStates.agentId, agent.id));
    }
    await tx.delete(autonomousSchedules).where(and(eq(autonomousSchedules.agentId, agent.id), inArray(autonomousSchedules.kind, ["state-review", "memory-recall", "autonomy-review"])));
    // Persist the same clock value as `updatedAt`; otherwise a slow transaction
    // shortens an interval before the scheduler has ever seen it.
    const scheduledAt = new Date();
    const now = scheduledAt.getTime();
    await tx.insert(autonomousSchedules).values([
      { id: `idle:${agent.id}`, agentId: agent.id, kind: "idle", reason: "一定期間の無活動を契機に、現在のSelf、State、Memoryから行動を検討する", nextDueAt: new Date(now + timings.autonomyReviewIntervalMs), updatedAt: scheduledAt },
      { id: `concern-formation:${agent.id}`, agentId: agent.id, kind: "concern-formation", reason: "Self、経験、関係、探索領域から今後も残る関心を形成する", nextDueAt: new Date(now + (timings.concernFormationIntervalMs ?? timings.autonomyReviewIntervalMs)), updatedAt: scheduledAt },
      { id: `reflection:${agent.id}`, agentId: agent.id, kind: "reflection", reason: "蓄積したEvent logをMemoryと長期状態へ統合する", nextDueAt: new Date(now + timings.stateReviewIntervalMs), updatedAt: scheduledAt }
    ]).onConflictDoNothing({ target: autonomousSchedules.id });
  });
  if (options.backgroundExperience !== undefined) {
    if (options.backgroundExperience.agentId !== agent.id) throw new Error("Background Experience agentId does not match the initialized agent");
    await replaceBackgroundExperiences(pool, options.backgroundExperience, agent.id);
  }
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
