/**
 * EPS sandbox-config — unit + isolation tests.
 *
 * These pin the bidirectional-isolation guarantees the truth-gate relies on:
 *   - sandbox config builds from the SECRET, never from process.env
 *   - the sandbox config's mode is ALWAYS 'sandbox' + base URL is the
 *     sandbox host, regardless of EPS_MODE in env
 *   - the sandbox deps carry their OWN axios client + their OWN fresh token
 *     cache (never the default singleton)
 *   - the default (env) deps path is unaffected — still reads EPS_MODE
 *   - no running-service file imports this module (architectural guard)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BASE_URLS, defaultEpsCallDeps, defaultTokenCache, V5_PRODUCTION_PATHS } from './core.js'
import { V4_SANDBOX_PROTOCOL, V5_PRODUCTION_PROTOCOL } from './eps-wire-protocol.js'
import {
  createSandboxEpsCallDeps,
  DEFAULT_SANDBOX_RETURN_URLS,
  loadSandboxEpsConfig,
  SANDBOX_EPS_SECRET_ID,
  unwiredSecretFetcher,
  V4_SANDBOX_PATHS,
  type SecretFetcher,
} from './sandbox-config.js'

const VALID_SANDBOX_SECRET = JSON.stringify({
  merchant_id: 'sandbox-merchant',
  store_id: 'sandbox-store',
  username: 'sandbox-user',
  password: 'sandbox-pass',
  hash_key: 'sandbox-hash-key',
  success_url: 'https://sandbox.example.test/return/success',
  fail_url: 'https://sandbox.example.test/return/fail',
  cancel_url: 'https://sandbox.example.test/return/cancel',
})

/** A stub fetcher returning a fixed secret string — no AWS, no network. */
const stubFetcher = (secret = VALID_SANDBOX_SECRET): SecretFetcher => {
  return async (secretId: string) => {
    expect(secretId).toBe(SANDBOX_EPS_SECRET_ID)
    return secret
  }
}

const EPS_ENV_KEYS = [
  'EPS_MERCHANT_ID',
  'EPS_STORE_ID',
  'EPS_USERNAME',
  'EPS_PASSWORD',
  'EPS_HASH_KEY',
  'EPS_MODE',
] as const
const ORIGINAL_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of EPS_ENV_KEYS) ORIGINAL_ENV[k] = process.env[k]
})
afterEach(() => {
  for (const k of EPS_ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL_ENV[k]
  }
})

describe('loadSandboxEpsConfig — constructs from the secret', () => {
  it('builds an EpsConfig with mode=sandbox + redirect URLs from the secret', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(setup.config).toMatchObject({
      merchantId: 'sandbox-merchant',
      storeId: 'sandbox-store',
      username: 'sandbox-user',
      password: 'sandbox-pass',
      hashKey: 'sandbox-hash-key',
      mode: 'sandbox',
    })
    expect(setup.redirectUrls).toEqual({
      successUrl: 'https://sandbox.example.test/return/success',
      failUrl: 'https://sandbox.example.test/return/fail',
      cancelUrl: 'https://sandbox.example.test/return/cancel',
    })
  })

  it('returns a frozen (immutable) config + setup', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(Object.isFrozen(setup)).toBe(true)
    expect(Object.isFrozen(setup.config)).toBe(true)
  })

  it('IGNORES process.env entirely — env EPS_MODE=production does not leak in', async () => {
    process.env['EPS_MODE'] = 'production'
    process.env['EPS_MERCHANT_ID'] = 'PROD-MERCHANT-SHOULD-NOT-APPEAR'
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(setup.config.mode).toBe('sandbox')
    expect(setup.config.merchantId).toBe('sandbox-merchant')
  })

  it('hard-codes mode=sandbox even if the secret tries to set mode=production', async () => {
    const sneaky = JSON.stringify({
      ...JSON.parse(VALID_SANDBOX_SECRET),
      mode: 'production', // ignored by the schema + builder
    })
    const setup = await loadSandboxEpsConfig(stubFetcher(sneaky))
    expect(setup.config.mode).toBe('sandbox')
  })

  it('falls back to default sandbox return URLs when the secret omits them (credentials-only secret)', async () => {
    const credsOnly = JSON.stringify({
      merchant_id: 'sandbox-merchant',
      store_id: 'sandbox-store',
      username: 'sandbox-user',
      password: 'sandbox-pass',
      hash_key: 'sandbox-hash-key',
      // no *_url fields
    })
    const setup = await loadSandboxEpsConfig(stubFetcher(credsOnly))
    expect(setup.config.mode).toBe('sandbox')
    expect(setup.redirectUrls).toEqual(DEFAULT_SANDBOX_RETURN_URLS)
  })

  it('secret-provided return URLs win over the defaults', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(setup.redirectUrls.successUrl).toBe('https://sandbox.example.test/return/success')
    expect(setup.redirectUrls).not.toEqual(DEFAULT_SANDBOX_RETURN_URLS)
  })

  it('throws on non-JSON secret', async () => {
    await expect(loadSandboxEpsConfig(stubFetcher('not json'))).rejects.toThrow(/not valid JSON/)
  })

  it('throws on schema-invalid secret (missing field)', async () => {
    const incomplete = JSON.stringify({ merchant_id: 'x' })
    await expect(loadSandboxEpsConfig(stubFetcher(incomplete))).rejects.toThrow(
      /failed schema validation/,
    )
  })
})

