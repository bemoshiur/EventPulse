import { describe, expect, it } from 'vitest'

import { hashEmail } from './suppression-list.js'

describe('hashEmail', () => {
  it('produces a stable sha256 hex digest', () => {
    const out = hashEmail('aminul@example.com')
    expect(out).toMatch(/^[0-9a-f]{64}$/)
  })

  it('lowercases before hashing — case-insensitive', () => {
    expect(hashEmail('Aminul@Example.COM')).toBe(hashEmail('aminul@example.com'))
  })

  it('trims surrounding whitespace before hashing', () => {
    expect(hashEmail('  aminul@example.com  ')).toBe(hashEmail('aminul@example.com'))
  })

  it('produces different digests for different emails', () => {
    const a = hashEmail('aminul@example.com')
    const b = hashEmail('different@example.com')
    expect(a).not.toBe(b)
  })

  it('is deterministic — same input twice = same digest', () => {
    expect(hashEmail('test@example.com')).toBe(hashEmail('test@example.com'))
  })
})
