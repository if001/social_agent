import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";

import type { AgentHarness } from "../../application/ports.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, type AgentCoreInput, type AgentRunResult, type ToolExecutionRecord } from "../../domain/contracts.js";
import { noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;

export type DeepAgentResult = { readonly structuredResponse?: unknown; readonly messages?: unknown; readonly toolExecutions?: readonly ToolExecutionRecord[] };
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly allowedToolNames: ReadonlySet<string>; readonly transport?: AgentCoreInput["run"]["transport"] };
export interface DeepAgentInvoker { invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: DeepAgentInvokeOptions): Promise<DeepAgentResult>; }

export type DeepAgentHarnessOptions = {
  readonly invoker: DeepAgentInvoker;
  readonly registeredToolNames: ReadonlySet<string>;
  readonly maxRepairs?: number;
  readonly logger?: Logger;
};

type ProposalIssue = { readonly code: "invalid_reference"; readonly path: readonly PropertyKey[]; readonly message: string };
function errorToolExecutions(error: unknown): readonly ToolExecutionRecord[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause) || !Array.isArray(error.cause.toolExecutions)) return [];
  return error.cause.toolExecutions as ToolExecutionRecord[];
}
function proposalReferenceIssues(input: AgentCoreInput, output: AgentRunResult["output"]): ProposalIssue[] {
  const memoryIds = new Set(input.memories.map(({ id }) => id));
  const intentionIds = new Set(input.intentions.map(({ id }) => id));
  const issues: ProposalIssue[] = [];
  output.internalChanges.memoryProposals.forEach((proposal, index) => {
    proposal.relatedIntentionIds.forEach((id) => {
      if (!intentionIds.has(id)) issues.push({ code: "invalid_reference", path: ["internalChanges", "memoryProposals", index, "relatedIntentionIds"], message: `Unknown intention reference: ${id}` });
    });
  });
  output.internalChanges.intentionProposals.forEach((proposal, index) => {
    if (proposal.operation === "update" && !intentionIds.has(proposal.intentionId)) issues.push({ code: "invalid_reference", path: ["internalChanges", "intentionProposals", index, "intentionId"], message: `Unknown intention reference: ${proposal.intentionId}` });
    if (proposal.operation === "update" && proposal.supersededByIntentionId !== undefined && !intentionIds.has(proposal.supersededByIntentionId)) issues.push({ code: "invalid_reference", path: ["internalChanges", "intentionProposals", index, "supersededByIntentionId"], message: `Unknown intention reference: ${proposal.supersededByIntentionId}` });
  });
  output.internalChanges.longTermCandidates.forEach((proposal, index) => {
    proposal.evidenceMemoryIds.forEach((id) => {
      if (!memoryIds.has(id)) issues.push({ code: "invalid_reference", path: ["internalChanges", "longTermCandidates", index, "evidenceMemoryIds"], message: `Unknown Memory reference: ${id}` });
    });
    proposal.evidenceEventIds.forEach((id) => {
      if (id !== input.run.eventId) issues.push({ code: "invalid_reference", path: ["internalChanges", "longTermCandidates", index, "evidenceEventIds"], message: `Unknown Event reference: ${id}` });
    });
  });
  output.internalChanges.transientStateUpdates.forEach((proposal, index) => { proposal.evidenceIds.forEach((id) => {
    if (id !== input.run.eventId && !memoryIds.has(id)) issues.push({ code: "invalid_reference", path: ["internalChanges", "transientStateUpdates", index, "evidenceIds"], message: `Unknown evidence reference: ${id}` });
  }); });
  output.internalChanges.memoryProposals.forEach((proposal, index) => { proposal.evidenceEventIds.forEach((id) => {
    if (id !== input.run.eventId) issues.push({ code: "invalid_reference", path: ["internalChanges", "memoryProposals", index, "evidenceEventIds"], message: `Unknown Event reference: ${id}` });
  }); });
  return issues;
}

