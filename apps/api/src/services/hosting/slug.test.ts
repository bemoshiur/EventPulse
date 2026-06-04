import { describe, expect, it } from 'vitest'

import { derivePersonalSlug } from './slug.js'

describe('derivePersonalSlug', () => {
  it('derives a valid slug from an email local-part', () => {
    expect(derivePersonalSlug('moshiur@publicpulse.com.bd')).toBe('moshiur')
    expect(derivePersonalSlug('moshiur.rahman@x.com')).toBe('moshiur-rahman')
    expect(derivePersonalSlug('Jane_Doe@x.com')).toBe('jane-doe')
  })
  it('pads short local-parts so the slug is >= 3 chars', () => {
    expect(derivePersonalSlug('jo@x.com')).toBe('jo-events')
    expect(derivePersonalSlug('a@x.com')).toBe('a-events')
  })
  it('always satisfies the handle regex ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (3-30 chars)', () => {
    const re = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
    for (const seed of [
      'moshiur@x',
      'a@x',
      '@x',
      '...@x',
      'অআই@x',
      '--weird--@x',
      'x'.repeat(50) + '@y',
    ]) {
      const s = derivePersonalSlug(seed)
      expect(s.length).toBeGreaterThanOrEqual(3)
      expect(s.length).toBeLessThanOrEqual(30)
      expect(s).toMatch(re)
    }
  })
})
