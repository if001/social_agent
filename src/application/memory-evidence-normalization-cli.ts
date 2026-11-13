export type MemoryEvidenceNormalizationCliOptions = { readonly agentId?: string; readonly apply: boolean };

export function parseMemoryEvidenceNormalizationOptions(arguments_: readonly string[]): MemoryEvidenceNormalizationCliOptions {
  let agentId: string | undefined;
  let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") {
      const candidate = arguments_[index + 1];
      if (candidate === undefined || candidate.trim() === "") throw new Error("--agent-id requires a value");
      agentId = candidate;
      index += 1;
      continue;
    }
    throw new Error("Usage: pnpm memory:evidence:normalize [--agent-id <id>] [--apply]");
  }
  return { ...(agentId === undefined ? {} : { agentId }), apply };
}
