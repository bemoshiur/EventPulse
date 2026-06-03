/**
 * GET /api/v1/auth/session — the lightweight "who am I" check the web
 * layout auth-gate calls to decide whether to render a protected shell or
 * redirect to sign-in. Reuses `requireUser` (any authenticated audience) and
 * echoes the session's audience + tenantId so the gate can match the route
 * group (tenant pages need a tenant session; admin pages a super-admin one).
 *
 * Unit-level (no DB): auth is a real Bearer JWT — the Bearer path verifies
 * signature + expiry without a live-session lookup.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { signTokens } from '../auth/jwt.js'
import { hashToken } from '../auth/tokens.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeAll(() => {
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
})

async function bearer(audience: 'attendee' | 'tenant' | 'super-admin', tenantId: string | null) {
  const { accessToken } = await signTokens({
    sub: USER_ID,
    audience,
    tenantId,
    sessionId: hashToken('test-session'),
  })
  return accessToken
}

describe('GET /api/v1/auth/session', () => {
  it('returns the attendee session identity', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/session', {
      headers: { authorization: `Bearer ${await bearer('attendee', null)}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { userId: string; audience: string; tenantId: string | null }
    }
    expect(body.data).toEqual({ userId: USER_ID, audience: 'attendee', tenantId: null })
  })

  it('returns the tenant audience + tenantId for a tenant session', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/session', {
      headers: { authorization: `Bearer ${await bearer('tenant', TENANT_ID)}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { audience: string; tenantId: string | null } }
    expect(body.data.audience).toBe('tenant')
    expect(body.data.tenantId).toBe(TENANT_ID)
  })

  it('401 when unauthenticated', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/session')
    expect(res.status).toBe(401)
  })
})
