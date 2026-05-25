/**
 * EPS InitializeEPS — Part 2 real-HTTP behaviour tests (nock-mocked).
 *
 * **The critical safety test:** when STAGING_PAYMENT_BLOCK=1 and a
 * priced order is attempted, NO HTTP request fires. Asserted via
 * `nock.isDone()` returning true after the throw (i.e. no
 * interceptor was hit because no request was made) AND
 * `nock.pendingMocks()` being empty (no expectation set in the
 * first place because we don't WANT a request to fire). The test
 * registers NO interceptor and verifies the call path never tries
 * to make HTTP.
 *
 * Other behaviour pinned:
 *   - block on + zero-amount: guard passes; call proceeds (free events)
 *   - block off + happy path: POST with correct body+headers, returns
 *     RedirectURL from response
 *   - x-hash signs merchantTransactionId (per §11.4 hash mechanism)
 *   - body shape: merchantId, storeId, merchantTransactionId,
 *     totalAmount (BDT decimal string), transactionTypeId=1,
 *     success/fail/cancel URLs
 *   - 401 + retry: refresh token, retry once, succeed
 *   - 401 twice: EpsResponseError with httpStatus=401
 *   - 4xx: EpsResponseError
 *   - 5xx: EpsResponseError
 *   - Missing RedirectURL: EpsResponseError
 *   - Schema fail: EpsResponseError
 *   - Network error: EpsNetworkError
 *   - merchantTransactionId < 10 chars: RangeError
 *   - Missing redirect URL env: EpsConfigError before HTTP
 *   - formatPaisaForEpsWire correctness
 */

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _accessTokenCacheKey,
  _resetTokenCacheForTest,
  defaultTokenCache,
  EpsConfigError,
} from './core.js'
import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { signEpsField } from './hash.js'
import {
  formatPaisaForEpsWire,
  initialiseOrderHttp,
  readInitRedirectUrls,
} from './initialise-order.js'
import { StagingPaymentBlockedError } from './staging-payment-block.js'

const PROD_BASE = 'https://pgapi.eps.com.bd'

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
  for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k]
  process.env['EPS_MERCHANT_ID'] = 'merchant-1'
  process.env['EPS_STORE_ID'] = 'store-1'
  process.env['EPS_USERNAME'] = 'epsuser'
  process.env['EPS_PASSWORD'] = 'epspass'
  process.env['EPS_HASH_KEY'] = 'hashkey-secret'
  process.env['EPS_MODE'] = 'production'
  process.env['EPS_SUCCESS_URL'] = 'https://staging.eventpulse.com.bd/orders/return/success'
  process.env['EPS_FAIL_URL'] = 'https://staging.eventpulse.com.bd/orders/return/fail'
  process.env['EPS_CANCEL_URL'] = 'https://staging.eventpulse.com.bd/orders/return/cancel'
  delete process.env['STAGING_PAYMENT_BLOCK']
  _resetTokenCacheForTest()
  nock.disableNetConnect()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL_ENV[k]
  }
  _resetTokenCacheForTest()
  nock.cleanAll()
  nock.enableNetConnect()
})

// Helper — seed the default cache so initialiseOrderHttp doesn't
// fetch a fresh token (which would require its own nock interceptor).
async function seedToken(token = 'cached-jwt'): Promise<void> {
  await defaultTokenCache().set(_accessTokenCacheKey, token, 60)
}

