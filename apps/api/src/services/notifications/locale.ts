/**
 * Locale selection for notification templates — Sprint 3 Day 22 Decision O.2.
 *
 * Discriminated-union helper that reads the right column based on the
 * target type:
 *
 *   - { tenantId } → tenants.preferred_locale  (KYC-event templates)
 *   - { userId }   → users.locale              (magic link, OAuth link)
 *
 * The discriminator prevents the most common bug class for this kind of
 * lookup: caller passes a userId when they meant a tenantId (or vice
 * versa) and the wrong column gets read. TypeScript narrows on the
 * presence of `tenantId` vs `userId`, so the wrong-type call fails to
 * compile.
 *
 * Reads run under `withSuperAdmin` (BYPASSRLS) because the notification
 * trigger may be a super-admin action where the tenant's owner should be
 * notified — tenant-context reads can't see arbitrary tenants. Per §1.3
 * R5 the locale itself is non-PII, so this surface is safe to read from
 * the super-admin context.
 *
 * Defensive fallback: if the lookup returns no row (impossible under the
 * CHECK + NOT NULL + foreign-key constraints, but defensive over
 * thrown errors in a notification-send hot path), the function returns
 * 'en'. A thrown error would interrupt the post-commit notification
 * fire and either (a) leave the user without notification or (b) crash
 * the worker. Returning 'en' degrades to a known-safe template variant.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { tenants, users } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

export type LocaleCode = 'en' | 'bn'

export type LocaleTarget = { tenantId: string } | { userId: string }

/**
 * Resolve the locale for a tenant- or user-targeted notification.
 *
 * @throws Never. On any error path (DB unreachable, row missing) returns
 *   'en' as a safe default and logs a warning. The notification fires
 *   in the correct locale 99.9% of the time and never fails to fire
 *   because of a locale-lookup error.
 */
export async function selectLocale(target: LocaleTarget): Promise<LocaleCode> {
  try {
    return await withSuperAdmin(async (db) => {
      if ('tenantId' in target) {
        const [row] = await db
          .select({ locale: tenants.preferredLocale })
          .from(tenants)
          .where(eq(tenants.id, target.tenantId))
          .limit(1)
        if (!row) {
          logger.warn(
            { tenantId: target.tenantId },
            'selectLocale: tenant not found; defaulting to en',
          )
          return 'en'
        }
        return narrow(row.locale)
      }
      const [row] = await db
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, target.userId))
        .limit(1)
      if (!row) {
        logger.warn({ userId: target.userId }, 'selectLocale: user not found; defaulting to en')
        return 'en'
      }
      return narrow(row.locale)
    })
  } catch (err) {
    logger.warn({ err, target }, 'selectLocale: lookup failed; defaulting to en')
    return 'en'
  }
}

/**
 * Constrain the DB-string to the two-value union. The CHECK constraint
 * (`tenants_preferred_locale_chk`) and the users.locale default 'en'
 * mean we should only see 'en' or 'bn' at the DB layer — but if a
 * future migration adds a third value without updating this helper,
 * we'd silently return that value to a template renderer that's typed
 * for only two. Narrow defensively.
 */
function narrow(value: string): LocaleCode {
  if (value === 'en' || value === 'bn') return value
  logger.warn({ value }, 'selectLocale: unexpected locale value; falling back to en')
  return 'en'
}
