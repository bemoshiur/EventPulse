import { Hono } from 'hono'

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

  return app
}

export type App = ReturnType<typeof createApp>
