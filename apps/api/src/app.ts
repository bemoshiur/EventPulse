import { Hono } from 'hono'

import { authRoutes } from './routes/auth.js'
import { oauthRoutes } from './routes/oauth-routes.js'
import { accountTypeRoutes } from './routes/tenant/account-type.js'
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

  return app
}

export type App = ReturnType<typeof createApp>
