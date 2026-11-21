import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/persistence/schema.ts",
  out: "./drizzle",
  migrations: { schema: "app" },
  // TEST_ADMIN_POSTGRES_URL is loaded only by the test migration command and
  // must win over an inherited production ADMIN_POSTGRES_URL.
  dbCredentials: { url: process.env.TEST_ADMIN_POSTGRES_URL ?? process.env.ADMIN_POSTGRES_URL ?? "postgres://localhost/social_agent" }
});
