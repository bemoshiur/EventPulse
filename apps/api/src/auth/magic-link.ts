/**
 * Magic link generator + verifier per CLAUDE.md §5.2.
 *
 * - 15-minute TTL (single-use)
 * - Token is opaque random; DB stores only the SHA-256 hash
 * - Optionally bound to the requesting IP's /24 prefix; subsequent
 *   consume request from a different /24 fails (mobile networks
 *   shouldn't reasonably jump prefixes within 15 minutes; if they do
 *   the user just requests another link)
 * - Single-use: once consumed (or expired) the row is deleted
 *
 * The function `requestMagicLink` returns the plaintext token, which
 * the caller embeds in the email URL. `consumeMagicLink` validates +
 * deletes; downstream code creates a session for the matched user.
 */

import { and, eq, lt } from 'drizzle-orm'

import { withSuperAdmin } from '../db/client.js'
import { magicLinks } from '../db/schema/index.js'
import { generateToken, hashToken, ipv4Prefix24 } from './tokens.js'

const TTL_MIN = 15

export type MagicLinkPurpose =
  | 'signup'
  | 'signin'
  | 'email_change'
  | 'email_verify'
  | 'password_reset'
  | 'ticket_access'

export interface RequestMagicLinkInput {
  email: string
  purpose: MagicLinkPurpose
  userId?: string | null
  ip?: string | null
}

export interface MagicLinkRequested {
  token: string
  expiresAt: Date
}

export async function requestMagicLink(input: RequestMagicLinkInput): Promise<MagicLinkRequested> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TTL_MIN * 60 * 1000)
  const ipPrefix = ipv4Prefix24(input.ip ?? null)

  await withSuperAdmin(async (db) => {
    await db.insert(magicLinks).values({
      tokenHash,
      userId: input.userId ?? null,
      email: input.email,
      purpose: input.purpose,
      ipPrefix,
      expiresAt,
    })
  })

  return { token, expiresAt }
}

export interface ConsumedMagicLink {
  email: string
  purpose: MagicLinkPurpose
  userId: string | null
}

/** Returns the matched record on success, null on miss / expired / IP-prefix mismatch. */
export async function consumeMagicLink(
  token: string,
  ip?: string | null,
): Promise<ConsumedMagicLink | null> {
  const tokenHash = hashToken(token)
  const requestPrefix = ipv4Prefix24(ip ?? null)

  return withSuperAdmin(async (db) => {
    const rows = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash))
    const row = rows[0]
    if (!row) return null
    // Always delete the row immediately so the link is single-use even on failure.
    await db.delete(magicLinks).where(eq(magicLinks.tokenHash, tokenHash))

    if (row.expiresAt.getTime() <= Date.now()) return null
    if (row.consumedAt !== null) return null
    if (row.ipPrefix && requestPrefix && row.ipPrefix !== requestPrefix) return null

    return {
      email: row.email,
      purpose: row.purpose as MagicLinkPurpose,
      userId: row.userId,
    }
  })
}

/** Drop expired magic-link rows (cron). */
export async function pruneExpiredMagicLinks(): Promise<number> {
  const result = await withSuperAdmin(async (db) =>
    db
      .delete(magicLinks)
      .where(and(lt(magicLinks.expiresAt, new Date())))
      .returning({ tokenHash: magicLinks.tokenHash }),
  )
  return result.length
}
