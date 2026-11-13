/**
 * Projects Runtime records into the representation an LLM may inspect.
 * Canonical identifiers, ownership references, cursors and optimistic-lock
 * fields are Runtime capabilities, not model context.
 */
const runtimeOnlyKeys = new Set([
  "id", "agentId", "runId", "eventId", "memoryId", "subjectId", "subjectIds",
  "concernId", "predictionId", "sourceEventId", "sourceRunId", "sourcePredictionId",
  "evidenceEventIds", "evidenceMemoryIds", "cursor", "nextCursor", "offset",
  "version", "toolCallId", "idempotencyKey", "integrationId"
]);

export function toModelRecordView(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toModelRecordView);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !runtimeOnlyKeys.has(key))
    .map(([key, item]) => [key, toModelRecordView(item)]));
}
