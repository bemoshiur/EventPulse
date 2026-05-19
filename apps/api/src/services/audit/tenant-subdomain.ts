/**
 * Tenant subdomain provisioning audit helper — Sprint 3 Day 22 Workstream 2.
 *
 * One-per-domain audit pattern (decisions.md 2026-05-17 + reaffirmed
 * 2026-05-18). This helper covers two actions in the
 * tenant-subdomain domain:
 *
 *   - tenant.subdomain_provisioned       (success path)
 *   - tenant.subdomain_provisioning_failed (failure path)
 *
 * Both are system-action audit rows (actor_type='system', actor_id is
 * the super admin whose approve triggered provisioning). tenant_id is
 * always populated. entity_type='tenant', entity_id=tenantId.
 *
 * On success: diff carries { provisionedAt, slug, ssmCommandId }.
 * On failure: diff carries { failedAt, slug, ssmCommandId?, reason,
 * exitCode? } — enough detail for super admin to triage from the
 * audit log without re-running the SSM command.
 *
 * No PII (per §1.3 R5). The slug is public-namespace-shared identifier;
 * SSM command IDs are internal-only correlation tokens.
 */

import { auditLogs } from '../../db/schema/index.js'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

type Tx = NodePgDatabase<Record<string, unknown>>

export interface ProvisionedDiff {
  provisionedAt: string
  slug: string
  ssmCommandId: string
  /** True when the provisioner determined the vhost was already in place. */
  noOpAlreadyExisted?: boolean
}

export interface FailedDiff {
  failedAt: string
  slug: string
  ssmCommandId?: string
  reason: string
  exitCode?: number
}

interface AuditCommon {
  tenantId: string
  /** Super admin user id who triggered the approve. */
  actorUserId: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * Write a `tenant.subdomain_provisioned` audit row. Must be called inside
 * an active transaction (the caller's withSuperAdmin tx); the audit row
 * and the tenants.subdomain_provisioned_at bump commit atomically.
 */
export async function writeSubdomainProvisioned(
  tx: Tx,
  input: AuditCommon & { diff: ProvisionedDiff },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: input.actorUserId,
    action: 'tenant.subdomain_provisioned',
    entityType: 'tenant',
    entityId: input.tenantId,
    diff: input.diff,
    metadata: { actor_role: 'super_admin', source: 'kyc_approve_transition' },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

/**
 * Write a `tenant.subdomain_provisioning_failed` audit row. Called when
 * the SSM SendCommand returns a non-success status, the EC2 script
 * prints PROVISION_FAILED_NGINX_T, or any unhandled error surfaces.
 * Tenant stays in approved status; super admin notification fires
 * separately (notification helper, not this audit helper).
 */
export async function writeSubdomainProvisioningFailed(
  tx: Tx,
  input: AuditCommon & { diff: FailedDiff },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: input.actorUserId,
    action: 'tenant.subdomain_provisioning_failed',
    entityType: 'tenant',
    entityId: input.tenantId,
    diff: input.diff,
    metadata: { actor_role: 'super_admin', source: 'kyc_approve_transition' },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}
