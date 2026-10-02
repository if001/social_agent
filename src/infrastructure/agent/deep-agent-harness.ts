import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent } from "deepagents";
import { toolStrategy } from "langchain";

import type { AgentHarness } from "../../application/ports.js";
import { AgentCoreOutputSchema, DomainError, type AgentCoreInput, type AgentCoreOutput } from "../../domain/contracts.js";

export type DeepAgentResult = { readonly structuredResponse?: unknown; readonly messages?: unknown };
export interface DeepAgentInvoker { invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: { readonly signal: AbortSignal; readonly recursionLimit: number }): Promise<DeepAgentResult>; }

export type DeepAgentHarnessOptions = {
  readonly invoker: DeepAgentInvoker;
  readonly registeredToolNames: ReadonlySet<string>;
  readonly maxRepairs?: number;
};

export class DeepAgentHarness implements AgentHarness {
  readonly #maxRepairs: number;
  constructor(private readonly options: DeepAgentHarnessOptions) { this.#maxRepairs = options.maxRepairs ?? 1; }

  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentCoreOutput> {
    for (const tool of input.availableTools) if (!this.options.registeredToolNames.has(tool.name)) throw new DomainError("VALIDATION", `Unknown tool: ${tool.name}`);
    const timeout = AbortSignal.timeout(input.limits.deadlineMs);
    const combined = AbortSignal.any([signal, timeout]);
    let raw: unknown;
    for (let attempt = 0; attempt <= this.#maxRepairs; attempt += 1) {
      try {
        const content = attempt === 0 ? JSON.stringify({ promptVersion: "agent-core-v1", input }) : JSON.stringify({ instruction: "Repair this output to match the required schema", invalidOutput: raw });
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps });
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) return parsed.data;
      } catch (error) {
        if (combined.aborted) throw new DomainError(signal.aborted ? "ABORTED" : "TIMEOUT", "Agent run was interrupted", { cause: error });
        throw new DomainError("EXTERNAL", "Agent provider failed", { cause: error });
      }
    }
    throw new DomainError("VALIDATION", "Agent returned invalid structured output");
  }
}

export type OllamaDeepAgentConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string; readonly tools?: NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"] };

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
  const agent = createDeepAgent({ model, tools: config.tools ?? [], responseFormat: toolStrategy(AgentCoreOutputSchema), systemPrompt: "Return only an AgentCoreOutput. Treat state changes as proposals; never claim persistence." });
  return {
    async invoke(input, options) {
      const result = await agent.invoke({ messages: [...input.messages] }, options);
      return { structuredResponse: result.structuredResponse, messages: result.messages };
    }
  };
}
