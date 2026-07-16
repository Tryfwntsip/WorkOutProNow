import { loadEnv } from "@myoadapt/config";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.js";

export * from "./schema.js";

let pool: pg.Pool | undefined;
let db: Kysely<Database> | undefined;

/**
 * Shared PostgreSQL connection pool. Created lazily on first use so importing
 * this package does not open connections (e.g. during tests that mock the db).
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return pool;
}

/** Typed Kysely client over the foundational schema. */
export function getDb(): Kysely<Database> {
  if (!db) {
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() })
    });
  }
  return db;
}

/** Liveness probe used by service /health/ready endpoints. */
export async function pingDb(): Promise<boolean> {
  const result = await getPool().query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}

/** Graceful shutdown — close the pool on SIGTERM/SIGINT. */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = undefined;
    pool = undefined;
  } else if (pool) {
    await pool.end();
    pool = undefined;
  }
}
