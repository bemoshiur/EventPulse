/**
 * Wire-shape diagnostic helper — unit tests.
 *
 * Pins the empirical-discovery contract: when an EPS response fails schema
 * validation, `describeResponseShape` produces enough information in the
 * structured log to pin the actual wire shape without a follow-up live run.
 */

import { describe, expect, it } from 'vitest'

import { describeResponseShape } from './eps-wire-diagnostic.js'

describe('describeResponseShape', () => {
  it('describes a plain object with top-level keys + types', () => {
    const d = describeResponseShape({
      TransactionId: '<guid>',
      RedirectURL: 'https://pg.eps.com.bd/PG?data=<guid>',
      ErrorMessage: '',
      ErrorCode: null,
      FinancialEntityList: null,
    })
    expect(d.kind).toBe('object')
    expect(d.topLevelKeys).toEqual([
      'TransactionId',
      'RedirectURL',
      'ErrorMessage',
      'ErrorCode',
      'FinancialEntityList',
    ])
    expect(d.topLevelTypes).toEqual({
      TransactionId: 'string',
      RedirectURL: 'string',
      ErrorMessage: 'string',
      ErrorCode: 'null',
      FinancialEntityList: 'null',
    })
    expect(d.bodyTruncated).toContain('"RedirectURL"')
  })

  it('reports null distinctly from object', () => {
    const d = describeResponseShape(null)
    expect(d.kind).toBe('null')
    expect(d.topLevelKeys).toBeUndefined()
    expect(d.topLevelTypes).toBeUndefined()
    expect(d.bodyTruncated).toBe('null')
  })

  it('reports a string body (e.g. when axios returned text not JSON)', () => {
    const d = describeResponseShape('<html>...</html>')
    expect(d.kind).toBe('string')
    expect(d.topLevelKeys).toBeUndefined()
    expect(d.bodyTruncated).toBe('"<html>...</html>"')
  })

  it('reports an array body (some V4 endpoints wrap data in an array)', () => {
    const d = describeResponseShape([{ a: 1 }, { a: 2 }])
    expect(d.kind).toBe('array')
    expect(d.topLevelKeys).toBeUndefined()
    expect(d.bodyTruncated).toContain('[{"a":1}')
  })

  it('truncates oversized bodies at the cap with the truncation marker', () => {
    const big = { x: 'a'.repeat(2000) }
    const d = describeResponseShape(big, 200)
    expect(d.bodyTruncated).toBeDefined()
    expect(d.bodyTruncated!.endsWith('...[truncated]')).toBe(true)
    expect(d.bodyTruncated!.length).toBeLessThanOrEqual(200 + '...[truncated]'.length)
  })

  it('handles a value JSON.stringify cannot serialise (BigInt) — kind+keys still populated', () => {
    const withBigInt = { TransactionId: 'x', Count: 42n }
    const d = describeResponseShape(withBigInt)
    expect(d.kind).toBe('object')
    expect(d.topLevelKeys).toEqual(['TransactionId', 'Count'])
    expect(d.topLevelTypes).toEqual({ TransactionId: 'string', Count: 'bigint' })
    // bodyTruncated may be undefined (BigInt unserialisable in default JSON.stringify)
    // — the kind/keys/types still describe the shape, which is the contract.
    expect(typeof d.bodyTruncated === 'string' || d.bodyTruncated === undefined).toBe(true)
  })

  it('never throws on circular references', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a['self'] = a
    expect(() => describeResponseShape(a)).not.toThrow()
    const d = describeResponseShape(a)
    expect(d.kind).toBe('object')
    expect(d.topLevelKeys).toEqual(['name', 'self'])
  })
})
