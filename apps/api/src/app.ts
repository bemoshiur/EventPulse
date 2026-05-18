import { Hono } from 'hono'

import { authRoutes } from './routes/auth.js'
import { oauthRoutes } from './routes/oauth-routes.js'
import { adminKycRoutes } from './routes/super-admin/kyc.js'
import { accountTypeRoutes } from './routes/tenant/account-type.js'
import { kycDraftRoutes } from './routes/tenant/kyc-drafts.js'
import { kycRoutes } from './routes/tenant/kyc.js'
import { meRoutes } from './routes/tenant/me.js'

/**
 * Hono application factory. Kept side-effect-free so tests can request routes
 * without binding to a port. `src/index.ts` wraps this with `@hono/node-server`.
 */
export function createApp() {
  const app = new Hono()

  app.get('/health', (c) =>
    c.json({
      data: {
        status: 'ok',
        service: '@eventpulse/api',
        timestamp: new Date().toISOString(),
      },
    }),
  )

  app.route('/api/v1/auth', authRoutes)
  app.route('/api/v1/auth/oauth', oauthRoutes)
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

  // Super admin routes — Sprint 2 Day 18 Item 13. Mounted under
  // /api/v1/admin/* per §10.4. requireSuperAdminAuth is applied
  // inside the sub-router via `admin.use('*', ...)`.
  app.route('/api/v1/admin/kyc', adminKycRoutes)

  return app
}

export type App = ReturnType<typeof createApp>
