import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

import { withSuperAdmin } from './db/client.js'
import { logger } from './lib/logger.js'
import { authRoutes } from './routes/auth.js'
import { oauthRoutes } from './routes/oauth-routes.js'
import { publicEventsRoutes } from './routes/public/events.js'
import { publicLegalRoutes } from './routes/public/legal.js'
import { epsReturnRoutes } from './routes/public/orders-eps-return.js'
import { publicOrdersRoutes } from './routes/public/orders.js'
import { epsWebhookRoutes } from './routes/webhooks/eps.js'
import { feeConfigRoutes } from './routes/super-admin/fee-config.js'
import { adminKycRoutes } from './routes/super-admin/kyc.js'
import { adminLegalRoutes } from './routes/super-admin/legal.js'
import { adminTicketTiersRoutes } from './routes/super-admin/ticket-tiers.js'
import { accountTypeRoutes } from './routes/tenant/account-type.js'
import { attendeeRoutes } from './routes/tenant/attendees.js'
import { checkInRoutes } from './routes/tenant/checkin.js'
import { eventsRoutes } from './routes/tenant/events.js'
import { kycDraftRoutes } from './routes/tenant/kyc-drafts.js'
import { kycRoutes } from './routes/tenant/kyc.js'
import { meRoutes } from './routes/tenant/me.js'
import { tenantTicketTiersRoutes } from './routes/tenant/ticket-tiers.js'

/**
 * Hono application factory. Kept side-effect-free so tests can request routes
 * without binding to a port. `src/index.ts` wraps this with `@hono/node-server`.
 */
