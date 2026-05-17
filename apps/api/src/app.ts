import { Hono } from 'hono'

import { authRoutes } from './routes/auth.js'
import { oauthRoutes } from './routes/oauth-routes.js'

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

  return app
}

export type App = ReturnType<typeof createApp>
