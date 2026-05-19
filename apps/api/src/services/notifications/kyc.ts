/**
 * KYC notification handlers — Sprint 2 Day 14 Item 9 stubs upgraded to
 * real SES sends at Sprint 3 Day 22 Workstream 1 (per Decision O.2).
 *
 * Three fire sites:
 *   - sendKycSubmittedNotice : POST /tenant/kyc/submissions on success
 *   - sendKycApprovedNotice  : Item 13 reviewer approve transition
 *   - sendKycRejectedNotice  : Item 13 reviewer reject transition
 *
 * Each function:
 *   1. Resolves tenant owner email from tenants.owner_user_id → users.email
 *      (super-admin context; the notification fire may run from a super-
 *      admin transition where the tenant context can't see the owner row)
 *   2. Resolves locale via selectLocale({ tenantId })
 *   3. Renders the matching bilingual template
 *   4. Calls sesClient.sendEmail() with the rendered payload + tags
 *   5. Returns a deterministic NotificationEvent shape so the route
 *      handler test can assert "yes, notification fired" without
 *      coupling to the eventual SES message-id
 *
 * Error handling: the notification fire is intentionally non-blocking
 * for the state transition. If SES is down, the audit_log row + state
 * transition already committed; we log the error + return an event
 * with `delivered: false`. The route handler's fire-and-forget
 * `.catch()` (per Item 9 wiring) absorbs any throw, but we'd rather
 * not throw at all — return the failure shape so future retry logic
 * has something to read.
 *
 * No-PII rule: the returned event carries tenantId + submissionId +
 * delivered flag. The owner email is resolved at send time and never
 * persisted into the event. The recipient address is never logged
 * (per §1.3 R5 + §8.1).
 *
 * MAIL_DRY_RUN=1 short-circuits the SES call inside the client wrapper
 * — for local dev + CI integration tests, the function still flows
 * through resolveOwnerEmail + selectLocale + render so the path is
 * fully exercised; only the network call is replaced with a synthetic
 * messageId.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { tenants, users } from '../../db/schema/index.js'
import { sendEmail } from '../../infra/ses/client.js'
import { renderKycApproved } from '../../infra/ses/templates/kyc-approved.js'
import { renderKycRejected } from '../../infra/ses/templates/kyc-rejected.js'
import { renderKycSubmitted } from '../../infra/ses/templates/kyc-submitted.js'
import { logger } from '../../lib/logger.js'
import { selectLocale } from './locale.js'

export type KycNotificationType = 'kyc_submitted' | 'kyc_approved' | 'kyc_rejected'

export interface KycNotificationEvent {
  type: KycNotificationType
  tenantId: string
  submissionId: string
  /** Wall-clock at fire time — present for ordering in tests. */
  firedAt: string
  /** Populated only on rejection. */
  reason?: string
  /** True when sendEmail() returned a message id (or dry-run id);
   *  false when owner resolution / SES send errored. */
  delivered: boolean
  /** SES message id (or dryrun-<ts>) when delivered=true; undefined otherwise. */
  messageId?: string
}

interface OwnerLookup {
  email: string
  name: string
  preferredLocale: 'en' | 'bn'
}

/** Resolve tenant owner email + name + preferred locale in a single
 *  super-admin tx. Returns null when the tenant or its owner is missing
 *  (impossible in practice given FK + NOT NULL constraints, but defensive). */
async function resolveOwnerLookup(tenantId: string): Promise<OwnerLookup | null> {
  return withSuperAdmin(async (db) => {
    const [tenant] = await db
      .select({
        ownerUserId: tenants.ownerUserId,
        preferredLocale: tenants.preferredLocale,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    if (!tenant || !tenant.ownerUserId) return null
    const [owner] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, tenant.ownerUserId))
      .limit(1)
    if (!owner) return null
    return {
      email: owner.email,
      name: owner.fullName,
      preferredLocale: tenant.preferredLocale === 'en' ? 'en' : 'bn',
    }
  })
}

