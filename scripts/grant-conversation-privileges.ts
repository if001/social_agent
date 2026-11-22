import { Pool } from "pg";

const normalizeUrl = (value: string) => value.replace("postgresql+psycopg://", "postgresql://");
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function grantConversationPrivileges(admin: Pool, runtime: Pool): Promise<string> {
  const role = (await runtime.query<{ role: string }>("SELECT current_user AS role")).rows[0]?.role;
  if (role === undefined || role === "") throw new Error("Could not determine runtime database role");
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.conversations, app.conversation_messages TO ${quoteIdentifier(role)}`);
  return role;
}

async function main(): Promise<void> {
  const adminUrl = process.env.TEST_ADMIN_POSTGRES_URL ?? process.env.ADMIN_POSTGRES_URL;
  const runtimeUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL;
  if (adminUrl === undefined || runtimeUrl === undefined) throw new Error("Admin and Runtime PostgreSQL URLs are required");
  const admin = new Pool({ connectionString: normalizeUrl(adminUrl) }); const runtime = new Pool({ connectionString: normalizeUrl(runtimeUrl) });
  try { const role = await grantConversationPrivileges(admin, runtime); process.stdout.write(`Granted Conversation DML privileges to ${role}.\n`); }
  finally { await Promise.all([admin.end(), runtime.end()]); }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Runtime grant failed"}\n`); process.exitCode = 1; });
