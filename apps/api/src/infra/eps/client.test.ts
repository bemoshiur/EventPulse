/**
 * EPS wrapper client — Day 24 Part 1 behaviour tests.
 *
 * Focus: behaviour the wrapper OWNS today.
 *
 *   - cfg() reads env, fails loud on missing values
 *   - BASE_URLS routes correctly on mode
 *   - http() factory yields a configured axios instance (no network)
 *   - initialiseOrder enforces the STAGING_PAYMENT_BLOCK guard FIRST
 *     (Phase 1) then throws EpsNotImplementedError (Part 2 wires the
 *     real call)
 *   - verifyOrder throws EpsNotImplementedError (no guard — Verify
 *     doesn't charge)
 *   - getAccessToken cache hit returns the cached value; cache miss
 *     throws EpsNotImplementedError until Part 2
 *
 * Tests deliberately do NOT make real EPS network calls. Day 24-25
 * Decision N truth gate exercises sandbox HTTP via the harness in
 * Phase 4; this file pins the Part 1 surface only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _resetTokenCacheForTest,
  _seedAccessTokenForTest,
  BASE_URLS,
  cfg,
  EpsConfigError,
  EpsNotImplementedError,
  getAccessToken,
  http,
  initialiseOrder,
  inMemoryTokenCache,
  StagingPaymentBlockedError,
  verifyOrder,
} from './client.js'

// Snapshot+restore the EPS-relevant env so individual tests can mutate
// freely without leaking. STAGING_PAYMENT_BLOCK is also snapshot.
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
  for (const k of ENV_KEYS) {
    ORIGINAL_ENV[k] = process.env[k]
  }
  // Default to a complete config so individual tests can selectively
  // delete one key to assert per-key error reporting.
  process.env['EPS_MERCHANT_ID'] = 'm'
  process.env['EPS_STORE_ID'] = 's'
  process.env['EPS_USERNAME'] = 'u'
  process.env['EPS_PASSWORD'] = 'p'
  process.env['EPS_HASH_KEY'] = 'k'
  process.env['EPS_MODE'] = 'production'
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
    expect(c).toEqual({
      merchantId: 'm',
      storeId: 's',
      username: 'u',
      password: 'p',
      hashKey: 'k',
      mode: 'production',
    })
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

  it.each([
    'EPS_MERCHANT_ID',
    'EPS_STORE_ID',
    'EPS_USERNAME',
    'EPS_PASSWORD',
    'EPS_HASH_KEY',
  ])('throws EpsConfigError naming %s when missing', (envKey) => {
    delete process.env[envKey]
    try {
      cfg()
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(EpsConfigError)
      expect((err as Error).message).toContain(envKey)
    }
  })

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
    expect(BASE_URLS.sandbox).toBe('https://sandbox-pgapi.eps.com.bd')
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
    expect(http().defaults.baseURL).toBe('https://sandbox-pgapi.eps.com.bd')
  })

  it('throws EpsConfigError when env missing (fail loud at construction)', () => {
    delete process.env['EPS_HASH_KEY']
    expect(() => http()).toThrow(EpsConfigError)
  })
})

describe('initialiseOrder', () => {
  it('throws StagingPaymentBlockedError when block on + priced order', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await expect(
      initialiseOrder({ merchantTransactionId: 'TXN-1', totalPaisa: 100_000n }),
    ).rejects.toBeInstanceOf(StagingPaymentBlockedError)
  })

  it('guard fires BEFORE NotImplementedError (safety beats scope)', async () => {
    // If a future change accidentally inverted the order, the
    // NotImplementedError would mask the guard's protective effect
    // and a real call could slip through. Pin order with an explicit
    // assertion on which error type fires.
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    try {
      await initialiseOrder({ merchantTransactionId: 'TXN-1', totalPaisa: 1n })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StagingPaymentBlockedError)
      expect(err).not.toBeInstanceOf(EpsNotImplementedError)
    }
  })

  it('throws EpsNotImplementedError when block on + free order (gate passed; scope gap)', async () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await expect(
      initialiseOrder({ merchantTransactionId: 'TXN-FREE', totalPaisa: 0n }),
    ).rejects.toBeInstanceOf(EpsNotImplementedError)
  })

  it('throws EpsNotImplementedError when block off + priced order', async () => {
    delete process.env['STAGING_PAYMENT_BLOCK']
    await expect(
      initialiseOrder({ merchantTransactionId: 'TXN-1', totalPaisa: 100n }),
    ).rejects.toBeInstanceOf(EpsNotImplementedError)
  })

  it('NotImplementedError names Day 26-28 as the wire-up point (greppable)', async () => {
    delete process.env['STAGING_PAYMENT_BLOCK']
    try {
      await initialiseOrder({ merchantTransactionId: 'TXN-1', totalPaisa: 100n })
      throw new Error('expected throw')
    } catch (err) {
      expect((err as Error).message).toMatch(/Day 26-28/)
    }
  })
})

describe('verifyOrder', () => {
  it('throws EpsNotImplementedError (no guard — Verify never charges)', async () => {
    // Verify is intentionally NOT gated by STAGING_PAYMENT_BLOCK: it's
    // a read-only call against the gateway. The guard only protects
    // the funds-moving entry points.
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    await expect(
      verifyOrder({ merchantTransactionId: 'TXN-VERIFY' }),
    ).rejects.toBeInstanceOf(EpsNotImplementedError)
  })

  it('NotImplementedError names Day 26-28 as the wire-up point', async () => {
    try {
      await verifyOrder({ merchantTransactionId: 'TXN-V' })
      throw new Error('expected throw')
    } catch (err) {
      expect((err as Error).message).toMatch(/Day 26-28/)
    }
  })
})

describe('getAccessToken', () => {
  it('returns the cached token when present (cache hit path is fully wired)', async () => {
    await _seedAccessTokenForTest('cached-jwt-12345')
    const token = await getAccessToken()
    expect(token).toBe('cached-jwt-12345')
  })

  it('throws EpsNotImplementedError on cache miss (no fetch wired in Part 1)', async () => {
    await expect(getAccessToken()).rejects.toBeInstanceOf(EpsNotImplementedError)
  })

  it('NotImplementedError mentions Part 2 / Day 26-28', async () => {
    try {
      await getAccessToken()
      throw new Error('expected throw')
    } catch (err) {
      expect((err as Error).message).toMatch(/Day 26-28/)
    }
  })

  it('accepts a custom cache for dependency injection', async () => {
    const custom = inMemoryTokenCache()
    await custom.set('eps:access-token:v1', 'injected-token', 60)
    expect(await getAccessToken(custom)).toBe('injected-token')
  })

  it('default cache singleton persists across calls within a process', async () => {
    await _seedAccessTokenForTest('first-call-cached')
    expect(await getAccessToken()).toBe('first-call-cached')
    // No re-seed: second call still hits the same default cache
    expect(await getAccessToken()).toBe('first-call-cached')
  })
})

describe('error class hygiene (greppable distinct types)', () => {
  it('StagingPaymentBlockedError, EpsConfigError, EpsNotImplementedError are distinct', () => {
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
    const blocked = new StagingPaymentBlockedError(100n)
    const configErr = new EpsConfigError('missing FOO')
    const notImpl = new EpsNotImplementedError('not yet wired')

    expect(blocked).toBeInstanceOf(StagingPaymentBlockedError)
    expect(blocked).not.toBeInstanceOf(EpsConfigError)
    expect(blocked).not.toBeInstanceOf(EpsNotImplementedError)

    expect(configErr).toBeInstanceOf(EpsConfigError)
    expect(configErr).not.toBeInstanceOf(StagingPaymentBlockedError)
    expect(configErr).not.toBeInstanceOf(EpsNotImplementedError)

    expect(notImpl).toBeInstanceOf(EpsNotImplementedError)
    expect(notImpl).not.toBeInstanceOf(StagingPaymentBlockedError)
    expect(notImpl).not.toBeInstanceOf(EpsConfigError)
  })

  it('greppable error names', () => {
    expect(new StagingPaymentBlockedError(1n).name).toBe('StagingPaymentBlockedError')
    expect(new EpsConfigError('x').name).toBe('EpsConfigError')
    expect(new EpsNotImplementedError('x').name).toBe('EpsNotImplementedError')
  })
})