export class DeepAgentHarness implements AgentHarness {
  readonly #maxRepairs: number;
  constructor(private readonly options: DeepAgentHarnessOptions) { this.#maxRepairs = options.maxRepairs ?? 1; }

  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    for (const tool of input.availableTools) if (!this.options.registeredToolNames.has(tool.name)) throw new DomainError("VALIDATION", `Unknown tool: ${tool.name}`);
    const timeout = AbortSignal.timeout(input.limits.deadlineMs);
    const combined = AbortSignal.any([signal, timeout]);
    let raw: unknown; let validationIssues: unknown; const observedToolExecutions: ToolExecutionRecord[] = [];
    for (let attempt = 0; attempt <= this.#maxRepairs; attempt += 1) {
      try {
        const logger = (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId });
        logger.log("info", "agent_core.model_attempt_started", { attempt: attempt + 1, repair: attempt > 0 });
        const promptInput = { ...input, memoryRetrievalTrace: undefined };
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v2-ja", input: promptInput })
          : JSON.stringify({ instruction: "元の入力に対する回答をAgentCoreOutputSchemaへ適合するよう修正してください。不足フィールドを補い、型とenumを守り、AgentCoreOutput以外を返さないでください。", input: promptInput, validationIssues, invalidOutput: raw });
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: input.limits.maxToolCalls, allowedToolNames: new Set(input.availableTools.map(({ name }) => name)), ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = proposalReferenceIssues(input, parsed.data);
          if (referenceIssues.length === 0) { logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1 }); return { output: parsed.data, toolExecutions: observedToolExecutions }; }
          validationIssues = referenceIssues;
        } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
        logger.log("warn", "agent_core.output_invalid", { attempt: attempt + 1, issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
      } catch (error) {
        observedToolExecutions.push(...errorToolExecutions(error));
        if (combined.aborted) throw new DomainError(signal.aborted ? "ABORTED" : "TIMEOUT", "Agent run was interrupted", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
        throw new DomainError("EXTERNAL", "Agent provider failed", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
      }
    }
    throw new DomainError("VALIDATION", `Agent returned invalid structured output: ${JSON.stringify(validationIssues)}`, { cause: { toolExecutions: observedToolExecutions } });
  }
}

export type OllamaDeepAgentConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string; readonly toolRegistry?: ToolRegistry; readonly logger?: Logger; readonly now?: () => Date };

export type DeepAgentToolRunContext = { readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly allowedToolNames?: ReadonlySet<string>; readonly signal: AbortSignal; readonly transport?: AgentCoreInput["run"]["transport"] };
export type DeepAgentRunTool = { invoke(input: Record<string, unknown>): Promise<unknown> };
export function createDeepAgentTools(registry: ToolRegistry, context: DeepAgentToolRunContext, executions: ToolExecutionRecord[], now: () => Date = () => new Date(), baseLogger: Logger = noopLogger): readonly DeepAgentRunTool[] {
  let toolCallCount = 0;
  return registry.registered().filter(({ name }) => context.allowedToolNames?.has(name) ?? true).map((registered) => tool(async (rawInput) => {
    toolCallCount += 1;
    const callId = `tool-${String(toolCallCount)}`;
    const startedAt = now().toISOString();
    const logger = baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, toolCallId: callId, toolName: registered.name });
    logger.log("info", "tool.started");
    if (context.signal.aborted) {
      const finishedAt = now().toISOString();
      executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: "Tool execution aborted", startedAt, finishedAt });
      throw new DomainError("ABORTED", "Tool execution aborted");
    }
    if (toolCallCount > context.maxToolCalls) {
      const finishedAt = now().toISOString();
      executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: "Tool call limit exceeded", startedAt, finishedAt });
      throw new DomainError("VALIDATION", "Tool call limit exceeded");
    }
    try {
      const transport = context.transport === undefined ? undefined : { hop: context.transport.hop, expiresAt: context.transport.expiresAt, ...(context.transport.replyTo === undefined ? {} : { replyTo: context.transport.replyTo }) };
      const result = await registry.execute(registered.name, rawInput, { agentId: context.agentId, runId: context.runId, eventId: context.eventId, toolCallId: callId, idempotencyKey: `${context.runId}:${callId}`, ...(transport === undefined ? {} : { transport }) }, context.signal);
      const finishedAt = now().toISOString();
      if (result.ok) executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: true, ...(result.value === undefined ? {} : { result: result.value }), startedAt, finishedAt });
      else executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: result.error ?? "Tool failed", startedAt, finishedAt });
      logger.log(result.ok ? "info" : "warn", "tool.completed", { ok: result.ok, elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify(result);
    } catch (error) {
      const finishedAt = now().toISOString();
      const message = error instanceof Error ? error.message : "Tool failed";
      executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: message, startedAt, finishedAt });
      logger.log("error", "tool.failed", { errorCode: error instanceof DomainError ? error.code : "UNKNOWN", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error: message });
    }
  }, { name: registered.name, description: registered.description, schema: registered.schema }));
}

