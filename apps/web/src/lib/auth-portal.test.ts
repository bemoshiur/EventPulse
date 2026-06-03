import { describe, expect, it } from 'vitest'

import { consumeErrorMessage, consumeHomePath } from './auth-portal'

describe('consumeHomePath', () => {
  it('super-admin lands on the admin KYC queue', () => {
    expect(consumeHomePath('super-admin')).toBe('/admin/kyc')
  })
  it('tenant lands on the tenant dashboard', () => {
    expect(consumeHomePath('tenant')).toBe('/dashboard')
  })
  it('attendee / unknown lands on root', () => {
    expect(consumeHomePath('attendee')).toBe('/')
    expect(consumeHomePath('whatever')).toBe('/')
  })
})

describe('consumeErrorMessage', () => {
  it('401 → expired/used link', () => {
    expect(consumeErrorMessage(401)).toMatch(/expired|used/i)
  })
  it('403 → no access for this account', () => {
    expect(consumeErrorMessage(403)).toMatch(/access|permission/i)
  })
  it('404 → no account', () => {
    expect(consumeErrorMessage(404)).toMatch(/no account|not found/i)
  })
  it('other → generic', () => {
    expect(consumeErrorMessage(500)).toMatch(/something went wrong|try again/i)
  })
})
