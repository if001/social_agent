import type { IdGenerator, RetrievalService } from "./ports.js";
import type { PredictionModel, PredictionRepository, PredictionService, PredictionServiceInput } from "./prediction.js";
import { DomainError } from "../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

export type PredictionLoopLimits = { readonly deadlineMs: number; readonly maxAttempts: number };

const withDeadline = async <T>(promise: Promise<T>, deadlineMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new DomainError("TIMEOUT", "G1/G2 prediction deadline exceeded")); }, deadlineMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
export type PredictionLoopOptions = {
  readonly repository: PredictionRepository;
  readonly model: PredictionModel;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  readonly retrieval?: RetrievalService;
  readonly limits: PredictionLoopLimits;
  readonly logger?: Logger;
};

export class PredictionLoop implements PredictionService {
  constructor(private readonly options: PredictionLoopOptions) {}

  async afterResponse(input: PredictionServiceInput, signal: AbortSignal): Promise<void> {
    if (input.event.kind !== "user-message") return;
    const logger = (this.options.logger ?? noopLogger).child({ agentId: input.event.agentId, eventId: input.event.id, runId: input.input.run.runId });
    if (signal.aborted) return;
    let remaining = this.options.limits.maxAttempts;
    while (remaining > 0) {
      remaining -= 1;
      try {
        const previous = await this.options.repository.latest(input.event.agentId);
        const memoryCandidates = this.options.retrieval === undefined ? [] : await this.options.retrieval.retrieve({ agentId: input.event.agentId, query: input.input.observation.summary, scope: "all", limit: 5 }).catch((error: unknown) => {
          logger.log("warn", "prediction.retrieval_failed", errorLogContext(error));
          return [];
        });
        const deadline = AbortSignal.timeout(this.options.limits.deadlineMs);
        const predictionSignal = AbortSignal.any([signal, deadline]);
        const output = await withDeadline(this.options.model.predict({
          agentId: input.event.agentId,
          observation: input.input.observation,
          recentExperiences: input.input.recentExperiences,
          ...(previous === undefined ? {} : { previousPrediction: { id: previous.id, createdAt: previous.createdAt, output: previous.output } }),
          memoryCandidates
        }, predictionSignal), this.options.limits.deadlineMs);
        await this.options.repository.save({
          id: this.options.ids.next(),
          agentId: input.event.agentId,
          sourceEventId: input.event.id,
          sourceRunId: input.input.run.runId,
          output,
          createdAt: this.options.now().toISOString()
        });
        logger.log("info", "prediction.saved", { g1Count: output.predictions.g1.candidates.length, g2Count: output.predictions.g2.candidates.length, evaluationCount: output.predictionEvaluations.length, needsG3: output.g3.needsG3 });
        return;
      } catch (error) {
        logger.log("warn", "prediction.attempt_failed", { remainingAttempts: remaining, ...errorLogContext(error) });
      }
    }
  }
}
