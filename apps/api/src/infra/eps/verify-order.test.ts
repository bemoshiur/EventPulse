/**
 * EPS CheckMerchantTransactionStatus — Part 2 real-HTTP behaviour tests.
 *
 * Behaviour pinned:
 *   - Happy path: POST with correct body + headers; status normalised
 *   - Full status-alias coverage (SUCCESS / COMPLETED / FAILED /
 *     FAILURE / CANCEL / CANCELLED / CANCELED / PENDING → canonical)
 *   - Status in nested `data.Status` handled
 *   - 401 + retry: refresh + succeed
 *   - 401 twice: EpsResponseError
 *   - 4xx/5xx: EpsResponseError
 *   - Network error: EpsNetworkError
 *   - merchantTransactionId < 10 chars: RangeError
 *   - STAGING_PAYMENT_BLOCK does NOT gate this path (Verify is
 *     read-only — does not charge)
 */

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _accessTokenCacheKey, _resetTokenCacheForTest, defaultTokenCache } from './core.js'
import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { signEpsField } from './hash.js'
import { type EpsStatus } from './normalise-status.js'
import { verifyOrderHttp } from './verify-order.js'

const PROD_BASE = 'https://pgapi.eps.com.bd'

const ENV_KEYS = [
  'EPS_MERCHANT_ID',
  'EPS_STORE_ID',
  'EPS_USERNAME',
  'EPS_PASSWORD',
  'EPS_HASH_KEY',
  'EPS_MODE',
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

async function seedToken(token = 'cached-jwt'): Promise<void> {
  await defaultTokenCache().set(_accessTokenCacheKey, token, 60)
}

describe('verifyOrderHttp — happy path', () => {
  it('POSTs body+headers per §11 contract; returns canonical status', async () => {
    await seedToken('bearer-token-y')
    const expectedHash = signEpsField('TXN-VERIFY-12345', 'hashkey-secret')

    const scope = nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus', (body) => {
        expect(body).toEqual({
          merchantId: 'merchant-1',
          storeId: 'store-1',
          merchantTransactionId: 'TXN-VERIFY-12345',
        })
        return true
      })
      .matchHeader('authorization', 'Bearer bearer-token-y')
      .matchHeader('x-hash', expectedHash)
      .reply(200, { Status: 'SUCCESS', EPSTransactionId: 'EPS-9999' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-VERIFY-12345' })
    expect(result.status).toBe('success')
    expect(result.raw).toMatchObject({ Status: 'SUCCESS', EPSTransactionId: 'EPS-9999' })
    scope.done()
  })

  it('chains GetToken + Verify when cache empty', async () => {
    const scope1 = nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { Token: 'fresh-verify-jwt' })

    const scope2 = nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .matchHeader('authorization', 'Bearer fresh-verify-jwt')
      .reply(200, { Status: 'COMPLETED' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-CHAINV-1234' })
    expect(result.status).toBe('success') // COMPLETED collapses → success
    scope1.done()
    scope2.done()
  })

  it('is NOT gated by STAGING_PAYMENT_BLOCK (Verify is read-only)', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await seedToken()

    const scope = nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(200, { Status: 'PENDING' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-BLOCK-12345' })
    expect(result.status).toBe('pending')
    scope.done()
  })
})

describe('verifyOrderHttp — status alias coverage', () => {
  const aliasCases: Array<[string, EpsStatus]> = [
    ['SUCCESS', 'success'],
    ['Success', 'success'],
    ['COMPLETED', 'success'],
    ['Completed', 'success'],
    ['FAILED', 'failed'],
    ['Failed', 'failed'],
    ['FAILURE', 'failed'],
    ['CANCEL', 'cancelled'],
    ['CANCELLED', 'cancelled'],
    ['Cancelled', 'cancelled'],
    ['CANCELED', 'cancelled'],
    ['PENDING', 'pending'],
    ['Pending', 'pending'],
  ]

  it.each(aliasCases)('Status="%s" → %s', async (alias, canonical) => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/CheckMerchantTransactionStatus').reply(200, { Status: alias })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-ALIAS-12345' })
    expect(result.status).toBe(canonical)
  })

  it('unknown alias collapses to "unknown" (no throw)', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(200, { Status: 'WEIRD_VALUE' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-WEIRD-12345' })
    expect(result.status).toBe('unknown')
  })

  it('status in nested data.Status is recognised', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(200, { data: { Status: 'SUCCESS' } })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-NESTED-1234' })
    expect(result.status).toBe('success')
  })

  it('status field alias `transactionStatus` is recognised', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(200, { transactionStatus: 'CANCELLED' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-TXNSTAT-1234' })
    expect(result.status).toBe('cancelled')
  })
})

describe('verifyOrderHttp — 401 refresh-and-retry', () => {
  it('refreshes token + retries ONCE on 401', async () => {
    await seedToken('stale-verify-jwt')

    const verifyFirst = nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .matchHeader('authorization', 'Bearer stale-verify-jwt')
      .reply(401, { Code: 'TOKEN_EXPIRED' })

    const getToken = nock(PROD_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { Token: 'fresh-verify-retry-jwt' })

    const verifyRetry = nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .matchHeader('authorization', 'Bearer fresh-verify-retry-jwt')
      .reply(200, { Status: 'SUCCESS' })

    const result = await verifyOrderHttp({ merchantTransactionId: 'TXN-VRETRY-1234' })
    expect(result.status).toBe('success')
    verifyFirst.done()
    getToken.done()
    verifyRetry.done()
  })

  it('throws EpsResponseError when retry also 401s', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/CheckMerchantTransactionStatus').reply(401)
    nock(PROD_BASE).post('/api/v1/GetToken').reply(200, { Token: 'still-bad' })
    nock(PROD_BASE).post('/api/v1/CheckMerchantTransactionStatus').reply(401)

    await expect(
      verifyOrderHttp({ merchantTransactionId: 'TXN-DOUBLE401-1' }),
    ).rejects.toMatchObject({ name: 'EpsResponseError', httpStatus: 401 })
  })
})

