/**
 * Truth-gate entrypoint — live sandbox provider wiring tests (nock-mocked).
 *
 * Pins:
 *   - extractEpsFeePaisa reads the EPS-fee field (top-level + nested) and
 *     throws (never returns 0) when absent
 *   - the live sandbox provider drives the REAL wrapper against the SANDBOX
 *     host ONLY — never the production host (proves harness→sandbox isolation)
 *   - with the default unwired fetcher the provider throws before any network
 */

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetTokenCacheForTest } from '../core.js'
import { type SecretFetcher, SANDBOX_EPS_SECRET_ID } from '../sandbox-config.js'
import { TRUTH_GATE_SCENARIOS } from './scenarios.js'
import { extractEpsFeePaisa, makeLiveSandboxObservationProvider } from './run-truth-gate.js'

const PROD_BASE = 'https://pgapi.eps.com.bd'
const SANDBOX_BASE = 'https://sandboxpgapi.eps.com.bd'

const SANDBOX_SECRET = JSON.stringify({
  merchant_id: 'sandbox-merchant',
  store_id: 'sandbox-store',
  username: 'sandbox-user',
  password: 'sandbox-pass',
  hash_key: 'sandbox-hash-key',
  success_url: 'https://sandbox.example.test/return/success',
  fail_url: 'https://sandbox.example.test/return/fail',
  cancel_url: 'https://sandbox.example.test/return/cancel',
})

const stubFetcher: SecretFetcher = async (secretId) => {
  expect(secretId).toBe(SANDBOX_EPS_SECRET_ID)
  return SANDBOX_SECRET
}

describe('extractEpsFeePaisa', () => {
  it('reads a top-level integer fee field', () => {
    expect(extractEpsFeePaisa({ epsFee: 2506 })).toBe(2506n)
  })
  it('reads a nested data.* fee field', () => {
    expect(extractEpsFeePaisa({ data: { GatewayFee: '2500' } })).toBe(2500n)
  })
  it('throws (never returns 0) when no fee field present', () => {
    expect(() => extractEpsFeePaisa({ Status: 'SUCCESS' })).toThrow(/no recognised EPS-fee field/)
  })
})

describe('makeLiveSandboxObservationProvider — sandbox-only isolation', () => {
  beforeEach(() => {
    _resetTokenCacheForTest()
    // No block in this unit context; we are exercising the sandbox client,
    // which is mode-sandbox regardless of env.
    delete process.env['STAGING_PAYMENT_BLOCK']
    nock.disableNetConnect()
  })
  afterEach(() => {
    _resetTokenCacheForTest()
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('with the default unwired fetcher, throws before any network call', async () => {
    const provider = makeLiveSandboxObservationProvider()
    const scenarioA = TRUTH_GATE_SCENARIOS[0]!
    await expect(provider(scenarioA)).rejects.toThrow(/unwiredSecretFetcher/)
    // No interceptors were registered + none were hit.
    expect(nock.pendingMocks()).toEqual([])
  })

  it('drives GetToken + Init + Verify against the SANDBOX host only', async () => {
    // Register interceptors on the SANDBOX base. NOTHING on prod — if the
    // provider hit prod, disableNetConnect would throw.
    const getToken = nock(SANDBOX_BASE)
      .post('/api/v1/GetToken')
      .reply(200, { Token: 'sandbox-jwt' })
    const init = nock(SANDBOX_BASE)
      .post('/api/v1/InitializeEPS')
      .reply(200, { RedirectURL: 'https://sandboxpgapi.eps.com.bd/checkout/x' })
    const verify = nock(SANDBOX_BASE)
      .post('/api/v1/CheckMerchantTransactionStatus')
      .reply(200, { Status: 'SUCCESS', epsFee: 2506 })

    const provider = makeLiveSandboxObservationProvider(stubFetcher)
    const scenarioA = TRUTH_GATE_SCENARIOS[0]! // (PT,PT), buyerTotal > 0
    const obs = await provider(scenarioA)

    expect(obs.observedEpsFeePaisa).toBe(2506n)
    getToken.done()
    init.done()
    verify.done()
    // Belt-and-braces: no leftover interceptors anywhere.
    expect(nock.pendingMocks()).toEqual([])
  })
})
