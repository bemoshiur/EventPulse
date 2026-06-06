/**
 * User CRUD helpers used by the auth flows. Kept thin on purpose; full
 * profile management lands in Sprint 2.
 *
 * OAuth identity helpers (findUserByOAuthIdentity, linkOAuthIdentity) remain
 * for the `oauth_identities` table + any historical rows, but third-party
 * (Google) sign-in was REMOVED 2026-06-04 (email-only auth) — no runtime path
 * calls them now. See decisions.md "Third-party login removed — email + OTP only".
 */

import { and, eq } from 'drizzle-orm'

import { withSuperAdmin } from '../db/client.js'
import { oauthIdentities, users } from '../db/schema/index.js'

export interface UserRecord {
  id: string
  email: string
  fullName: string
  passwordHash: string | null
  emailVerifiedAt: Date | null
  mfaEnabled: boolean
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    return rows[0] ?? null
  })
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    return rows[0] ?? null
  })
}

export interface CreateUserInput {
  email: string
  fullName: string
  passwordHash?: string | null
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  return withSuperAdmin(async (db) => {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash ?? null,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
    return row!
  })
}

export async function markEmailVerified(userId: string): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId))
  })
}

/** Set (or reset) a user's argon2id password hash. Used by password reset. */
export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId))
  })
}

// ─── MFA / TOTP (§5.2) ──────────────────────────────────────────────────

export interface MfaState {
  enabled: boolean
  secret: string | null
  recoveryCodes: string[]
}

export async function getMfaState(userId: string): Promise<MfaState | null> {
  return withSuperAdmin(async (db) => {
    const [row] = await db
      .select({
        enabled: users.mfaEnabled,
        secret: users.mfaSecret,
        recoveryCodes: users.mfaRecoveryCodes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return row ?? null
  })
}

/** Store a provisional TOTP secret (MFA NOT yet enabled — confirmed by a code). */
export async function setMfaSecret(userId: string, secret: string): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db.update(users).set({ mfaSecret: secret, mfaEnabled: false }).where(eq(users.id, userId))
  })
}

/** Turn MFA on after a confirming code + store the recovery-code hashes. */
export async function enableMfa(userId: string, recoveryHashes: string[]): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db
      .update(users)
      .set({ mfaEnabled: true, mfaRecoveryCodes: recoveryHashes })
      .where(eq(users.id, userId))
  })
}

export async function disableMfa(userId: string): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db
      .update(users)
      .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] })
      .where(eq(users.id, userId))
  })
}

/** Remove a used recovery-code hash; returns true if it was present (valid). */
export async function consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
  return withSuperAdmin(async (db) => {
    const [row] = await db
      .select({ codes: users.mfaRecoveryCodes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!row || !row.codes.includes(codeHash)) return false
    await db
      .update(users)
      .set({ mfaRecoveryCodes: row.codes.filter((h) => h !== codeHash) })
      .where(eq(users.id, userId))
    return true
  })
}

// ─── OAuth identity helpers (Sprint 2 Item 4) ─────────────────────────
//
// Type is Google-only at MVP per decisions.md "Apple Sign-In dropped
// from MVP scope" (Sprint 3 Day 23). Database CHECK enum on
// oauth_identities.provider retains both ('google', 'apple') for
// historical row readability + forward-compat re-introduction; type
// narrows the application surface to what's actively wired.

export type OAuthProvider = 'google'

export interface OAuthIdentityRecord {
  id: string
  userId: string
  provider: OAuthProvider
  providerUserId: string
  email: string | null
}

/**
 * Look up an OAuth identity by (provider, provider_user_id). This is the
 * primary match path on every callback — Apple's `sub` is the only
 * identifier Apple guarantees stable, so we look up on it first even
 * when the email is also returned.
 */
export async function findUserByOAuthIdentity(
  provider: OAuthProvider,
  providerUserId: string,
): Promise<{ user: UserRecord; identity: OAuthIdentityRecord } | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        identityId: oauthIdentities.id,
        identityProvider: oauthIdentities.provider,
        identityProviderUserId: oauthIdentities.providerUserId,
        identityEmail: oauthIdentities.email,
        userId: users.id,
        userEmail: users.email,
        userFullName: users.fullName,
        userPasswordHash: users.passwordHash,
        userEmailVerifiedAt: users.emailVerifiedAt,
        userMfaEnabled: users.mfaEnabled,
      })
      .from(oauthIdentities)
      .innerJoin(users, eq(users.id, oauthIdentities.userId))
      .where(
        and(
          eq(oauthIdentities.provider, provider),
          eq(oauthIdentities.providerUserId, providerUserId),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      user: {
        id: row.userId,
        email: row.userEmail,
        fullName: row.userFullName,
        passwordHash: row.userPasswordHash,
        emailVerifiedAt: row.userEmailVerifiedAt,
        mfaEnabled: row.userMfaEnabled,
      },
      identity: {
        id: row.identityId,
        userId: row.userId,
        provider: row.identityProvider as OAuthProvider,
        providerUserId: row.identityProviderUserId,
        email: row.identityEmail,
      },
    }
  })
}

export interface LinkOAuthIdentityInput {
  userId: string
  provider: OAuthProvider
  providerUserId: string
  email: string | null
  rawProfile?: Record<string, unknown>
}

/**
 * Insert an OAuth identity for an existing user. Caller is responsible
 * for having validated the IdP ID-token signature AND (for auto-link)
 * that the IdP-asserted email is verified AND not a privacy relay.
 *
 * Idempotent at the (provider, provider_user_id) UNIQUE constraint —
 * a second link attempt for the same provider+sub will throw a unique
 * violation, which the caller should treat as "this account is already
 * linked" (most likely by a concurrent callback for the same user).
 */
export async function linkOAuthIdentity(
  input: LinkOAuthIdentityInput,
): Promise<OAuthIdentityRecord> {
  return withSuperAdmin(async (db) => {
    const [row] = await db
      .insert(oauthIdentities)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
        rawProfile: (input.rawProfile ?? null) as never,
      })
      .returning({
        id: oauthIdentities.id,
        userId: oauthIdentities.userId,
        provider: oauthIdentities.provider,
        providerUserId: oauthIdentities.providerUserId,
        email: oauthIdentities.email,
      })
    return {
      id: row!.id,
      userId: row!.userId,
      provider: row!.provider as OAuthProvider,
      providerUserId: row!.providerUserId,
      email: row!.email,
    }
  })
}
