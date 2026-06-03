/**
 * EPS wrapper client — public-surface tests.
 *
 * Scope: behaviour the wrapper OWNS at the public-surface level —
 *
 *   - `cfg()` reads env, fails loud on missing values
 *   - `BASE_URLS` routes correctly on mode
 *   - `http()` factory yields a configured axios instance (no network)
 *   - `initialiseOrder` enforces the STAGING_PAYMENT_BLOCK guard
 *     FIRST (no HTTP fires when block is on + priced order)
 *   - `getAccessToken` cache-hit path returns the cached value
 *     without firing HTTP
 *   - All five greppable error classes are distinct (3 Part 1 +
 *     2 Part 2)
 *
 * Per-endpoint HTTP behaviour (real wire-shape, 401 retry, status
 * normalisation, error mapping) lives in `get-token.test.ts`,
 * `initialise-order.test.ts`, `verify-order.test.ts` — all use
 * `nock` to intercept HTTP at the Node http layer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _resetTokenCacheForTest,
  _seedAccessTokenForTest,
  BASE_URLS,
  cfg,
  EpsConfigError,
  EpsNetworkError,
  EpsNotImplementedError,
  EpsResponseError,
  getAccessToken,
  http,
  initialiseOrder,
  inMemoryTokenCache,
  StagingPaymentBlockedError,
} from './client.js'

// Snapshot+restore EPS-relevant env so individual tests can mutate
// freely without leaking. STAGING_PAYMENT_BLOCK is also snapshot.
const ENV_KEYS = [
  'EPS_MERCHANT_ID',
  'EPS_STORE_ID',
  'EPS_USERNAME',
  'EPS_PASSWORD',
  'EPS_HASH_KEY',
  'EPS_MODE',
  'EPS_SUCCESS_URL',
  'EPS_FAIL_URL',
  'EPS_CANCEL_URL',
  'STAGING_PAYMENT_BLOCK',
] as const

const ORIGINAL_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    ORIGINAL_ENV[k] = process.env[k]
  }
  process.env['EPS_MERCHANT_ID'] = 'm'
  process.env['EPS_STORE_ID'] = 's'
  process.env['EPS_USERNAME'] = 'u'
  process.env['EPS_PASSWORD'] = 'p'
  process.env['EPS_HASH_KEY'] = 'k'
  process.env['EPS_MODE'] = 'production'
  delete process.env['EPS_SUCCESS_URL']
  delete process.env['EPS_FAIL_URL']
  delete process.env['EPS_CANCEL_URL']
  delete process.env['STAGING_PAYMENT_BLOCK']
  _resetTokenCacheForTest()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = ORIGINAL_ENV[k]
    }
  }
  _resetTokenCacheForTest()
})

describe('cfg', () => {
  it('returns a complete config when all env present', () => {
    const c = cfg()
    // Env path always carries V5 production paths + V5 production wire
    // protocol; the V4 sandbox shape is produced only by sandbox-config.ts.
    expect(c.merchantId).toBe('m')
    expect(c.storeId).toBe('s')
    expect(c.username).toBe('u')
    expect(c.password).toBe('p')
    expect(c.hashKey).toBe('k')
    expect(c.mode).toBe('production')
    expect(c.paths).toEqual({
      getToken: '/v1/Auth/GetToken',
      initialise: '/v1/EPSEngine/InitializeEPS',
      verify: '/v1/EPSEngine/CheckMerchantTransactionStatus',
    })
    expect(c.wireProtocol.name).toBe('v5-production')
  })

  it('defaults mode to production when EPS_MODE unset', () => {
    delete process.env['EPS_MODE']
    expect(cfg().mode).toBe('production')
  })

  it('accepts mode=sandbox', () => {
    process.env['EPS_MODE'] = 'sandbox'
    expect(cfg().mode).toBe('sandbox')
  })

  it('throws EpsConfigError on invalid mode', () => {
    process.env['EPS_MODE'] = 'staging'
    expect(() => cfg()).toThrow(EpsConfigError)
    expect(() => cfg()).toThrow(/EPS_MODE/)
  })

  it.each(['EPS_MERCHANT_ID', 'EPS_STORE_ID', 'EPS_USERNAME', 'EPS_PASSWORD', 'EPS_HASH_KEY'])(
    'throws EpsConfigError naming %s when missing',
    (envKey) => {
      delete process.env[envKey]
      try {
        cfg()
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(EpsConfigError)
        expect((err as Error).message).toContain(envKey)
      }
    },
  )

  it('throws once listing ALL missing keys (faster diagnosis than one-at-a-time)', () => {
    delete process.env['EPS_MERCHANT_ID']
    delete process.env['EPS_HASH_KEY']
    try {
      cfg()
      throw new Error('expected throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('EPS_MERCHANT_ID')
      expect(msg).toContain('EPS_HASH_KEY')
    }
  })
})

describe('BASE_URLS', () => {
  it('production points at the prod gateway', () => {
    expect(BASE_URLS.production).toBe('https://pgapi.eps.com.bd')
  })

  it('sandbox points at the sandbox gateway', () => {
    expect(BASE_URLS.sandbox).toBe('https://sandboxpgapi.eps.com.bd')
  })

  it('only two modes exist (defence against accidental third)', () => {
    expect(Object.keys(BASE_URLS).sort()).toEqual(['production', 'sandbox'])
  })
})

describe('http() factory', () => {
  it('returns an axios instance configured for the active mode', () => {
    const client = http()
    expect(client.defaults.baseURL).toBe('https://pgapi.eps.com.bd')
    expect(client.defaults.timeout).toBe(15_000)
    expect(client.defaults.headers['content-type']).toBe('application/json')
  })

  it('switches base URL when EPS_MODE=sandbox', () => {
    process.env['EPS_MODE'] = 'sandbox'
    expect(http().defaults.baseURL).toBe('https://sandboxpgapi.eps.com.bd')
  })

  it('throws EpsConfigError when env missing (fail loud at construction)', () => {
    delete process.env['EPS_HASH_KEY']
    expect(() => http()).toThrow(EpsConfigError)
  })
})

describe('initialiseOrder block-guard (public-surface contract)', () => {
  // Block-guard tests pinned here: any future regression that
  // re-orders the implementation MUST keep these passing.
  // The "no HTTP fires when block on" assertion lives in
  // initialise-order.test.ts where nock can prove zero requests.

  it('throws StagingPaymentBlockedError when block on + priced order', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await expect(
      initialiseOrder({ merchantTransactionId: 'TXN-1234567890', totalPaisa: 100_000n }),
    ).rejects.toBeInstanceOf(StagingPaymentBlockedError)
  })

  it('guard fires BEFORE any other error type (priced order + missing env → still BlockedError)', async () => {
    // If guard ordering inverted, this would throw EpsConfigError
    // first (env-reads come after guard). Pin: guard wins.
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    delete process.env['EPS_HASH_KEY']
    try {
      await initialiseOrder({ merchantTransactionId: 'TXN-1234567890', totalPaisa: 1n })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StagingPaymentBlockedError)
      expect(err).not.toBeInstanceOf(EpsConfigError)
    }
  })

  it('throws RangeError when merchantTransactionId < 10 chars (validation after guard)', async () => {
    delete process.env['STAGING_PAYMENT_BLOCK']
    await expect(
      initialiseOrder({ merchantTransactionId: 'short', totalPaisa: 1n }),
    ).rejects.toBeInstanceOf(RangeError)
  })
})

describe('getAccessToken cache-hit path (public-surface contract)', () => {
  // Cache-miss + real-HTTP behaviour lives in get-token.test.ts.
  // Here we only pin that a populated cache short-circuits.

  it('returns the cached token when present', async () => {
    await _seedAccessTokenForTest('cached-jwt-12345')
    const token = await getAccessToken()
    expect(token).toBe('cached-jwt-12345')
  })

  it('accepts a custom cache for dependency injection', async () => {
    const custom = inMemoryTokenCache()
    await custom.set('eps:access-token:v1', 'injected-token', 60)
    expect(await getAccessToken(custom)).toBe('injected-token')
  })

  it('default cache singleton persists across calls within a process', async () => {
    await _seedAccessTokenForTest('first-call-cached')
    expect(await getAccessToken()).toBe('first-call-cached')
    expect(await getAccessToken()).toBe('first-call-cached')
  })
})

describe('error class hygiene (greppable distinct types)', () => {
  // Five greppable error classes — three Part-1 (Day 24) + two Part-2
  // (Day 26). Distinctness is load-bearing per
  // `.claude/memory/decisions.md` "Three distinct greppable EPS error
  // classes" (2026-05-25), extended in Day 26.

  it('all five classes are mutually distinct', () => {
    const blocked = new StagingPaymentBlockedError(100n)
    const configErr = new EpsConfigError('missing FOO')
    const notImpl = new EpsNotImplementedError('not yet wired')
    const network = new EpsNetworkError('connect EHOSTUNREACH', new Error('socket'), 'req-1')
    const respErr = new EpsResponseError('HTTP 500', { httpStatus: 500 })

    const all = { blocked, configErr, notImpl, network, respErr }
    const ctors = {
      blocked: StagingPaymentBlockedError,
      configErr: EpsConfigError,
      notImpl: EpsNotImplementedError,
      network: EpsNetworkError,
      respErr: EpsResponseError,
    }
    for (const [name, instance] of Object.entries(all)) {
      for (const [otherName, ctor] of Object.entries(ctors)) {
        if (name === otherName) {
          expect(instance).toBeInstanceOf(ctor)
        } else {
          expect(instance).not.toBeInstanceOf(ctor)
        }
      }
    }
  })

  it('all five classes have greppable .name fields', () => {
    expect(new StagingPaymentBlockedError(1n).name).toBe('StagingPaymentBlockedError')
    expect(new EpsConfigError('x').name).toBe('EpsConfigError')
    expect(new EpsNotImplementedError('x').name).toBe('EpsNotImplementedError')
    expect(new EpsNetworkError('x', new Error('y')).name).toBe('EpsNetworkError')
    expect(new EpsResponseError('x').name).toBe('EpsResponseError')
  })

  it('EpsResponseError carries httpStatus/epsCode/epsMessage/requestId fields', () => {
    const e = new EpsResponseError('HTTP 400', {
      httpStatus: 400,
      epsCode: 'INVALID_HASH',
      epsMessage: 'x-hash mismatch',
      requestId: 'req-abc',
    })
    expect(e.httpStatus).toBe(400)
    expect(e.epsCode).toBe('INVALID_HASH')
    expect(e.epsMessage).toBe('x-hash mismatch')
    expect(e.requestId).toBe('req-abc')
  })

  it('EpsNetworkError carries cause + requestId', () => {
    const cause = new Error('ECONNREFUSED')
    const e = new EpsNetworkError('network failure', cause, 'req-xyz')
    expect(e.cause).toBe(cause)
    expect(e.requestId).toBe('req-xyz')
  })
})
