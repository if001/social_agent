import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/persistence/schema.ts",
  out: "./drizzle",
  migrations: { schema: "app" },
  dbCredentials: { url: process.env.ADMIN_POSTGRES_URL ?? "postgres://localhost/social_agent" }
});
