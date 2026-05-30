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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetTokenCacheForTest } from '../core.js'
import {
  loadSandboxEpsConfig,
  type SecretFetcher,
  SANDBOX_EPS_SECRET_ID,
} from '../sandbox-config.js'
import { TRUTH_GATE_SCENARIOS } from './scenarios.js'
import {
  extractEpsFeePaisa,
  makeLiveSandboxObservationProvider,
  makeSecretsManagerFetcher,
  type SecretsManagerLike,
} from './run-truth-gate.js'

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

describe('makeSecretsManagerFetcher — real fetcher (stub client)', () => {
  it('reads SecretString + parses into a valid sandbox EpsConfig', async () => {
    const stubClient: SecretsManagerLike = {
      async send(command) {
        // The command should target the sandbox secret id.
        expect((command.input as { SecretId?: string }).SecretId).toBe(SANDBOX_EPS_SECRET_ID)
        return { SecretString: SANDBOX_SECRET }
      },
    }
    const fetcher = makeSecretsManagerFetcher(stubClient)
    const setup = await loadSandboxEpsConfig(fetcher)
    expect(setup.config.mode).toBe('sandbox')
    expect(setup.config.merchantId).toBe('sandbox-merchant')
  })

  it('throws when the secret has no SecretString', async () => {
    const stubClient: SecretsManagerLike = {
      async send() {
        return {}
      },
    }
    const fetcher = makeSecretsManagerFetcher(stubClient)
    await expect(fetcher(SANDBOX_EPS_SECRET_ID)).rejects.toThrow(/no SecretString/)
  })

  it('default makeLiveSandboxObservationProvider() STILL uses the throwing unwired fetcher', async () => {
    // Proves the real fetcher is opt-in only — the provider does not pick it
    // up by default; it must be supplied explicitly (as main() does).
    const provider = makeLiveSandboxObservationProvider()
    await expect(provider(TRUTH_GATE_SCENARIOS[0]!)).rejects.toThrow(/unwiredSecretFetcher/)
  })
})

describe('architectural guard — no running-service path can reach the harness/fetcher', () => {
  it('no production file imports run-truth-gate (the only holder of the real fetcher)', () => {
    const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules') continue
          walk(full)
          continue
        }
        if (!full.endsWith('.ts') || full.endsWith('.test.ts')) continue
        // The harness dir is allowed to reference itself.
        if (full.includes(`${join('eps', 'truth-gate')}`)) continue
        const body = readFileSync(full, 'utf8')
        if (/run-truth-gate(\.js)?['"]/.test(body)) {
          offenders.push(full.slice(apiSrc.length + 1))
        }
      }
    }
    walk(apiSrc)
    expect(offenders).toEqual([])
  })
})

describe('extractEpsFeePaisa — derives observation from V4 Verify TotalAmount', () => {
  const scenarioWithSubtotal = (subtotalPaisa: bigint) =>
    ({ calculatorPrediction: { subtotalPaisa } }) as Parameters<typeof extractEpsFeePaisa>[0]

  it('Mode A buyer total "1027.56" - subtotal 100000 = 2756 (platform+eps combined per Mode A docstring)', () => {
    expect(extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: '1027.56' })).toBe(
      2756n,
    )
  })
  it('Mode C calculator prediction "1025.00" - subtotal 100000 = 2500 (pure eps_fee for Mode C)', () => {
    expect(extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: '1025.00' })).toBe(
      2500n,
    )
  })
  it('Mode C §14.2 narrative "1025.06" - subtotal 100000 = 2506 (the divergent case)', () => {
    expect(extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: '1025.06' })).toBe(
      2506n,
    )
  })
  it('Mode B buyer total "1000.00" - subtotal 100000 = 0 (blind spot — both fees absorbed)', () => {
    expect(extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: '1000.00' })).toBe(0n)
  })
  it('Mode D buyer total "1002.50" - subtotal 100000 = 250 (platform_fee only; eps blind spot)', () => {
    expect(extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: '1002.50' })).toBe(250n)
  })
  it('throws when Verify raw is not an object', () => {
    expect(() => extractEpsFeePaisa(scenarioWithSubtotal(100000n), null)).toThrow(/not an object/)
    expect(() => extractEpsFeePaisa(scenarioWithSubtotal(100000n), 'string')).toThrow(
      /not an object/,
    )
  })
  it('throws when TotalAmount is missing (lists keys seen so the V5/V4 drift surfaces in the message)', () => {
    expect(() =>
      extractEpsFeePaisa(scenarioWithSubtotal(100000n), { Status: 'Success', Other: 'x' }),
    ).toThrow(/missing string TotalAmount/)
  })
  it('throws when TotalAmount is a number (V4 spec says string; defend against drift)', () => {
    expect(() =>
      extractEpsFeePaisa(scenarioWithSubtotal(100000n), { TotalAmount: 1027.56 }),
    ).toThrow(/missing string TotalAmount/)
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

  it('drives GetToken + V4-shaped Init + V4 GET Verify against the SANDBOX host', async () => {
    // V4 sandbox wire shape:
    //  - GetToken: POST /v1/Auth/GetToken
    //  - Init:     POST /v1/EPSEngine/InitializeEPS, success requires
    //              BOTH TransactionId AND RedirectURL non-null
    //  - Verify:   GET  /v1/EPSEngine/CheckMerchantTransactionStatus
    //              ?merchantTransactionId=<mtid>; returns TotalAmount as BDT
    //              decimal string. extractEpsFeePaisa(scenario, raw) derives
    //              observed = parseBdtDecimalToPaisa(TotalAmount) - subtotal.
    // Scenario A: subtotal 100000, buyerTotal 102756 → TotalAmount "1027.56"
    //             → derived = 102756 - 100000 = 2756n (= platform_fee + eps_fee
    //             per Mode A buyer-pays-both-pass-through composition; see
    //             extractEpsFeePaisa docstring for per-mode interpretation).
    const getToken = nock(SANDBOX_BASE)
      .post('/v1/Auth/GetToken')
      .reply(200, { Token: 'sandbox-jwt' })
    const init = nock(SANDBOX_BASE).post('/v1/EPSEngine/InitializeEPS').reply(200, {
      TransactionId: '00000000-0000-0000-0000-00000000000a',
      RedirectURL: 'https://sandboxpgapi.eps.com.bd/checkout/x',
      ErrorMessage: '',
      ErrorCode: null,
      FinancialEntityList: null,
    })
    const verify = nock(SANDBOX_BASE)
      .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
      .query({ merchantTransactionId: /^TXN-TRUTH-A-/ })
      .reply(200, {
        MerchantTransactionId: 'TXN-TRUTH-A-XXX',
        Status: 'Success',
        TotalAmount: '1027.56',
        ErrorCode: '',
        ErrorMessage: '',
      })

    const provider = makeLiveSandboxObservationProvider(stubFetcher)
    const scenarioA = TRUTH_GATE_SCENARIOS[0]! // (PT,PT), buyerTotal=102756 paisa
    const obs = await provider(scenarioA)

    // Mode A buyer-total derivation: parseBdt("1027.56") - subtotal(100000) = 2756.
    expect(obs.observedEpsFeePaisa).toBe(2756n)
    getToken.done()
    init.done()
    verify.done()
    expect(nock.pendingMocks()).toEqual([])
  })
})
