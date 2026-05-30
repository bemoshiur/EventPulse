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

describe('extractEpsFeePaisa — mode-agnostic derivation from V4 Verify (TotalAmount − StoreAmount)', () => {
  // The earlier (TotalAmount − subtotal) rule had Mode-A combined-fee
  // conflation and Mode-B/D blind spots. The new rule reads EPS's
  // authoritative split (StoreAmount = what gets settled to the merchant)
  // and yields pure eps_fee independently of the §14.2 absorb/pass-through
  // composition. Cases below cover the empirical Mode A bKash sandbox
  // observation plus illustrative card-rate amounts.

  it('Mode A bKash empirical: TotalAmount=1027.56 StoreAmount=1010.09 → 1747 paisa (= 17.47 BDT = 1.747% MFS rate)', () => {
    expect(extractEpsFeePaisa({ TotalAmount: '1027.56', StoreAmount: '1010.09' })).toBe(1747n)
  })

  it('Mode B both-absorbed: TotalAmount=1000.00 StoreAmount=982.53 → 1747 paisa (no Mode-B blind spot — StoreAmount publishes the cut)', () => {
    expect(extractEpsFeePaisa({ TotalAmount: '1000.00', StoreAmount: '982.53' })).toBe(1747n)
  })

  it('Mode C narrative AB,PT: TotalAmount=1025.06 StoreAmount=1000.00 → 2506 paisa (the §14.2 25.06 case)', () => {
    expect(extractEpsFeePaisa({ TotalAmount: '1025.06', StoreAmount: '1000.00' })).toBe(2506n)
  })

  it('Mode C calculator AB,PT: TotalAmount=1025.00 StoreAmount=1000.00 → 2500 paisa (the calculator-prediction case)', () => {
    expect(extractEpsFeePaisa({ TotalAmount: '1025.00', StoreAmount: '1000.00' })).toBe(2500n)
  })

  it('Mode D PT,AB: TotalAmount=1002.50 StoreAmount=975.06 → 2744 paisa (no Mode-D blind spot — StoreAmount publishes the cut)', () => {
    expect(extractEpsFeePaisa({ TotalAmount: '1002.50', StoreAmount: '975.06' })).toBe(2744n)
  })

  it('throws when Verify raw is not an object', () => {
    expect(() => extractEpsFeePaisa(null)).toThrow(/not an object/)
    expect(() => extractEpsFeePaisa('string')).toThrow(/not an object/)
  })

  it('throws when TotalAmount is missing (drift diagnostic surfaces keys seen)', () => {
    expect(() => extractEpsFeePaisa({ Status: 'Success', StoreAmount: '1010.09' })).toThrow(
      /missing string TotalAmount/,
    )
  })

  it('throws when StoreAmount is missing (V4/V5 drift defence)', () => {
    expect(() => extractEpsFeePaisa({ TotalAmount: '1027.56', Status: 'Success' })).toThrow(
      /missing string StoreAmount/,
    )
  })

  it('throws when TotalAmount is a number (V4 spec says string; defend against drift)', () => {
    expect(() => extractEpsFeePaisa({ TotalAmount: 1027.56, StoreAmount: '1010.09' })).toThrow(
      /missing string TotalAmount/,
    )
  })

  it('throws when StoreAmount is a number (V4 spec says string; defend against drift)', () => {
    expect(() => extractEpsFeePaisa({ TotalAmount: '1027.56', StoreAmount: 1010.09 })).toThrow(
      /missing string StoreAmount/,
    )
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

  it('drives GetToken + V4-shaped Init + V4 GET Verify against the SANDBOX host (StoreAmount derivation)', async () => {
    // V4 sandbox wire shape:
    //  - GetToken: POST /v1/Auth/GetToken
    //  - Init:     POST /v1/EPSEngine/InitializeEPS, success requires
    //              BOTH TransactionId AND RedirectURL non-null
    //  - Verify:   GET  /v1/EPSEngine/CheckMerchantTransactionStatus
    //              ?merchantTransactionId=<mtid>; returns TotalAmount AND
    //              StoreAmount as BDT decimal strings. extractEpsFeePaisa(raw)
    //              derives pure eps_fee = (TotalAmount − StoreAmount),
    //              mode-agnostic.
    // Scenario A: TotalAmount "1027.56" / StoreAmount "1010.09" — the empirical
    //             bKash sandbox observation. Derived = 1027.56 − 1010.09 =
    //             17.47 BDT = 1747 paisa (= the MFS rate of ~1.747% on face,
    //             NOT the calculator-modelled 2.5% card rate).
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
        StoreAmount: '1010.09',
        FinancialEntity: 'BKash',
        ErrorCode: null,
        ErrorMessage: null,
      })

    const provider = makeLiveSandboxObservationProvider(stubFetcher)
    const scenarioA = TRUTH_GATE_SCENARIOS[0]! // (PT,PT), buyerTotal=102756 paisa
    const obs = await provider(scenarioA)

    // Pure eps_fee derivation: parseBdt("1027.56") − parseBdt("1010.09") = 1747.
    expect(obs.observedEpsFeePaisa).toBe(1747n)
    getToken.done()
    init.done()
    verify.done()
    expect(nock.pendingMocks()).toEqual([])
  })
})
