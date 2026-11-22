import type { IdGenerator } from "./ports.js";
import type { Observation, PredictionOutput } from "../domain/contracts.js";
import { errorLogContext } from "../observability/logger.js";

export type G3HypothesisEvaluation = { readonly statement: string; readonly status: "supported" | "contradicted" | "undecidable"; readonly rationale: string };
export type G3Output = {
  readonly hypothesisEvaluations: readonly G3HypothesisEvaluation[];
  readonly newHypotheses: readonly string[];
  readonly findings: readonly string[];
  readonly memories: readonly { readonly content: string; readonly reason: string; readonly target: "episodic" | "semantic" | "self-related" | "self-change" | "common-ground"; readonly perspective: "self" | "user" }[];
};
export type G3Input = {
  readonly agentId: string;
  readonly sourceEventId: string;
  readonly sourceRunId: string;
  readonly sourcePredictionId: string;
  readonly observation: Observation;
  readonly prediction: PredictionOutput;
};
/** Raw Tool evidence remains a Runtime-only audit pool.  The model never emits
 * its IDs and later model calls only receive the ID-free projection. */
export type G3ToolEvidence = { readonly name: string; readonly ok: boolean; readonly result?: unknown; readonly error?: string };
export type G3ModelResult = { readonly output: G3Output; readonly toolEvidence: readonly G3ToolEvidence[] };
export type G3Task = { readonly id: string; readonly agentId: string; readonly sourcePredictionId: string; readonly sourceEventId: string; readonly sourceRunId: string; readonly status: "pending" | "running" | "result-pending" | "completed" | "failed"; readonly attempt: number; readonly deadlineAt: string; readonly leaseUntil?: string; readonly input: G3Input; readonly output?: G3Output; readonly toolEvidence?: readonly G3ToolEvidence[]; readonly createdAt: string; readonly completedAt?: string };

export interface G3Model { analyze(input: G3Input, signal: AbortSignal): Promise<G3ModelResult>; }
export interface G3TaskRepository {
  save(task: G3Task): Promise<void>;
  claim(taskId: string, now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined>;
  claimDue(now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined>;
  saveResult(taskId: string, leaseToken: string, result: G3ModelResult): Promise<boolean>;
  complete(taskId: string, leaseToken: string, result: G3ModelResult, completedAt: string): Promise<boolean>;
  retryOrFail(taskId: string, leaseToken: string, reason: string, now: string, maxAttempts: number): Promise<void>;
}
export interface G3ResultSink { handle(result: G3ModelResult, input: G3Input): Promise<void>; }
export interface G3Sink { enqueue(input: G3Input): Promise<void>; }

/** Persist an auditable, bounded error classification rather than merely the
 * top-level provider wrapper. This is a task record, never model context. */
export function g3FailureReason(error: unknown): string {
  const context = errorLogContext(error);
  const causes: unknown = typeof context.errorCauses === "string" ? JSON.parse(context.errorCauses) as unknown : [];
  return JSON.stringify({ errorType: context.errorType, errorCode: context.errorCode, errorMessage: context.errorMessage, causes });
}

export class G3Service {
  constructor(private readonly repository: G3TaskRepository, private readonly model: G3Model, private readonly resultSink: G3ResultSink, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly taskDeadlineMs = 300_000, private readonly leaseMs = 60_000, private readonly maxAttempts = 3) {}
  async run(input: G3Input, signal: AbortSignal): Promise<G3Output | undefined> {
    const startedAt = this.now();
    const deadlineAt = new Date(startedAt.getTime() + this.taskDeadlineMs).toISOString();
    const task: G3Task = { id: this.ids.next(), agentId: input.agentId, sourcePredictionId: input.sourcePredictionId, sourceEventId: input.sourceEventId, sourceRunId: input.sourceRunId, status: "pending", attempt: 0, deadlineAt, input, createdAt: startedAt.toISOString() };
    await this.repository.save(task);
    const claimed = await this.repository.claim(task.id, startedAt.toISOString(), new Date(startedAt.getTime() + this.leaseMs).toISOString(), this.maxAttempts);
    return claimed === undefined ? undefined : this.#process(claimed, signal);
  }
  async drain(signal: AbortSignal, limit = 20): Promise<void> {
    for (let index = 0; index < limit; index += 1) {
      const claimedAt = this.now();
      const task = await this.repository.claimDue(claimedAt.toISOString(), new Date(claimedAt.getTime() + this.leaseMs).toISOString(), this.maxAttempts);
      if (task === undefined) return;
      await this.#process(task, signal);
    }
  }
  async #process(task: G3Task, signal: AbortSignal): Promise<G3Output | undefined> {
    const leaseToken = task.leaseUntil; if (leaseToken === undefined) return undefined;
    try {
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, this.leaseMs - 30_000))]);
      const result = task.output === undefined ? await this.model.analyze(task.input, boundedSignal) : { output: task.output, toolEvidence: task.toolEvidence ?? [] };
      if (task.output === undefined && !await this.repository.saveResult(task.id, leaseToken, result)) return undefined;
      await this.resultSink.handle(result, task.input);
      if (!await this.repository.complete(task.id, leaseToken, result, this.now().toISOString())) return undefined;
      return result.output;
    } catch (error) {
      await this.repository.retryOrFail(task.id, leaseToken, g3FailureReason(error), this.now().toISOString(), this.maxAttempts);
      return undefined;
    }
  }
}

export class MemoryG3ResultSink implements G3ResultSink {
  /** Memory candidates are deliberately delivered to the ordinary Agent Loop;
   * G3 has no direct persistence authority. */
  handle(): Promise<void> { return Promise.resolve(); }
}

export class DirectG3Sink implements G3Sink {
  constructor(private readonly service: G3Service, private readonly deadlineMs: number) {}
  enqueue(input: G3Input): Promise<void> {
    void this.service.run(input, AbortSignal.timeout(this.deadlineMs)).catch(() => undefined);
    return Promise.resolve();
  }
}
