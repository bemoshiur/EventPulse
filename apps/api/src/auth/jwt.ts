/**
 * JWT issuance + verification per CLAUDE.md §5.1.
 *
 * Three audiences (super-admin, tenant, attendee). Access tokens
 * 15-minute TTL; refresh tokens 7-day TTL (rotated on use). Algorithm:
 * HS256 with a secret from JWT_ACCESS_SECRET / JWT_REFRESH_SECRET env
 * vars (Secrets Manager in prod, dotenv locally).
 *
 * Tokens carry only the audience + minimal subject info; the source of
 * truth for "is this session still valid" remains the `sessions` table
 * (so a revoked session takes effect within one access-token lifetime).
 */

import { jwtVerify, SignJWT } from 'jose'

import type { SessionAudience } from './sessions.js'

const ACCESS_TTL_SEC = 15 * 60
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60

function secret(envName: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): Uint8Array {
  const raw = process.env[envName]
  if (!raw) throw new Error(`${envName} is not set`)
  if (raw.length < 32) throw new Error(`${envName} must be at least 32 characters`)
  return new TextEncoder().encode(raw)
}

export interface AccessClaims {
  sub: string // userId
  audience: SessionAudience['audience']
  tenantId: string | null
  sessionId: string // sha256 of session token, doubles as primary key in sessions table
}

export interface SignedTokens {
  accessToken: string
  refreshToken: string
  accessExpiresIn: number
  refreshExpiresIn: number
}

export async function signTokens(claims: AccessClaims): Promise<SignedTokens> {
  const accessToken = await new SignJWT({
    audience: claims.audience,
    tenantId: claims.tenantId,
    sessionId: claims.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('eventpulse')
    .setAudience(claims.audience)
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(secret('JWT_ACCESS_SECRET'))

  const refreshToken = await new SignJWT({
    audience: claims.audience,
    tenantId: claims.tenantId,
    sessionId: claims.sessionId,
    kind: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('eventpulse')
    .setAudience(claims.audience)
    .setExpirationTime(`${REFRESH_TTL_SEC}s`)
    .sign(secret('JWT_REFRESH_SECRET'))

  return {
    accessToken,
    refreshToken,
    accessExpiresIn: ACCESS_TTL_SEC,
    refreshExpiresIn: REFRESH_TTL_SEC,
  }
}

// ─── MFA challenge token ────────────────────────────────────────────────
//
// Issued by /password/login when the user has MFA on: it proves "password +
// email already passed" without opening a session. Short-lived (5 min), carries
// the intended audience + tenantId so /mfa/verify can open the right session.
// Signed with JWT_ACCESS_SECRET + a `purpose: 'mfa_challenge'` claim so it can't
// be replayed as an access token.

const MFA_CHALLENGE_TTL_SEC = 300

export interface MfaChallenge {
  sub: string
  audience: SessionAudience['audience']
  tenantId: string | null
}

export async function signMfaChallenge(c: MfaChallenge): Promise<string> {
  return new SignJWT({ audience: c.audience, tenantId: c.tenantId, purpose: 'mfa_challenge' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setIssuer('eventpulse')
    .setExpirationTime(`${MFA_CHALLENGE_TTL_SEC}s`)
    .sign(secret('JWT_ACCESS_SECRET'))
}

export async function verifyMfaChallenge(token: string): Promise<MfaChallenge | null> {
  try {
    const { payload } = await jwtVerify(token, secret('JWT_ACCESS_SECRET'), {
      issuer: 'eventpulse',
    })
    if (payload['purpose'] !== 'mfa_challenge' || typeof payload.sub !== 'string') return null
    return {
      sub: payload.sub,
      audience: payload['audience'] as SessionAudience['audience'],
      tenantId: (payload['tenantId'] as string | null) ?? null,
    }
  } catch {
    return null
  }
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret('JWT_ACCESS_SECRET'), {
      issuer: 'eventpulse',
    })
    return {
      sub: String(payload.sub),
      audience: payload['audience'] as SessionAudience['audience'],
      tenantId: (payload['tenantId'] as string | null) ?? null,
      sessionId: String(payload['sessionId']),
    }
  } catch {
    return null
  }
}

export async function verifyRefreshToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret('JWT_REFRESH_SECRET'), {
      issuer: 'eventpulse',
    })
    if (payload['kind'] !== 'refresh') return null
    return {
      sub: String(payload.sub),
      audience: payload['audience'] as SessionAudience['audience'],
      tenantId: (payload['tenantId'] as string | null) ?? null,
      sessionId: String(payload['sessionId']),
    }
  } catch {
    return null
  }
}
