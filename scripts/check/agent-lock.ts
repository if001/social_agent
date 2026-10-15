import { Pool } from "pg";

const agentId = process.argv[2];
if (agentId === undefined || agentId.trim() === "") {
  console.error("Usage: node --env-file=.env --import tsx scripts/check/agent-lock.ts <agent-id>");
  process.exitCode = 1;
} else {
  const databaseUrl = process.env.POSTGRES_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") throw new Error("POSTGRES_URL is missing");

  const pool = new Pool({
    connectionString: databaseUrl.replace("postgresql+psycopg://", "postgresql://")
  });

  try {
    const result = await pool.query<Record<string, unknown>>(`
      WITH target AS (
        SELECT lock_key
        FROM agent_lock_keys
        WHERE agent_id = $1
      ), advisory_locks AS (
        SELECT
          pid,
          granted,
          CASE
            WHEN ((classid::bigint << 32) + objid::bigint) >= 9223372036854775808
              THEN ((classid::bigint << 32) + objid::bigint) - 18446744073709551616
            ELSE ((classid::bigint << 32) + objid::bigint)
          END AS lock_key
        FROM pg_locks
        WHERE locktype = 'advisory'
      )
      SELECT
        activity.pid,
        activity.state,
        activity.backend_start,
        activity.state_change,
        activity.client_addr,
        activity.wait_event_type,
        activity.wait_event,
        advisory_locks.granted,
        activity.query AS last_query
      FROM target
      JOIN advisory_locks USING (lock_key)
      JOIN pg_stat_activity AS activity USING (pid)
      ORDER BY activity.pid
    `, [agentId]);

    if (result.rows.length === 0) console.log(`No advisory lock session found for agent: ${agentId}`);
    else console.table(result.rows);
  } finally {
    await pool.end();
  }
}
