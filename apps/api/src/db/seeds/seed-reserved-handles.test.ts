import { describe, expect, it } from 'vitest'
import { RESERVED_HANDLES, validateList } from './seed-reserved-handles.js'

describe('reserved-handles seed', () => {
  it('all entries pass the §2.3 handle pattern + length checks', () => {
    expect(() => validateList(RESERVED_HANDLES)).not.toThrow()
  })

  it('contains the system-critical handles', () => {
    const handles = new Set(RESERVED_HANDLES.map((r) => r.handle))
    for (const required of ['admin', 'api', 'app', 'www', 'my', 'support']) {
      expect(handles.has(required)).toBe(true)
    }
  })

  it('contains the Event Pulse brand handles', () => {
    const handles = new Set(RESERVED_HANDLES.map((r) => r.handle))
    expect(handles.has('eventpulse')).toBe(true)
    expect(handles.has('publicpulse')).toBe(true)
  })

  it('contains the BD payment-brand impersonation guards', () => {
    const handles = new Set(RESERVED_HANDLES.map((r) => r.handle))
    for (const brand of ['bkash', 'nagad', 'eps', 'sslcommerz']) {
      expect(handles.has(brand)).toBe(true)
    }
  })

  it('rejects empty handles or > 64 chars', () => {
    expect(() => validateList([{ handle: '', reason: 'system' }])).toThrow(/range/)
    expect(() => validateList([{ handle: 'a'.repeat(65), reason: 'system' }])).toThrow(/range/)
  })

  it('rejects uppercase or trailing-hyphen handles', () => {
    expect(() => validateList([{ handle: 'Admin', reason: 'system' }])).toThrow(/pattern/)
    expect(() => validateList([{ handle: 'admin-', reason: 'system' }])).toThrow(/pattern/)
  })

  it('allows 1-2 char system reservations (e.g. `my`, `mx`)', () => {
    expect(() =>
      validateList([
        { handle: 'my', reason: 'system' },
        { handle: 'mx', reason: 'system' },
      ]),
    ).not.toThrow()
  })
})
