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

  it('drives GetToken + Init + Verify against the SANDBOX host using V4 paths only', async () => {
    // Register interceptors on the SANDBOX base + V4 paths (per V4_SANDBOX_PATHS
    // in sandbox-config.ts: /v1/Auth/ + /v1/EPSEngine/). NOTHING on prod, and
    // nothing on the V5 paths — if the provider hit prod OR used V5 paths,
    // disableNetConnect would throw.
    const getToken = nock(SANDBOX_BASE)
      .post('/v1/Auth/GetToken')
      .reply(200, { Token: 'sandbox-jwt' })
    const init = nock(SANDBOX_BASE)
      .post('/v1/EPSEngine/InitializeEPS')
      .reply(200, { RedirectURL: 'https://sandboxpgapi.eps.com.bd/checkout/x' })
    const verify = nock(SANDBOX_BASE)
      .post('/v1/EPSEngine/CheckMerchantTransactionStatus')
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