describe('unwiredSecretFetcher — safe default (no network, loud refusal)', () => {
  it('throws an actionable error and makes no call', async () => {
    await expect(loadSandboxEpsConfig()).rejects.toThrow(/unwiredSecretFetcher/)
    await expect(unwiredSecretFetcher(SANDBOX_EPS_SECRET_ID)).rejects.toThrow(/No network call/)
  })
})

describe('createSandboxEpsCallDeps — isolated client + cache', () => {
  it('pins the axios client baseURL to the SANDBOX host', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    const deps = createSandboxEpsCallDeps(setup)
    expect(deps.client.defaults.baseURL).toBe(BASE_URLS.sandbox)
    expect(deps.client.defaults.baseURL).not.toBe(BASE_URLS.production)
    expect(deps.config.mode).toBe('sandbox')
  })

  it('uses a FRESH token cache, never the default singleton', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    const deps = createSandboxEpsCallDeps(setup)
    expect(deps.cache).not.toBe(defaultTokenCache())
    // two builds → two distinct caches (no shared mutable state)
    const deps2 = createSandboxEpsCallDeps(setup)
    expect(deps.cache).not.toBe(deps2.cache)
  })

  it('carries the redirect URLs so the init path needs no env', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    const deps = createSandboxEpsCallDeps(setup)
    expect(deps.redirectUrls).toEqual(setup.redirectUrls)
  })

  it('defensively refuses a non-sandbox setup', () => {
    const fakeProd = {
      config: { ...JSON.parse('{}'), mode: 'production' },
      redirectUrls: { successUrl: 'a', failUrl: 'b', cancelUrl: 'c' },
    } as unknown as Parameters<typeof createSandboxEpsCallDeps>[0]
    expect(() => createSandboxEpsCallDeps(fakeProd)).toThrow(/refusing non-sandbox config/)
  })
})

describe('default (env) deps path is unaffected by the sandbox seam', () => {
  it('defaultEpsCallDeps reads EPS_MODE from env → production base URL', () => {
    process.env['EPS_MERCHANT_ID'] = 'm'
    process.env['EPS_STORE_ID'] = 's'
    process.env['EPS_USERNAME'] = 'u'
    process.env['EPS_PASSWORD'] = 'p'
    process.env['EPS_HASH_KEY'] = 'k'
    process.env['EPS_MODE'] = 'production'
    const deps = defaultEpsCallDeps()
    expect(deps.config.mode).toBe('production')
    expect(deps.client.defaults.baseURL).toBe(BASE_URLS.production)
    expect(deps.cache).toBe(defaultTokenCache()) // the running-process singleton
  })
})

