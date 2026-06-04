/**
 * Self-service hosting route — `POST /my/hosting/start`.
 *
 * Unit-level (no DB): `ensurePersonalTenant` + `createSession` are mocked; the
 * JWT/cookie plumbing runs for real. Auth is a real attendee Bearer JWT.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/hosting/index.js', () => ({
  ensurePersonalTenant: vi.fn(),
}))
vi.mock('../../auth/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/sessions.js')>()
  return { ...actual, createSession: vi.fn() }
})

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { createSession } from '../../auth/sessions.js'
import { hashToken } from '../../auth/tokens.js'
import { ensurePersonalTenant } from '../../services/hosting/index.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeAll(() => {
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
})

beforeEach(() => {
  vi.mocked(ensurePersonalTenant).mockReset()
  vi.mocked(createSession).mockReset()
})

async function attendeeBearer(): Promise<string> {
  const { accessToken } = await signTokens({
    sub: USER_ID,
    audience: 'attendee',
    tenantId: null,
    sessionId: hashToken('test-session'),
  })
  return accessToken
}

describe('POST /api/v1/my/hosting/start', () => {
  it('provisions the personal tenant + enters its tenant context (cookie)', async () => {
    vi.mocked(ensurePersonalTenant).mockResolvedValueOnce({
      id: TENANT_ID,
      slug: 'moshiur',
      name: 'Moshiur',
    })
    vi.mocked(createSession).mockResolvedValueOnce({
      token: 'tenant-session-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    const app = createApp()
    const res = await app.request('/api/v1/my/hosting/start', {
      method: 'POST',
      headers: { authorization: `Bearer ${await attendeeBearer()}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tenantId: string; slug: string } }
    expect(body.data.tenantId).toBe(TENANT_ID)
    expect(body.data.slug).toBe('moshiur')
    expect(vi.mocked(ensurePersonalTenant)).toHaveBeenCalledWith(USER_ID)
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, audience: 'tenant', tenantId: TENANT_ID }),
    )
    expect(res.headers.get('set-cookie')).toContain('ep_session=')
  })

  it('401 when unauthenticated', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/my/hosting/start', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(vi.mocked(ensurePersonalTenant)).not.toHaveBeenCalled()
  })
})
