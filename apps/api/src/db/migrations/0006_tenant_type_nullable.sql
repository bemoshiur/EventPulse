-- Sprint 2 Day 15 Item 11 — relax tenants.type from NOT NULL to NULL-able.
--
-- The post-login Account-Type modal (Item 11) gates the tenant portal on
-- a real type choice. Until the user picks Individual or Organisation,
-- tenants.type is NULL and `requireTenantType` middleware returns 409 on
-- every tenant-scoped route except the setter (`POST /tenant/account-type`)
-- and the read endpoint (`GET /tenant/me` — needed for the modal to detect
-- the null state).
--
-- Two changes bundled because they are inseparable:
--   1. ALTER COLUMN type DROP NOT NULL — column becomes nullable.
--   2. DROP + re-ADD tenants_type_chk — Postgres CHECK constraints reject
--      NULL when the expression evaluates to UNKNOWN (`NULL IN (...)` is
--      always UNKNOWN, never TRUE). Without the rewrite, the existing
--      `CHECK (type IN ('organisation','individual'))` would block every
--      INSERT/UPDATE that left type unset, defeating the relaxation.
--      The rewritten check is `(type IS NULL OR type IN (...))` which
--      accepts NULL explicitly while keeping the two-value allowlist
--      for non-null writes.
--
-- Backwards compatibility: existing tenants (created during Sprint 1 +
-- Sprint 2 Days 12-14 test fixtures) all have non-null type values. The
-- relaxation does not change their behaviour; new tenants created after
-- this migration that omit `type` simply land with NULL, triggering the
-- Item 11 modal on first login.
--
-- Set-once enforcement: NULL → 'individual' or NULL → 'organisation' is
-- legal; subsequent changes (e.g. 'individual' → 'organisation') are
-- blocked at the application layer by `POST /tenant/account-type` with
-- a 409 TENANT_TYPE_ALREADY_SET response. See decisions.md 2026-05-18
-- "Tenant account_type is set-once for MVP — change requires support
-- intervention" for the full rationale.
--
-- CLAUDE.md §9.1 still documents `type text NOT NULL`; this is queued
-- for the Day 18 AM v2.3 playbook bump PR alongside §17/§13.0/§13.3/§4.2.1
-- amendments (per handoff.md scheduled mid-sprint PR slots).
--
-- Grants + RLS unchanged. The §4.2.1 boilerplate from earlier migrations
-- already covers the tenants table for both eventpulse_app and
-- eventpulse_admin; the column-nullability change does not affect either
-- the policy expressions or the GRANT level.

BEGIN;

ALTER TABLE tenants ALTER COLUMN type DROP NOT NULL;

ALTER TABLE tenants DROP CONSTRAINT tenants_type_chk;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_type_chk
  CHECK (type IS NULL OR type IN ('organisation','individual'));

COMMIT;
