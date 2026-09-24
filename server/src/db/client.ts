import postgres from 'postgres';
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsTransaction,
} from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * An open drizzle transaction (`db.transaction(async (tx) => …)`). Same query
 * surface as `Db`, scoped to the transaction. (Structurally assignable to `Db`
 * in drizzle 0.38, but declared explicitly so intent reads and a future
 * drizzle bump that breaks the aliasing fails loudly here, not silently.)
 */
export type Tx = PostgresJsTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** A repository helper client: the shared pool OR an open transaction. Helpers
 *  taking this participate in their caller's unit of work (B3) — pass `tx`
 *  through when the call site wraps the unit in `db.transaction`. */
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