export const agentCoreSystemPrompt = `あなたは、固有の状態と経験を持つソーシャルエージェントの通常Agent Coreです。

目的:
入力されたObservationをSelf、現在状態、Social Context、Memory、Active Intentionに照らして主観的に意味づけ、必要な内部変更を「提案」し、そのrunの最終行動を1つ選びます。保存やToolの機械的制約はRuntimeが担当します。

入力:
- run: run、Event、対象Agent、発生時刻
- observation: 今回観測した出来事と確認済みの事実
- recentObservations: 代名詞や省略を解決するための直近の出来事。新しい出来事として重複保存しません
- persona: 設定された表示名、一人称、言語、トーン、応答スタイル。発話表現だけへ適用し、意味判断、行動選択、内部状態、長期的なSelfの根拠にはしません。省略される場合があります
- self: Identity、Disposition、Values、Role、Self Narrative、Self Continuity
- dynamicState: 次のEventにも継続しているMood、複数のDrive（description、sourceEvidenceIds、since）、Current Interest。前回EventのEmotionとDesireは含みません
- socialContext: 対象Agentが持つ関係認識
- memories: 今回の判断に利用できる対象Agent自身のMemory
- intentions: 継続中の行動方針。Expectationは独立保存せず、これとSocial Context、Memory、直近Observationから今回予期していたことと実際との差を導出します
- availableTools: このrunで利用可能なTool
- runtimeConstraintsとlimits: 必ず守る実行制約

出力はAgentCoreOutputだけです:
- interpretation.subjectiveMeaning: 今回のEventがこのAgentにとって持つ意味。意味づけが不要な場合だけ省略できます
- internalChanges.transientStateUpdates: Emotion、Mood、Drive、Desire、Current Interest、Working Social Contextの更新提案。targetはemotion | mood | drives | desires | currentInterests | socialContextです。EmotionとMoodはset、複数項目はset | append | removeを使います。Driveのvalueにはdescription文字列だけを返し、sourceEvidenceIdsとsinceはRuntimeがevidenceIdsとEvent時刻から付与します。Social Contextのset/append値はsubjectId、subjectType（user | agent | team | project | organization）、descriptionを持ちます。EmotionとDesireは今回のrunの解釈とActionにだけ使われ、監査記録には残りますが次のEventへ永続化されません。継続させる必要がある内容はMood、DriveまたはIntentionとして別に提案します。各要素はvalue、reason、evidenceIdsも持ちます
- internalChanges.memoryProposals: 今回のEventで生じ、後の判断を変え得る具体的な出来事だけを保存するEpisodic Memory提案。kindはepisodicだけです。Web本文をMemoryへ複製せず「何を調べ、何を確認したか」という経験の概要にし、根拠ページはwebSnapshotIdsで参照します。約束、予定、決定、感情的・関係上重要な出来事、重要なTool結果、Intentionの変化がなければ空配列にします。各要素はcontent、relatedSubjectIds、relatedIntentionIds、自然言語のimportance、検索上の限定値retrievalPriority（low | normal | high | critical）、evidenceEventIds、webSnapshotIdsも持ちます。送信元Agent IDはRuntimeがObservationから付与するため生成しません
- internalChanges.intentionProposals: Intention提案。新規はoperation=create、description、reason、任意のtriggerとnextReviewAtを持ちます。triggerは指定時刻の{kind:"time",at}、関連Eventの{kind:"event",eventKinds,keywords}、無活動時間の{kind:"idle",idleForMs}、明示確認の{kind:"manual-review"}のいずれかです。既存更新はoperation=update、入力に存在するintentionId、reasonと変更項目を持ち、statusを変える場合はactive | completed | dropped | supersededのいずれかです
- internalChanges.longTermCandidates: 後でReviewする候補。targetはselfNarrative | selfContinuity | values | acquiredDisposition | role | raisonDetre | longTermPreference | longTermInterest | semanticMemory | selfRelatedMemoryのいずれかです。長期Self、安定した知識、自己認識を通常runで確定せず候補にします。各要素はproposal、reason、evidenceMemoryIds、evidenceEventIdsを持ち、根拠を少なくとも1件指定します
- action: respondはcontent、waitはreasonと任意のuntil、refuseはreasonとbasis（personality | system）、no-actionはreasonを持ちます。Tool利用はreasoning中に行い、最終actionへtoolを返しません

時間スケール:
- Expectationは今回の入力から導出します。持続させる必要がある期待だけを、その意味に応じてIntention、Social ContextまたはMemoryとして提案します
- Emotionと各Desireは今回のEventに対する短期状態であり、次回入力には引き継がれません
- Mood、各Drive、Current Interest、Intention、Social Contextは次のEventにも影響させる必要がある場合だけ更新します
- Self NarrativeとAcquired Dispositionを通常Eventから直接更新しません。十分な根拠がある場合だけlongTermCandidatesへ提案します
- observationがstate-review Internal Eventの場合、時間が経過しても現在のMood、Drive、Current Interestを維持する意味があるかを再評価します。変化させる根拠がなければ更新せず、失効した項目だけremoveします
- observationがmemory-recall Internal Eventの場合、入力された関連Memoryが現在のSelf、Mood、Drive、Intention、Social Contextにとって持つ意味を再評価します。過去のEmotionをそのまま復元せず、現在の根拠がある場合だけ状態変更やActionを提案します

制約:
- personaがある場合はrespondの表現へ反映します。personaだけを根拠に状態更新、Memory、Intention、longTermCandidateを提案しません
- 入力にない事実を作りません
- MemoryやIntentionのIDを根拠・更新対象に使う場合は入力に存在するIDだけを使います
- 他Agentから聞いた情報を対象Agent自身の直接経験として扱いません
- 直近の対話は今回の出来事の文脈解決に使い、同じ出来事を別のMemoryとして繰り返し提案しません
- 全状態を毎回変更せず、不要な各提案配列は空配列[]にします
- 新規Memory、Intention、Candidateに保存用ID、所有Agent ID、作成時刻、statusを生成しません
- 状態変更は提案であり、保存済みだと主張しません
- AgentCoreOutput以外の説明文を返しません

最小出力例:
{"interpretation":{"subjectiveMeaning":"挨拶を受け、穏やかな交流の始まりだと受け取った"},"internalChanges":{"transientStateUpdates":[],"memoryProposals":[],"intentionProposals":[],"longTermCandidates":[]},"action":{"type":"respond","content":"こんにちは。今日は何について話しましょうか。"}}`;

