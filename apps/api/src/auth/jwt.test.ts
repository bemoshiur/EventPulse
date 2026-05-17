import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { signTokens, verifyAccessToken, verifyRefreshToken } from './jwt.js'

const ORIGINAL_ACCESS = process.env['JWT_ACCESS_SECRET']
const ORIGINAL_REFRESH = process.env['JWT_REFRESH_SECRET']

describe('JWT access + refresh issuance', () => {
  beforeEach(() => {
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64)
  })

  afterEach(() => {
    if (ORIGINAL_ACCESS === undefined) delete process.env['JWT_ACCESS_SECRET']
    else process.env['JWT_ACCESS_SECRET'] = ORIGINAL_ACCESS
    if (ORIGINAL_REFRESH === undefined) delete process.env['JWT_REFRESH_SECRET']
    else process.env['JWT_REFRESH_SECRET'] = ORIGINAL_REFRESH
  })

  it('signs and verifies a tenant access token', async () => {
    const tokens = await signTokens({
      sub: '00000000-0000-0000-0000-000000000001',
      audience: 'tenant',
      tenantId: '00000000-0000-0000-0000-000000000002',
      sessionId: 'sha256-hex',
    })
    expect(tokens.accessExpiresIn).toBe(900)
    expect(tokens.refreshExpiresIn).toBe(604_800)

    const access = await verifyAccessToken(tokens.accessToken)
    expect(access).not.toBeNull()
    expect(access?.audience).toBe('tenant')
    expect(access?.tenantId).toBe('00000000-0000-0000-0000-000000000002')

    const refresh = await verifyRefreshToken(tokens.refreshToken)
    expect(refresh).not.toBeNull()
    expect(refresh?.sessionId).toBe('sha256-hex')
  })

  it('rejects an access token signed with the refresh secret', async () => {
    const tokens = await signTokens({
      sub: 'u',
      audience: 'super-admin',
      tenantId: null,
      sessionId: 's',
    })
    // refresh token signed with refresh secret should fail access-side verify
    await expect(verifyAccessToken(tokens.refreshToken)).resolves.toBeNull()
  })

  it('throws when JWT_ACCESS_SECRET is missing', async () => {
    delete process.env['JWT_ACCESS_SECRET']
    await expect(
      signTokens({ sub: 'u', audience: 'attendee', tenantId: null, sessionId: 's' }),
    ).rejects.toThrow(/JWT_ACCESS_SECRET/)
  })

  it('throws when JWT_ACCESS_SECRET is too short', async () => {
    process.env['JWT_ACCESS_SECRET'] = 'too-short'
    await expect(
      signTokens({ sub: 'u', audience: 'attendee', tenantId: null, sessionId: 's' }),
    ).rejects.toThrow(/at least 32/)
  })

  it('verifyAccessToken returns null on garbage token', async () => {
    await expect(verifyAccessToken('not.a.jwt')).resolves.toBeNull()
  })
})
