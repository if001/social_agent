import { Pool } from "pg";

import { migrate } from "./infrastructure/persistence/postgres.js";
import { AddressedFileQueue } from "./infrastructure/queue/addressed-file-queue.js";
import { initializeAgent, listDeadLetters, requeueDeadLetter } from "./operations/operations.js";

const [command, ...args] = process.argv.slice(2);
const databaseUrl = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");

async function main(): Promise<void> {
  if (command === "migrate") { const pool = new Pool({ connectionString: process.env.ADMIN_POSTGRES_URL?.replace("postgresql+psycopg://", "postgresql://") || databaseUrl }); try { await migrate(pool); } finally { await pool.end(); } return; }
  if (command === "agent:init") { const [agentId, familyId = "default"] = args; if (agentId === undefined) throw new Error("Usage: agent:init <agent-id> [family-id]"); const pool = new Pool({ connectionString: databaseUrl }); try { await initializeAgent(pool, { agentId, familyId, familyName: familyId, identity: agentId, sharedDisposition: "Curious and thoughtful", initialDisposition: "Open to experience" }); } finally { await pool.end(); } return; }
  if (command === "dead:list") { const [root, destination] = args; if (root === undefined || destination === undefined) throw new Error("Usage: dead:list <queue-root> <destination>"); process.stdout.write(`${JSON.stringify(await listDeadLetters(new AddressedFileQueue(root), destination), null, 2)}\n`); return; }
  if (command === "dead:requeue") { const [root, destination, file] = args; if (root === undefined || destination === undefined || file === undefined) throw new Error("Usage: dead:requeue <queue-root> <destination> <file>"); await requeueDeadLetter(new AddressedFileQueue(root), destination, file); return; }
  throw new Error("Commands: migrate | agent:init | dead:list | dead:requeue");
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Operation failed"}\n`); process.exitCode = 1; });
