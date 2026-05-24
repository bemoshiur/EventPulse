/**
 * Tenant subdomain provisioning task — Sprint 3 Day 22 Workstream 2.
 *
 * Fired fire-and-forget from the Item 13 KYC approve action AFTER the
 * approve tx commits. Per the Day 20 brief: failed provisioning leaves
 * the tenant in approved status (KYC is the contract; provisioning is
 * operational layer) but writes a `tenant.subdomain_provisioning_failed`
 * audit row + surfaces in admin queue.
 *
 * Flow:
 *   1. Read tenants.slug + check tenants.subdomain_provisioned_at — if
 *      already set, no-op (idempotent re-runs are safe).
 *   2. Render vhost template via services/tenant-subdomain/template.ts.
 *   3. Build SSM commands (write vhost + symlink + nginx -t + reload).
 *   4. Send via @aws-sdk/client-ssm; poll until terminal status.
 *   5. Parse output for PROVISION_OK / PROVISION_NO_OP_ALREADY_EXISTS /
 *      PROVISION_FAILED_NGINX_T markers.
 *   6. On success: update tenants.subdomain_provisioned_at +
 *      write audit row (single tx).
 *   7. On failure: update tenants.subdomain_provisioning_failed_at +
 *      write failure audit row + log structured error for super admin
 *      notification.
 *
 * Decision O.1: cert + DNS wildcard live; no certbot call from here.
 *
 * Dry-run mode: when SUBDOMAIN_PROVISION_DRY_RUN=1 the function logs
 * what it would do + returns success without calling SSM. Used by
 * unit tests + local dev where AWS creds aren't available.
 */

import { eq } from 'drizzle-orm'

import { GetCommandInvocationCommand, SSMClient, SendCommandCommand } from '@aws-sdk/client-ssm'

import { withSuperAdmin } from '../../db/client.js'
import { tenants } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import {
  writeSubdomainProvisioned,
  writeSubdomainProvisioningFailed,
} from '../audit/tenant-subdomain.js'
import { buildProvisionCommands, renderTenantVhost } from './template.js'

export interface ProvisionInput {
  tenantId: string
  /** Super admin who triggered the KYC approve. */
  actorUserId: string
  /** Optional ip/UA passthrough for the audit row. */
  ip?: string | null
  userAgent?: string | null
}

export type ProvisionResult =
  | { status: 'success'; provisionedAt: Date; ssmCommandId: string; noOpAlreadyExisted: boolean }
  | { status: 'already_provisioned'; provisionedAt: Date }
  | { status: 'failed'; reason: string; ssmCommandId?: string; exitCode?: number }
  | { status: 'dry_run'; commandsCount: number }
  | { status: 'tenant_missing' }

const PROVISION_OK_MARKER = 'PROVISION_OK'
const PROVISION_NO_OP_MARKER = 'PROVISION_NO_OP_ALREADY_EXISTS'
const PROVISION_FAIL_MARKER = 'PROVISION_FAILED_NGINX_T'

let _ssmClient: SSMClient | undefined
function ssm(): SSMClient {
  if (!_ssmClient) {
    _ssmClient = new SSMClient({ region: process.env['AWS_REGION'] ?? 'ap-southeast-1' })
  }
  return _ssmClient
}

/** Test seam — reset the lazy singleton so tests can swap region/mocks. */
export function _resetSsmClientForTests(): void {
  _ssmClient = undefined
}

function envApex(): string {
  // Per CLAUDE.md §17.6: staging is `staging.eventpulse.com.bd`; production
  // would be `eventpulse.com.bd`. Env override allows ops to point
  // provisioning at a different apex without code change.
  return process.env['TENANT_APEX_DOMAIN'] ?? 'staging.eventpulse.com.bd'
}

function envInstanceId(): string {
  const id = process.env['STAGING_EC2_INSTANCE_ID']
  if (!id) {
    throw new Error(
      'STAGING_EC2_INSTANCE_ID env var is required for tenant subdomain provisioning. ' +
        'Set in bootstrap-staging.sh or override in test fixtures via SUBDOMAIN_PROVISION_DRY_RUN=1.',
    )
  }
  return id
}

