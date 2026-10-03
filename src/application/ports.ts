import type { Agent, AgentCoreInput, AgentRunResult, DomainEvent, Memory, MessageEnvelope } from "../domain/contracts.js";

export interface Clock { now(): Date; }
export interface IdGenerator { next(): string; }
export interface MessageQueue {
  publish(message: MessageEnvelope): Promise<void>;
  subscribe(destination: string, handler: (message: MessageEnvelope) => Promise<void>, signal: AbortSignal): Promise<void>;
}
export interface AgentRepository {
  find(agentId: string): Promise<Agent | undefined>;
  save(agent: Agent, expectedVersion: number): Promise<void>;
}
export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
  list(agentId: string): Promise<readonly Memory[]>;
}
export interface UnitOfWork { transaction<T>(work: () => Promise<T>): Promise<T>; }
export interface AgentHarness { run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult>; }
export interface EmbeddingProvider { readonly dimension: number; embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]>; }
export interface MemoryRetriever { retrieve(agentId: string, query: string, limit: number): Promise<readonly Memory[]>; }
export interface ToolDefinition { readonly name: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>; }
export interface ToolResult { readonly ok: boolean; readonly value?: unknown; readonly error?: string; }
export interface Tool { readonly definition: ToolDefinition; execute(input: unknown, context: { agentId: string; runId: string; idempotencyKey: string }, signal: AbortSignal): Promise<ToolResult>; }
export interface UiAdapter {
  toEvent(message: MessageEnvelope): DomainEvent;
  deliver(message: MessageEnvelope, signal: AbortSignal): Promise<void>;
}