function tenantPortalUrl(): string {
  // Sprint 3 Day 22: subdomain provisioning lands in the next PR. Until
  // tenant-specific subdomains are live, the dashboard CTA points at
  // the canonical app subdomain. Provisioning PR will replace this with
  // tenant.slug-aware lookup.
  return process.env['TENANT_APP_BASE_URL'] ?? 'https://app.staging.eventpulse.com.bd/dashboard'
}

function kycResubmitUrl(): string {
  return process.env['TENANT_KYC_URL'] ?? 'https://app.staging.eventpulse.com.bd/kyc'
}

function now(): string {
  return new Date().toISOString()
}

async function sendOrFallback(
  type: KycNotificationType,
  tenantId: string,
  submissionId: string,
  rendered: { templateId: string; subject: string; text: string; html: string },
  toEmail: string,
  reason?: string,
): Promise<KycNotificationEvent> {
  try {
    const result = await sendEmail({
      to: toEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: {
        notification_type: type,
        template_id: rendered.templateId,
      },
    })
    return {
      type,
      tenantId,
      submissionId,
      firedAt: now(),
      reason,
      delivered: true,
      messageId: result.messageId,
    }
  } catch (err) {
    logger.error(
      { err, notification: type, tenantId, submissionId, templateId: rendered.templateId },
      'kyc notification send failed; transition + audit already committed',
    )
    return { type, tenantId, submissionId, firedAt: now(), reason, delivered: false }
  }
}

export async function sendKycSubmittedNotice(input: {
  tenantId: string
  submissionId: string
}): Promise<KycNotificationEvent> {
  const owner = await resolveOwnerLookup(input.tenantId)
  if (!owner) {
    logger.warn(
      { tenantId: input.tenantId },
      'sendKycSubmittedNotice: owner lookup returned null; skipping send',
    )
    return {
      type: 'kyc_submitted',
      tenantId: input.tenantId,
      submissionId: input.submissionId,
      firedAt: now(),
      delivered: false,
    }
  }
  const locale = await selectLocale({ tenantId: input.tenantId })
  const rendered = renderKycSubmitted({
    tenantName: owner.name,
    submittedAt: new Date(),
    locale,
  })
  return sendOrFallback('kyc_submitted', input.tenantId, input.submissionId, rendered, owner.email)
}

export async function sendKycApprovedNotice(input: {
  tenantId: string
  submissionId: string
}): Promise<KycNotificationEvent> {
  const owner = await resolveOwnerLookup(input.tenantId)
  if (!owner) {
    logger.warn(
      { tenantId: input.tenantId },
      'sendKycApprovedNotice: owner lookup returned null; skipping send',
    )
    return {
      type: 'kyc_approved',
      tenantId: input.tenantId,
      submissionId: input.submissionId,
      firedAt: now(),
      delivered: false,
    }
  }
  const locale = await selectLocale({ tenantId: input.tenantId })
  const rendered = renderKycApproved({
    tenantName: owner.name,
    tenantPortalUrl: tenantPortalUrl(),
    locale,
  })
  return sendOrFallback('kyc_approved', input.tenantId, input.submissionId, rendered, owner.email)
}

export async function sendKycRejectedNotice(input: {
  tenantId: string
  submissionId: string
  reason: string
}): Promise<KycNotificationEvent> {
  const owner = await resolveOwnerLookup(input.tenantId)
  if (!owner) {
    logger.warn(
      { tenantId: input.tenantId },
      'sendKycRejectedNotice: owner lookup returned null; skipping send',
    )
    return {
      type: 'kyc_rejected',
      tenantId: input.tenantId,
      submissionId: input.submissionId,
      firedAt: now(),
      reason: input.reason,
      delivered: false,
    }
  }
  const locale = await selectLocale({ tenantId: input.tenantId })
  const rendered = renderKycRejected({
    tenantName: owner.name,
    reason: input.reason,
    resubmitUrl: kycResubmitUrl(),
    locale,
  })
  return sendOrFallback(
    'kyc_rejected',
    input.tenantId,
    input.submissionId,
    rendered,
    owner.email,
    input.reason,
  )
}