/**
 * Provision a tenant subdomain.
 *
 * NEVER throws. All failure paths return a typed `ProvisionResult`
 * with status='failed' so the caller can log + alert without
 * try/catch ergonomics in the hot path.
 */
export async function provisionTenantSubdomain(input: ProvisionInput): Promise<ProvisionResult> {
  // 1. Read tenant + idempotency check.
  let slug: string
  let alreadyProvisionedAt: Date | null
  try {
    const lookup = await withSuperAdmin(async (db) => {
      const [row] = await db
        .select({
          slug: tenants.slug,
          subdomainProvisionedAt: tenants.subdomainProvisionedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1)
      return row
    })
    if (!lookup) {
      logger.warn({ tenantId: input.tenantId }, 'provisionTenantSubdomain: tenant not found')
      return { status: 'tenant_missing' }
    }
    slug = lookup.slug
    alreadyProvisionedAt = lookup.subdomainProvisionedAt
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId },
      'provisionTenantSubdomain: tenant lookup failed',
    )
    return { status: 'failed', reason: `tenant lookup failed: ${(err as Error).message}` }
  }

  if (alreadyProvisionedAt) {
    logger.info(
      { tenantId: input.tenantId, slug, provisionedAt: alreadyProvisionedAt.toISOString() },
      'provisionTenantSubdomain: already provisioned; no-op',
    )
    return { status: 'already_provisioned', provisionedAt: alreadyProvisionedAt }
  }

  // 2. Render vhost + build SSM commands.
  let commands: string[]
  let vhostContent: string
  try {
    vhostContent = renderTenantVhost({ slug, apexDomain: envApex() })
    commands = buildProvisionCommands({ slug, vhostContent })
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, slug },
      'provisionTenantSubdomain: template render failed',
    )
    return {
      status: 'failed',
      reason: `template render failed: ${(err as Error).message}`,
    }
  }

  if (process.env['SUBDOMAIN_PROVISION_DRY_RUN'] === '1') {
    logger.info(
      { tenantId: input.tenantId, slug, commandsCount: commands.length },
      'provisionTenantSubdomain: dry-run (SUBDOMAIN_PROVISION_DRY_RUN=1)',
    )
    return { status: 'dry_run', commandsCount: commands.length }
  }

  // 3. Send via SSM + poll.
  let commandId: string | undefined
  let exitCode: number | undefined
  let stdout = ''
  try {
    const send = await ssm().send(
      new SendCommandCommand({
        InstanceIds: [envInstanceId()],
        DocumentName: 'AWS-RunShellScript',
        Parameters: { commands },
        TimeoutSeconds: 60,
        Comment: `tenant-subdomain-provisioning slug=${slug}`,
      }),
    )
    commandId = send.Command?.CommandId
    if (!commandId) {
      return { status: 'failed', reason: 'SSM SendCommand returned no CommandId' }
    }

    // Poll up to 30s for terminal status.
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep(2000)
      const inv = await ssm().send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: envInstanceId(),
        }),
      )
      stdout = inv.StandardOutputContent ?? ''
      exitCode = inv.ResponseCode ?? undefined
      const status = inv.Status
      if (
        status === 'Success' ||
        status === 'Failed' ||
        status === 'TimedOut' ||
        status === 'Cancelled'
      ) {
        break
      }
    }
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, slug, ssmCommandId: commandId },
      'provisionTenantSubdomain: SSM send/poll failed',
    )
    return {
      status: 'failed',
      reason: `SSM send/poll failed: ${(err as Error).message}`,
      ssmCommandId: commandId,
    }
  }

  // 4. Parse output for markers.
  const okMarker = stdout.includes(PROVISION_OK_MARKER)
  const noOpMarker = stdout.includes(PROVISION_NO_OP_MARKER)
  const failMarker = stdout.includes(PROVISION_FAIL_MARKER)

  if (failMarker || (!okMarker && !noOpMarker)) {
    const reason = failMarker
      ? 'nginx -t rejected the generated vhost; rolled back via PROVISION_FAILED_NGINX_T path'
      : `SSM completed without expected markers (exit=${exitCode}); stdout=${stdout.slice(0, 200)}`
    return await recordFailure({
      tenantId: input.tenantId,
      slug,
      actorUserId: input.actorUserId,
      ip: input.ip,
      userAgent: input.userAgent,
      reason,
      ssmCommandId: commandId,
      exitCode,
    })
  }

  // 5. Record success.
  return await recordSuccess({
    tenantId: input.tenantId,
    slug,
    actorUserId: input.actorUserId,
    ip: input.ip,
    userAgent: input.userAgent,
    ssmCommandId: commandId!,
    noOpAlreadyExisted: noOpMarker,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function recordSuccess(input: {
  tenantId: string
  slug: string
  actorUserId: string
  ip?: string | null
  userAgent?: string | null
  ssmCommandId: string
  noOpAlreadyExisted: boolean
}): Promise<ProvisionResult> {
  const provisionedAt = new Date()
  try {
    await withSuperAdmin(async (tx) => {
      await tx
        .update(tenants)
        .set({ subdomainProvisionedAt: provisionedAt })
        .where(eq(tenants.id, input.tenantId))
      await writeSubdomainProvisioned(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        ip: input.ip,
        userAgent: input.userAgent,
        diff: {
          provisionedAt: provisionedAt.toISOString(),
          slug: input.slug,
          ssmCommandId: input.ssmCommandId,
          noOpAlreadyExisted: input.noOpAlreadyExisted,
        },
      })
    })
    logger.info(
      {
        tenantId: input.tenantId,
        slug: input.slug,
        ssmCommandId: input.ssmCommandId,
        noOpAlreadyExisted: input.noOpAlreadyExisted,
      },
      'provisionTenantSubdomain: success',
    )
    return {
      status: 'success',
      provisionedAt,
      ssmCommandId: input.ssmCommandId,
      noOpAlreadyExisted: input.noOpAlreadyExisted,
    }
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, slug: input.slug, ssmCommandId: input.ssmCommandId },
      'provisionTenantSubdomain: db write failed AFTER successful SSM provisioning — manual reconciliation needed',
    )
    return {
      status: 'failed',
      reason: `db write failed after successful SSM provisioning: ${(err as Error).message}`,
      ssmCommandId: input.ssmCommandId,
    }
  }
}

