import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent } from "deepagents";
import { providerStrategy, tool } from "langchain";

import type { AgentHarness } from "../../application/ports.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, type AgentCoreInput, type AgentRunResult, type ToolExecutionRecord } from "../../domain/contracts.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;

export type DeepAgentResult = { readonly structuredResponse?: unknown; readonly messages?: unknown; readonly toolExecutions?: readonly ToolExecutionRecord[] };
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number };
export interface DeepAgentInvoker { invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: DeepAgentInvokeOptions): Promise<DeepAgentResult>; }

export type DeepAgentHarnessOptions = {
  readonly invoker: DeepAgentInvoker;
  readonly registeredToolNames: ReadonlySet<string>;
  readonly maxRepairs?: number;
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
  });
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
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v2-ja", input })
          : JSON.stringify({ instruction: "元の入力に対する回答をAgentCoreOutputSchemaへ適合するよう修正してください。不足フィールドを補い、型とenumを守り、AgentCoreOutput以外を返さないでください。", input, validationIssues, invalidOutput: raw });
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: input.limits.maxToolCalls });
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = proposalReferenceIssues(input, parsed.data);
          if (referenceIssues.length === 0) return { output: parsed.data, toolExecutions: observedToolExecutions };
          validationIssues = referenceIssues;
        } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
      } catch (error) {
        observedToolExecutions.push(...errorToolExecutions(error));
        if (combined.aborted) throw new DomainError(signal.aborted ? "ABORTED" : "TIMEOUT", "Agent run was interrupted", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
        throw new DomainError("EXTERNAL", "Agent provider failed", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
      }
    }
    throw new DomainError("VALIDATION", `Agent returned invalid structured output: ${JSON.stringify(validationIssues)}`, { cause: { toolExecutions: observedToolExecutions } });
  }
}

export type OllamaDeepAgentConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string; readonly toolRegistry?: ToolRegistry; readonly now?: () => Date };

export type DeepAgentToolRunContext = { readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly signal: AbortSignal };
export type DeepAgentRunTool = { invoke(input: Record<string, unknown>): Promise<unknown> };
export function createDeepAgentTools(registry: ToolRegistry, context: DeepAgentToolRunContext, executions: ToolExecutionRecord[], now: () => Date = () => new Date()): readonly DeepAgentRunTool[] {
  let toolCallCount = 0;
  return registry.registered().map((registered) => tool(async (rawInput) => {
    toolCallCount += 1;
    const callId = `tool-${String(toolCallCount)}`;
    const startedAt = now().toISOString();
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
      const result = await registry.execute(registered.name, rawInput, { agentId: context.agentId, runId: context.runId, idempotencyKey: `${context.runId}:${callId}` }, context.signal);
      const finishedAt = now().toISOString();
      if (result.ok) executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: true, ...(result.value === undefined ? {} : { result: result.value }), startedAt, finishedAt });
      else executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: result.error ?? "Tool failed", startedAt, finishedAt });
      return JSON.stringify(result);
    } catch (error) {
      const finishedAt = now().toISOString();
      const message = error instanceof Error ? error.message : "Tool failed";
      executions.push({ callId, runId: context.runId, eventId: context.eventId, name: registered.name, input: rawInput as Record<string, unknown>, ok: false, error: message, startedAt, finishedAt });
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
- self: Identity、Disposition、Values、Role、Self Narrative、Self Continuity
- dynamicState: 現在のEmotion、Mood、Drive、Desire
- socialContext: 対象Agentが持つ関係認識
- memories: 今回の判断に利用できる対象Agent自身のMemory
- intentions: 継続中の行動方針
- availableTools: このrunで利用可能なTool
- runtimeConstraintsとlimits: 必ず守る実行制約

出力はAgentCoreOutputだけです:
- interpretation.subjectiveMeaning: 今回のEventがこのAgentにとって持つ意味。意味づけが不要な場合だけ省略できます
- internalChanges.transientStateUpdates: Emotion、Mood、Drive、Desire、Working Social Contextの更新提案。各要素はtarget、operation、value、reason、evidenceIdsを持ちます
- internalChanges.memoryProposals: 保存価値のあるMemory提案。各要素はkind、content、relatedSubjectIds、relatedIntentionIds、importance、任意のsourceAgentId、evidenceEventIdsを持ちます
- internalChanges.intentionProposals: Intention提案。新規はoperation=create、description、reason、任意のnextReviewAt。既存更新はoperation=update、入力に存在するintentionId、reasonと変更項目を持ちます
- internalChanges.longTermCandidates: 長期状態を後でReviewする候補。各要素はtarget、proposal、reason、1件以上のevidenceMemoryIdsを持ちます
- action: respond、wait、refuse、no-actionのいずれか1つ。Tool利用はreasoning中に行い、最終actionへtoolを返しません

時間スケール:
- EmotionとDesireは今回のEventに対する短期状態です
- Mood、Drive、Intention、Social Contextは次のEventにも影響させる必要がある場合だけ更新します
- Self NarrativeとAcquired Dispositionを通常Eventから直接更新しません。十分な根拠がある場合だけlongTermCandidatesへ提案します

制約:
- 入力にない事実を作りません
- MemoryやIntentionのIDを根拠・更新対象に使う場合は入力に存在するIDだけを使います
- 他Agentから聞いた情報を対象Agent自身の直接経験として扱いません
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
      const tools = config.toolRegistry === undefined ? [] : createDeepAgentTools(config.toolRegistry, options, toolExecutions, config.now);
      const agent = createDeepAgent({ model, tools: tools as DeepAgentToolsOption, responseFormat: providerStrategy(AgentCoreOutputSchema), systemPrompt: agentCoreSystemPrompt });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, options);
        return { structuredResponse: result.structuredResponse, messages: result.messages, toolExecutions };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions } }); }
    }
  };
}