describe('per-endpoint path map — V4 sandbox vs V5 production isolation', () => {
  it('V4_SANDBOX_PATHS holds the empirically-confirmed V4 sandbox paths', () => {
    expect(V4_SANDBOX_PATHS).toEqual({
      getToken: '/v1/Auth/GetToken',
      initialise: '/v1/EPSEngine/InitializeEPS',
      verify: '/v1/EPSEngine/CheckMerchantTransactionStatus',
    })
  })

  it('V5_PRODUCTION_PATHS holds the §11.4 V5 production paths', () => {
    expect(V5_PRODUCTION_PATHS).toEqual({
      getToken: '/api/v1/GetToken',
      initialise: '/api/v1/InitializeEPS',
      verify: '/api/v1/CheckMerchantTransactionStatus',
    })
  })

  it('V4 and V5 share NO path values — no key collides between the two maps', () => {
    // Cross-contamination guard: if any production path string equals any
    // sandbox path string, a swap-bug somewhere could route traffic at the
    // wrong env without obvious symptoms. Pin that they are disjoint.
    const v4Values = new Set(Object.values(V4_SANDBOX_PATHS))
    for (const v5 of Object.values(V5_PRODUCTION_PATHS)) {
      expect(v4Values.has(v5)).toBe(false)
    }
  })

  it('both path maps are FROZEN (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(V4_SANDBOX_PATHS)).toBe(true)
    expect(Object.isFrozen(V5_PRODUCTION_PATHS)).toBe(true)
  })

  it('loaded sandbox config carries V4_SANDBOX_PATHS (NEVER V5 paths)', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(setup.config.paths).toBe(V4_SANDBOX_PATHS)
    expect(setup.config.paths).not.toBe(V5_PRODUCTION_PATHS)
    expect(setup.config.paths.getToken).toBe('/v1/Auth/GetToken')
    expect(setup.config.paths.initialise).toBe('/v1/EPSEngine/InitializeEPS')
    expect(setup.config.paths.verify).toBe('/v1/EPSEngine/CheckMerchantTransactionStatus')
  })

  it('loaded sandbox config carries V4_SANDBOX_PROTOCOL (NEVER V5 protocol)', async () => {
    const setup = await loadSandboxEpsConfig(stubFetcher())
    expect(setup.config.wireProtocol).toBe(V4_SANDBOX_PROTOCOL)
    expect(setup.config.wireProtocol).not.toBe(V5_PRODUCTION_PROTOCOL)
    expect(setup.config.wireProtocol.name).toBe('v4-sandbox')
  })

  it('default (env) deps wireProtocol is V5_PRODUCTION_PROTOCOL regardless of EPS_MODE', () => {
    process.env['EPS_MERCHANT_ID'] = 'm'
    process.env['EPS_STORE_ID'] = 's'
    process.env['EPS_USERNAME'] = 'u'
    process.env['EPS_PASSWORD'] = 'p'
    process.env['EPS_HASH_KEY'] = 'k'
    process.env['EPS_MODE'] = 'sandbox' // does NOT switch protocol
    const deps = defaultEpsCallDeps()
    expect(deps.config.wireProtocol).toBe(V5_PRODUCTION_PROTOCOL)
    expect(deps.config.wireProtocol).not.toBe(V4_SANDBOX_PROTOCOL)
  })

  it('secret CANNOT inject V5 paths into the sandbox config (paths are code-only)', async () => {
    // Even if a maliciously-crafted secret carries `paths`/`get_token_path`,
    // the schema ignores it and the loader hardcodes V4_SANDBOX_PATHS.
    const sneaky = JSON.stringify({
      ...JSON.parse(VALID_SANDBOX_SECRET),
      paths: V5_PRODUCTION_PATHS,
      get_token_path: '/api/v1/GetToken',
      initialise_path: '/api/v1/InitializeEPS',
      verify_path: '/api/v1/CheckMerchantTransactionStatus',
    })
    const setup = await loadSandboxEpsConfig(stubFetcher(sneaky))
    expect(setup.config.paths).toBe(V4_SANDBOX_PATHS)
  })

  it('default (env) deps path config.paths is V5_PRODUCTION_PATHS regardless of EPS_MODE', () => {
    // Even with EPS_MODE=sandbox in env (which the running services never set
    // on staging but which the get-token test exercises), cfg() returns V5
    // paths — the env path NEVER produces V4 paths.
    process.env['EPS_MERCHANT_ID'] = 'm'
    process.env['EPS_STORE_ID'] = 's'
    process.env['EPS_USERNAME'] = 'u'
    process.env['EPS_PASSWORD'] = 'p'
    process.env['EPS_HASH_KEY'] = 'k'
    process.env['EPS_MODE'] = 'sandbox' // does NOT switch paths
    const deps = defaultEpsCallDeps()
    expect(deps.config.paths).toBe(V5_PRODUCTION_PATHS)
    expect(deps.config.paths).not.toBe(V4_SANDBOX_PATHS)
  })
})

describe('architectural isolation — no running-service file imports sandbox-config', () => {
  it('sandbox-config is imported ONLY from the truth-gate path', () => {
    const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const offenders: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules') continue
          walk(full)
          continue
        }
        if (!full.endsWith('.ts')) continue
        // Tests may import anything; we only police production code paths.
        if (full.endsWith('.test.ts')) continue
        if (full.endsWith('sandbox-config.ts')) continue
        const body = readFileSync(full, 'utf8')
        if (/sandbox-config(\.js)?['"]/.test(body)) {
          // Allowed: only the truth-gate entrypoint may wire it.
          const allowed = full.endsWith(join('truth-gate', 'run-truth-gate.ts'))
          if (!allowed) offenders.push(full.slice(apiSrc.length + 1))
        }
      }
    }
    walk(apiSrc)

    expect(offenders).toEqual([])
  })
})
