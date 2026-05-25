/**
 * Rate limiter unit tests — pure, deterministic via injected clock.
 */

import { describe, expect, it } from 'vitest'

import { createRateLimiter } from './rate-limit.js'

function makeFakeClock(initial = 1_000_000) {
  let t = initial
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
    set: (v: number) => {
      t = v
    },
  }
}

describe('createRateLimiter', () => {
  it('allows up to `limit` requests in the window then rejects', () => {
    const clock = makeFakeClock()
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now })
    expect(rl.check('k')).toBe(true) // 1
    expect(rl.check('k')).toBe(true) // 2
    expect(rl.check('k')).toBe(true) // 3
    expect(rl.check('k')).toBe(false) // 4 over limit
    expect(rl.count('k')).toBe(3)
  })

  it('keys are independent', () => {
    const clock = makeFakeClock()
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now })
    expect(rl.check('a')).toBe(true)
    expect(rl.check('a')).toBe(true)
    expect(rl.check('a')).toBe(false)
    // b key not affected
    expect(rl.check('b')).toBe(true)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('b')).toBe(false)
  })

  it('resets at window boundary', () => {
    const clock = makeFakeClock(60_000) // bucket starts at 60_000
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
    // Advance to next bucket
    clock.advance(60_000)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
  })

  it('mid-window advance does NOT reset', () => {
    const clock = makeFakeClock(60_000)
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    clock.advance(30_000) // still inside the window
    expect(rl.check('k')).toBe(false)
  })

  it('reset() clears all state', () => {
    const clock = makeFakeClock()
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
    rl.reset()
    expect(rl.check('k')).toBe(true)
  })

  it('throws on invalid config', () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError)
    expect(() => createRateLimiter({ limit: -1, windowMs: 1000 })).toThrow(RangeError)
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError)
  })

  it('count() returns 0 for never-seen key', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 })
    expect(rl.count('never')).toBe(0)
  })
})
