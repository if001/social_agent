import { G3OutputSchema, PredictionOutputSchema, type G3EvaluationOutput, type PredictionOutput } from "../domain/contracts.js";

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const text = (value: unknown, fallback: string): string => typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;

/** One-way data migration. Runtime readers must only accept the current schemas. */
export function migratePredictionOutput(value: unknown): PredictionOutput {
  const root = object(value);
  if (root === undefined) return PredictionOutputSchema.parse(value);
  const predictions = object(root.predictions) ?? {};
  const candidates = (group: "g1" | "g2") => {
    const layer = object(predictions[group]);
    const first = Array.isArray(layer?.candidates) ? object(layer.candidates[0]) : undefined;
    if (first === undefined) return [];
    const base = {
      content: text(first.content, "予測内容なし"), expectation: first.expectation, contextSummary: text(first.contextSummary, "文脈なし"), rationale: text(first.rationale, "旧記録から移行"),
      ...(group === "g1" ? { feature: text(first.feature, "表層") } : { speechAct: text(first.speechAct, "発話") })
    };
    return [base];
  };
  const evaluations = (Array.isArray(root.predictionEvaluations) ? root.predictionEvaluations : []).slice(0, 2).flatMap((raw) => {
    const item = object(raw); if (item === undefined || (item.group !== "g1" && item.group !== "g2")) return [];
    return [{ group: item.group, match: item.match, surprise: item.surprise ?? "unknown", interpretation: text(item.interpretation, "旧評価から移行") }];
  });
  const oldG3 = object(root.g3); const investigation = object(root.investigation);
  const reason = typeof investigation?.reason === "string" ? investigation.reason : oldG3?.needsG3 === true ? oldG3.reason : undefined;
  return PredictionOutputSchema.parse({ predictions: { g1: { candidates: candidates("g1") }, g2: { candidates: candidates("g2") } }, predictionEvaluations: evaluations, ...(typeof reason === "string" && reason.trim() !== "" ? { investigation: { reason: reason.trim() } } : {}) });
}

export function migrateG3Output(value: unknown): G3EvaluationOutput {
  const root = object(value);
  if (root === undefined) return G3OutputSchema.parse(value);
  const strings = (candidate: unknown): string[] => Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()).slice(0, 5) : [];
  return G3OutputSchema.parse({ findings: strings(root.findings), hypotheses: strings(root.hypotheses ?? root.newHypotheses) });
}
