import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("runtime database boundary", () => {
  it("NFR-11: keeps PostgreSQL clients behind purpose-specific repository adapters", async () => {
    const [memoryUpdate, agentContextTools, scheduledTaskTools, agentContextRepository, memoryRepository, scheduledTaskRepository, composition] = await Promise.all([
      source("src/application/memory-update.ts"),
      source("src/infrastructure/tools/agent-context-tools.ts"),
      source("src/infrastructure/tools/scheduled-task-tools.ts"),
      source("src/infrastructure/persistence/postgres-agent-context-tool-repository.ts"),
      source("src/infrastructure/persistence/postgres-memory-update-repository.ts"),
      source("src/infrastructure/persistence/postgres-scheduled-task-tool-repository.ts"),
      source("src/bootstrap/bot-composition.ts")
    ]);

    for (const boundarySource of [memoryUpdate, agentContextTools, scheduledTaskTools]) {
      expect(boundarySource).not.toMatch(/from ["']pg["']/u);
      expect(boundarySource).not.toMatch(/\bPool(?:Client)?\b/u);
    }
    for (const repositorySource of [agentContextRepository, memoryRepository, scheduledTaskRepository]) {
      expect(repositorySource).toMatch(/constructor\(private readonly database: RuntimeDatabase/u);
      expect(repositorySource).not.toMatch(/constructor\([^)]*\bPool(?:Client)?\b/u);
    }
    expect(composition.match(/const database = createRuntimeDatabase\(pool\)/gu)).toHaveLength(1);
    expect(composition).toContain("new PostgresAgentContextToolRepository(database, retrievalService)");
    expect(composition).toContain("new PostgresMemoryUpdateRepository(database,");
    expect(composition).toContain("new PostgresScheduledTaskToolRepository(database)");
  });
});
