/**
 * Postgres connection + RLS-scoping helpers per CLAUDE.md §4.2 / §4.2.1.
 *
 * Three context helpers, one per audience:
 *
 *   - withTenant(tenantId, fn) — tenant routes. Sets `app.current_tenant_id`.
 *     Tenant-scoped RLS policies (migrations/0002_identity_rls_policies.sql)
 *     read that var.
 *
 *   - withUser(userId, fn)     — /my/* routes (user-scoped, no tenant).
 *     Sets `app.current_user_id`. User-scoped RLS policies
 *     (migrations/0003_user_scoped_rls.sql) read that var.
 *
 *   - withSuperAdmin(fn)       — super-admin routes. Switches Postgres role
 *     to `eventpulse_admin` (BYPASSRLS). Use sparingly and audit-log every
 *     call.
 *
 * The first two switch to `eventpulse_app` first (non-superuser, RLS engages
 * — Postgres superusers always bypass RLS regardless of FORCE; see
 * .claude/memory/gotchas.md). The third switches to `eventpulse_admin`.
 *
 * All three open a transaction; `fn` runs inside it; commit on success,
 * rollback on throw.
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
 * Run `fn` inside a transaction scoped to `tenantId`. Drops to the
 * non-superuser `eventpulse_app` role (so RLS engages — Postgres
 * superusers always bypass RLS) and sets the session variable that
 * RLS policies read. Always rolls back if `fn` throws.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: NodePgDatabase<Schema>) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE eventpulse_app')
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
 * Run `fn` inside a transaction scoped to `userId`. Drops to the
 * non-superuser `eventpulse_app` role (so RLS engages) and sets
 * `app.current_user_id` for user-scoped policies (migration 0003) to
 * read. Use for `/my/*` routes and any other endpoint that authorises
 * by user identity rather than by tenant membership.
 *
 * Visible under this context (per migration 0003):
 *   - users           : only the row matching userId
 *   - sessions        : only sessions belonging to userId
 *   - oauth_identities: only OAuth links belonging to userId
 *
 * NOT visible under this context (deliberate — BYPASSRLS-only):
 *   - magic_links     : operational; tokens are consumed via withSuperAdmin
 *   - handle_history  : audit trail; read via middleware (BYPASSRLS)
 *
 * Tenant-scoped tables also see zero rows here because
 * `app.current_tenant_id` is not set; that's correct — withUser is for
 * routes that don't have a tenant context. If you need both, today the
 * call site uses withSuperAdmin and does the auth check in application
 * code; a combined `withUserInTenant(userId, tenantId, fn)` helper can
 * be added later if a real use case appears.
 *
 * Always rolls back if `fn` throws.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: NodePgDatabase<Schema>) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE eventpulse_app')
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
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
