/**
 * Unit tests for the audience-grant decision (pure, no DB).
 *
 * Guards the Day-45 critical finding: /password/login + /magic-link/consume
 * trusted a client-supplied `audience`, so any user could self-grant
 * `super-admin` or scope a `tenant` session to an arbitrary tenantId. The
 * decision below is the server-side authority that closes that hole.
 */
import { describe, expect, it } from 'vitest'

import { decideAudience, type AudienceGrants } from './audience-grant.js'

const NONE: AudienceGrants = { isSuperAdmin: false, tenantIds: [] }
const SUPER: AudienceGrants = { isSuperAdmin: true, tenantIds: [] }
const MEMBER: AudienceGrants = {
  isSuperAdmin: false,
  tenantIds: ['11111111-1111-1111-1111-111111111111'],
}

describe('decideAudience', () => {
  it('always allows attendee regardless of grants', () => {
    expect(decideAudience('attendee', NONE).allowed).toBe(true)
    expect(decideAudience('attendee', SUPER).allowed).toBe(true)
  })

  it('denies super-admin when the user is not in super_admins', () => {
    const d = decideAudience('super-admin', NONE)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBeTruthy()
  })

  it('allows super-admin only for a super_admins member', () => {
    expect(decideAudience('super-admin', SUPER).allowed).toBe(true)
  })

  it('denies tenant audience when the user is not a member of that tenant', () => {
    const d = decideAudience('tenant', NONE, '11111111-1111-1111-1111-111111111111')
    expect(d.allowed).toBe(false)
  })

  it('denies tenant audience for a tenant the user is NOT a member of (cross-tenant guard)', () => {
    const d = decideAudience('tenant', MEMBER, '22222222-2222-2222-2222-222222222222')
    expect(d.allowed).toBe(false)
  })

  it('allows tenant audience for a tenant the user IS a member of', () => {
    const d = decideAudience('tenant', MEMBER, '11111111-1111-1111-1111-111111111111')
    expect(d.allowed).toBe(true)
  })

  it('denies tenant audience when no tenantId is supplied', () => {
    expect(decideAudience('tenant', MEMBER).allowed).toBe(false)
  })

  it('does not let a super_admin auto-pass the tenant check without membership', () => {
    // super-admin status must NOT grant arbitrary tenant access
    const d = decideAudience('tenant', SUPER, '33333333-3333-3333-3333-333333333333')
    expect(d.allowed).toBe(false)
  })
})
