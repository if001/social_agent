import type { IdGenerator } from "./ports.js";
import type { Observation, PredictionOutput } from "../domain/contracts.js";

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
  readonly sourcePredictionId: string;
  readonly observation: Observation;
  readonly prediction: PredictionOutput;
};
/** Raw Tool evidence remains a Runtime-only audit pool.  The model never emits
 * its IDs and later model calls only receive the ID-free projection. */
export type G3ToolEvidence = { readonly name: string; readonly ok: boolean; readonly result?: unknown; readonly error?: string };
export type G3ModelResult = { readonly output: G3Output; readonly toolEvidence: readonly G3ToolEvidence[] };
export type G3Task = { readonly id: string; readonly agentId: string; readonly sourcePredictionId: string; readonly sourceEventId: string; readonly status: "pending" | "completed" | "failed"; readonly input: G3Input; readonly output?: G3Output; readonly toolEvidence?: readonly G3ToolEvidence[]; readonly createdAt: string; readonly completedAt?: string };

export interface G3Model { analyze(input: G3Input, signal: AbortSignal): Promise<G3ModelResult>; }
export interface G3TaskRepository {
  save(task: G3Task): Promise<void>;
  complete(taskId: string, result: G3ModelResult, completedAt: string): Promise<void>;
  fail(taskId: string, reason: string, completedAt: string): Promise<void>;
}
export interface G3ResultSink { handle(result: G3ModelResult, input: G3Input): Promise<void>; }
export interface G3Sink { enqueue(input: G3Input): Promise<void>; }

export class G3Service {
  constructor(private readonly repository: G3TaskRepository, private readonly model: G3Model, private readonly resultSink: G3ResultSink, private readonly ids: IdGenerator, private readonly now: () => Date) {}
  async run(input: G3Input, signal: AbortSignal): Promise<G3Output | undefined> {
    const task: G3Task = { id: this.ids.next(), agentId: input.agentId, sourcePredictionId: input.sourcePredictionId, sourceEventId: input.sourceEventId, status: "pending", input, createdAt: this.now().toISOString() };
    await this.repository.save(task);
    try {
      const result = await this.model.analyze(input, signal);
      await this.repository.complete(task.id, result, this.now().toISOString());
      await this.resultSink.handle(result, input);
      return result.output;
    } catch (error) {
      await this.repository.fail(task.id, error instanceof Error ? error.message : "G3 failed", this.now().toISOString());
      return undefined;
    }
  }
}

export class MemoryG3ResultSink implements G3ResultSink {
  /** Memory candidates are deliberately delivered to the ordinary Agent Loop;
   * G3 has no direct persistence authority. */
  async handle(_result: G3ModelResult, _input: G3Input): Promise<void> {}
}

export class DirectG3Sink implements G3Sink {
  constructor(private readonly service: G3Service, private readonly deadlineMs: number) {}
  enqueue(input: G3Input): Promise<void> {
    void this.service.run(input, AbortSignal.timeout(this.deadlineMs)).catch(() => undefined);
    return Promise.resolve();
  }
}
