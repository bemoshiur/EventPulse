-- Sprint 2 Day 18 Item 13 — reviewer checklist + reviewer notes columns
-- on kyc_submissions, plus a composite index on audit_logs for the
-- conflict-of-interest query the super admin queue uses on approve.
--
-- Per `.claude/memory/decisions.md` 2026-05-19 "Item 13 super admin KYC
-- review queue — pre-code architecture (Decisions G, H, I)".
--
-- Two column additions + one index, in one migration because they all
-- support the same Item 13 surface and would otherwise ship as three
-- trivial migrations.
--
--   1. reviewer_checklist jsonb — per Decision I, structured tracking
--      of which verifiable items the reviewer has confirmed. Schema
--      (per submission): { "<key>": { checked: bool, checked_at: ts,
--      checked_by: user_id }, ... }. Per-tier required keys live in
--      packages/shared-types/src/kyc-reviewer-schemas.ts as canonical
--      const arrays (single source of truth, consumed by both server
--      enforce-on-approve and frontend approve-button-disabled gate).
--      Default '{}'::jsonb so existing rows from Days 12-17 backfill
--      cleanly without a data-migration step.
--
--   2. reviewer_notes text — free-text observations that don't fit the
--      structured checklist. NOT shown to the tenant; internal review
--      state only. Updates write audit_log rows with truncated diffs
--      per Decision I.
--
--   3. idx_audit_logs_entity_actor composite index on
--      audit_logs(entity_type, entity_id, actor_id) — supports the
--      conflict-of-interest query the super admin approve action runs:
--          SELECT 1 FROM audit_logs
--          WHERE entity_type = 'kyc_submission'
--            AND entity_id   = $1
--            AND actor_type  = 'tenant_user'
--            AND actor_id    = $2  -- the reviewer's user id
--          LIMIT 1
--      Without the index this is a scan of audit_logs (which grows
--      fast). The existing idx_audit_entity (entity_type, entity_id,
--      created_at) does NOT cover actor_id — the planner would scan
--      every audit row for the submission and filter post-fetch. New
--      composite drops to a single index-only lookup.
--
-- Append-only invariant for audit_logs (§4.2.1.1) is unchanged. The
-- new columns on kyc_submissions are mutable per-submission state, NOT
-- append-only — they require UPDATE permission for eventpulse_app
-- which already has it via ALTER DEFAULT PRIVILEGES from 0001. No
-- REVOKE pattern here.
--
-- RLS unchanged: kyc_submissions's existing tenant_isolation_* policies
-- govern the new columns automatically (RLS is row-level, not
-- column-level). The super-admin context uses withSuperAdmin →
-- BYPASSRLS to read any tenant's reviewer state on the queue surface,
-- per Decision G + I cross-cutting consequences.

BEGIN;

ALTER TABLE kyc_submissions
  ADD COLUMN reviewer_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reviewer_notes     text;

CREATE INDEX idx_audit_logs_entity_actor
  ON audit_logs (entity_type, entity_id, actor_id);

COMMIT;
