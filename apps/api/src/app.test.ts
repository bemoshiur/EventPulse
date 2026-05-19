import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('api smoke', () => {
  // Fix 6 changed /health to DB-aware: returns 200 + db:'ok' when reachable,
  // 503 + db:'unreachable' when not. Without DATABASE_URL set, the DB ping
  // fails fast → 503. Both branches are valid; this test asserts the
  // envelope shape on whichever branch fires for the local test rig.
  const HAS_DB = Boolean(process.env['DATABASE_URL'])

  it('GET /health returns the DB-aware envelope', async () => {
    const app = createApp()
    const res = await app.request('/health')
    if (HAS_DB) {
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { status: string; service: string; db: string; timestamp: string }
      }
      expect(body.data.status).toBe('ok')
      expect(body.data.service).toBe('@eventpulse/api')
      expect(body.data.db).toBe('ok')
      expect(body.data.timestamp).toBeTruthy()
    } else {
      expect(res.status).toBe(503)
      const body = (await res.json()) as {
        error: { code: string; service: string; db: string; timestamp: string }
      }
      expect(body.error.code).toBe('DB_UNREACHABLE')
      expect(body.error.service).toBe('@eventpulse/api')
      expect(body.error.db).toBe('unreachable')
      expect(body.error.timestamp).toBeTruthy()
    }
  })
})
