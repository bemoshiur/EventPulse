/**
 * Drizzle schema — Sprint 1 Day 5-6 identity tables.
 *
 * Tracks CLAUDE.md §9.1 (identity + tenancy), §9.12 (fee config), §9.14
 * (handle system). Event Pulse v2.1: unified identity model where one
 * `users` row carries attendee + tenant contexts, personal tenants
 * auto-provision on first event publish, and handles share a global
 * namespace with tenant slugs.
 *
 * RLS policies are NOT defined here — see migrations 0002_*.sql. Drizzle
 * generates table DDL; we hand-write policies as a separate SQL migration
 * because (a) Drizzle doesn't have first-class policy DSL yet and (b) we
 * want RLS in its own reviewable file per §4.3.
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * `citext` is a Postgres extension type for case-insensitive text.
 * Drizzle doesn't ship it; declare it once and reuse.
 */
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
})

// ─────────────────────────────────────────────────────────────────────────
// USERS — one row per real person; carries attendee + tenant contexts.
// ─────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: citext().notNull().unique(),
    phone: text(),
    fullName: text('full_name').notNull(),
    handle: citext().unique(),
    handleChosenAt: timestamp('handle_chosen_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    avatarUrl: text('avatar_url'),
    locale: text().notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('idx_users_email').on(t.email), index('idx_users_handle').on(t.handle)],
)

// ─────────────────────────────────────────────────────────────────────────
// TENANTS — organisations and personal tenants alike. RLS is enforced.
// ─────────────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  'tenants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Nullable per migration 0006 (Sprint 2 Day 15 Item 11). Post-login
    // Account-Type modal sets this on first dashboard load; until then,
    // `requireTenantType` middleware returns 409 on every tenant route
    // except the setter (`POST /tenant/account-type`) and the read
    // endpoint (`GET /tenant/me`). Set-once at the application layer
    // (decisions.md 2026-05-18); only NULL → value is legal.
    type: text(),
    name: text().notNull(),
    slug: citext().notNull().unique(),
    isPersonal: boolean('is_personal').notNull().default(false),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    status: text().notNull().default('pending_kyc'),
    kycTier: text('kyc_tier').notNull().default('tier_1'),
    kycStatus: text('kyc_status').notNull().default('not_submitted'),
    feeOverrideBps: integer('fee_override_bps'),
    brandLogoUrl: text('brand_logo_url'),
    brandColorPrimary: text('brand_color_primary'),
    brandColorAccent: text('brand_color_accent'),
    monthlyGmvPaisa: bigint('monthly_gmv_paisa', { mode: 'bigint' }).notNull().default(0n),
    // Per migration 0009 (Sprint 3 Day 22 Decision O.2). Tenant-organisation
    // communications locale; tenant-level, not owner-individual. Notification
    // helper for KYC-event templates reads from here; user-targeted templates
    // (magic link, OAuth) read users.locale instead. Default 'bn' per §1.3 R12
    // + §16.2 BD-market reality.
    preferredLocale: text('preferred_locale').notNull().default('bn'),
    // Per migration 0010 (Sprint 3 Day 22 Workstream 2). Subdomain
    // provisioning lifecycle on the wildcard cert + wildcard DNS
    // infrastructure landed in Decision O.1. Both NULL until first KYC
    // approve transition. See services/tenant-subdomain/provision.ts for
    // the state-machine semantics (NULL/NULL = never tried; provisioned
    // NOT NULL = success; failed NOT NULL + provisioned NULL = stuck).
    subdomainProvisionedAt: timestamp('subdomain_provisioned_at', { withTimezone: true }),
    subdomainProvisioningFailedAt: timestamp('subdomain_provisioning_failed_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'tenants_type_chk',
      // NULL accepted explicitly (migration 0006) so the post-login Account-
      // Type modal can land with no type until the user chooses. NULL IN (...)
      // is UNKNOWN, not TRUE, so without the explicit IS NULL branch the CHECK
      // would reject every INSERT/UPDATE that left type unset.
      sql`${t.type} IS NULL OR ${t.type} IN ('organisation','individual')`,
    ),
    check(
      'tenants_status_chk',
      sql`${t.status} IN ('pending_kyc','active','suspended','terminated')`,
    ),
    check(
      'tenants_kyc_tier_chk',
      sql`${t.kycTier} IN ('tier_1','tier_2','tier_3','org_a','org_b','org_c')`,
    ),
    check(
      'tenants_kyc_status_chk',
      sql`${t.kycStatus} IN ('not_submitted','submitted','under_review','approved','rejected')`,
    ),
    check(
      'tenants_personal_owner_chk',
      sql`(${t.isPersonal} = false) OR (${t.ownerUserId} IS NOT NULL)`,
    ),
    check(
      'tenants_preferred_locale_chk',
      // Two-value enum at the DB layer per migration 0009. Future additions
      // (e.g. 'hi', 'ur') require a deliberate migration. Default 'bn' set
      // at column level; CHECK enforces explicit-write conformance.
      sql`${t.preferredLocale} IN ('en','bn')`,
    ),
    index('idx_tenants_owner_personal')
      .on(t.ownerUserId)
      .where(sql`${t.isPersonal} = true`),
    index('idx_tenants_status').on(t.status),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// OAUTH IDENTITIES — Google + Apple Sign-In links per §5.2.
