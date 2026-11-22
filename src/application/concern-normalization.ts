import { z } from "zod";

import { CurrentConcernDescriptionSchema, CurrentConcernImportanceSchema, type Concern } from "../domain/contracts.js";

export const ConcernNormalizationModelInputSchema = z.object({
  description: z.string().trim().min(1).max(16_000).describe("現在のConcern本文。永続ID、status、時刻は含まない"),
  whyItMatters: z.string().trim().min(1).max(16_000).describe("現在この関心が残る理由。永続ID、status、時刻は含まない")
}).strict();
export type ConcernNormalizationModelInput = z.infer<typeof ConcernNormalizationModelInputSchema>;

export const ConcernNormalizationDecisionSchema = z.object({
  description: CurrentConcernDescriptionSchema,
  whyItMatters: CurrentConcernImportanceSchema
}).strict().describe("一件の既存active Concernについて、維持するなら入力をそのまま、正規化するなら同じ一つの持続する関心の核を返す。Runtimeが一致比較でkeep又はnormalizeを確定する。分割、作成、終了は行わない");
export type ConcernNormalizationDecision = z.infer<typeof ConcernNormalizationDecisionSchema>;

export interface ConcernNormalizationModel {
  normalize(input: ConcernNormalizationModelInput, signal?: AbortSignal): Promise<ConcernNormalizationDecision>;
}

export interface ConcernNormalizationRepository {
  loadActive(agentId: string): Promise<{ readonly version: number; readonly concerns: readonly Concern[] }>;
  apply(request: {
    readonly agentId: string;
    readonly expectedVersion: number;
    readonly runId: string;
    readonly occurredAt: Date;
    readonly changes: readonly { readonly concernId: string; readonly description: string; readonly whyItMatters: string }[];
  }): Promise<number>;
}

export type ConcernNormalizationRunOptions = {
  readonly agentId: string;
  readonly apply: boolean;
  readonly runId: string;
  readonly occurredAt: Date;
  readonly signal?: AbortSignal;
};

export type ConcernNormalizationRunResult = {
  readonly agentId: string;
  readonly apply: boolean;
  readonly applied: boolean;
  readonly version: number;
  readonly normalizedCount: number;
  readonly keptCount: number;
  readonly failureCount: number;
  readonly results: readonly ({ readonly concernId: string } & (
    { readonly operation: "keep" }
    | { readonly operation: "normalize"; readonly description: string; readonly whyItMatters: string }
    | { readonly operation: "failed"; readonly error: string }
  ))[];
};

export class ConcernNormalizationService {
  constructor(private readonly model: ConcernNormalizationModel, private readonly repository: ConcernNormalizationRepository) {}

  async run(options: ConcernNormalizationRunOptions): Promise<ConcernNormalizationRunResult> {
    const snapshot = await this.repository.loadActive(options.agentId);
    const results: ConcernNormalizationRunResult["results"][number][] = [];
    for (const concern of snapshot.concerns) {
      const input = ConcernNormalizationModelInputSchema.parse({ description: concern.description, whyItMatters: concern.whyItMatters });
      try {
        const raw = await this.model.normalize(input, options.signal);
        const decision = ConcernNormalizationDecisionSchema.parse(raw);
        const description = CurrentConcernDescriptionSchema.parse(decision.description);
        const whyItMatters = CurrentConcernImportanceSchema.parse(decision.whyItMatters);
        const unchanged = description === concern.description && whyItMatters === concern.whyItMatters;
        results.push({ concernId: concern.id, ...(unchanged ? { operation: "keep" as const } : { operation: "normalize" as const, description, whyItMatters }) });
      } catch (error) {
        results.push({ concernId: concern.id, operation: "failed", error: error instanceof Error ? error.message : "Concern normalization failed" });
      }
    }
    const changes = results.flatMap((result) => result.operation === "normalize" ? [{ concernId: result.concernId, description: result.description, whyItMatters: result.whyItMatters }] : []);
    const failureCount = results.filter(({ operation }) => operation === "failed").length;
    const applied = options.apply && failureCount === 0 && changes.length > 0;
    const version = applied
      ? await this.repository.apply({ agentId: options.agentId, expectedVersion: snapshot.version, runId: options.runId, occurredAt: options.occurredAt, changes })
      : snapshot.version;
    return { agentId: options.agentId, apply: options.apply, applied, version, normalizedCount: changes.length, keptCount: results.filter(({ operation }) => operation === "keep").length, failureCount, results };
  }
}
