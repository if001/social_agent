/**
 * Ollama's schema mode normally returns JSON. Some models nevertheless emit a
 * literal line break or tab inside a JSON string. Those characters have an
 * unambiguous JSON representation, so escaping only them preserves the model
 * value without inventing fields or prose.
 */
const unfence = (content: string): string => content.trim()
  .replace(/^```(?:json)?\s*/iu, "")
  .replace(/\s*```$/u, "");

const escapeControlsInsideStrings = (json: string): string => {
  let escaped = false;
  let inString = false;
  let result = "";
  for (const char of json) {
    if (escaped) { result += char; escaped = false; continue; }
    if (char === "\\") { result += char; escaped = true; continue; }
    if (char === '"') { result += char; inString = !inString; continue; }
    if (!inString || char.charCodeAt(0) >= 0x20) { result += char; continue; }
    result += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  }
  return result;
};

export function parseModelJson(content: string): unknown {
  const source = unfence(content);
  try { return JSON.parse(source); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const repaired = escapeControlsInsideStrings(source);
    if (repaired === source) throw error;
    return JSON.parse(repaired);
  }
}

export function hasModelJsonSyntaxError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof SyntaxError) return true;
    current = current.cause;
  }
  return false;
}

/** Re-ask only when the provider failed before a schema validator could see JSON. */
export async function retryMalformedModelJson<T>(initial: () => Promise<T>, repair: () => Promise<T>): Promise<T> {
  try { return await initial(); }
  catch (error) {
    if (!hasModelJsonSyntaxError(error)) throw error;
    return repair();
  }
}
