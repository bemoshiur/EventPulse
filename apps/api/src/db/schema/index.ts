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
    type: text().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('tenants_type_chk', sql`${t.type} IN ('organisation','individual')`),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('kyc_submissions_type_chk', sql`${t.submissionType} IN ('individual','organisation')`),
    check(
      'kyc_submissions_status_chk',
      sql`${t.status} IN ('submitted','under_review','approved','rejected')`,
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
