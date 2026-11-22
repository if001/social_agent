export type ConcernNormalizationCliOptions = { readonly agentId: string; readonly apply: boolean };

export function parseConcernNormalizationOptions(arguments_: readonly string[]): ConcernNormalizationCliOptions {
  let agentId: string | undefined;
  let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") {
      const candidate = arguments_[index + 1];
      if (candidate === undefined || candidate.trim() === "" || candidate.startsWith("--")) throw new Error("--agent-id requires a value");
      agentId = candidate;
      index += 1;
      continue;
    }
    throw new Error("Usage: pnpm concern:normalize -- --agent-id <id> [--apply]");
  }
  if (agentId === undefined) throw new Error("--agent-id is required");
  return { agentId, apply };
}
