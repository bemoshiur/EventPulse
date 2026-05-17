/**
 * Session store per CLAUDE.md §5.3.
 *
 * Sessions live in the `sessions` table. The plaintext token is sent to
 * the client as an HttpOnly cookie; the DB stores the SHA-256 hash. On
 * every request the cookie's token is re-hashed and matched against the
 * stored row, plus expiry is enforced.
 *
 * Audiences:
 * - 'super-admin' — admin.eventpulse.com.bd; tenant_id MUST be null
 * - 'tenant'      — app.eventpulse.com.bd; tenant_id MUST be set
 * - 'attendee'    — my.eventpulse.com.bd; tenant_id MUST be null
 *
 * The `sessions_tenant_consistency_chk` table constraint enforces this
 * at the DB layer too.
 */

import { eq, lt } from 'drizzle-orm'

import { withSuperAdmin } from '../db/client.js'
import { sessions } from '../db/schema/index.js'
import { generateToken, hashToken } from './tokens.js'

const SESSION_TTL_DAYS = 7

export interface SessionAudience {
  audience: 'super-admin' | 'tenant' | 'attendee'
  tenantId?: string
}

export interface CreateSessionInput extends SessionAudience {
  userId: string
  ip?: string | null
  userAgent?: string | null
  ttlDays?: number
}

export interface CreatedSession {
  token: string
  expiresAt: Date
}

export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  if (input.audience === 'tenant' && !input.tenantId) {
    throw new Error('tenant audience requires tenantId')
  }
  if (input.audience !== 'tenant' && input.tenantId) {
    throw new Error('non-tenant audience must not set tenantId')
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const ttl = (input.ttlDays ?? SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + ttl)

  await withSuperAdmin(async (db) => {
    await db.insert(sessions).values({
      id: tokenHash,
      userId: input.userId,
      audience: input.audience,
      tenantId: input.tenantId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    })
  })

  return { token, expiresAt }
}

export interface ResolvedSession {
  userId: string
  audience: SessionAudience['audience']
  tenantId: string | null
  expiresAt: Date
}

/** Returns the active session matching the token, or null if missing/expired. */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const id = hashToken(token)
  const rows = await withSuperAdmin(async (db) =>
    db.select().from(sessions).where(eq(sessions.id, id)).limit(1),
  )
  const row = rows[0]
  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) {
    await revokeSession(token).catch(() => undefined)
    return null
  }
  return {
    userId: row.userId,
    audience: row.audience as SessionAudience['audience'],
    tenantId: row.tenantId,
    expiresAt: row.expiresAt,
  }
}

export async function revokeSession(token: string): Promise<void> {
  const id = hashToken(token)
  await withSuperAdmin(async (db) => {
    await db.delete(sessions).where(eq(sessions.id, id))
  })
}

/**
 * Janitor: drop sessions that have already expired. Cheap to run on a
 * schedule; can also be invoked on every Nth request as a side task.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await withSuperAdmin(async (db) =>
    db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id }),
  )
  return result.length
}