export function createApp() {
  const app = new Hono()

  // DB-aware /health (Fix 6 of the Day 21 verification deploy sequence).
  // Runs a `SELECT 1` to confirm Postgres is reachable. Returns 200 with
  // db:'ok' when reachable, 503 with db:'unreachable' when not. The
  // deploy.sh + rollback.sh healthcheck contract is "200 = healthy" —
  // so a 503 here trips deploy.sh's auto-rollback. Previously the
  // endpoint returned 200 unconditionally and the Nginx static /health
  // intercept also returned 200 — the api could be entirely down and
  // external probes still saw 200. That's the silent-failure pattern
  // the Sprint 2 closing gotchas.md entry consolidates.
  app.get('/health', async (c) => {
    const startedAt = Date.now()
    try {
      await withSuperAdmin(async (tx) => {
        await tx.execute(sql`SELECT 1`)
      })
      return c.json({
        data: {
          status: 'ok',
          service: '@eventpulse/api',
          db: 'ok',
          checkedMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err) {
      logger.error({ err, durationMs: Date.now() - startedAt }, 'healthcheck DB ping failed')
      return c.json(
        {
          error: {
            code: 'DB_UNREACHABLE',
            service: '@eventpulse/api',
            db: 'unreachable',
            checkedMs: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          },
        },
        503,
      )
    }
  })

  app.route('/api/v1/auth', authRoutes)
  app.route('/api/v1/auth/oauth', oauthRoutes)
  // Public Trust Center read endpoints. Unauthenticated; consumed by
  // apps/web Server Components for the /trust + /privacy/etc pages
  // (Decision K, 2026-05-19). Edge-cacheable.
  app.route('/api/v1/public/legal', publicLegalRoutes)
  // Public event landing read — Sprint 3 Day 25 Phase 2. Consumed by
  // the apps/web Server Component at /(public)/[tenant]/[event]/page.
  // Visibility + status filtering is application-side; the route's
  // RLS context is super-admin (BYPASSRLS) because public reads
  // cross tenant boundaries by design.
  app.route('/api/v1/public/events', publicEventsRoutes)
  // Public order creation — Sprint 3 Day 26 Phase 4. The money endpoint.
  // STAGING_PAYMENT_BLOCK=1 refuses the EPS init step under the
  // service layer's guard; the order itself still persists in
  // awaiting_payment regardless. Day 27 ships the EPS callback
  // handler that completes the lifecycle.
  app.route('/api/v1/public/orders', publicOrdersRoutes)
  // EPS browser redirect handlers — Sprint 3 Day 27 Phase 3. Buyer
  // lands here from EPS hosted page after success/fail/cancel. The
  // redirect URL itself is NEVER authoritative (§1.3 R3); the handler
  // reconciles via settleOrderFromEps (same verify-by-callback model
  // as the webhook), then redirects the browser to the appropriate
  // frontend page at ${EVENTPULSE_WEB_BASE_URL}/orders/return/*.
  app.route('/api/v1/public/orders/eps-return', epsReturnRoutes)
  // EPS server-to-server webhook — Sprint 3 Day 27 Phase 2. The
  // authentication model is "verify-by-callback" per §11.1 step 11:
  // the handler treats the payload as a notification trigger only;
  // verifyOrder() against EPS is the authoritative status source.
  // §11 does NOT specify an EPS-side webhook signature mechanism
  // (decisions.md "Day 27 EPS webhook auth model" 2026-05-25).
  app.route('/api/v1/webhooks/eps', epsWebhookRoutes)
  // Tenant routes — order doesn't matter (Hono routes are matched by
  // exact path prefix), but the `me` + `account-type` mounts deliberately
  // sit alongside `kyc` because they share the /api/v1/tenant/* namespace.
  // Both `me` and `account-type` are NOT gated by requireTenantType
  // (the gate-setter and the read endpoint the modal needs); `kyc` IS
  // gated, applied inside `routes/tenant/kyc.ts` via `kyc.use('*', ...)`.
  app.route('/api/v1/tenant/me', meRoutes)
  app.route('/api/v1/tenant/account-type', accountTypeRoutes)
  app.route('/api/v1/tenant/kyc', kycRoutes)
  // Drafts router is mounted at /api/v1/tenant/kyc/drafts (not nested
  // under kycRoutes) so the requireTenantType middleware applies to it
  // independently — kycRoutes' middleware doesn't compose down into a
  // child route group in Hono's current routing model.
  app.route('/api/v1/tenant/kyc/drafts', kycDraftRoutes)
  // Events router — Sprint 3 Day 23 Workstream 1 per §10.2. Gated by
  // requireTenantAuth + requireTenantType inside the router. No KYC
  // gate — self-service free-events publish without KYC per §13.5;
  // KYC requirement layers in at "add paid tier" (Day 25+).
  app.route('/api/v1/tenant/events', eventsRoutes)
  // Ticket-tier router — Sprint 3 Day 25 per §10.2. Nested under
  // events because tiers FK to events. :eventId path param is exposed
  // inside the sub-router; the tenant scope comes from requireTenantAuth
  // applied inside the router.
  app.route('/api/v1/tenant/events/:eventId/tickets', tenantTicketTiersRoutes)
  // Check-in routes — Sprint 4 Day 31 Phase 1 per §10.2.
  // POST /api/v1/tenant/events/:eventId/checkin     {qrCode, gate}
  // GET  /api/v1/tenant/events/:eventId/checkin/stats
  // Tenant-staff authed via requireTenantAuth inside the router.
  // Per-role gate (Owner/Admin/Editor/Scanner per §5.4 vs Finance
  // can't) is a Sprint 4+ carry — no requireRole middleware exists
  // yet; MVP allows any tenant member.
  app.route('/api/v1/tenant/events', checkInRoutes)

  // Attendee list endpoint — Sprint 4 Day 32 Phase 1 per §10.2:
  //   GET /api/v1/tenant/events/:eventId/attendees
  // Tenant-staff auth via requireTenantAuth inside the router.
  // Cross-tenant isolation enforced by RLS + application-layer
  // event/tenant filter inside the service. No per-row audit on
  // list reads (Decision G precedent; bulk extraction is what the
  // Phase-3 CSV-export endpoint audits).
  app.route('/api/v1/tenant/events', attendeeRoutes)

  // Super admin routes — Sprint 2 Day 18 Item 13 + Day 19 Item 15.
  // Mounted under /api/v1/admin/* per §10.4. requireSuperAdminAuth
  // is applied inside each sub-router via `*.use('*', ...)`.
  app.route('/api/v1/admin/kyc', adminKycRoutes)
  app.route('/api/v1/admin/legal', adminLegalRoutes)
  // Per-tenant fee config (super-admin only) — Sprint 3 Day 23
  // Workstream 2 per §10.4 + §14.4. NO migration needed (table +
  // RLS already shipped in 0001 + 0002). The :tenantId path param
  // is the source of truth for which tenant is being mutated;
  // withSuperAdmin() in the service layer bypasses RLS so the
  // single super-admin queue can write to any tenant's row.
  app.route('/api/v1/admin/tenants/:tenantId/fees', feeConfigRoutes)
  // Ticket-tier super-admin read — Sprint 3 Day 25. READ only per
  // §14.4 ("platform doesn't reach into tenant pricing"). Mounted
  // by event-id for direct super-admin inspection without needing
  // to know the owning tenant id upfront — withSuperAdmin() bypasses
  // RLS so event_id alone is sufficient.
  app.route('/api/v1/admin/events/:eventId/tickets', adminTicketTiersRoutes)

  return app
}

export type App = ReturnType<typeof createApp>
