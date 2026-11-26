import { Pool } from "pg";
import { and, desc, eq } from "drizzle-orm";

import { loadBotStartConfig } from "../../src/bootstrap/bot-start.js";
import { createBotComposition } from "../../src/bootstrap/bot-composition.js";
import { ExperienceIntegrationOutputSchema } from "../../src/application/experience-integration.js";
import { createOllamaExperienceIntegrationModel } from "../../src/infrastructure/agent/experience-integration-harness.js";
import { PostgresExperienceIntegrationRepository } from "../../src/infrastructure/persistence/postgres-experience-integration.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import { experienceIntegrations } from "../../src/infrastructure/persistence/schema.js";
import { UuidGenerator } from "../../src/infrastructure/system.js";

const describeReplay = process.env.LIVE_SHIRO_EXPERIENCE_INTEGRATION_REPLAY === "true" ? describe : describe.skip;

describeReplay("live shiro Experience Integration replay", () => {
  it("FR-82, NFR-8: produces a valid aggregate from one persisted shiro run without writing the production DB", async () => {
    const config = await loadBotStartConfig(["--env-file", ".env.shiro"]);
    const pool = new Pool({ connectionString: config.database.url.replace("postgresql+psycopg://", "postgresql://"), options: "-c search_path=app,public,ext", max: 1 });
    try {
      const database = createRuntimeDatabase(pool);
      const [row] = await database.db.select({ id: experienceIntegrations.id }).from(experienceIntegrations)
        .where(and(eq(experienceIntegrations.agentId, "shiro"), eq(experienceIntegrations.status, "completed"))).orderBy(desc(experienceIntegrations.createdAt)).limit(1);
      expect(row).toBeDefined();
      if (row === undefined) return;
      const repository = new PostgresExperienceIntegrationRepository(database, new UuidGenerator(), () => new Date());
      const [input] = await repository.completedByIds([row.id]);
      expect(input).toBeDefined();
      if (input === undefined) return;
      const composition = createBotComposition({ pool, config });
      const output = await createOllamaExperienceIntegrationModel({ ...config.chat, toolRegistry: composition.toolRegistry }).integrate(input, AbortSignal.timeout(300_000));
      expect(ExperienceIntegrationOutputSchema.safeParse(output).success).toBe(true);
    } finally { await pool.end(); }
  }, 310_000);
});
