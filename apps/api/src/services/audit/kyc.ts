/**
 * Audit helper for KYC submission state transitions — Sprint 2 Day 14 Item 9.
 *
 * Writes one `audit_logs` row per legal transition handled by the state
 * machine in `apps/api/src/domain/kyc/state-machine.ts`. Always called
 * inside an active transaction (`tx` from withTenant) so the audit row
 * and the kyc_submissions row update commit atomically — a state change
 * without its audit row, or vice-versa, is a regulatory-review failure
 * mode and the transaction boundary is the only thing that prevents it.
 *
 * Audit row shape (per §9.10 + §1.3 R8):
 *   - tenant_id    : always populated from withTenant context.
 *                    System-action audit writes (tenant_id IS NULL)
 *                    require withSuperAdmin and a different helper.
 *   - actor_type   : 'tenant_user' (tenant resubmit) or 'super_admin'
 *                    (reviewer approve/reject). Item 9 ships the
 *                    tenant_user path only; reviewer writes land at
 *                    Item 13 (Day 18) and call back into this helper.
 *   - actor_id     : the user id of the actor (never null for KYC).
 *   - action       : 'kyc_submission.transition' — namespaced so a
 *                    future entity_type=order audit shares the
 *                    'transition' verb without colliding.
 *   - entity_type  : 'kyc_submission'
 *   - entity_id    : the submission id (matches kyc_submissions.id).
 *   - diff         : { from, to, reason? } — reason populated on rejection.
 *   - metadata     : { actor_role } — captured for forensic queries that
 *                    need to know "which role acted" without joining
 *                    back to a stale roles table.
 *   - ip, user_agent: from the request when available (route handler
 *                    passes through; null in test/system paths).
 *
 * No-PII rule: nothing in this row carries raw PII. The submission's
 * NID / eTIN / bank details live in kyc_submissions.fields; the audit
 * trail references the submission by id only. Per §1.3 R5.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'
import type { KycSubmissionStatus } from '../../domain/kyc/state-machine.js'

/**
 * Subset of `audit_logs.actor_type` (§9.10 CHECK enum:
 *   'user' | 'tenant_user' | 'super_admin' | 'system' | 'webhook'
 * ) that the KYC code path can ever emit. We deliberately narrow:
 *
 *   - `tenant_user` — tenant resubmit / tenant-side create writes.
 *   - `super_admin` — reviewer approve/reject writes (lands at Item 13).
 *
 * The other DB-legal values ('user', 'system', 'webhook') belong to
 * future writers (`user` for /my/* self-service writes, `system` for
 * cron-driven retention sweeps, `webhook` for EPS callbacks). Those
 * writers ship their own helpers; we don't widen this type unless KYC
 * code actually needs to write rows with those actor_types, which
 * would be a meaningful design change worth surfacing.
 */
export type KycAuditActorRole = 'tenant_user' | 'super_admin'

export interface WriteKycTransitionInput {
  /** UUID of the kyc_submissions row whose state is changing. */
  submissionId: string
  /** Tenant id — must equal `app.current_tenant_id` for the RLS insert to pass. */
  tenantId: string
  /** Previous status; null only when the audit is logging the row's birth
   *  (status='submitted' on first write). Convention: pass null on create,
   *  pass the old state on every subsequent transition.
   */
  fromState: KycSubmissionStatus | null
  /** Destination status. */
  toState: KycSubmissionStatus
  /** UUID of the user who acted. */
  actorUserId: string
  /** Which surface they acted from. */
  actorRole: KycAuditActorRole
  /** Required on rejection, optional otherwise. */
  reason?: string | null
  /** Request IP, if available. */
  ip?: string | null
  /** Request user-agent, if available. */
  userAgent?: string | null
}

type Tx = NodePgDatabase<Record<string, unknown>>

export async function writeKycTransition(tx: Tx, input: WriteKycTransitionInput): Promise<void> {
  // The `KycAuditActorRole` type is intentionally a subset of the DB
  // CHECK enum (see type comment above), so passing `actorRole` straight
  // through as `actor_type` is always legal at the DB level.
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'kyc_submission.transition',
    entityType: 'kyc_submission',
    entityId: input.submissionId,
    diff: {
      from: input.fromState,
      to: input.toState,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}
