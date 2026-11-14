import { Pool } from "pg";

import { EventExperienceSchema } from "../src/application/experience-integration.js";
import { loadConfig } from "../src/config/config.js";
import { createOllamaEventExperienceRepairModel } from "../src/infrastructure/agent/experience-integration-harness.js";
import { OllamaEmbeddingProvider } from "../src/infrastructure/embedding/ollama-embedding.js";
import { PostgresExperienceIntegrationRepository } from "../src/infrastructure/persistence/postgres-experience-integration.js";
import { PostgresMemoryEmbeddingLifecycle } from "../src/infrastructure/persistence/postgres-memory-embedding.js";
import { UuidGenerator } from "../src/infrastructure/system.js";

type Options = { readonly agentId?: string; readonly apply: boolean };

function options(args: readonly string[]): Options {
  let agentId: string | undefined;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    if (value === "--apply") { apply = true; continue; }
    throw new Error("Usage: pnpm experience:requeue:missing-event-experience [--agent-id <id>] [--apply]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  return { ...(agentId === undefined ? {} : { agentId }), apply };
}

async function main(): Promise<void> {
  const config = options(process.argv.slice(2));
  const app = await loadConfig();
  const pool = new Pool({ connectionString: app.database.url.replace("postgresql+psycopg://", "postgresql://") });
  try {
    const ids = new UuidGenerator();
    const embedding = new PostgresMemoryEmbeddingLifecycle(pool, new OllamaEmbeddingProvider(app.embedding), app.embedding.model);
    const repository = new PostgresExperienceIntegrationRepository(pool, ids, () => new Date(), embedding);
    const candidates = await repository.missingEventExperienceCandidates(config.agentId);
    let completed = 0; let failed = 0;
    if (config.apply) {
      const model = createOllamaEventExperienceRepairModel(app.chat);
      for (const input of await repository.completedByIds(candidates.map(({ id }) => id))) {
        try { await repository.repairEventExperience(input, EventExperienceSchema.parse(await model.integrate(input, AbortSignal.timeout(60_000)))); completed += 1; }
        catch { failed += 1; }
      }
    }
    process.stdout.write(`${JSON.stringify({ ...(config.agentId === undefined ? {} : { agentId: config.agentId }), apply: config.apply, candidateCount: candidates.length, completed, failed, candidates: candidates.slice(0, 20) })}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Experience Integration requeue failed"}\n`);
  process.exitCode = 1;
});
