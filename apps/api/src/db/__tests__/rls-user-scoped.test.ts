import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import pg from 'pg'

import { resetPool, withSuperAdmin, withUser } from '../client.js'
import {
  handleHistory,
  magicLinks,
  oauthIdentities,
  sessions,
  tenants,
  users,
} from '../schema/index.js'

/**
 * User-scoped RLS isolation tests per CLAUDE.md §4.4 + migration 0003.
 *
 * Two tests per RLS'd table (per `.claude/memory/decisions.md`
 * "Sprint 2 plan approved with 5 amendments", Moshiur's add-on at Item 3
 * approval): for each of `users`, `sessions`, and `oauth_identities`,
 * verify BOTH directions:
 *
 *   1. User A's read of their OWN row returns the expected data.
 *   2. User A's read of user B's row returns zero rows (RLS blocks).
 *
 * Plus negative-context tests that confirm:
 *
 *   - `magic_links` and `handle_history` are NOT visible under
 *     withUser() — they stay BYPASSRLS-only per Sprint 2 amendment 2.
 *   - Tenant-scoped tables (e.g. `tenants`) return zero rows in a
 *     withUser() context because `app.current_tenant_id` is not set.
 *   - A buggy code path that switches to eventpulse_app without
 *     setting `app.current_user_id` sees zero rows everywhere.
 *
 * Skipped automatically when DATABASE_URL is unset.
 */

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('RLS user-scoped isolation (migration 0003)', () => {
  const fixtures: {
    userA?: string
    userB?: string
    sessionA?: string
    sessionB?: string
    oauthA?: string
    oauthB?: string
    tenantA?: string
    magicLinkAHash?: string
    handleHistoryAId?: string
  } = {}

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      // Two distinct users.
      const ts = Date.now()
      const [userA] = await db
        .insert(users)
        .values({
          email: `rls-user-a-${ts}@test.local`,
          fullName: 'RLS User A',
        })
        .returning({ id: users.id })
      const [userB] = await db
        .insert(users)
        .values({
          email: `rls-user-b-${ts}@test.local`,
          fullName: 'RLS User B',
        })
        .returning({ id: users.id })
      fixtures.userA = userA!.id
      fixtures.userB = userB!.id

      // One attendee session per user (audience=attendee → tenant_id null).
      const [sessionA] = await db
        .insert(sessions)
        .values({
          id: `sess-a-${ts}`,
          userId: userA!.id,
          audience: 'attendee',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .returning({ id: sessions.id })
      const [sessionB] = await db
        .insert(sessions)
        .values({
          id: `sess-b-${ts}`,
          userId: userB!.id,
          audience: 'attendee',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .returning({ id: sessions.id })
      fixtures.sessionA = sessionA!.id
      fixtures.sessionB = sessionB!.id

      // One OAuth identity per user (different providers to keep
      // (provider, provider_user_id) UNIQUE constraint clean).
      const [oauthA] = await db
        .insert(oauthIdentities)
        .values({
          userId: userA!.id,
          provider: 'google',
          providerUserId: `google-rls-a-${ts}`,
          email: `rls-user-a-${ts}@test.local`,
        })
        .returning({ id: oauthIdentities.id })
      const [oauthB] = await db
        .insert(oauthIdentities)
        .values({
          userId: userB!.id,
          provider: 'apple',
          providerUserId: `apple-rls-b-${ts}`,
          email: `rls-user-b-${ts}@test.local`,
        })
        .returning({ id: oauthIdentities.id })
      fixtures.oauthA = oauthA!.id
      fixtures.oauthB = oauthB!.id

      // A magic link for user A — exists so the negative test can
      // distinguish "RLS blocked" from "no data at all".
      const tokenHash = `rls-token-hash-a-${ts}`
      await db.insert(magicLinks).values({
        tokenHash,
        userId: userA!.id,
        email: `rls-user-a-${ts}@test.local`,
        purpose: 'signin',
        expiresAt: new Date(Date.now() + 1000 * 60 * 15),
      })
      fixtures.magicLinkAHash = tokenHash

      // A tenant for the "withUser cannot see tenants" sanity test.
      const [tenantA] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: `RLS Tenant A ${ts}`,
          slug: `rls-tenant-a-${ts}`,
          ownerUserId: userA!.id,
          isPersonal: true,
        })
        .returning({ id: tenants.id })
      fixtures.tenantA = tenantA!.id

      // A handle_history row for user A.
      const [hh] = await db
        .insert(handleHistory)
        .values({
          userId: userA!.id,
          oldHandle: `rls-old-a-${ts}`,
          newHandle: `rls-new-a-${ts}`,
        })
        .returning({ id: handleHistory.id })
      fixtures.handleHistoryAId = hh!.id
    })
  })

  afterAll(async () => {
    // Best-effort cleanup. Foreign-key cascades handle most of it
    // (sessions / oauth_identities / handle_history all CASCADE on users).
    // magic_links does NOT cascade — drop them manually.
    await withSuperAdmin(async (db) => {
      if (fixtures.magicLinkAHash) {
        await db.delete(magicLinks).where(eq(magicLinks.tokenHash, fixtures.magicLinkAHash))
      }
      if (fixtures.tenantA) {
        await db.delete(tenants).where(eq(tenants.id, fixtures.tenantA))
      }
      if (fixtures.userA) await db.delete(users).where(eq(users.id, fixtures.userA))
      if (fixtures.userB) await db.delete(users).where(eq(users.id, fixtures.userB))
    })
    await resetPool()
  })

  // ─── users ────────────────────────────────────────────────────────────

  it('user A reads their OWN users row and gets exactly that row', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(users).where(eq(users.id, fixtures.userA!)),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(fixtures.userA)
    expect(rows[0]!.fullName).toBe('RLS User A')
  })

  it('user A reading user B in users sees ZERO rows (RLS blocks)', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(users).where(eq(users.id, fixtures.userB!)),
    )
    expect(rows).toEqual([])
  })

  // ─── sessions ────────────────────────────────────────────────────────

  it('user A reads their OWN sessions row and gets exactly that row', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(sessions).where(eq(sessions.userId, fixtures.userA!)),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(fixtures.sessionA)
    expect(rows[0]!.userId).toBe(fixtures.userA)
  })

  it('user A reading user B in sessions sees ZERO rows (RLS blocks)', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(sessions).where(eq(sessions.userId, fixtures.userB!)),
    )
    expect(rows).toEqual([])
  })

  // ─── oauth_identities ────────────────────────────────────────────────

  it('user A reads their OWN oauth_identities row and gets exactly that row', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, fixtures.userA!)),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(fixtures.oauthA)
    expect(rows[0]!.provider).toBe('google')
  })

  it('user A reading user B in oauth_identities sees ZERO rows (RLS blocks)', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, fixtures.userB!)),
    )
    expect(rows).toEqual([])
  })

  // ─── BYPASSRLS-only tables (magic_links + handle_history) ────────────

  it('user A cannot read their OWN magic_links via withUser (BYPASSRLS-only)', async () => {
    // Even though user A owns this magic link, withUser sees no policy
    // permitting SELECT on magic_links → zero rows. This is the
    // intentional foot-gun prevention from Sprint 2 amendment 2.
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(magicLinks).where(eq(magicLinks.tokenHash, fixtures.magicLinkAHash!)),
    )
    expect(rows).toEqual([])
  })

  it('super-admin context CAN read magic_links (BYPASSRLS path still works)', async () => {
    const rows = await withSuperAdmin(async (db) =>
      db.select().from(magicLinks).where(eq(magicLinks.tokenHash, fixtures.magicLinkAHash!)),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.userId).toBe(fixtures.userA)
  })

  it('user A cannot read their OWN handle_history via withUser (BYPASSRLS-only)', async () => {
    const rows = await withUser(fixtures.userA!, async (db) =>
      db.select().from(handleHistory).where(eq(handleHistory.id, fixtures.handleHistoryAId!)),
    )
    expect(rows).toEqual([])
  })

  it('super-admin context CAN read handle_history (BYPASSRLS path still works)', async () => {
    const rows = await withSuperAdmin(async (db) =>
      db.select().from(handleHistory).where(eq(handleHistory.id, fixtures.handleHistoryAId!)),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.userId).toBe(fixtures.userA)
  })

  // ─── Cross-axis sanity tests ─────────────────────────────────────────

  it('withUser context cannot see tenant-scoped tables (app.current_tenant_id not set)', async () => {
    // tenants policy requires id = current_setting('app.current_tenant_id')::uuid.
    // In withUser(), only app.current_user_id is set; the tenant cast
    // either yields no rows OR raises invalid_text_representation — both
    // outcomes satisfy "no tenant data visible".
    let rows: { id: string }[] = []
    try {
      rows = await withUser(fixtures.userA!, async (db) =>
        db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, fixtures.tenantA!)),
      )
    } catch (err) {
      if (!(err instanceof Error && /invalid input syntax for type uuid/i.test(err.message))) {
        throw err
      }
      // Cast-from-empty-string raised — equivalent to zero rows.
    }
    expect(rows).toEqual([])
  })

  it('eventpulse_app role WITHOUT app.current_user_id sees nothing in users', async () => {
    // Buggy code path simulation: a request grabs a connection, switches
    // to eventpulse_app, forgets to set the session var, then queries.
    // RLS must reject; otherwise users without auth context could read
    // other people's rows.
    const tinyPool = new pg.Pool({
      connectionString: process.env['DATABASE_URL']!,
      max: 1,
    })
    const client = await tinyPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE eventpulse_app')
      let visibleIds: string[] = []
      try {
        const r = await client.query<{ id: string }>('SELECT id FROM users LIMIT 100')
        visibleIds = r.rows
          .map((row) => row.id)
          .filter((id) => id === fixtures.userA || id === fixtures.userB)
      } catch (err) {
        if (!(err instanceof Error && /invalid input syntax for type uuid/i.test(err.message))) {
          throw err
        }
      }
      expect(visibleIds).toEqual([])
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
      await tinyPool.end()
    }
  })
})
