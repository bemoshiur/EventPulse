import { describe, expect, it } from 'vitest'

import { decideAutoLink } from './oauth.js'

/**
 * Pure-function tests for the auto-link decision matrix per
 * `.claude/memory/decisions.md` "OAuth callback security model"
 * (2026-05-17) and CLAUDE.md §5.2.
 *
 * The decision matrix has five outcomes; each is exercised below.
 * The most security-relevant case is "Apple relay email + existing
 * user with same email" — we MUST refuse to auto-link there because
 * Apple can rotate the relay and we'd link the wrong human.
 */

describe('decideAutoLink', () => {
  it('LINKS when verified email matches an existing user (Google happy path)', () => {
    const d = decideAutoLink({
      providerUserId: 'google-sub-123',
      email: 'real@example.com',
      emailVerified: true,
      isPrivateEmail: false,
      existingUserWithEmailId: 'user-uuid-1',
    })
    expect(d).toEqual({ action: 'link-to-existing', reason: 'verified-email-match' })
  })

  it('CREATES NEW USER when no existing user has that email (Google new-user)', () => {
    const d = decideAutoLink({
      providerUserId: 'google-sub-456',
      email: 'newperson@example.com',
      emailVerified: true,
      isPrivateEmail: false,
      existingUserWithEmailId: null,
    })
    expect(d).toEqual({ action: 'create-new-user', reason: 'no-match' })
  })

  it('CREATES NEW USER on Apple relay email — even when an existing user has the same email', () => {
    // The most critical case. An attacker could otherwise:
    //   1. Sign up with Apple, get email abc@privaterelay.appleid.com
    //   2. Wait for Apple to rotate the relay
    //   3. The "old" relay address could be reissued to someone else
    //   4. That someone else uses our platform with the relay address
    //   5. They'd be auto-linked to the attacker's account — TAKEOVER
    // The is_private_email gate above closes this off completely.
    const d = decideAutoLink({
      providerUserId: 'apple-sub-789',
      email: 'abc123@privaterelay.appleid.com',
      emailVerified: true,
      isPrivateEmail: true,
      existingUserWithEmailId: 'user-uuid-victim',
    })
    expect(d).toEqual({ action: 'create-new-user', reason: 'relay-email-not-linkable' })
  })

  it('CREATES NEW USER when IdP says email is NOT verified', () => {
    const d = decideAutoLink({
      providerUserId: 'google-sub-999',
      email: 'unverified@example.com',
      emailVerified: false,
      isPrivateEmail: false,
      existingUserWithEmailId: 'user-uuid-1',
    })
    expect(d).toEqual({ action: 'create-new-user', reason: 'email-not-verified' })
  })

  it('CREATES NEW USER when IdP returned no email at all', () => {
    const d = decideAutoLink({
      providerUserId: 'apple-sub-no-email',
      email: null,
      emailVerified: true,
      isPrivateEmail: false,
      existingUserWithEmailId: null,
    })
    expect(d).toEqual({ action: 'create-new-user', reason: 'email-not-verified' })
  })

  it('Apple non-relay, verified email, no existing user → new user', () => {
    const d = decideAutoLink({
      providerUserId: 'apple-sub-fresh',
      email: 'me@example.com',
      emailVerified: true,
      isPrivateEmail: false,
      existingUserWithEmailId: null,
    })
    expect(d).toEqual({ action: 'create-new-user', reason: 'no-match' })
  })

  it('Apple non-relay, verified email, existing user → link (per spec, Apple permits this path)', () => {
    // When Apple returns the user's real email (is_private_email=false),
    // they've explicitly told the IdP "share my real email with this
    // app". Linking on email match is safe here, same as Google.
    const d = decideAutoLink({
      providerUserId: 'apple-sub-share-real',
      email: 'shared@example.com',
      emailVerified: true,
      isPrivateEmail: false,
      existingUserWithEmailId: 'user-uuid-2',
    })
    expect(d).toEqual({ action: 'link-to-existing', reason: 'verified-email-match' })
  })
})
