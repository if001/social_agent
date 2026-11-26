import { z } from "zod";

import type { ExperienceIntegrationInput, ExperienceIntegrationModel } from "../../application/experience-integration.js";
import { EventExperienceSchema, ExperienceIntegrationMemoryCandidateSchema, ExperienceIntegrationOutputSchema, FocusConcernOutcomeSchema, RelationshipCandidateSchema } from "../../application/experience-integration.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { toModelRecordView } from "./model-record-view.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { projectExperienceEvidenceForModel } from "./tool-result-model-view.js";
import { hasModelJsonSyntaxError, parseModelJson } from "./model-json-parser.js";

/** Each sub-decision uses one small JSON object. The mandatory Event Experience
 * remains the audit anchor; other persistence candidates may be absent. */
export const ExperienceIntegrationMemoryOutputSchema = z.object({
  memories: z.array(ExperienceIntegrationMemoryCandidateSchema).max(3).default([])
}).strict();
export const ExperienceIntegrationRelationshipOutputSchema = z.object({ relationship: RelationshipCandidateSchema.optional() }).strict();
export const ExperienceIntegrationFocusConcernOutputSchema = z.object({ focusConcern: FocusConcernOutcomeSchema.optional() }).strict();

export const eventExperienceSystemPrompt = "完了済みEventから、今回確定した出来事・選択・結果だけをJSON objectで返す。許可fieldはsummaryとfactsだけ。factsは具体的事実を最大4件にする。起動理由、時刻、kind、ID、Meaning、Feeling、Desire、未確認推測、Tool失敗、Memory、Mood、Relationship、Concernは書かない。";
export const memoryIntegrationSystemPrompt = "完了済みEventから、将来の判断に再利用する経験候補だけをJSON objectで返す。rootはmemoriesだけ。候補がなければ必ず {\"memories\":[]} を返す。各候補はcontent、reason、target、perspectiveだけで、targetはepisodic|semantic|self-related|self-change|common-ground、perspectiveはself|userだけ。ID、根拠一覧、subject、Tool本文、応答文、未確認推測、実行手順は書かない。";
export const relationshipIntegrationSystemPrompt = "今回のEventでactorとの持続的な関係が変わった時だけJSON objectでrelationshipを返す。変化がなければ {}。relationshipの許可fieldはoperation、currentDescription、description、reasonだけ。operationはupsert|remove、reasonは必須。descriptionは現在の関係の型・安定した前提・未解決の約束だけを400文字以内で書く。相手名、ID、個別Event、人物プロフィール、Concern、Feeling、次の行動は書かない。";
export const focusConcernIntegrationSystemPrompt = "Runtimeが束縛した一件のConcernへの変化だけをJSON objectで返す。rootはfocusConcernだけ。変化がなければ {}。focusConcernはoutcomeとreasonだけで、outcomeはunchanged|progress|satisfied|abandoned。Concern ID、Event ID、status操作、実行手順、次の計画は書かない。satisfiedは核が実質的に満たされた時だけ、abandonedは現在のSelfにとって価値を明確に失った時だけ。検索失敗・情報不足・一時的Feelingだけではabandonedにしない。";

/** Compatibility export for existing callers and structured-output checks. */
export const experienceIntegrationSystemPrompt = [eventExperienceSystemPrompt, memoryIntegrationSystemPrompt, relationshipIntegrationSystemPrompt, focusConcernIntegrationSystemPrompt].join("\n");
export const experienceIntegrationRepairInstruction = "直前の出力を同じ入力事実だけでschemaに直し、有効なJSON objectだけを返す。許可されていないfieldを削除し、factsは最大4件、候補がないoptional rootは省略する。Memory候補がない時だけは {\"memories\":[]} を返す。文字列値の改行は\\nとしてescapeする。";
export const eventExperienceRepairSystemPrompt = eventExperienceSystemPrompt;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => { if (typeof part !== "object" || part === null || !("text" in part)) return ""; const text = (part as Record<string, unknown>).text; return typeof text === "string" ? text : ""; }).join("") : "";
type ExperienceIntegrationHarnessConfig = OllamaChatConfig & { readonly toolRegistry?: ToolRegistry };

function eventView(input: ExperienceIntegrationInput, tools?: ToolRegistry) {
  return toModelRecordView({
    observation: input.input.observation,
    assessment: input.result.assessment,
    action: input.result.output.action,
    evidence: projectExperienceEvidenceForModel(input.result.toolExecutions, tools)
  });
}

function hasSourceActor(input: ExperienceIntegrationInput): boolean {
  const payload = input.sourceEvent.payload;
  return typeof payload.actorId === "string" || typeof payload.senderAgentId === "string" || input.input.observation.actor !== undefined;
}

/** Minimal model-facing views. Current State, identifiers and context lookup
 * results intentionally never cross this boundary. */
export const experienceIntegrationModelInput = (input: ExperienceIntegrationInput, tools?: ToolRegistry) => {
  const event = eventView(input, tools);
  return {
    eventExperience: event,
    memory: event,
    ...(hasSourceActor(input) ? { relationship: toModelRecordView({ event }) } : {}),
    mood: toModelRecordView({ event, currentMood: input.input.state.mood }),
    ...(input.focusConcern === undefined ? {} : { focusConcern: toModelRecordView({ event, concern: { description: input.focusConcern.description, whyItMatters: input.focusConcern.whyItMatters } }) })
  };
};

