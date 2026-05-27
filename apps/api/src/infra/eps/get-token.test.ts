/**
 * EPS GetToken — Part 2 real-HTTP behaviour tests (nock-mocked).
 *
 * Per the Day 26 brief: "Tests (mock the HTTP layer — nock/msw —
 * NEVER hit real EPS this session)". `nock` intercepts at the Node
 * http layer so every axios instance the wrapper constructs hits
 * the interceptor regardless of how the factory is wired.
 *
 * Behaviour pinned:
 *   - Happy path: POST to /api/v1/GetToken with body+x-hash header,
 *     returns { token, ttlSeconds }
 *   - x-hash signs the `userName` field (not password, not whole body)
 *     per §11.4 hash mechanism table
 *   - TTL: respects EPS `ExpiresIn` minus 60s safety margin
 *   - TTL: falls back to default 14*60 when EPS omits ExpiresIn
 *   - Schema validation: malformed → EpsResponseError
 *   - Missing token field: EpsResponseError with epsCode/epsMessage
 *     when available
 *   - 4xx/5xx: EpsResponseError carrying httpStatus
 *   - Network failure (no response): EpsNetworkError
 *   - Mode switching: sandbox uses sandbox base URL
 */

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { deriveTokenTtl, fetchAccessTokenFromEps } from './get-token.js'
import { signEpsField } from './hash.js'

const PROD_BASE = 'https://pgapi.eps.com.bd'
const SANDBOX_BASE = 'https://sandboxpgapi.eps.com.bd'

const ENV_KEYS = [
  'EPS_MERCHANT_ID',
  'EPS_STORE_ID',
  'EPS_USERNAME',
  'EPS_PASSWORD',
  'EPS_HASH_KEY',
  'EPS_MODE',
] as const

const ORIGINAL_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k]
  process.env['EPS_MERCHANT_ID'] = 'merchant-1'
  process.env['EPS_STORE_ID'] = 'store-1'
  process.env['EPS_USERNAME'] = 'epsuser'
  process.env['EPS_PASSWORD'] = 'epspass'
  process.env['EPS_HASH_KEY'] = 'hashkey-secret'
  process.env['EPS_MODE'] = 'production'
  nock.disableNetConnect()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL_ENV[k]
  }
  nock.cleanAll()
  nock.enableNetConnect()
})

describe('fetchAccessTokenFromEps — happy path', () => {
  it('POSTs userName+password to /api/v1/GetToken with x-hash header', async () => {
    const expectedHash = signEpsField('epsuser', 'hashkey-secret')

    const scope = nock(PROD_BASE)
      .post('/api/v1/GetToken', (body) => {
        expect(body).toEqual({ userName: 'epsuser', password: 'epspass' })
        return true
      })
      .matchHeader('x-hash', expectedHash)
      .matchHeader('content-type', /application\/json/)
      .reply(200, { Token: 'eyJ.fake.jwt', ExpiresIn: 900 })

    const result = await fetchAccessTokenFromEps()
    expect(result.token).toBe('eyJ.fake.jwt')
    expect(result.ttlSeconds).toBe(900 - 60) // ExpiresIn minus 60s safety
    scope.done()
  })

  it('routes to sandbox base URL when EPS_MODE=sandbox', async () => {
    process.env['EPS_MODE'] = 'sandbox'

    const scope = nock(SANDBOX_BASE).post('/api/v1/GetToken').reply(200, { Token: 'sandbox-jwt' })

    const result = await fetchAccessTokenFromEps()
    expect(result.token).toBe('sandbox-jwt')
    scope.done()
  })

  it('accepts lowercase-alias Token field (passthrough schema)', async () => {
    const scope = nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { token: 'alias-token' }) // lowercase alias

    const result = await fetchAccessTokenFromEps()
    expect(result.token).toBe('alias-token')
    scope.done()
  })

  it('accepts AccessToken field as fallback', async () => {
    const scope = nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { AccessToken: 'another-alias-jwt' })

    const result = await fetchAccessTokenFromEps()
    expect(result.token).toBe('another-alias-jwt')
    scope.done()
  })
})

describe('fetchAccessTokenFromEps — TTL derivation', () => {
  it('uses EPS ExpiresIn minus 60s safety margin when present + ample', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 't', ExpiresIn: 600 })
    const result = await fetchAccessTokenFromEps()
    expect(result.ttlSeconds).toBe(600 - 60)
  })

  it('falls back to default 14*60 when EPS omits ExpiresIn', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 't' })
    const result = await fetchAccessTokenFromEps()
    expect(result.ttlSeconds).toBe(14 * 60)
  })

  it('uses default when reported TTL is too short to be meaningful', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 't', ExpiresIn: 30 })
    const result = await fetchAccessTokenFromEps()
    // 30s reported < safety margin + 30 buffer → fall back to default
    expect(result.ttlSeconds).toBe(14 * 60)
  })

  it('accepts lowercase expiresIn alias', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 't', expiresIn: 600 })
    const result = await fetchAccessTokenFromEps()
    expect(result.ttlSeconds).toBe(600 - 60)
  })
})

describe('deriveTokenTtl', () => {
  it('honours ample reported TTL minus safety margin', () => {
    expect(deriveTokenTtl({ ExpiresIn: 900 })).toBe(840)
  })

  it('falls back to default when ExpiresIn absent', () => {
    expect(deriveTokenTtl({})).toBe(14 * 60)
  })

  it('caps short TTLs at default rather than going sub-minute', () => {
    expect(deriveTokenTtl({ ExpiresIn: 60 })).toBe(14 * 60)
  })
})

describe('fetchAccessTokenFromEps — error mapping', () => {
  it('throws EpsResponseError on 4xx with httpStatus + parsed EPS code/message', async () => {
    nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(401, { Code: 'AUTH_FAILED', Message: 'Bad credentials' })

    await expect(fetchAccessTokenFromEps()).rejects.toMatchObject({
      name: 'EpsResponseError',
      httpStatus: 401,
      epsCode: 'AUTH_FAILED',
      epsMessage: 'Bad credentials',
    })
  })

  it('throws EpsResponseError on 5xx', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(503, { Message: 'gateway down' })
    await expect(fetchAccessTokenFromEps()).rejects.toMatchObject({
      name: 'EpsResponseError',
      httpStatus: 503,
    })
  })

  it('throws EpsResponseError on schema-fail (root is not an object)', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, 'plain text body')
    await expect(fetchAccessTokenFromEps()).rejects.toBeInstanceOf(EpsResponseError)
  })

  it('throws EpsResponseError when no token field present in response', async () => {
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Code: '0001', Message: 'no token here' })

    await expect(fetchAccessTokenFromEps()).rejects.toMatchObject({
      name: 'EpsResponseError',
      epsCode: '0001',
      epsMessage: 'no token here',
    })
  })

  it('throws EpsNetworkError when the request fails at the network layer', async () => {
    // Pass a real Error instance — some nock+axios version combos don't
    // propagate plain-object errors cleanly (the request hangs until
    // axios timeout, which our 15s default would exceed test budget).
    nock(PROD_BASE).post('/api/v1/GetToken').replyWithError(new Error('connect ECONNREFUSED'))

    await expect(fetchAccessTokenFromEps()).rejects.toBeInstanceOf(EpsNetworkError)
  })
})
