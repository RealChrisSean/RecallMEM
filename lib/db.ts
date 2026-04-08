import { Pool, QueryResultRow } from "pg";

/**
 * Database layer for the RecallMEM memory framework.
 *
 * This module supports two usage patterns:
 *
 * 1. **Standalone app (default):** Set `DATABASE_URL` in your env and the
 *    pool is created automatically on first query. The default user ID is
 *    "local-user" (single-user mode). This is what the RecallMEM app does.
 *
 * 2. **Embedded as a framework:** If you're forking lib/ into your own app:
 *    - Call `configureDb({ pool: yourPool })` to share your existing pool
 *    - Call `setUserIdResolver(fn)` to wire in your auth system so each
 *      request uses the right user's memory
 *
 * Example for embedding the framework into a multi-user app:
 *
 *   import { Pool } from "pg";
 *   import { configureDb, setUserIdResolver } from "./lib/db";
 *
 *   const myPool = new Pool({ connectionString: "postgres://..." });
 *   configureDb({ pool: myPool });
 *
 *   // Resolve the current user from your auth system on each call.
 *   // Can be sync (returns string) or async (returns Promise<string>).
 *   setUserIdResolver(() => getCurrentUserFromSession());
 */

let _pool: Pool | null = null;
let _userIdResolver: () => string | Promise<string> = () => "local-user";

/**
 * Wire in a custom Postgres pool. Call this once at startup before any
 * RecallMEM lib functions run.
 */
export function configureDb(opts: { pool: Pool }): void {
  _pool = opts.pool;
}

/**
 * Wire in a function that returns the current user's ID. Called by lib
 * functions whenever they need to scope a query to a user. Default returns
 * "local-user" (single-user mode).
 *
 * If your app has auth, pass a function that reads the current user from
 * your session/JWT/whatever and returns their ID as a string.
 */
export function setUserIdResolver(
  resolver: () => string | Promise<string>
): void {
  _userIdResolver = resolver;
}

/**
 * Get the current user's ID. Used by all lib functions internally.
 * In single-user mode this just returns "local-user".
 */
export async function getUserId(): Promise<string> {
  return _userIdResolver();
}

/**
 * Get the active pool. If none has been configured, lazily create one
 * from `DATABASE_URL`.
 */
export function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set and no pool has been configured. " +
          "Either set DATABASE_URL in your environment, or call " +
          "configureDb({ pool }) before using lib functions."
      );
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return _pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

// Convert a number[] embedding into pgvector's text format: '[0.1,0.2,...]'
export function toVectorString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
