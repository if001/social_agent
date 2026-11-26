import { parseJsonOutput } from "../../domain/json-output.js";

/** Shared parser for all normal LLM structured-output payloads. */
export const parseModelJson = parseJsonOutput;

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
