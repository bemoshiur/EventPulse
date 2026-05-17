import { describe, expect, it } from 'vitest'

import { constantTimeEquals, hashPassword, verifyPassword } from './hash.js'

describe('argon2id password hashing', () => {
  it('round-trips a plaintext password', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true)
    await expect(verifyPassword('correcthorsebatterystaple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    await expect(verifyPassword('wronghorse', hash)).resolves.toBe(false)
  })

  it('rejects short passwords at hash time', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/)
  })

  it('hashes are non-deterministic (random salt)', async () => {
    const a = await hashPassword('correcthorsebatterystaple')
    const b = await hashPassword('correcthorsebatterystaple')
    expect(a).not.toBe(b)
  })

  it('rejects malformed encoded strings', async () => {
    await expect(verifyPassword('any', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('any', '$argon2id$v=20$m=1,t=1,p=1$abc$def')).resolves.toBe(false)
  })

  it('constantTimeEquals is correct on matched + mismatched + length-mismatched inputs', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
  })
})
