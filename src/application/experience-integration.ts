import { z } from "zod";

import type { IdGenerator } from "./ports.js";
import type { CanonicalSubjectResolver } from "./canonical-subject.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MemoryIntent } from "../domain/contracts.js";
import { CurrentRelationshipDescriptionSchema, MemoryIntentTargetSchema, MemoryPerspectiveSchema, PersistentMoodSchema } from "../domain/contracts.js";

export const EventExperienceSchema = z.object({
  summary: z.string().trim().min(1).max(800).describe("確定した今回のEventで起きたこと・選択・結果を1〜2文で要約する。起動理由、Meaning、Feeling、Desire、未確認の推測は書かない"),
  facts: z.array(z.string().trim().min(1).max(240)).max(4).describe("summaryと重複しない、今回のEventで確認できた具体的事実。固定のtrigger reasonやTool失敗そのものは書かない")
}).strict().describe("commit後に形成する、Reflectionと検索のためのEvent固有経験");

export const ExperienceIntegrationOutputSchema = z.object({
  experience: EventExperienceSchema.describe("今回のEventで確定した出来事・選択・結果。長期Memoryを作らない場合でも必ず形成する"),
  memories: z.array(z.object({ content: z.string().trim().min(1).max(16_000), reason: z.string().trim().min(1).max(16_000), target: MemoryIntentTargetSchema, perspective: MemoryPerspectiveSchema }).strict()).max(3).describe("長期に再利用する経験候補。根拠Event、subject、更新対象はRuntimeがsource Eventから解決する"),
  relationship: z.object({ operation: z.enum(["upsert", "remove"]), currentDescription: CurrentRelationshipDescriptionSchema.optional(), description: CurrentRelationshipDescriptionSchema.optional(), reason: z.string().trim().min(1).max(800) }).strict().optional().describe("今回のactorとの関係候補。現在の関係だけを短く書き、個別出来事・履歴・IDは出さない。Runtimeがactorと現在本文から対象を解決する"),
  mood: PersistentMoodSchema.optional()
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
  integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown>;
  repair?(input: ExperienceIntegrationInput, validationIssues: readonly z.core.$ZodIssue[], signal: AbortSignal): Promise<unknown>;
}

export interface ExperienceIntegrationRepository {
  begin(input: ExperienceIntegrationInput): Promise<"created" | "duplicate">;
  apply(input: ExperienceIntegrationInput, output: ExperienceIntegrationOutput): Promise<void>;
  fail(input: ExperienceIntegrationInput, error: unknown): Promise<void>;
  pending?(agentId?: string): Promise<readonly ExperienceIntegrationInput[]>;
  claim?(integrationId: string): Promise<boolean>;
}

const noSubjects: CanonicalSubjectResolver = { resolve: () => undefined, actorIdsFor: () => [] };

export class ExperienceIntegration {
  constructor(private readonly repository: ExperienceIntegrationRepository, private readonly model: ExperienceIntegrationModel, private readonly subjects: CanonicalSubjectResolver = noSubjects) {}

  async reserve(input: ExperienceIntegrationInput): Promise<boolean> { return (await this.repository.begin(input)) === "created"; }

  async process(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<void> {
    if (!await this.reserve(input)) return;
    await this.processReserved(input, signal);
  }

  async processReserved(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<void> {
    if (this.repository.claim !== undefined && !await this.repository.claim(input.integrationId)) return;
    try {
      const first = ExperienceIntegrationOutputSchema.safeParse(await this.model.integrate(input, signal));
      let output = first.success ? first.data : this.model.repair === undefined
        ? (() => { throw first.error; })()
        : ExperienceIntegrationOutputSchema.parse(await this.model.repair(input, first.error.issues, signal));
      if (output.relationship !== undefined && this.subjects.resolve(input.input.observation.actor) === undefined) output = { ...output, relationship: undefined };
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

export function memorySubjectsForIntegration(input: ExperienceIntegrationInput, intents: readonly Pick<MemoryIntent, "perspective">[], subjects: CanonicalSubjectResolver = noSubjects): readonly (readonly string[])[] {
  const subjectId = subjects.resolve(input.input.observation.actor);
  return intents.map((intent) => intent.perspective === "user" && subjectId !== undefined ? [subjectId] : []);
}