export async function checkOllamaChatCapability(config: Pick<OllamaDeepAgentConfig, "apiKey" | "baseUrl" | "model">, fetcher: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try { response = await fetcher(new URL("/api/tags", config.baseUrl), { headers: { Authorization: `Bearer ${config.apiKey}` } }); }
  catch (error) { throw new DomainError("EXTERNAL", "Ollama capability check failed", { cause: error }); }
  if (!response.ok) throw new DomainError("EXTERNAL", `Ollama capability check returned HTTP ${String(response.status)}`);
  const body: unknown = await response.json().catch((error: unknown) => { throw new DomainError("EXTERNAL", "Ollama capability response was invalid", { cause: error }); });
  const models: unknown[] = typeof body === "object" && body !== null && "models" in body && Array.isArray(body.models) ? body.models as unknown[] : [];
  const available = models.some((entry) => typeof entry === "object" && entry !== null && "name" in entry && entry.name === config.model);
  if (!available) throw new DomainError("VALIDATION", `Configured Ollama chat model is unavailable: ${config.model}`);
}

export function createOllamaDeepAgentInvoker(config: OllamaDeepAgentConfig): DeepAgentInvoker {
  const model = new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
  return {
    async invoke(input, options) {
      const toolExecutions: ToolExecutionRecord[] = [];
      const tools = config.toolRegistry === undefined ? [] : createDeepAgentTools(config.toolRegistry, options, toolExecutions, config.now, config.logger);
      const agent = createDeepAgent({ model, tools: tools as DeepAgentToolsOption, systemPrompt: agentCoreSystemPrompt });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, options);
        const messages = result.messages as unknown[];
        const last = messages.at(-1);
        const content: unknown = typeof last === "object" && last !== null && "content" in last ? last.content : undefined;
        const blocks: readonly unknown[] = Array.isArray(content) ? content as unknown[] : [];
        const text = typeof content === "string" ? content : blocks.flatMap((block): string[] => typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? [block.text] : []).join("\n");
        const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu.exec(text.trim());
        const json = fenced?.[1]?.trim() ?? text.trim();
        let structuredResponse: unknown = text;
        try { structuredResponse = JSON.parse(json); } catch { /* Harness repair receives the invalid text. */ }
        return { structuredResponse, messages, toolExecutions };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions } }); }
    }
  };
}