async function recordFailure(input: {
  tenantId: string
  slug: string
  actorUserId: string
  ip?: string | null
  userAgent?: string | null
  reason: string
  ssmCommandId?: string
  exitCode?: number
}): Promise<ProvisionResult> {
  const failedAt = new Date()
  try {
    await withSuperAdmin(async (tx) => {
      await tx
        .update(tenants)
        .set({ subdomainProvisioningFailedAt: failedAt })
        .where(eq(tenants.id, input.tenantId))
      await writeSubdomainProvisioningFailed(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        ip: input.ip,
        userAgent: input.userAgent,
        diff: {
          failedAt: failedAt.toISOString(),
          slug: input.slug,
          ssmCommandId: input.ssmCommandId,
          reason: input.reason,
          exitCode: input.exitCode,
        },
      })
    })
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, slug: input.slug },
      'provisionTenantSubdomain: failed to record provisioning failure in audit (compound failure)',
    )
  }
  logger.error(
    {
      tenantId: input.tenantId,
      slug: input.slug,
      ssmCommandId: input.ssmCommandId,
      reason: input.reason,
      exitCode: input.exitCode,
    },
    'provisionTenantSubdomain: failed — super admin notification should fire',
  )
  return {
    status: 'failed',
    reason: input.reason,
    ssmCommandId: input.ssmCommandId,
    exitCode: input.exitCode,
  }
}
