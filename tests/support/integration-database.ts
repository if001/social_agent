import { Pool } from "pg";

import { migrate } from "../../src/infrastructure/persistence/postgres.js";

const normalizeUrl = (url: string) => url.replace("postgresql+psycopg://", "postgresql://");
const options = "-c search_path=app,public,ext";

const databaseNameFromUrl = (url: string) => {
  const name = new URL(normalizeUrl(url)).pathname.replace(/^\//u, "");
  if (name.length === 0) throw new Error("TEST_POSTGRES_URL must include a database name");
  return name;
};

export const integrationDatabaseConfigured = () =>
  process.env.TEST_POSTGRES_URL !== undefined && process.env.TEST_ADMIN_POSTGRES_URL !== undefined;

/**
 * Shared, disposable integration-test database.  DDL uses the admin role;
 * application assertions deliberately use only the runtime role.
 */
export const createIntegrationDatabase = () => {
  const runtimeUrl = process.env.TEST_POSTGRES_URL;
  const adminUrl = process.env.TEST_ADMIN_POSTGRES_URL;
  if (runtimeUrl === undefined || adminUrl === undefined) {
    throw new Error("TEST_POSTGRES_URL and TEST_ADMIN_POSTGRES_URL are required for integration tests");
  }
  const pool = new Pool({ connectionString: normalizeUrl(runtimeUrl), options, max: 4 });
  const admin = new Pool({ connectionString: normalizeUrl(adminUrl), options, max: 2 });
  const expectedDatabaseName = process.env.TEST_DATABASE_NAME ?? databaseNameFromUrl(runtimeUrl);
  let prepared = false;

  const assertTestDatabase = async () => {
    const [runtime, administrator] = await Promise.all([
      pool.query<{ database: string }>("SELECT current_database() AS database"),
      admin.query<{ database: string }>("SELECT current_database() AS database")
    ]);
    const runtimeName = runtime.rows[0]?.database;
    const adminName = administrator.rows[0]?.database;
    if (runtimeName !== expectedDatabaseName || adminName !== expectedDatabaseName || runtimeName !== adminName || !expectedDatabaseName.endsWith("_test")) {
      throw new Error("Integration tests require matching runtime/admin URLs for a database whose name ends in _test");
    }
  };

  const clear = async () => {
    const tables = (await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'app' AND tablename <> '__drizzle_migrations' ORDER BY tablename"
    )).rows.map(({ tablename }) => `app.${quoteIdentifier(tablename)}`);
    if (tables.length > 0) await admin.query(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  };

  return {
    pool,
    admin,
    async prepare() {
      await assertTestDatabase();
      await admin.query("CREATE SCHEMA IF NOT EXISTS app");
      await migrate(admin);
      await clear();
      prepared = true;
    },
    async close() {
      if (prepared) await clear();
      await pool.end();
      await admin.end();
    }
  };
};

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
