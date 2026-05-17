/**
 * Seed the `reserved_handles` table (CLAUDE.md §9.14).
 *
 * Run at deploy and during dev DB bootstrap to ensure no user can register
 * a handle that collides with platform routes, brand-impersonation risks,
 * or government/news entities. New entries can be added by editing the list
 * below and re-running this script (it's idempotent).
 *
 * Sprint 1 Day 5-6: this file currently exports the seed array and a
 * placeholder run() function. Wire the actual DB writes to the
 * `withSuperAdmin` connection helper (apps/api/src/db/client.ts) once the
 * Drizzle schema lands.
 */

export type ReservedHandleReason = 'system' | 'brand' | 'offensive' | 'impersonation_risk'

export interface ReservedHandle {
  handle: string
  reason: ReservedHandleReason
}

export const RESERVED_HANDLES: ReadonlyArray<ReservedHandle> = [
  // System routes / subdomains
  ...[
    'admin',
    'api',
    'app',
    'auth',
    'cdn',
    'dashboard',
    'dev',
    'docs',
    'edge',
    'ftp',
    'git',
    'help',
    'logs',
    'mail',
    'mx',
    'my',
    'ns1',
    'ns2',
    'oauth',
    'root',
    'sso',
    'staging',
    'static',
    'status',
    'support',
    'system',
    'webhook',
    'webhooks',
    'www',
  ].map((handle) => ({ handle, reason: 'system' as const })),

  // Account flow paths
  ...[
    'account',
    'billing',
    'contact',
    'cookies',
    'discover',
    'dpa',
    'eula',
    'features',
    'home',
    'invoice',
    'invoices',
    'legal',
    'login',
    'logout',
    'pricing',
    'privacy',
    'profile',
    'refund',
    'refund-policy',
    'register',
    'security',
    'settings',
    'signin',
    'sign-in',
    'signup',
    'sign-up',
    'terms',
    'trust',
    'verify',
  ].map((handle) => ({ handle, reason: 'system' as const })),

  // Marketing surfaces
  ...[
    'about',
    'blog',
    'careers',
    'changelog',
    'customers',
    'jobs',
    'partners',
    'press',
    'use-cases',
  ].map((handle) => ({ handle, reason: 'system' as const })),

  // Event Pulse brand
  ...[
    'ep',
    'eventpulse',
    'event-pulse',
    'eventpulsebd',
    'eventpulse-bd',
    'publicpulse',
    'public-pulse',
    'ticonsys',
    'ticon',
    'ticon-systems',
  ].map((handle) => ({ handle, reason: 'brand' as const })),

  // Common BD brand / regulator impersonation risks — extend as needed
  ...[
    'bkash',
    'nagad',
    'rocket',
    'upay',
    'eps',
    'sslcommerz',
    'sslwireless',
    'bb',
    'bangladesh-bank',
    'bfiu',
    'btrc',
    'nbr',
    'ec',
    'porichoy',
  ].map((handle) => ({ handle, reason: 'impersonation_risk' as const })),
]

/**
 * Idempotent seed runner. Inserts every entry in {@link RESERVED_HANDLES};
 * existing rows are left alone via `ON CONFLICT DO NOTHING`. Re-runnable.
 *
 * Skipped automatically (no DB writes) when `DATABASE_URL` is not set, so
 * the file can also serve as a CI-time lint of the list shape.
 */
export async function run(): Promise<void> {
  validateList(RESERVED_HANDLES)

  if (!process.env['DATABASE_URL']) {
    // eslint-disable-next-line no-console
    console.log(
      `reserved handles: ${RESERVED_HANDLES.length} entries validated (DATABASE_URL not set; skipping insert)`,
    )
    return
  }

  // Dynamic import so consumers that just want the array (and the unit
  // test file) don't pay the cost of pulling in pg + drizzle.
  const { withSuperAdmin, resetPool } = await import('../client.js')
  const { reservedHandles } = await import('../schema/index.js')

  try {
    await withSuperAdmin(async (db) => {
      await db
        .insert(reservedHandles)
        .values(RESERVED_HANDLES.map((r) => ({ handle: r.handle, reason: r.reason })))
        .onConflictDoNothing({ target: reservedHandles.handle })
    })
    // eslint-disable-next-line no-console
    console.log(`reserved handles: ${RESERVED_HANDLES.length} entries seeded`)
  } finally {
    await resetPool()
  }
}

/**
 * Validate the reserved-handle list.
 *
 * Note: this is intentionally looser than the §2.3 user-handle rules. The
 * reserved list is a superset — it can include sub-3-char names like `my`
 * (the attendee-portal subdomain) that users can never register anyway,
 * because preventing future-attacker confusion is cheap and the lookup is
 * indifferent to length. The user-side handle validation in `apps/api/src/
 * domain/handles/*` is where the 3-30 length and pattern get enforced.
 */
export function validateList(list: ReadonlyArray<ReservedHandle>): void {
  // Single char allowed; max 64 to leave room for branded multi-word reservations.
  const pattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
  const seen = new Set<string>()
  for (const { handle } of list) {
    if (handle.length < 1 || handle.length > 64) {
      throw new RangeError(`reserved handle out of range (1-64 chars): "${handle}"`)
    }
    if (!pattern.test(handle)) {
      throw new RangeError(`reserved handle violates pattern: "${handle}"`)
    }
    if (seen.has(handle)) {
      throw new RangeError(`reserved handle duplicate: "${handle}"`)
    }
    seen.add(handle)
  }
}

// CLI entrypoint: `pnpm --filter @eventpulse/api exec tsx scripts/seed-reserved-handles.ts`
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
