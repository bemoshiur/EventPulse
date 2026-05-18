/**
 * Audit helper for tenant-scope mutations — Sprint 2 Day 15 Item 11.
 *
 * Sibling to `apps/api/src/services/audit/kyc.ts`. Per the Day 14
 * audit_logs scope decision (decisions.md 2026-05-17, reaffirmed Day 15):
 * audit helpers are one-per-domain, not a single generic `writeAudit()`.
 * Each helper carries domain-specific TypeScript types on its diff and
 * metadata shapes; a generic helper would lose that type safety. New
 * audit domains create new sibling helpers in this directory.
 *
 * What ships today:
 *   - writeTenantTypeSet(tx, ...) — one row per first-time tenant type
 *     selection (NULL → 'individual' | 'organisation'). Sprint 2 Day 15
 *     Item 11 is the only writer. Phase 2's super-admin "change tenant
 *     type" action ships its own writer in apps/api/src/services/audit/
 *     super-admin-tenant.ts so the actor_role boundary stays clean
 *     between tenant-self-service writes and admin overrides.
 *
 * Always called inside an active transaction (`tx` from withTenant) so
 * the audit row and the tenants.type update commit atomically — a type
 * change without its audit row is a regulatory-review failure mode and
 * the transaction boundary is the only thing that prevents it.
 *
 * No-PII rule: nothing in this row carries raw PII. The audit references
 * the tenant by id only; the type value itself is structural metadata,
 * not personal data. Per §1.3 R5.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

/**
 * Subset of `audit_logs.actor_type` (§9.10) that tenant-scope writers
 * can emit. Item 11 only writes `tenant_user`; Phase 2's super-admin
 * type-change action will use `super_admin` via its own helper, NOT this
 * one (see header — distinct helpers per actor-role boundary).
 */
export type TenantAuditActorRole = 'tenant_user'

/**
 * `tenants.type` literal set, mirrored locally so the helper's input
 * type matches the column's value space without importing schema types
 * back through a layering loop.
 */
export type TenantType = 'individual' | 'organisation'

export interface WriteTenantTypeSetInput {
  /** UUID of the tenant whose type was set. */
  tenantId: string
  /** UUID of the user who acted (always populated in tenant-context writes). */
  actorUserId: string
  /** Previous type — null on first-write, the only legal source state for Item 11. */
  fromType: TenantType | null
  /** Destination type. */
  toType: TenantType
  /** Always 'tenant_user' from this helper. Phase 2's super-admin writer is separate. */
  actorRole: TenantAuditActorRole
  /** Request IP, if available. */
  ip?: string | null
  /** Request user-agent, if available. */
  userAgent?: string | null
}

type Tx = NodePgDatabase<Record<string, unknown>>

export async function writeTenantTypeSet(tx: Tx, input: WriteTenantTypeSetInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'tenant.type_set',
    entityType: 'tenant',
    entityId: input.tenantId,
    diff: {
      type: { from: input.fromType, to: input.toType },
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}