describe('initialiseOrderHttp — STAGING_PAYMENT_BLOCK guard (load-bearing safety)', () => {
  it('CRITICAL: block on + priced order → throws StagingPaymentBlockedError AND fires ZERO HTTP requests', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    // NO nock interceptor registered. If the implementation attempts
    // ANY HTTP request, nock will throw "Disallowed net connect" and
    // the test will fail with a different error than the expected
    // StagingPaymentBlockedError. This is the safety net per §11.0.

    await expect(
      initialiseOrderHttp({
        merchantTransactionId: 'TXN-PRICED-1',
        totalPaisa: 100_000n,
      }),
    ).rejects.toBeInstanceOf(StagingPaymentBlockedError)

    // Belt-and-braces: no pending interceptors (we registered none),
    // and nock.activeMocks() is empty.
    expect(nock.activeMocks()).toEqual([])
    expect(nock.pendingMocks()).toEqual([])
  })

  it('guard fires BEFORE env reads (block on + missing URL env → still BlockedError)', async () => {
    // If the implementation read env vars BEFORE checking the guard,
    // this would throw EpsConfigError (missing EPS_SUCCESS_URL etc).
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    delete process.env['EPS_SUCCESS_URL']

    try {
      await initialiseOrderHttp({
        merchantTransactionId: 'TXN-GUARD-ORDER',
        totalPaisa: 1n,
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StagingPaymentBlockedError)
      expect(err).not.toBeInstanceOf(EpsConfigError)
    }
  })

  it('block off + priced order: guard passes; call proceeds to HTTP', async () => {
    delete process.env['STAGING_PAYMENT_BLOCK']
    await seedToken()

    const scope = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(200, { RedirectURL: 'https://pgapi.eps.com.bd/checkout/abc' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-PASS-1',
      totalPaisa: 100_000n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/checkout/abc')
    scope.done()
  })

  it('block on + zero-paisa order: guard passes (free events bypass per §13.5)', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await seedToken()

    const scope = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(200, { RedirectURL: 'https://pgapi.eps.com.bd/free' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-FREE-12345',
      totalPaisa: 0n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/free')
    scope.done()
  })
})

describe('initialiseOrderHttp — happy path', () => {
  it('POSTs body+headers per §11 contract', async () => {
    await seedToken('bearer-token-x')
    const expectedHash = signEpsField('TXN-HAPPY-12345', 'hashkey-secret')

    const scope = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS', (body) => {
        expect(body).toEqual({
          merchantId: 'merchant-1',
          storeId: 'store-1',
          merchantTransactionId: 'TXN-HAPPY-12345',
          totalAmount: '1000.00',
          transactionTypeId: 1,
          successUrl: 'https://staging.eventpulse.com.bd/orders/return/success',
          failUrl: 'https://staging.eventpulse.com.bd/orders/return/fail',
          cancelUrl: 'https://staging.eventpulse.com.bd/orders/return/cancel',
        })
        return true
      })
      .matchHeader('authorization', 'Bearer bearer-token-x')
      .matchHeader('x-hash', expectedHash)
      .reply(200, { RedirectURL: 'https://pgapi.eps.com.bd/checkout/xyz', Code: '0000' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-HAPPY-12345',
      totalPaisa: 100_000n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/checkout/xyz')
    expect(result.raw).toMatchObject({ RedirectURL: 'https://pgapi.eps.com.bd/checkout/xyz' })
    scope.done()
  })

  it('accepts lowercase redirectUrl alias from response', async () => {
    await seedToken()
    const scope = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(200, { redirectUrl: 'https://pgapi.eps.com.bd/checkout/lc' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-ALIAS-1234',
      totalPaisa: 50_000n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/checkout/lc')
    scope.done()
  })

  it('fetches access token when cache empty (chains GetToken + InitializeEPS)', async () => {
    // No seed; expect a GetToken first then InitializeEPS.
    const scope1 = nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { Token: 'fresh-jwt', ExpiresIn: 900 })

    const scope2 = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .matchHeader('authorization', 'Bearer fresh-jwt')
      .reply(200, { RedirectURL: 'https://pgapi.eps.com.bd/checkout/fresh' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-CHAIN-1234',
      totalPaisa: 10_000n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/checkout/fresh')
    scope1.done()
    scope2.done()
  })
})

describe('initialiseOrderHttp — 401 refresh-and-retry', () => {
  it('refreshes token + retries ONCE on 401, succeeds on retry', async () => {
    await seedToken('stale-jwt')

    const initFirst = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .matchHeader('authorization', 'Bearer stale-jwt')
      .reply(401, { Code: 'TOKEN_EXPIRED', Message: 'JWT expired' })

    const getToken = nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { Token: 'fresh-jwt', ExpiresIn: 900 })

    const initRetry = nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .matchHeader('authorization', 'Bearer fresh-jwt')
      .reply(200, { RedirectURL: 'https://pgapi.eps.com.bd/checkout/after-retry' })

    const result = await initialiseOrderHttp({
      merchantTransactionId: 'TXN-RETRY-12345',
      totalPaisa: 100_000n,
    })
    expect(result.redirectUrl).toBe('https://pgapi.eps.com.bd/checkout/after-retry')
    initFirst.done()
    getToken.done()
    initRetry.done()
  })

  it('throws EpsResponseError when retry ALSO 401s (no infinite-retry loop)', async () => {
    await seedToken('stale-jwt')

    nock(PROD_BASE).post('/api/v1/InitializeEPS').reply(401)
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 'fresh-jwt-also-bad' })
    nock(PROD_BASE).post('/api/v1/InitializeEPS').reply(401, { Code: 'TOKEN_STILL_BAD' })

    await expect(
      initialiseOrderHttp({
        merchantTransactionId: 'TXN-DOUBLE-FAIL-1',
        totalPaisa: 100_000n,
      }),
    ).rejects.toMatchObject({
      name: 'EpsResponseError',
      httpStatus: 401,
    })
  })
})

describe('initialiseOrderHttp — error mapping', () => {
  it('throws EpsResponseError on 4xx (non-401)', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(400, { Code: 'INVALID_HASH', Message: 'x-hash mismatch' })

    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'TXN-400-12345', totalPaisa: 1n }),
    ).rejects.toMatchObject({
      name: 'EpsResponseError',
      httpStatus: 400,
      epsCode: 'INVALID_HASH',
    })
  })

  it('throws EpsResponseError on 5xx', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/InitializeEPS').reply(503, { Message: 'gateway down' })

    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'TXN-503-12345', totalPaisa: 1n }),
    ).rejects.toMatchObject({ name: 'EpsResponseError', httpStatus: 503 })
  })

  it('throws EpsResponseError when response missing RedirectURL', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(200, { Code: '0000', Message: 'OK but no URL' })

    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'TXN-NOURL-1234', totalPaisa: 1n }),
    ).rejects.toMatchObject({
      name: 'EpsResponseError',
      epsCode: '0000',
      epsMessage: 'OK but no URL',
    })
  })

  it('throws EpsResponseError on schema-fail (non-object response)', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/InitializeEPS').reply(200, 'plain text')

    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'TXN-PLAIN-1234', totalPaisa: 1n }),
    ).rejects.toBeInstanceOf(EpsResponseError)
  })

  it('throws EpsNetworkError on network failure', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/InitializeEPS').replyWithError(new Error('ECONNREFUSED'))

    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'TXN-ECONN-1234', totalPaisa: 1n }),
    ).rejects.toBeInstanceOf(EpsNetworkError)
  })
})

