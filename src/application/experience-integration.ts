import { z } from "zod";

import type { IdGenerator } from "./ports.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MemoryIntent } from "../domain/contracts.js";
import { MemoryIntentSchema, RelationshipChangeSchema } from "../domain/contracts.js";

const MoodSchema = z.string().trim().min(1).max(160);

export const ExperienceIntegrationOutputSchema = z.object({
  memories: z.array(MemoryIntentSchema).max(3).describe("長期に再利用する経験だけ。単発のTool失敗や応答文の転載は保存しない"),
  relationship: RelationshipChangeSchema.optional().describe("今回の相手との関係が持続的に変わったときだけ指定する"),
  mood: MoodSchema.optional().describe("次の複数Eventに残る背景的な気分。今回だけのFeelingや待機理由は入れない")
}).strict().describe("応答commit後のExperience Integration出力。SelfとConcernは扱わない");
export type ExperienceIntegrationOutput = z.infer<typeof ExperienceIntegrationOutputSchema>;

export type ExperienceIntegrationInput = {
  readonly integrationId: string;
  readonly agentId: string;
  readonly sourceEvent: DomainEvent;
  readonly sourceRunId: string;
  readonly input: AgentCoreInput;
  readonly result: AgentRunResult;
};

export interface ExperienceIntegrationModel {
  integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<ExperienceIntegrationOutput>;
}

export interface ExperienceIntegrationRepository {
  begin(input: ExperienceIntegrationInput): Promise<"created" | "duplicate">;
  apply(input: ExperienceIntegrationInput, output: ExperienceIntegrationOutput): Promise<void>;
  fail(input: ExperienceIntegrationInput, error: unknown): Promise<void>;
  pending?(agentId?: string): Promise<readonly ExperienceIntegrationInput[]>;
  claim?(integrationId: string): Promise<boolean>;
}

export class ExperienceIntegration {
  constructor(private readonly repository: ExperienceIntegrationRepository, private readonly model: ExperienceIntegrationModel) {}

  async reserve(input: ExperienceIntegrationInput): Promise<boolean> { return (await this.repository.begin(input)) === "created"; }

  async process(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<void> {
    if (!await this.reserve(input)) return;
    await this.processReserved(input, signal);
  }

  async processReserved(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<void> {
    if (this.repository.claim !== undefined && !await this.repository.claim(input.integrationId)) return;
    try {
      const output = ExperienceIntegrationOutputSchema.parse(await this.model.integrate(input, signal));
      if (output.memories.some((intent) => intent.evidenceEventIds.some((eventId) => eventId !== input.sourceEvent.id))) throw new Error("Experience Integration referenced an Event outside its input");
      const actorId = input.input.observation.actor?.type === "human" || input.input.observation.actor?.type === "agent" ? input.input.observation.actor.id : undefined;
      if (output.relationship !== undefined) {
        const subjectId = output.relationship.operation === "remove" ? output.relationship.subjectId : output.relationship.relationship.subjectId;
        if (actorId === undefined || subjectId !== actorId) throw new Error("Experience Integration may update only the current event actor relationship");
      }
      await this.repository.apply(input, output);
    } catch (error) {
      await this.repository.fail(input, error);
      throw error;
    }
  }
  async retryPending(signal: AbortSignal, agentId?: string): Promise<void> {
    if (this.repository.pending === undefined) return;
    for (const input of await this.repository.pending(agentId)) await this.processReserved(input, signal);
  }
}

export interface ExperienceIntegrationSink {
  enqueue(input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void>;
  enqueueAndWait?(input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void>;
  drain?(signal: AbortSignal): Promise<void>;
}

/** Starts persistence-oriented integration only after the response transaction exists. */
export class DirectExperienceIntegrationSink implements ExperienceIntegrationSink {
  constructor(private readonly integration: ExperienceIntegration, private readonly ids: IdGenerator, private readonly timeoutMs = 60_000) {}
  enqueue(input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> {
    const request = { ...input, integrationId: this.ids.next() };
    return this.integration.reserve(request).then((reserved) => {
      if (reserved) void this.integration.processReserved(request, AbortSignal.timeout(this.timeoutMs)).catch(() => undefined);
    });
  }
  async enqueueAndWait(input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> {
    await this.integration.process({ ...input, integrationId: this.ids.next() }, AbortSignal.timeout(this.timeoutMs));
  }
  drain(signal: AbortSignal): Promise<void> { return this.integration.retryPending(signal); }
}

export function memorySubjectsForIntegration(input: ExperienceIntegrationInput, intents: readonly MemoryIntent[]): readonly (readonly string[])[] {
  const actorId = input.input.observation.actor?.type === "human" || input.input.observation.actor?.type === "agent" ? input.input.observation.actor.id : undefined;
  return intents.map((intent) => intent.perspective === "user" && actorId !== undefined ? [actorId] : []);
}
