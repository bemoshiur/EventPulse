-- Sprint 2 Day 13 Item 7 — kyc_submissions table + RLS policies + grants.
--
-- One row per KYC submission attempt per CLAUDE.md §9.2 + §13.1. Tenant-
-- scoped via RLS (`tenant_id`). Reviewer fields populated by super-admin
-- actions (`withSuperAdmin` → eventpulse_admin BYPASSRLS).
--
-- Status enum follows §9.2 literally — `submitted` is the entry state
-- (the submit endpoint atomically creates the row once docs + fields
-- pass validation; no draft state at the database layer).
--
-- Porichoy deferral (`.claude/memory/decisions.md` 2026-05-17): MVP sets
-- `nid_verified` via reviewer action; `porichoy_verification_id` stays
-- nullable until the live integration lands in a separate PR.
--
-- Carry from Sprint 2 Day 11 Item 5 (gotchas.md): every new migration
-- explicitly re-issues the §4.2.1 GRANT boilerplate for both roles.
-- ALTER DEFAULT PRIVILEGES from 0001 covers future tables created by
-- the same CURRENT_USER, but per-migration explicit GRANT survives
-- ownership shifts (e.g. a manual psql application would not inherit
-- ALTER DEFAULT PRIVILEGES from another role's session).

BEGIN;

-- ─── table ─────────────────────────────────────────────────────────────

CREATE TABLE kyc_submissions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_type             text        NOT NULL,
  tier_requested              text        NOT NULL,
  documents                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  fields                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status                      text        NOT NULL DEFAULT 'submitted',
  reviewer_id                 uuid        REFERENCES users(id),
  decision_reason             text,
  decided_at                  timestamptz,
  nid_verified                boolean     NOT NULL DEFAULT false,
  porichoy_verification_id    text,
  bank_name_match             boolean     NOT NULL DEFAULT false,
  bfiu_screened               boolean     NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kyc_submissions_type_chk
    CHECK (submission_type IN ('individual','organisation')),
  CONSTRAINT kyc_submissions_status_chk
    CHECK (status IN ('submitted','under_review','approved','rejected')),
  CONSTRAINT kyc_submissions_tier_chk
    CHECK (tier_requested IN ('tier_1','tier_2','tier_3','org_a','org_b','org_c'))
);

CREATE INDEX idx_kyc_status ON kyc_submissions(status, created_at);
CREATE INDEX idx_kyc_tenant ON kyc_submissions(tenant_id, created_at);

-- ─── updated_at trigger (mirrors the pattern in 0001) ─────────────────

CREATE TRIGGER trg_kyc_submissions_updated_at
  BEFORE UPDATE ON kyc_submissions
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

-- ─── RLS policies ──────────────────────────────────────────────────────
--
-- Standard tenant-scoped policy template per CLAUDE.md §4.3 + §4.4.
--
-- Super-admin operations (reviewer approve/reject) go through
-- `withSuperAdmin` (BYPASSRLS); no admin-specific policy needed here.
-- Per §4.2.1, eventpulse_admin still requires explicit GRANTs (BYPASSRLS
-- only skips policies, not the underlying authz check).

ALTER TABLE kyc_submissions ENABLE  ROW LEVEL SECURITY;
ALTER TABLE kyc_submissions FORCE   ROW LEVEL SECURITY;

CREATE POLICY kyc_submissions_tenant_select ON kyc_submissions
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY kyc_submissions_tenant_insert ON kyc_submissions
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY kyc_submissions_tenant_update ON kyc_submissions
  FOR UPDATE
  USING       (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- No DELETE policy — KYC submissions are not deletable by tenants per
-- BFIU §15.1 (5-year retention). Super-admin can hard-delete via
-- withSuperAdmin if compelled to (e.g. GDPR right-to-be-forgotten
-- post-retention), audit-logged.

-- ─── grants ────────────────────────────────────────────────────────────
--
-- Re-issue §4.2.1 grants for the new table specifically. `ALTER DEFAULT
-- PRIVILEGES` from migration 0001 covers tables created by the same
-- CURRENT_USER going forward, but explicit per-migration grants survive
-- ownership shifts (manual psql application, dump+restore, owner
-- reassignment) and make the per-table authz contract reviewable in
-- one file alongside the policies.

GRANT SELECT, INSERT, UPDATE, REFERENCES, TRIGGER
  ON kyc_submissions TO eventpulse_app, eventpulse_admin;
-- Deliberately NO DELETE grant — BFIU 5-year retention. Super-admin
-- hard-deletes via DROP-then-rewrite require a separate maintenance PR.

COMMIT;