describe('initialiseOrderHttp — input validation', () => {
  it('throws RangeError when merchantTransactionId < 10 chars', async () => {
    await expect(
      initialiseOrderHttp({ merchantTransactionId: 'short', totalPaisa: 1n }),
    ).rejects.toBeInstanceOf(RangeError)
  })
})

describe('readInitRedirectUrls', () => {
  it('returns all three URLs when env present', () => {
    const r = readInitRedirectUrls()
    expect(r).toEqual({
      successUrl: 'https://staging.eventpulse.com.bd/orders/return/success',
      failUrl: 'https://staging.eventpulse.com.bd/orders/return/fail',
      cancelUrl: 'https://staging.eventpulse.com.bd/orders/return/cancel',
    })
  })

  it.each(['EPS_SUCCESS_URL', 'EPS_FAIL_URL', 'EPS_CANCEL_URL'])(
    'throws EpsConfigError naming %s when missing',
    (key) => {
      delete process.env[key]
      try {
        readInitRedirectUrls()
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(EpsConfigError)
        expect((err as Error).message).toContain(key)
      }
    },
  )
})

describe('formatPaisaForEpsWire', () => {
  it.each<[bigint, string]>([
    [0n, '0.00'],
    [1n, '0.01'],
    [9n, '0.09'],
    [10n, '0.10'],
    [99n, '0.99'],
    [100n, '1.00'],
    [100_000n, '1000.00'],
    [100_050n, '1000.50'],
    [1n * 10n ** 10n, '100000000.00'],
  ])('formats %s paisa → "%s"', (paisa, expected) => {
    expect(formatPaisaForEpsWire(paisa)).toBe(expected)
  })

  it('throws RangeError on negative paisa', () => {
    expect(() => formatPaisaForEpsWire(-1n)).toThrow(RangeError)
  })
})
