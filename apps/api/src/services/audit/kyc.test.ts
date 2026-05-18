/**
 * Unit tests for the pure-function helpers in services/audit/kyc.ts.
 *
 * The DB-touching parts (writeKycTransition, writeKycDraftCreated,
 * writeKycDraftUpdated) are exercised by integration tests in
 * routes/tenant/kyc.test.ts + routes/tenant/kyc-drafts.test.ts.
 * This file covers the diff computation helpers — pure functions
 * with no DB or network — that drive the path-only audit diff for
 * kyc_submission.draft_updated rows (Decision A, 2026-05-18).
 */

import { describe, expect, it } from 'vitest'

import { computeFieldDiff, flattenPaths } from './kyc.js'

describe('flattenPaths', () => {
  it('returns an empty list for undefined', () => {
    expect(flattenPaths(undefined, 'fields')).toEqual([])
  })

  it('returns an empty list for null', () => {
    expect(flattenPaths(null, 'fields')).toEqual([])
  })

  it('returns the prefix for a leaf scalar', () => {
    expect(flattenPaths('hello', 'fields.identity.fullName')).toEqual(['fields.identity.fullName'])
  })

  it('returns prefixed paths for a flat object', () => {
    expect(flattenPaths({ fullName: 'X', nidNumber: 'Y' }, 'fields.identity').sort()).toEqual([
      'fields.identity.fullName',
      'fields.identity.nidNumber',
    ])
  })

  it('recurses into nested objects', () => {
    expect(flattenPaths({ identity: { fullName: 'X', nidNumber: 'Y' } }, 'fields').sort()).toEqual([
      'fields.identity.fullName',
      'fields.identity.nidNumber',
    ])
  })

  it('treats arrays as leaf values (no expansion)', () => {
    // Tier 1 + Tier A schemas have no array fields; arrays are leaves
    // to keep audit paths interpretable without array-index syntax.
    expect(flattenPaths({ tags: ['a', 'b'] }, 'fields')).toEqual(['fields.tags'])
  })

  it('returns nothing for an empty object', () => {
    expect(flattenPaths({}, 'fields')).toEqual([])
  })
})

describe('computeFieldDiff', () => {
  it('identifies a single added path', () => {
    const diff = computeFieldDiff({}, { fullName: 'X' }, 'fields.identity')
    expect(diff).toEqual({
      added: ['fields.identity.fullName'],
      updated: [],
      removed: [],
    })
  })

  it('identifies a single updated path', () => {
    const diff = computeFieldDiff({ fullName: 'X' }, { fullName: 'Y' }, 'fields.identity')
    expect(diff).toEqual({
      added: [],
      updated: ['fields.identity.fullName'],
      removed: [],
    })
  })

  it('identifies a single removed path', () => {
    const diff = computeFieldDiff(
      { fullName: 'X', nidNumber: 'Y' },
      { fullName: 'X' },
      'fields.identity',
    )
    expect(diff).toEqual({
      added: [],
      updated: [],
      removed: ['fields.identity.nidNumber'],
    })
  })

  it('returns all-empty for a no-op (same before/after)', () => {
    const value = { fullName: 'X', nidNumber: 'Y' }
    const diff = computeFieldDiff(value, value, 'fields.identity')
    expect(diff).toEqual({ added: [], updated: [], removed: [] })
  })

  it('reports all three categories at once', () => {
    const before = { fullName: 'X', nidNumber: 'Y' }
    const after = { fullName: 'X2', dateOfBirth: '2000-01-01' }
    const diff = computeFieldDiff(before, after, 'fields.identity')
    expect(new Set(diff.added)).toEqual(new Set(['fields.identity.dateOfBirth']))
    expect(new Set(diff.updated)).toEqual(new Set(['fields.identity.fullName']))
    expect(new Set(diff.removed)).toEqual(new Set(['fields.identity.nidNumber']))
  })

  it('handles undefined before (= initial PATCH against a fresh sub-object)', () => {
    const diff = computeFieldDiff(undefined, { fullName: 'X' }, 'fields.identity')
    expect(diff.added).toEqual(['fields.identity.fullName'])
    expect(diff.updated).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it('handles undefined after (= step cleared)', () => {
    const diff = computeFieldDiff({ fullName: 'X' }, undefined, 'fields.identity')
    expect(diff.added).toEqual([])
    expect(diff.updated).toEqual([])
    expect(diff.removed).toEqual(['fields.identity.fullName'])
  })

  it('descends into nested sub-objects (jsonb shape mirrors wizard step shape)', () => {
    const before = { identity: { fullName: 'X' } }
    const after = { identity: { fullName: 'Y', dateOfBirth: '2000-01-01' } }
    const diff = computeFieldDiff(before, after, 'fields')
    expect(new Set(diff.added)).toEqual(new Set(['fields.identity.dateOfBirth']))
    expect(new Set(diff.updated)).toEqual(new Set(['fields.identity.fullName']))
    expect(diff.removed).toEqual([])
  })

  it('stores no PII in the resulting diff — paths only', () => {
    // The whole point of the path-only diff: an audit reviewer can see
    // that fields.identity.nidNumber was UPDATED without learning what
    // the NID number is. This test is the canonical regression target
    // for any future "let's include values for richer forensics" idea —
    // if it ever fails because values leaked into the diff, the audit
    // shape has regressed past §1.3 R5 and the PR must not merge.
    const before = { nidNumber: '1234567890' }
    const after = { nidNumber: '9876543210' }
    const diff = computeFieldDiff(before, after, 'fields.identity')
    const serialised = JSON.stringify(diff)
    expect(serialised).not.toContain('1234567890')
    expect(serialised).not.toContain('9876543210')
    expect(diff.updated).toEqual(['fields.identity.nidNumber'])
  })
})
