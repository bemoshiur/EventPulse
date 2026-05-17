/**
 * KYC notification stubs — Sprint 2 Day 14 Item 9.
 *
 * These are scaffolding. Item 16 (Day 20) wires bilingual SES templates
 * + recipient lookup (tenant owner + super admin queue digest). For now,
 * each function logs the event with a `[STUB]` marker and returns a
 * deterministic `NotificationEvent` shape so the route handler can
 * assert "yes, the notification was fired" without depending on SES.
 *
 * Why ship stubs at Item 9 instead of waiting for Item 16:
 *   1. The state machine + audit trail are useless if the notification
 *      firing point isn't wired in the same transaction boundary as the
 *      state change. Wiring stubs now means Item 16 just replaces the
 *      stub body with the real SES call — no route changes.
 *   2. The integration test for the submit endpoint asserts that the
 *      stub fires on terminal transitions; that test stays green when
 *      Item 16 lands.
 *
 * Fire site map (today):
 *   - sendKycSubmittedNotice : called by POST /tenant/kyc/submissions
 *     after the kyc_submissions row + audit row are inserted in the
 *     same transaction.
 *   - sendKycApprovedNotice  : will be called by Item 13's reviewer
 *     approve action. Stub exists so the Item 13 PR doesn't need to
 *     touch this file beyond replacing the stub body.
 *   - sendKycRejectedNotice  : same as above, on reject.
 *
 * TODO(Item 16, Day 20):
 *   - Resolve tenant primary email via tenants.owner_user_id → users.email
 *     (under withSuperAdmin since tenant context can't read users.email
 *     for an arbitrary user, only their own — and the notification
 *     trigger may be a super-admin action where the tenant's owner
 *     should be notified).
 *   - Load bilingual template from `apps/api/src/infra/ses/templates/`
 *     (templates land in Item 16); render with subject/preheader/body
 *     in en + bn per §1.3 R12.
 *   - Call sesClient.sendEmail() with the rendered template + tag
 *     `notification_type=kyc_<event>` for engagement tracking.
 *   - Persist a `notification_log` row per §9.10 once that table lands
 *     (also Item 16).
 *
 * No-PII rule: returned events carry only tenantId + submissionId.
 * Recipient email is resolved at send time and never echoed back into
 * the event object (per §1.3 R5).
 */

import { logger } from '../../lib/logger.js'

export type KycNotificationType = 'kyc_submitted' | 'kyc_approved' | 'kyc_rejected'

export interface KycNotificationEvent {
  type: KycNotificationType
  tenantId: string
  submissionId: string
  /** Wall-clock at fire time — present for ordering in tests. */
  firedAt: string
  /** Populated only on rejection. */
  reason?: string
  /** True while Item 16 hasn't landed; lets tests assert the scaffolding
   *  shape rather than coupling to the eventual SES message-id. */
  stub: true
}

function now(): string {
  return new Date().toISOString()
}

export async function sendKycSubmittedNotice(input: {
  tenantId: string
  submissionId: string
}): Promise<KycNotificationEvent> {
  const event: KycNotificationEvent = {
    type: 'kyc_submitted',
    tenantId: input.tenantId,
    submissionId: input.submissionId,
    firedAt: now(),
    stub: true,
  }
  logger.info(
    { notification: event },
    '[STUB] KYC submitted notification fired (Item 16 wires SES template)',
  )
  return event
}

export async function sendKycApprovedNotice(input: {
  tenantId: string
  submissionId: string
}): Promise<KycNotificationEvent> {
  const event: KycNotificationEvent = {
    type: 'kyc_approved',
    tenantId: input.tenantId,
    submissionId: input.submissionId,
    firedAt: now(),
    stub: true,
  }
  logger.info(
    { notification: event },
    '[STUB] KYC approved notification fired (Item 16 wires SES template)',
  )
  return event
}

export async function sendKycRejectedNotice(input: {
  tenantId: string
  submissionId: string
  reason: string
}): Promise<KycNotificationEvent> {
  const event: KycNotificationEvent = {
    type: 'kyc_rejected',
    tenantId: input.tenantId,
    submissionId: input.submissionId,
    firedAt: now(),
    reason: input.reason,
    stub: true,
  }
  logger.info(
    { notification: event },
    '[STUB] KYC rejected notification fired (Item 16 wires SES template)',
  )
  return event
}
