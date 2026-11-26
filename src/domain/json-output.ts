/**
 * Normalizes the one allowed presentation wrapper for an LLM JSON payload.
 * The payload itself is always parsed as JSON; YAML and prose are never
 * interpreted as structured output.
 */
const jsonCodeFence = /^```json\s*\r?\n?([\s\S]*?)\r?\n?```$/iu;

export function parseJsonOutput(content: string): unknown {
  const trimmed = content.trim();
  const fenced = jsonCodeFence.exec(trimmed);
  return JSON.parse(fenced?.[1]?.trim() ?? trimmed);
}
