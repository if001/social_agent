import { z } from "zod";

import type { IdGenerator } from "./ports.js";
import type { CanonicalSubjectResolver } from "./canonical-subject.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MemoryIntent } from "../domain/contracts.js";
import { CurrentRelationshipDescriptionSchema, MemoryIntentTargetSchema, MemoryPerspectiveSchema, PersistentMoodSchema } from "../domain/contracts.js";
import type { ConcernReevaluation, ConcernReevaluationSource } from "./concern-reevaluation.js";

export const EventExperienceSchema = z.object({
  summary: z.string().trim().min(1).max(800).describe("確定した今回のEventで起きたこと・選択・結果を1〜2文で要約する。起動理由、Meaning、Feeling、Desire、未確認の推測は書かない"),
  facts: z.array(z.string().trim().min(1).max(240)).max(4).describe("summaryと重複しない、今回のEventで確認できた具体的事実。固定のtrigger reasonやTool失敗そのものは書かない")
}).strict().describe("commit後に形成する、Reflectionと検索のためのEvent固有経験");

const RelationshipCandidateSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("今回のactorとの持続的な関係を現在状態として更新するならupsert、根拠を失った既存Relationshipを消すならremove"),
  currentDescription: CurrentRelationshipDescriptionSchema.optional().describe("更新または削除の対象を示す現在のRelationship本文。ID、出来事の履歴、人物プロフィールは書かない"),
  description: CurrentRelationshipDescriptionSchema.optional().describe("upsert後の現在の関係の型、安定した会話前提、未解決の約束だけを表す本文。個別Event、Concern、Feeling、応答方針は書かない"),
  reason: z.string().trim().min(1).max(800).describe("今回の確定Eventが、なぜ関係の持続的な変化を示すかを短く書く。人物プロフィールや次の行動計画は書かない")
}).strict();

const ExperienceIntegrationMemoryCandidateSchema = z.object({
  content: z.string().trim().min(1).max(800).describe("将来の判断で再利用できる、今回の経験の具体的な要点を1〜2文で書く。会話やTool本文の複写、未確認の推測、実行手順は書かない"),
  reason: z.string().trim().min(1).max(400).describe("この要点を今後も残す理由を短く書く。保存先、ID、根拠一覧、次の行動計画は書かない"),
  target: MemoryIntentTargetSchema,
  perspective: MemoryPerspectiveSchema
}).strict().describe("Experience Integrationが提案する短い再利用用Memory候補");

/** The Runtime binds the target; the model never receives or returns its ID. */
export const FocusConcernOutcomeSchema = z.object({
  outcome: z.enum(["unchanged", "progress", "satisfied", "abandoned"]).describe("今回の確定経験によるFocus Concernの変化。核となる関心が実質的に満たされた時だけsatisfied、現在のSelfにとって価値を失ったことが明確な時だけabandonedを選ぶ。検索失敗・情報不足・一時的なFeelingだけではabandonedにしない"),
  reason: z.string().trim().min(1).max(800).describe("今回のEvent、Tool結果、作成Memoryから判断できる短い理由。Concern ID、Event ID、実行手順、次の行動計画は書かない")
}).strict().describe("Runtimeが束縛した一件のFocus ConcernへのIDなしの判断");

export const ExperienceIntegrationOutputSchema = z.object({
  experience: EventExperienceSchema.describe("今回のEventで確定した出来事・選択・結果。長期Memoryを作らない場合でも必ず形成する"),
  memories: z.array(ExperienceIntegrationMemoryCandidateSchema).max(3).describe("長期に再利用する経験候補。根拠Event、subject、更新対象はRuntimeがsource Eventから解決する"),
  relationship: RelationshipCandidateSchema.optional().describe("今回のactorとの関係候補。現在の関係だけを短く書き、個別出来事・履歴・IDは出さない。Runtimeがactorと現在本文から対象を解決する"),
  mood: PersistentMoodSchema.optional(),
  focusConcern: FocusConcernOutcomeSchema.optional().describe("入力にfocusConcernがある時だけ、その一件への変化を判断する。入力にない時は出さない")
}).strict().describe("応答commit後のExperience Integration出力。Selfと、Runtimeが束縛していないConcernは扱わない");
export type ExperienceIntegrationOutput = z.infer<typeof ExperienceIntegrationOutputSchema>;

export type ExperienceIntegrationInput = {
  readonly integrationId: string;
  readonly agentId: string;
  readonly sourceEvent: DomainEvent;
  readonly sourceRunId: string;
  readonly input: AgentCoreInput;
  readonly result: AgentRunResult;
  /** Runtime-only association. Its ID is never exposed to the model. */
  readonly focusConcern?: { readonly concernId: string; readonly description: string; readonly whyItMatters: string };
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
  reevaluationSource?(input: ExperienceIntegrationInput): Promise<ConcernReevaluationSource | undefined>;
}

const noSubjects: CanonicalSubjectResolver = { resolve: () => undefined, actorIdsFor: () => [] };

export class ExperienceIntegration {
  constructor(private readonly repository: ExperienceIntegrationRepository, private readonly model: ExperienceIntegrationModel, private readonly subjects: CanonicalSubjectResolver = noSubjects, private readonly reevaluation?: ConcernReevaluation) {}

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
      if (input.focusConcern === undefined && output.focusConcern !== undefined) output = { ...output, focusConcern: undefined };
      await this.repository.apply(input, output);
      const source = this.repository.reevaluationSource === undefined ? undefined : await this.repository.reevaluationSource(input);
      if (source !== undefined && this.reevaluation !== undefined) await this.reevaluation.consider(source, signal);
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

export function memorySubjectsForIntegration(input: ExperienceIntegrationInput, intents: readonly Pick<MemoryIntent, "perspective">[], subjects: CanonicalSubjectResolver = noSubjects, actor = input.input.observation.actor): readonly (readonly string[])[] {
  const subjectId = subjects.resolve(actor);
  return intents.map((intent) => subjectId !== undefined && (intent.perspective === "user" || actor?.type === "agent") ? [subjectId] : []);
}
