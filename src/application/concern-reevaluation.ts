import { z } from "zod";

/** A Runtime-bound Concern candidate. Its canonical ID never reaches the model. */
export type ConcernReevaluationFocus = {
  readonly concernId: string;
  readonly description: string;
  readonly whyItMatters: string;
};

export type ConcernReevaluationSource = {
  readonly agentId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceEventId?: string;
  readonly sourceRunId?: string;
  readonly memoryIds: readonly string[];
};

export const ConcernImpactSchema = z.object({
  decision: z.enum(["none", "reconsider"]).describe("この経験が現在の一件のConcernを別の持続的関心へ分ける再検討を必要とするか。Memory保存だけではreconsiderにしない"),
  reason: z.string().trim().min(1).max(400).describe("現在のConcernと今回の経験の関係を短く説明する。ID、候補番号、status、次の実行手順は書かない")
}).strict();
export type ConcernImpact = z.infer<typeof ConcernImpactSchema>;

export type ConcernImpactInput = {
  readonly source: ConcernReevaluationSource;
  readonly focus: { readonly description: string; readonly whyItMatters: string };
  readonly experienceSummary: string;
  readonly memories: readonly { readonly content: string; readonly importance: string }[];
};

export interface ConcernImpactModel {
  assess(input: ConcernImpactInput, signal: AbortSignal): Promise<unknown>;
}

export interface ConcernReevaluationRepository {
  /** `retry` means the original Memory write is already durable and only the
   * inexpensive impact assessment is being retried. */
  begin(source: ConcernReevaluationSource): Promise<"created" | "retry" | "existing">;
  focus(source: ConcernReevaluationSource): Promise<ConcernReevaluationFocus | undefined>;
  input(source: ConcernReevaluationSource, focus: ConcernReevaluationFocus): Promise<ConcernImpactInput>;
  discard(source: ConcernReevaluationSource, reason: string): Promise<void>;
  pending(source: ConcernReevaluationSource, focus: ConcernReevaluationFocus, impact: ConcernImpact): Promise<void>;
  fail(source: ConcernReevaluationSource, error: unknown): Promise<void>;
}

/**
 * Turns one completed experience into at most one pending motivational
 * re-evaluation.  The batch is durable before the small model call, so a
 * failed assessment never repeats the original Memory write.
 */
export class ConcernReevaluation {
  constructor(private readonly repository: ConcernReevaluationRepository, private readonly model: ConcernImpactModel) {}

  async consider(source: ConcernReevaluationSource, signal: AbortSignal): Promise<void> {
    if (source.memoryIds.length === 0) return;
    const state = await this.repository.begin(source);
    if (state === "existing") return;
    const focus = await this.repository.focus(source);
    if (focus === undefined) { await this.repository.discard(source, "関連するactive Concernが見つからなかった"); return; }
    try {
      const impact = ConcernImpactSchema.parse(await this.model.assess(await this.repository.input(source, focus), signal));
      if (impact.decision === "none") await this.repository.discard(source, impact.reason);
      else await this.repository.pending(source, focus, impact);
    } catch (error) {
      await this.repository.fail(source, error);
    }
  }
}
