import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema.js";

/**
 * Runtime persistence connection boundary.
 *
 * Only infrastructure repositories receive this object.  Application services,
 * Tool adapters, and UI readers depend on purpose-specific repository ports,
 * never on `pg` clients.  Repositories use `db` for ordinary CRUD; the small
 * set of PostgreSQL-specific operations remains in those repositories.
 */
export function createRuntimeDatabase(pool: Pool) {
  const db = drizzle(pool, { schema });
  return {
    db,
    native: pool,
    transaction: db.transaction.bind(db)
  };
}

export type RuntimeDatabase = ReturnType<typeof createRuntimeDatabase>;
