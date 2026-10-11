import { ChatOllama } from "@langchain/ollama";
import { DomainError } from "../../domain/contracts.js";

export type OllamaChatConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string };

export function createOllamaChatModel(config: OllamaChatConfig): ChatOllama {
  return new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
}

export function providerFailure(operation: string, error: unknown, signal: AbortSignal, cause: unknown = error): DomainError {
  if (!signal.aborted) return new DomainError("EXTERNAL", `${operation} provider failed`, { cause });
  const timedOut = signal.reason instanceof Error && signal.reason.name === "TimeoutError";
  return new DomainError(timedOut ? "TIMEOUT" : "ABORTED", `${operation} was interrupted`, { cause });
}
