/**
 * SandboxPricedCallToken — capability + branding tests.
 */

import { describe, expect, it } from 'vitest'

import { isSandboxPricedCallToken, SandboxPricedCallToken } from './sandbox-priced-call-token.js'

describe('SandboxPricedCallToken', () => {
  it('mints from a sandbox-mode proof', () => {
    const token = SandboxPricedCallToken.mint({ mode: 'sandbox' })
    expect(token).toBeInstanceOf(SandboxPricedCallToken)
    expect(isSandboxPricedCallToken(token)).toBe(true)
  })

  it('refuses to mint from a production-mode proof (sandbox-only capability)', () => {
    expect(() => SandboxPricedCallToken.mint({ mode: 'production' })).toThrow(/sandbox-only/)
  })

  it('constructor is private (compile-time guarantee)', () => {
    // @ts-expect-error — constructor is private; calling it must be a type error.
    const t = new SandboxPricedCallToken()
    expect(t).toBeInstanceOf(SandboxPricedCallToken)
  })

  it('typeguard rejects shape-only fakes', () => {
    expect(isSandboxPricedCallToken({})).toBe(false)
    expect(isSandboxPricedCallToken(null)).toBe(false)
    expect(isSandboxPricedCallToken({ brand: true })).toBe(false)
  })
})
