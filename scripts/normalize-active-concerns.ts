import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { parseConcernNormalizationOptions } from "../src/application/concern-normalization-cli.js";
import { ConcernNormalizationService } from "../src/application/concern-normalization.js";
import { createOllamaConcernNormalizationModel } from "../src/infrastructure/agent/concern-normalization-model.js";
import { PostgresConcernNormalizationRepository } from "../src/infrastructure/persistence/postgres-concern-normalization.js";
import { createRuntimeDatabase } from "../src/infrastructure/persistence/runtime-database.js";
import { createStdoutLogger } from "../src/observability/logger.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value;
};

async function main(): Promise<void> {
  const options = parseConcernNormalizationOptions(process.argv.slice(2));
  const pool = new Pool({ connectionString: required("POSTGRES_URL").replace("postgresql+psycopg://", "postgresql://"), options: "-c search_path=app,public,ext" });
  try {
    const service = new ConcernNormalizationService(
      createOllamaConcernNormalizationModel(
        { baseUrl: required("OLLAMA_BASE_URL"), apiKey: required("OLLAMA_API_KEY"), model: required("OLLAMA_CHAT_MODEL"), think: "low" },
        createStdoutLogger({ component: "concern_normalization" }, (line) => { process.stderr.write(line); })
      ),
      new PostgresConcernNormalizationRepository(createRuntimeDatabase(pool))
    );
    const result = await service.run({ agentId: options.agentId, apply: options.apply, runId: randomUUID(), occurredAt: new Date(), signal: AbortSignal.timeout(600_000) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failureCount > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Concern normalization failed"}\n`);
  process.exitCode = 1;
});