export const eventExperienceRepairInput = (input: ExperienceIntegrationInput, tools?: ToolRegistry) => experienceIntegrationModelInput(input, tools).eventExperience;

export type EventExperienceRepairModel = { integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> };
export function createOllamaEventExperienceRepairModel({ toolRegistry, ...config }: ExperienceIntegrationHarnessConfig, logger: Logger = noopLogger): EventExperienceRepairModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(EventExperienceSchema) });
  return { async integrate(input, signal) {
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: eventExperienceRepairSystemPrompt }, { role: "user", content: JSON.stringify(eventExperienceRepairInput(input, toolRegistry)) }], { signal });
      const output = contentOf(result.content); if (output.trim().length === 0) throw new Error("Event Experience repair returned empty content");
      logger.log("info", "event_experience_repair.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, outputChars: output.length });
      return parseModelJson(output);
    } catch (error) { throw providerFailure("Event Experience repair", error, signal); }
  } };
}

function createJsonInvoker<T extends z.ZodType>(name: string, schema: T, system: string, config: OllamaChatConfig, logger: Logger) {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(schema) });
  return async (view: unknown, input: ExperienceIntegrationInput, signal: AbortSignal): Promise<z.infer<T>> => {
    const invoke = async (instruction?: string): Promise<unknown> => {
      const content = JSON.stringify(instruction === undefined ? view : { instruction, input: view });
      const startedAt = Date.now();
      try {
        const result = await model.invoke([{ role: "system", content: system }, { role: "user", content }], { signal });
        const output = contentOf(result.content);
        if (output.trim().length === 0) throw new Error(`${name} returned empty content`);
        logger.log("info", "experience_integration.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, target: name, elapsedMs: Date.now() - startedAt, inputChars: content.length, outputChars: output.length });
        return parseModelJson(output);
      } catch (error) {
        const failure = providerFailure(`Experience Integration ${name}`, error, signal);
        logger.log("warn", "experience_integration.target_failed", { agentId: input.agentId, sourceRunId: input.sourceRunId, target: name, ...errorLogContext(failure) });
        throw failure;
      }
    };
    try {
      const first = schema.safeParse(await invoke());
      if (first.success) return first.data;
      return schema.parse(await invoke(`${experienceIntegrationRepairInstruction} validationIssues: ${JSON.stringify(first.error.issues)}`));
    } catch (error) {
      if (!hasModelJsonSyntaxError(error)) throw error;
      return schema.parse(await invoke(experienceIntegrationRepairInstruction));
    }
  };
}

async function optionalTarget<T>(target: string, invoke: () => Promise<T>, logger: Logger, input: ExperienceIntegrationInput): Promise<T | undefined> {
  try { return await invoke(); }
  catch (error) {
    logger.log("warn", "experience_integration.optional_target_ignored", { agentId: input.agentId, sourceRunId: input.sourceRunId, target, ...errorLogContext(error) });
    return undefined;
  }
}

/** At most five decisions, with one JSON-only syntax retry each. */
export const experienceIntegrationMaxModelCalls = 10;

export function createOllamaExperienceIntegrationModel({ toolRegistry, ...config }: ExperienceIntegrationHarnessConfig, logger: Logger = noopLogger): ExperienceIntegrationModel {
  const eventExperience = createJsonInvoker("event-experience", EventExperienceSchema, eventExperienceSystemPrompt, config, logger);
  const memories = createJsonInvoker("memory", ExperienceIntegrationMemoryOutputSchema, memoryIntegrationSystemPrompt, config, logger);
  const relationship = createJsonInvoker("relationship", ExperienceIntegrationRelationshipOutputSchema, relationshipIntegrationSystemPrompt, config, logger);
  const focusConcern = createJsonInvoker("focus-concern", ExperienceIntegrationFocusConcernOutputSchema, focusConcernIntegrationSystemPrompt, config, logger);
  const integrate = async (input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> => {
    const views = experienceIntegrationModelInput(input, toolRegistry);
    const experience = await eventExperience(views.eventExperience, input, signal);
    const memory = await optionalTarget("memory", () => memories(views.memory, input, signal), logger, input);
    const relation = views.relationship === undefined ? undefined : await optionalTarget("relationship", () => relationship(views.relationship, input, signal), logger, input);
    const focusView = views.focusConcern === undefined ? undefined : toModelRecordView({
      ...views.focusConcern,
      createdMemories: memory?.memories ?? []
    });
    const focus = focusView === undefined ? undefined : await optionalTarget("focus-concern", () => focusConcern(focusView, input, signal), logger, input);
    return ExperienceIntegrationOutputSchema.parse({
      experience,
      memories: memory?.memories ?? [],
      ...(relation?.relationship === undefined ? {} : { relationship: relation.relationship }),
      ...(focus?.focusConcern === undefined ? {} : { focusConcern: focus.focusConcern })
    });
  };
  return { integrate, repair: (input, _issues, signal) => integrate(input, signal) };
}
