import { describe, expect, it } from 'vitest'

import { deriveDisplayName } from './display-name.js'

describe('deriveDisplayName', () => {
  it('derives a friendly name from the email local-part', () => {
    expect(deriveDisplayName('moshiur@publicpulse.com.bd')).toBe('Moshiur')
    expect(deriveDisplayName('moshiur.rahman@x.com')).toBe('Moshiur Rahman')
    expect(deriveDisplayName('jane_doe@x.com')).toBe('Jane Doe')
    expect(deriveDisplayName('a.b-c@x.com')).toBe('A B C')
  })
  it('falls back to "New User" when there is no usable local-part', () => {
    expect(deriveDisplayName('   ')).toBe('New User')
    expect(deriveDisplayName('@x.com')).toBe('New User')
    expect(deriveDisplayName('...@x.com')).toBe('New User')
  })
})