describe('verifyOrderHttp — error mapping', () => {
  it('throws EpsResponseError on 4xx (non-401)', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(404, { Code: 'TXN_NOT_FOUND' })

    await expect(verifyOrderHttp({ merchantTransactionId: 'TXN-404-12345' })).rejects.toMatchObject(
      { name: 'EpsResponseError', httpStatus: 404, epsCode: 'TXN_NOT_FOUND' },
    )
  })

  it('throws EpsResponseError on 5xx', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/CheckMerchantTransactionStatus').reply(500)

    await expect(verifyOrderHttp({ merchantTransactionId: 'TXN-500-12345' })).rejects.toMatchObject(
      { name: 'EpsResponseError', httpStatus: 500 },
    )
  })

  it('throws EpsResponseError on schema-fail (non-object response)', async () => {
    await seedToken()
    nock(PROD_BASE).post('/api/v1/CheckMerchantTransactionStatus').reply(200, 'plain text')

    await expect(
      verifyOrderHttp({ merchantTransactionId: 'TXN-PLAIN-12345' }),
    ).rejects.toBeInstanceOf(EpsResponseError)
  })

  it('throws EpsNetworkError on network failure', async () => {
    await seedToken()
    nock(PROD_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .replyWithError(new Error('ECONNRESET'))

    await expect(
      verifyOrderHttp({ merchantTransactionId: 'TXN-RESET-12345' }),
    ).rejects.toBeInstanceOf(EpsNetworkError)
  })
})

describe('verifyOrderHttp — input validation', () => {
  it('throws RangeError when merchantTransactionId < 10 chars', async () => {
    await expect(verifyOrderHttp({ merchantTransactionId: 'short' })).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})