// ─────────────────────────────────────────────────────────────────────────

export const oauthIdentities = pgTable(
  'oauth_identities',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: citext(),
    rawProfile: jsonb('raw_profile'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('oauth_provider_user_uq').on(t.provider, t.providerUserId),
    check('oauth_provider_chk', sql`${t.provider} IN ('google','apple')`),
    index('idx_oauth_user').on(t.userId),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// MAGIC LINKS — single-use email tokens per §5.2.
// ─────────────────────────────────────────────────────────────────────────

export const magicLinks = pgTable(
  'magic_links',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    purpose: text().notNull(),
    ipPrefix: inet('ip_prefix'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('magic_links_purpose_chk', sql`${t.purpose} IN ('signup','signin','email_change')`),
    index('idx_magic_links_email').on(t.email, t.expiresAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// SUPER ADMINS — platform staff. Permissions stored as a text array.
// ─────────────────────────────────────────────────────────────────────────

export const superAdmins = pgTable('super_admins', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  permissions: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─────────────────────────────────────────────────────────────────────────
// TENANT USERS — RBAC membership per §5.4.
// ─────────────────────────────────────────────────────────────────────────

export const tenantUsers = pgTable(
  'tenant_users',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    check(
      'tenant_users_role_chk',
      sql`${t.role} IN ('owner','admin','editor','scanner','finance')`,
    ),
    index('idx_tenant_users_user').on(t.userId),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// SESSIONS — Lucia-compatible. Audience separates the three portals.
// ─────────────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    audience: text().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    ip: inet(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sessions_audience_chk', sql`${t.audience} IN ('super-admin','tenant','attendee')`),
    check(
      'sessions_tenant_consistency_chk',
      sql`(${t.audience} = 'tenant' AND ${t.tenantId} IS NOT NULL) OR (${t.audience} <> 'tenant' AND ${t.tenantId} IS NULL)`,
    ),
    // Composite index supports the "my active sessions" query
    // (WHERE user_id = $1 AND expires_at > now()) and also covers any
    // single-column user_id lookup via the leftmost prefix. Replaces
    // the original idx_sessions_user (dropped in migration 0003).
    // A partial WHERE expires_at > now() is NOT used because now() is
    // STABLE not IMMUTABLE — Postgres rejects it in index predicates.
    index('idx_sessions_user_active').on(t.userId, t.expiresAt),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// TENANT FEE CONFIG — per-tenant fee override (super admin only).
// Default mode: pass_through (CLAUDE.md §14.1, decision 2026-05-16).
// ─────────────────────────────────────────────────────────────────────────

export const tenantFeeConfig = pgTable(
  'tenant_fee_config',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    platformFeeBps: integer('platform_fee_bps').notNull().default(25),
    defaultFeeMode: text('default_fee_mode').notNull().default('pass_through'),
    allowPerEventOverride: boolean('allow_per_event_override').notNull().default(true),
    customArrangementNote: text('custom_arrangement_note'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenant_fee_config_mode_chk', sql`${t.defaultFeeMode} IN ('absorb','pass_through')`),
    check(
      'tenant_fee_config_bps_chk',
      sql`${t.platformFeeBps} >= 0 AND ${t.platformFeeBps} <= 10000`,
    ),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// FEE OVERRIDE LOG — audit trail of every fee change.
// ─────────────────────────────────────────────────────────────────────────

export const feeOverrideLog = pgTable(
  'fee_override_log',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id),
    previousFeeBps: integer('previous_fee_bps').notNull(),
    newFeeBps: integer('new_fee_bps').notNull(),
    previousMode: text('previous_mode').notNull(),
    newMode: text('new_mode').notNull(),
    reason: text().notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_fee_log_tenant').on(t.tenantId, t.createdAt),
    check('fee_override_log_prev_mode_chk', sql`${t.previousMode} IN ('absorb','pass_through')`),
    check('fee_override_log_new_mode_chk', sql`${t.newMode} IN ('absorb','pass_through')`),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// RESERVED HANDLES — global namespace guard.
// ─────────────────────────────────────────────────────────────────────────

export const reservedHandles = pgTable('reserved_handles', {
  handle: citext().primaryKey(),
  reason: text().notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedBy: uuid('added_by').references(() => users.id),
})

// ─────────────────────────────────────────────────────────────────────────
// KYC SUBMISSIONS — Sprint 2 Day 13 Item 7 (CLAUDE.md §9.2 + §13).
//
// Tenant-scoped via RLS (`tenant_id`). One row per submission attempt;
// reviewer fields populated by super-admin actions per §13.1.
//
// Status note (vs. CLAUDE.md §9.2):
//   §9.2 enumerates ('submitted','under_review','approved','rejected').
//   We adopt the §13.1 reality: a submission is created in `submitted`
//   exactly once by POST /tenant/kyc/submissions (Day 14). For Day 13
//   only the upload-url endpoint ships; the submit endpoint lands the
//   row directly in `submitted` once documents + fields are validated.
//   No `draft` state: server doesn't track per-upload state, client
//   uploads to a known prefix and the submit POST atomically materialises
//   the row.
//
// Porichoy deferral (decisions.md 2026-05-17): `nid_verified` is set by
// reviewer action in MVP; `porichoy_verification_id` stays nullable
// (live calls land in a separate PR once credentials arrive).
// ─────────────────────────────────────────────────────────────────────────

export const kycSubmissions = pgTable(
  'kyc_submissions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    submissionType: text('submission_type').notNull(),
    tierRequested: text('tier_requested').notNull(),
    // documents: { nid_front: 's3://.../nid_front.jpg', etin_certificate: '...' }
    documents: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // fields: { nid_number: '...', etin: '...', bank: {...} } — submission-type-shaped
    fields: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text().notNull().default('submitted'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    decisionReason: text('decision_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    nidVerified: boolean('nid_verified').notNull().default(false),
    porichoyVerificationId: text('porichoy_verification_id'),
    bankNameMatch: boolean('bank_name_match').notNull().default(false),
    bfiuScreened: boolean('bfiu_screened').notNull().default(false),
    // Reviewer state added in migration 0007 (Sprint 2 Day 18 Item 13)
    // per Decisions G/H/I in `.claude/memory/decisions.md` 2026-05-19.
    // reviewerChecklist persists per-key check state across review
    // sessions; per-tier required keys are in shared-types as canonical
    // const arrays. reviewerNotes is internal-only free text, never
    // surfaced to tenants.
    reviewerChecklist: jsonb('reviewer_checklist')
      .notNull()
      .default(sql`'{}'::jsonb`),
    reviewerNotes: text('reviewer_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('kyc_submissions_type_chk', sql`${t.submissionType} IN ('individual','organisation')`),
    check(
      'kyc_submissions_status_chk',
      // 'draft' added in migration 0005 for the rejected → draft resubmit
      // lane (Item 9 state machine). First-write still inserts in 'submitted'.
      sql`${t.status} IN ('draft','submitted','under_review','approved','rejected')`,
    ),
    check(
      'kyc_submissions_tier_chk',
      sql`${t.tierRequested} IN ('tier_1','tier_2','tier_3','org_a','org_b','org_c')`,
    ),
    index('idx_kyc_status').on(t.status, t.createdAt),
    index('idx_kyc_tenant').on(t.tenantId, t.createdAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// HANDLE HISTORY — 30-day redirect on handle change.
// ─────────────────────────────────────────────────────────────────────────

export const handleHistory = pgTable(
  'handle_history',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    oldHandle: citext('old_handle').notNull(),
    newHandle: citext('new_handle').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    redirectExpiresAt: timestamp('redirect_expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
  },
  (t) => [
    check(
      'handle_history_exactly_one_owner_chk',
      sql`(${t.userId} IS NOT NULL) <> (${t.tenantId} IS NOT NULL)`,
    ),
    index('idx_handle_history_old').on(t.oldHandle, t.redirectExpiresAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// AUDIT_LOGS — append-only audit trail per §9.10 + §1.3 R8.
//
// First consumer is Sprint 2 Day 14 Item 9 (KYC state machine transitions).
// Future writers: Item 13 reviewer queue, fee-config changes (§14.4),
// payout state transitions (§14.8), legal document material-change
// consent re-prompts (§20.4).
//
// RLS invariant (load-bearing — see migration 0005 header):
//   System-action rows (tenant_id IS NULL) require withSuperAdmin context
//   to write or read. Tenant-context writes always populate tenant_id from
//   app.current_tenant_id; tenant-context reads filter on the same.
//   Tenants cannot cross the tenant_id IS NULL boundary in either direction.
//
// Immutability: no UPDATE policy, no DELETE policy, REVOKE UPDATE/DELETE
// from eventpulse_app. Only eventpulse_admin (BYPASSRLS) can mutate, and
// only via maintenance PRs (retention sweeps for BFIU §15.1).
// ─────────────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb(),
    metadata: jsonb(),
    ip: inet(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'audit_logs_actor_type_chk',
      sql`${t.actorType} IN ('user','tenant_user','super_admin','system','webhook')`,
    ),
    index('idx_audit_tenant').on(t.tenantId, t.createdAt),
    index('idx_audit_entity').on(t.entityType, t.entityId, t.createdAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// LEGAL_DOCUMENTS — Trust Center registry (§9.11 + Decision M.3 2026-05-19).
//
// Platform-global table — no tenant_id. Decision M.3 extends §9.11 with the
// `canonical_url_path` column so URL routing is data-driven: a Server
// Component at /trust/security/disclosure calls
// fetchLegalDocumentByUrlPath('/trust/security/disclosure'). Database slugs
// are flat (`security-disclosure`) and never encode nested paths.
//
// Access pattern (Decision K 2026-05-19): all reads + writes via
// withSuperAdmin() → eventpulse_admin (BYPASSRLS). RLS forced with no
// policies as a defence-in-depth backstop — eventpulse_app has no expected
// access path.
// ─────────────────────────────────────────────────────────────────────────

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text().notNull().unique(),
    canonicalUrlPath: text('canonical_url_path').notNull().unique(),
    category: text().notNull(),
    title: text().notNull(),
    oneLiner: text('one_liner').notNull(),
    currentVersionId: uuid('current_version_id'),
    requiresSignature: boolean('requires_signature').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'legal_documents_category_chk',
      sql`${t.category} IN ('legal_contract','trust_artefact')`,
    ),
    check('legal_documents_canonical_url_path_chk', sql`${t.canonicalUrlPath} LIKE '/%'`),
    index('idx_legal_documents_url').on(t.canonicalUrlPath),
    index('idx_legal_documents_category').on(t.category),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// LEGAL_DOCUMENT_VERSIONS — APPEND-ONLY version history per §9.11.
//
// Second append-only table after audit_logs. Per §4.2.1.1 (v2.3 amendment)
// the migration explicitly REVOKEs UPDATE/DELETE/TRUNCATE from
// eventpulse_app on top of the no-UPDATE/DELETE policy gap; the GRANT
// layer is the load-bearing enforcement.
//
// body_md is the canonical authoring form (markdown). body_html is the
// pre-rendered + sanitized output produced by renderLegalMarkdown() in
// apps/api/src/domain/legal/render.ts (Decision J 2026-05-19). Public
// pages serve body_html directly to avoid re-sanitizing per request.
//
// (document_id, version) is unique so re-publishing the same version
// string for a document errors cleanly at the DB layer.
// ─────────────────────────────────────────────────────────────────────────

export const legalDocumentVersions = pgTable(
  'legal_document_versions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => legalDocuments.id),
    version: text().notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    bodyMd: text('body_md').notNull(),
    bodyHtml: text('body_html').notNull(),
    summaryOfChanges: text('summary_of_changes'),
    materialChange: boolean('material_change').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('legal_document_versions_doc_version_uq').on(t.documentId, t.version),
    index('idx_legal_versions_document').on(t.documentId, t.effectiveAt),
  ],
)

// ─────────────────────────────────────────────────────────────────────────
// EVENTS — Sprint 3 Day 23 Workstream 1 per CLAUDE.md §9.3.
//
// 27 columns: §9.3 spec minus primary_domain_id (deferred to Sprint 7 when
// custom_domains lands per Phase 2 white-label scope; 2026-05-24 Day 23
// pre-flight decision). MVP routing relies on tenant subdomain
// (provisionTenantSubdomain) + path-mode URLs.
//
// Status CHECK enforces value-set membership only; the linear transition
// chain (§2.4) is validated by apps/api/src/domain/event-state-machine.ts
// as a pure function (mirrors fee-calculator.ts purity discipline).
//
// Fee handling defaults to 'pass_through' per §14.1. Service layer
// snapshots the per-event values at event-create from tenant_fee_config.
// fee-calculator (Sprint 3 Day 21) reads the snapshot from the event +
// order, NOT from tenant_fee_config at order time — see decisions.md
// 2026-05-24 "EPS fee is NOT per-tenant configurable" for the rule.
// ─────────────────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: citext().notNull(),
    type: text().notNull(),
    status: text().notNull().default('draft'),
    visibility: text().notNull().default('public'),
    isListedPublicly: boolean('is_listed_publicly').notNull().default(false),
    title: text().notNull(),
    titleBn: text('title_bn'),
    description: text(),
    descriptionBn: text('description_bn'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text().notNull().default('Asia/Dhaka'),
    venue: jsonb().notNull(),
    capacity: integer(),
    bannerImageUrl: text('banner_image_url'),
    ogImageUrl: text('og_image_url'),
    // primary_domain_id intentionally deferred to Sprint 7 (custom_domains
    // is Phase 2 white-label scope) — MVP routing via tenant subdomain +
    // path-mode. 2026-05-24 Day 23 pre-flight decision.
    epsFeeHandling: text('eps_fee_handling').notNull().default('pass_through'),
    platformFeeHandling: text('platform_fee_handling').notNull().default('pass_through'),
    refundPolicy: jsonb('refund_policy')
      .notNull()
      .default(sql`'{"allowed":false}'::jsonb`),
    settings: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'events_status_chk',
      sql`${t.status} IN ('draft','published','on_sale','sold_out','live','completed','archived')`,
    ),
    check('events_visibility_chk', sql`${t.visibility} IN ('public','unlisted','private')`),
    check(
      'events_type_chk',
      sql`${t.type} IN ('concert','alumni','standup','conference','workshop','community','sports','other')`,
    ),
    check('events_eps_fee_handling_chk', sql`${t.epsFeeHandling} IN ('absorb','pass_through')`),
    check(
      'events_platform_fee_handling_chk',
      sql`${t.platformFeeHandling} IN ('absorb','pass_through')`,
    ),
    check('events_capacity_chk', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
    check('events_ends_after_starts_chk', sql`${t.endsAt} >= ${t.startsAt}`),
    unique('events_tenant_slug_uq').on(t.tenantId, t.slug),
    index('idx_events_tenant_status').on(t.tenantId, t.status, t.startsAt),
    // Partial index for /discover + admin upcoming-events widget queries.
    index('idx_events_starts_at_active')
      .on(t.startsAt)
      .where(sql`${t.status} IN ('published','on_sale','live')`),
  ],
)

// ─── ticket_tiers (Sprint 3 Day 25) ─────────────────────────────────────
//
// Per CLAUDE.md §9.3 + migration 0012. Deferred from Day 23 events
// workstream per decisions.md 2026-05-24 "Scope = events table ONLY;
// ticket_tiers is Day 25". Each tier has its own price + capacity +
// sales window; the order pipeline (Day 26-28) reads tiers via the
// fee-calculator at order time. capacity locking via SELECT...FOR
// UPDATE on the sold counter lands Day 29.
//
// is_complimentary distinguishes revenue-bearing free tiers (price 0,
// is_complimentary false — e.g. "RSVP for our free meetup") from comp
// passes (price 0, is_complimentary true — e.g. sponsor/organiser
// invites). The CHECK constraint enforces price_paisa=0 when
// is_complimentary=true.
// ─────────────────────────────────────────────────────────────────────────

export const ticketTiers = pgTable(
  'ticket_tiers',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    pricePaisa: bigint('price_paisa', { mode: 'bigint' }).notNull(),
    capacity: integer().notNull(),
    sold: integer().notNull().default(0),
    salesStartAt: timestamp('sales_start_at', { withTimezone: true }),
    salesEndAt: timestamp('sales_end_at', { withTimezone: true }),
    minPerOrder: integer('min_per_order').notNull().default(1),
    maxPerOrder: integer('max_per_order').notNull().default(10),
    isComplimentary: boolean('is_complimentary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ticket_tiers_price_chk', sql`${t.pricePaisa} >= 0`),
    check('ticket_tiers_capacity_chk', sql`${t.capacity} > 0`),
    check('ticket_tiers_sold_chk', sql`${t.sold} >= 0`),
    check('ticket_tiers_min_per_order_chk', sql`${t.minPerOrder} >= 1`),
    check('ticket_tiers_max_per_order_chk', sql`${t.maxPerOrder} >= ${t.minPerOrder}`),
    check(
      'ticket_tiers_window_chk',
      sql`${t.salesEndAt} IS NULL OR ${t.salesStartAt} IS NULL OR ${t.salesEndAt} > ${t.salesStartAt}`,
    ),
    check(
      'ticket_tiers_complimentary_price_chk',
      sql`${t.isComplimentary} = false OR ${t.pricePaisa} = 0`,
    ),
    index('idx_tickets_event').on(t.eventId),
  ],
)

// ─── orders + order_items + attendees + order_events + refunds ──────────
// Sprint 3 Day 26 Phase 3 — order pipeline schema per §9.5.
// Migration 0013_orders.sql is the canonical SQL; this is its Drizzle
// mirror. The 4 fee-snapshot extension columns (platformFeeBps,
// epsFeeBps, platformFeeHandling, epsFeeHandling) match the migration
// file header rationale (§14.4 + Decision N audit requirements).
//
// order_events is APPEND-ONLY per §4.2.1.1: the migration REVOKEs
// UPDATE/DELETE/TRUNCATE from eventpulse_app. The Drizzle schema
// cannot express that constraint — it's a GRANT-layer policy. The
// service layer must NEVER attempt to UPDATE/DELETE order_events
// through the tenant role; super-admin bypass is the only legitimate
// mutation path (regulator-required redaction).
// ─────────────────────────────────────────────────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    merchantTransactionId: text('merchant_transaction_id').notNull().unique(),
    buyerName: text('buyer_name').notNull(),
    buyerEmail: citext('buyer_email').notNull(),
    buyerPhone: text('buyer_phone').notNull(),
    buyerNidLast4: text('buyer_nid_last4'),
    // Money snapshot (paisa, §1.3 R2).
    subtotalPaisa: bigint('subtotal_paisa', { mode: 'bigint' }).notNull(),
    epsFeePaisa: bigint('eps_fee_paisa', { mode: 'bigint' }).notNull().default(0n),
    platformFeePaisa: bigint('platform_fee_paisa', { mode: 'bigint' }).notNull(),
    withholdingTaxPaisa: bigint('withholding_tax_paisa', { mode: 'bigint' }).notNull().default(0n),
    totalPaisa: bigint('total_paisa', { mode: 'bigint' }).notNull(),
    netToOrganiserPaisa: bigint('net_to_organiser_paisa', { mode: 'bigint' }).notNull(),
    currency: text().notNull().default('BDT'),
    // Fee-handling + bps snapshots (§14.4 extension).
    platformFeeBps: integer('platform_fee_bps').notNull(),
    epsFeeBps: integer('eps_fee_bps').notNull(),
    platformFeeHandling: text('platform_fee_handling').notNull(),
    epsFeeHandling: text('eps_fee_handling').notNull(),
    status: text().notNull().default('pending'),
    epsTransactionId: text('eps_transaction_id'),
    epsPaymentMethod: text('eps_payment_method'),
    epsVerifiedAt: timestamp('eps_verified_at', { withTimezone: true }),
    ip: inet(),
    userAgent: text('user_agent'),
    utm: jsonb(),
    idempotencyKey: text('idempotency_key'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'orders_status_chk',
      sql`${t.status} IN ('pending','awaiting_payment','paid','completed','cancelled','failed','refund_requested','refunded','disputed','chargeback','reversed')`,
    ),
    check(
      'orders_platform_fee_handling_chk',
      sql`${t.platformFeeHandling} IN ('absorb','pass_through')`,
    ),
    check('orders_eps_fee_handling_chk', sql`${t.epsFeeHandling} IN ('absorb','pass_through')`),
    check('orders_subtotal_nonneg_chk', sql`${t.subtotalPaisa} >= 0`),
    check('orders_eps_fee_nonneg_chk', sql`${t.epsFeePaisa} >= 0`),
    check('orders_platform_fee_nonneg_chk', sql`${t.platformFeePaisa} >= 0`),
    check('orders_withholding_nonneg_chk', sql`${t.withholdingTaxPaisa} >= 0`),
    check('orders_total_nonneg_chk', sql`${t.totalPaisa} >= 0`),
    check('orders_net_to_organiser_nonneg_chk', sql`${t.netToOrganiserPaisa} >= 0`),
    check('orders_platform_fee_bps_nonneg_chk', sql`${t.platformFeeBps} >= 0`),
    check('orders_eps_fee_bps_nonneg_chk', sql`${t.epsFeeBps} >= 0`),
    check('orders_currency_chk', sql`${t.currency} = 'BDT'`),
    index('idx_orders_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_orders_event').on(t.eventId, t.status, t.createdAt),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id')
      .notNull()
      .references(() => ticketTiers.id, { onDelete: 'restrict' }),
    quantity: integer().notNull(),
    unitPricePaisa: bigint('unit_price_paisa', { mode: 'bigint' }).notNull(),
    subtotalPaisa: bigint('subtotal_paisa', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    check('order_items_quantity_pos_chk', sql`${t.quantity} > 0`),
    check('order_items_unit_price_nonneg', sql`${t.unitPricePaisa} >= 0`),
    check('order_items_subtotal_nonneg', sql`${t.subtotalPaisa} >= 0`),
    index('idx_order_items_order').on(t.orderId),
  ],
)

export const attendees = pgTable(
  'attendees',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id')
      .notNull()
      .references(() => ticketTiers.id, { onDelete: 'restrict' }),
    attendeeName: text('attendee_name').notNull(),
    attendeeEmail: citext('attendee_email'),
    attendeePhone: text('attendee_phone'),
    submissionData: jsonb('submission_data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    qrCode: text('qr_code').notNull().unique(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInBy: uuid('checked_in_by').references(() => users.id),
    checkedInGate: text('checked_in_gate'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_attendees_event').on(t.tenantId, t.orderId),
    index('idx_attendees_qr').on(t.qrCode),
  ],
)

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_order_events_order').on(t.orderId, t.createdAt)],
)

export const refunds = pgTable(
  'refunds',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    amountPaisa: bigint('amount_paisa', { mode: 'bigint' }).notNull(),
    reason: text().notNull(),
    initiatedBy: uuid('initiated_by')
      .notNull()
      .references(() => users.id),
    status: text().notNull().default('pending'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('refunds_amount_pos_chk', sql`${t.amountPaisa} > 0`),
    check(
      'refunds_status_chk',
      sql`${t.status} IN ('pending','approved','rejected','processed','failed')`,
    ),
    index('idx_refunds_order').on(t.orderId, t.createdAt),
  ],
)

// ─── email_suppression_list (Day 39 Phase 4) ────────────────────────────
// Global suppression list per SNS bounce/complaint events. The
// outbound-send guard consults this table on every SES SendEmail.
// One row per suppressed email; ON CONFLICT (email) DO UPDATE keeps
// the latest state per address.

export const emailSuppressionList = pgTable(
  'email_suppression_list',
  {
    email: citext().primaryKey(),
    /** sha256(lower(email)) — for log/audit references where raw email shouldn't appear per §1.3 R5. */
    emailHash: text('email_hash').notNull(),
    /**
     * AWS classification:
     *   - 'hard_bounce' / 'complaint' / 'soft_bounce_promoted' = permanent (suppressed_until NULL)
     *   - 'soft_bounce_temporary' = temporary (suppressed_until set to a future ts)
     */
    reason: text().notNull(),
    /** SNS Message id for traceability back to the source notification. */
    sourceMessageId: text('source_message_id'),
    /** NULL for permanent suppressions; future ts for soft-bounce temporal. */
    suppressedUntil: timestamp('suppressed_until', { withTimezone: true }),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'email_suppression_reason_chk',
      sql`${t.reason} IN ('hard_bounce','complaint','soft_bounce_temporary','soft_bounce_promoted')`,
    ),
    index('idx_email_suppression_until').on(t.suppressedUntil),
  ],
)

// ─── consent_records (Day 39 Phase 2) ───────────────────────────────────
//
// Buyer-Terms-Lite v1.0 consent capture per Phase 2 wire-in. The CLAUDE.md
// §9.11 spec is amended for guest-buyer reality:
//
//   - `userId` is nullable (guest buyers have no user_id at checkout).
//   - `orderId` is NEW — guest-checkout anchor; populated by the order-
//     creation tx-seam INSERT.
//   - CHECK requires at least one of (userId, orderId) be set.
//   - §9.11 UNIQUE (user_id, document_id, version_id) dropped — guest
//     consents wouldn't satisfy it; authenticated-user uniqueness story
//     ships later when a `/my` consent surface lands.
//
// Access pattern (mirrors legal_document_versions): all reads + writes
// via withSuperAdmin() under eventpulse_admin BYPASSRLS. RLS enabled +
// FORCED with NO policies — defence-in-depth so non-BYPASSRLS routes
// hit a hard "permission denied" rather than leaking via missing-policy
// silent failures. Future tenant/user-portal read surfaces add policies
// in their own migrations alongside the read code.
//
// NOT append-only: `withdrawnAt` is UPDATE'd to mark consent withdrawal.
// §4.2.1.1 append-only invariant does NOT apply.

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id),
    orderId: uuid('order_id').references(() => orders.id),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => legalDocuments.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => legalDocumentVersions.id),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet(),
    userAgent: text('user_agent'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check('consent_records_anchor_chk', sql`${t.userId} IS NOT NULL OR ${t.orderId} IS NOT NULL`),
    index('idx_consent_user').on(t.userId, t.consentedAt),
    index('idx_consent_order').on(t.orderId),
    index('idx_consent_document_version').on(t.documentId, t.versionId, t.consentedAt),
  ],
)
