-- Sprint 3 Day 22 — add tenants.preferred_locale column per Decision O.2.
--
-- Why a new column instead of reusing users.locale:
--
-- Tenant-organisation communications locale is a tenant-level decision, not
-- an owner-individual decision. Using `users.locale` via `tenants.owner_user_id`
-- as a proxy creates wrong-by-design coupling that surfaces as user-facing
-- bugs at scale:
--   - Owner changes their UI locale → all org notifications flip locale silently
--   - Personal-tenant owner whose UI locale is 'en' (expat) is the wrong source
--     for org's customer-facing comms
--   - Multi-owner tenant (Sprint 6 RBAC scope) has no canonical owner to read from
--
-- Default 'bn' per §1.3 R12 + §16.2 + BD market reality (most tenants will
-- prefer Bangla notifications). The two-value CHECK pins the enum at the DB
-- layer so a future "let's add Hindi/Urdu" decision lands as a deliberate
-- migration, not a stringly-typed surprise.
--
-- Notification helper (Workstream 1 PR) consumes this column for tenant-
-- targeted templates (kyc_submitted, kyc_approved, kyc_rejected). User-
-- targeted templates (magic_link, oauth_account_linked) read from users.locale
-- instead. Helper signature uses a discriminated union (`{tenantId} | {userId}`)
-- so callers cannot confuse the two.
--
-- Pre-migration check: SELECT COUNT(*) FROM tenants on staging returned 0
-- (Sprint 3 Day 22 SSM verification). No backfill needed; the default 'bn'
-- applies to all future inserts. If a future environment has pre-existing
-- tenants when this migration runs, the DEFAULT 'bn' applies on
-- ADD COLUMN backfill (Postgres rewrites every row to set the default for
-- the new column), which is the intended behaviour — existing tenants
-- become 'bn' unless explicitly overridden after the migration.
--
-- CLAUDE.md §9.1 still documents the tenants DDL without preferred_locale;
-- the §9.1 amendment is queued as a v2.4 playbook bump candidate per
-- progress.md cross-sprint carries.
--
-- Grants + RLS unchanged. The §4.2.1 boilerplate from earlier migrations
-- already covers the tenants table for both eventpulse_app and
-- eventpulse_admin; an added column does not affect either the policy
-- expressions or the GRANT level.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'bn';

ALTER TABLE tenants
  ADD CONSTRAINT tenants_preferred_locale_chk
  CHECK (preferred_locale IN ('en','bn'));

COMMIT;
