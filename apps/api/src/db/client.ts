/**
 * Postgres connection + tenant-scoping helpers per CLAUDE.md §4.2.
 *
 * Every request that touches tenant-scoped data goes through `withTenant`,
 * which sets `app.current_tenant_id` on the session before any query runs.
 * RLS policies (see migrations/0002_identity_rls_policies.sql) read that
 * setting and enforce isolation at the database layer.
 *
 * Super-admin code goes through `withSuperAdmin` which switches the role
 * to `eventpulse_admin` (BYPASSRLS). Use sparingly and audit-log every call.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'

import * as schema from './schema/index.js'

type Schema = typeof schema

let _pool: pg.Pool | undefined

/**
 * Lazy-initialised connection pool. Tests can call `resetPool()` between
 * runs to ensure clean state.
 */
export function pool(): pg.Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL']
    if (!url) {
      throw new Error('DATABASE_URL is not set. Required for any DB-touching code path.')
    }
    _pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env['DATABASE_POOL_MAX'] ?? '10'),
      idleTimeoutMillis: 30_000,
    })
  }
  return _pool
}

/** Reset the pool — for tests only. */
export async function resetPool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}

/**
 * Run `fn` inside a transaction scoped to `tenantId`. Sets the session
 * variable that RLS policies read. Always rolls back if `fn` throws.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: NodePgDatabase<Schema>) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId])
    const db = drizzle(client, { schema })
    const result = await fn(db)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Run `fn` as the `eventpulse_admin` Postgres role (BYPASSRLS). Use only
 * in super-admin code paths. Caller is responsible for audit logging.
 */
export async function withSuperAdmin<T>(
  fn: (tx: NodePgDatabase<Schema>) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE eventpulse_admin')
    const db = drizzle(client, { schema })
    const result = await fn(db)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Smoke probe; returns the server's now() to verify connectivity. */
export async function ping(): Promise<Date> {
  const client = await pool().connect()
  try {
    const result = await client.query<{ now: Date }>(sql`SELECT now() AS now`.toString())
    return result.rows[0]!.now
  } finally {
    client.release()
  }
}
