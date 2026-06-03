/**
 * Tenant-context picker routes — `GET /my/contexts` + `POST /my/contexts/switch`.
 *
 * Unit-level (no DB): the DB-touching pieces (`listUserContexts`,
 * `fetchAudienceGrants`, `createSession`) are mocked; the membership decision
 * (`decideAudience`) and the JWT/cookie plumbing run for real. Auth is a real
 * attendee Bearer JWT — the Bearer path in the middleware verifies signature +
 * expiry without a live-session lookup, so no DB is needed to authenticate.
 *
 * Behaviour pinned:
 *   - GET lists the caller's tenants (any authenticated audience may call it —
 *     a freshly-logged-in user holds an attendee session, not a tenant one).
 *   - GET without auth → 401.
 *   - POST /switch validates membership server-side (never trusts the body's
 *     tenantId), mints a TENANT session for it, and sets the session cookie.
 *   - POST /switch for a tenant the user is NOT a member of → 403.
 *   - POST /switch with a malformed body → 400.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/contexts/index.js', () => ({
  listUserContexts: vi.fn(),
}))
vi.mock('../../auth/audience-grant.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/audience-grant.js')>()
  return { ...actual, fetchAudienceGrants: vi.fn() }
})
vi.mock('../../auth/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/sessions.js')>()
  return { ...actual, createSession: vi.fn() }
})

import { createApp } from '../../app.js'
import { fetchAudienceGrants } from '../../auth/audience-grant.js'
import { signTokens } from '../../auth/jwt.js'
import { createSession } from '../../auth/sessions.js'
import { hashToken } from '../../auth/tokens.js'
import { listUserContexts } from '../../services/contexts/index.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

beforeAll(() => {
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
})

beforeEach(() => {
  vi.mocked(listUserContexts).mockReset()
  vi.mocked(fetchAudienceGrants).mockReset()
  vi.mocked(createSession).mockReset()
})

/** A real attendee Bearer JWT for USER_ID (no DB — signing is pure). */
async function attendeeBearer(): Promise<string> {
  const { accessToken } = await signTokens({
    sub: USER_ID,
    audience: 'attendee',
    tenantId: null,
    sessionId: hashToken('test-session-token'),
  })
  return accessToken
}

describe('GET /api/v1/my/contexts', () => {
  it('lists the caller’s tenants (attendee session is allowed — picker runs pre-tenant-context)', async () => {
    vi.mocked(listUserContexts).mockResolvedValueOnce([
      {
        id: TENANT_A,
        name: 'Acme Events',
        slug: 'acme',
        type: 'organisation',
        isPersonal: false,
        kycStatus: 'approved',
      },
      {
        id: TENANT_B,
        name: 'My Personal',
        slug: 'me',
        type: 'individual',
        isPersonal: true,
        kycStatus: 'not_submitted',
      },
    ])
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts', {
      headers: { authorization: `Bearer ${await attendeeBearer()}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { contexts: { id: string; slug: string }[] } }
    expect(body.data.contexts).toHaveLength(2)
    expect(body.data.contexts.map((c) => c.slug)).toEqual(['acme', 'me'])
    expect(vi.mocked(listUserContexts)).toHaveBeenCalledWith(USER_ID)
  })

  it('401 when unauthenticated', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts')
    expect(res.status).toBe(401)
    expect(vi.mocked(listUserContexts)).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/my/contexts/switch', () => {
  it('mints a TENANT session for a tenant the user belongs to + sets the cookie', async () => {
    vi.mocked(fetchAudienceGrants).mockResolvedValueOnce({
      isSuperAdmin: false,
      tenantIds: [TENANT_A],
    })
    vi.mocked(createSession).mockResolvedValueOnce({
      token: 'new-tenant-session-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts/switch', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await attendeeBearer()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tenantId: TENANT_A }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, audience: 'tenant', tenantId: TENANT_A }),
    )
    // The new session cookie is set on the response.
    expect(res.headers.get('set-cookie')).toContain('ep_session=')
  })

  it('403 when the user is NOT a member of the requested tenant (body tenantId is never trusted)', async () => {
    vi.mocked(fetchAudienceGrants).mockResolvedValueOnce({
      isSuperAdmin: false,
      tenantIds: [TENANT_A],
    })
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts/switch', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await attendeeBearer()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tenantId: TENANT_B }),
    })
    expect(res.status).toBe(403)
    expect(vi.mocked(createSession)).not.toHaveBeenCalled()
  })

  it('400 on a malformed body (no tenantId)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts/switch', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await attendeeBearer()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/my/contexts/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_A }),
    })
    expect(res.status).toBe(401)
  })
})
