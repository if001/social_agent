import { z } from "zod";

import { AgentStateSchema, ConcernChangeSchema, EpisodicMemorySchema, RelationshipChangeSchema, SelfSchema, DomainError } from "../domain/contracts.js";

const Id = z.string().trim().min(1);
const Text = z.string().trim().min(1).max(16_000);

export const ReflectionInputSchema = z.object({
  reflectionId: Id,
  agentId: Id,
  expectedVersion: z.number().int().nonnegative(),
  self: SelfSchema,
  state: AgentStateSchema,
  events: z.array(z.object({ id: Id, occurredAt: z.iso.datetime({ offset: true }), summary: Text })).min(1),
  memories: z.array(EpisodicMemorySchema)
});
export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;

export const ReflectionOutputSchema = z.object({
  memories: z.array(EpisodicMemorySchema.omit({ id: true, createdAt: true })),
  concernChanges: z.array(ConcernChangeSchema),
  relationshipChanges: z.array(RelationshipChangeSchema),
  mood: Text.optional(),
  self: SelfSchema.optional(),
  selfChangeReason: Text.optional(),
  evidenceMemoryIds: z.array(Id).default([])
}).superRefine((value, context) => {
  if ((value.self === undefined) !== (value.selfChangeReason === undefined)) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "Self changes require an explicit reason" });
  if (value.self !== undefined && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "Self changes require Memory evidence" });
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export interface ReflectionModel { reflect(input: ReflectionInput, signal: AbortSignal): Promise<ReflectionOutput>; }
export interface ReflectionRepository {
  load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined>;
  commit(input: ReflectionInput, output: ReflectionOutput): Promise<"committed" | "duplicate">;
  fail(input: ReflectionInput, error: unknown): Promise<void>;
}

export class Reflection {
  constructor(private readonly repository: ReflectionRepository, private readonly model: ReflectionModel) {}

  async process(reflectionId: string, agentId: string, signal: AbortSignal): Promise<ReflectionOutput | undefined> {
    const loaded = await this.repository.load(reflectionId, agentId);
    if (loaded === undefined) return undefined;
    const input = ReflectionInputSchema.parse(loaded);
    try {
      const output = ReflectionOutputSchema.parse(await this.model.reflect(input, signal));
      const knownMemories = new Set(input.memories.map(({ id }) => id));
      if (output.evidenceMemoryIds.some((id) => !knownMemories.has(id))) throw new DomainError("VALIDATION", "Reflection referenced Memory outside its input");
      await this.repository.commit(input, output);
      return output;
    } catch (error) {
      await this.repository.fail(input, error);
      throw error;
    }
  }
}
