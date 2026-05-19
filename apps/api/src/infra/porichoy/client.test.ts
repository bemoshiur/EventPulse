/**
 * Tests for the Porichoy scaffold stub — Sprint 2 Day 20 Item 16.
 *
 * The stub is load-bearing: any caller hitting it MUST get a loud,
 * greppable error so the manual-verification policy isn't bypassed
 * by accidentally-wired automation. These tests pin that contract.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  PorichoyNotImplementedError,
  PorichoyScaffoldStub,
  _resetPorichoyClient,
  porichoyClient,
  readPorichoyConfig,
} from './client.js'

describe('Porichoy scaffold stub', () => {
  afterEach(() => {
    _resetPorichoyClient()
  })

  it('PorichoyScaffoldStub.nidVerify throws PorichoyNotImplementedError', async () => {
    const stub = new PorichoyScaffoldStub()
    await expect(stub.nidVerify('1234567890', 'Test User', '1990-01-01')).rejects.toThrow(
      PorichoyNotImplementedError,
    )
  })

  it('error message references the canonical decisions.md entry', async () => {
    const stub = new PorichoyScaffoldStub()
    await expect(stub.nidVerify('x', 'x', 'x')).rejects.toThrow(
      /Platform-wide policy.*manual verification only for MVP/,
    )
  })

  it('error message references Phase 2 trigger', async () => {
    const stub = new PorichoyScaffoldStub()
    await expect(stub.nidVerify('x', 'x', 'x')).rejects.toThrow(/Phase 2 trigger/)
  })

  it('porichoyClient() returns the scaffold stub today (load-bearing)', () => {
    const c = porichoyClient()
    expect(c).toBeInstanceOf(PorichoyScaffoldStub)
  })

  it('porichoyClient() is memoised — same instance across calls', () => {
    const a = porichoyClient()
    const b = porichoyClient()
    expect(a).toBe(b)
  })

  it('_resetPorichoyClient() clears the memoised instance', () => {
    const a = porichoyClient()
    _resetPorichoyClient()
    const b = porichoyClient()
    expect(a).not.toBe(b)
  })
})

describe('Porichoy config reading', () => {
  const savedKey = process.env['POROCHOY_API_KEY']
  const savedUrl = process.env['POROCHOY_BASE_URL']

  afterEach(() => {
    if (savedKey === undefined) delete process.env['POROCHOY_API_KEY']
    else process.env['POROCHOY_API_KEY'] = savedKey
    if (savedUrl === undefined) delete process.env['POROCHOY_BASE_URL']
    else process.env['POROCHOY_BASE_URL'] = savedUrl
  })

  it('readPorichoyConfig() returns null when either env var is missing', () => {
    delete process.env['POROCHOY_API_KEY']
    delete process.env['POROCHOY_BASE_URL']
    expect(readPorichoyConfig()).toBeNull()
  })

  it('readPorichoyConfig() returns null when only API_KEY is set', () => {
    process.env['POROCHOY_API_KEY'] = 'set'
    delete process.env['POROCHOY_BASE_URL']
    expect(readPorichoyConfig()).toBeNull()
  })

  it('readPorichoyConfig() returns the pair when both are set', () => {
    process.env['POROCHOY_API_KEY'] = 'key-value'
    process.env['POROCHOY_BASE_URL'] = 'https://api.porichoy.gov.bd'
    expect(readPorichoyConfig()).toEqual({
      apiKey: 'key-value',
      baseUrl: 'https://api.porichoy.gov.bd',
    })
  })
})
