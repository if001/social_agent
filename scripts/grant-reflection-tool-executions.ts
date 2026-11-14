import { Pool } from "pg";

const normalizeUrl = (value: string) => value.replace("postgresql+psycopg://", "postgresql://");
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Grants only the DML privileges required by the runtime writer/reader. */
export async function grantReflectionToolExecutionPrivileges(admin: Pool, runtime: Pool): Promise<string> {
  const role = (await runtime.query<{ role: string }>("SELECT current_user AS role")).rows[0]?.role;
  if (role === undefined || role === "") throw new Error("Could not determine runtime database role");
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.reflection_tool_executions TO ${quoteIdentifier(role)}`);
  return role;
}

async function main(): Promise<void> {
  const adminUrl = process.env.ADMIN_POSTGRES_URL;
  const runtimeUrl = process.env.POSTGRES_URL;
  if (adminUrl === undefined || runtimeUrl === undefined) throw new Error("ADMIN_POSTGRES_URL and POSTGRES_URL are required");
  const admin = new Pool({ connectionString: normalizeUrl(adminUrl) });
  const runtime = new Pool({ connectionString: normalizeUrl(runtimeUrl) });
  try { await grantReflectionToolExecutionPrivileges(admin, runtime); process.stdout.write("Granted Reflection Tool execution DML privileges to the runtime role.\n"); } finally { await Promise.all([admin.end(), runtime.end()]); }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Runtime grant failed"}\n`); process.exitCode = 1; });
