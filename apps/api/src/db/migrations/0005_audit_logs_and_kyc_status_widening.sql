-- Sprint 2 Day 14 Item 9 — audit_logs table + kyc_submissions.status widening.
--
-- Two changes bundled because:
--   1. audit_logs (§9.10) is project-wide infra that Item 9 is the first
--      consumer of. Items 5/7+8 didn't ship it because they had no
--      auditable state transitions. Now Item 9's submit endpoint writes
--      one audit row per KYC state transition; future features (Item 13
--      reviewer queue, eventually fee changes per §14.4, payouts per
--      §14.8) write to the same table.
--   2. kyc_submissions.status CHECK gets 'draft' added so the
--      rejected → draft resubmit lane from Item 9's state machine spec
--      is legal at the database layer. First-write of a submission
--      still inserts directly in 'submitted' (the de-facto-draft phase
--      is the Day 13 upload-url step, which has no DB row). 'draft'
--      only exists in the enum so a rejected row can revert for
--      resubmission. §9.2/§13.3 of CLAUDE.md still document the 4-state
--      set; v2.3 closeout bump amends them to document the resubmit
--      lane (queued in progress.md closeout candidates).
--
-- Carry from Sprint 2 Day 11 Item 5 (gotchas.md): every new migration
-- explicitly re-issues the §4.2.1 GRANT boilerplate for the new table
-- specifically. ALTER DEFAULT PRIVILEGES from 0001 covers future tables
-- created by the same CURRENT_USER, but explicit per-migration GRANT
-- survives ownership shifts (manual psql application, dump+restore,
-- owner reassignment) and makes the per-table authz contract
-- reviewable in one file.

BEGIN;

-- ─── kyc_submissions.status: add 'draft' to the CHECK enum ───────────

ALTER TABLE kyc_submissions
  DROP CONSTRAINT kyc_submissions_status_chk;

ALTER TABLE kyc_submissions
  ADD CONSTRAINT kyc_submissions_status_chk
  CHECK (status IN ('draft','submitted','under_review','approved','rejected'));

-- ─── audit_logs table ─────────────────────────────────────────────────
--
-- Schema mirrors §9.10 literally. Nullable tenant_id is reserved for
-- future system-action audit writes (cron jobs, scheduled tasks,
-- platform-level admin actions). All Item 9 writes are tenant-scoped
-- (a tenant submitting their own KYC) so tenant_id is always
-- populated under the current code paths.
--
-- RLS invariant (load-bearing — read before adding any audit writer):
--   System-action audit rows (tenant_id IS NULL) can only be written
--   under withSuperAdmin / BYPASSRLS context. Tenant-context writes
--   always populate tenant_id from app.current_tenant_id. Reading
--   system-action rows similarly requires withSuperAdmin. Tenants
--   cannot read or write across the tenant_id IS NULL boundary in
--   either direction.

CREATE TABLE audit_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  actor_type   text        NOT NULL,
  actor_id     uuid,
  action       text        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    uuid,
  diff         jsonb,
  metadata     jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_actor_type_chk
    CHECK (actor_type IN ('user','tenant_user','super_admin','system','webhook'))
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at);

-- ─── RLS policies ──────────────────────────────────────────────────────
--
-- Tenants see their own audit rows only. System-action rows
-- (tenant_id IS NULL) are invisible to tenants by design — they exist
-- for platform-level auditing visible only via withSuperAdmin.

ALTER TABLE audit_logs ENABLE  ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE   ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant_select ON audit_logs
  FOR SELECT USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

CREATE POLICY audit_logs_tenant_insert ON audit_logs
  FOR INSERT WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- No UPDATE policy. No DELETE policy. audit_logs is APPEND-ONLY by
-- design (§1.3 R8: "Audit everything that changes state"). The authz
-- contract relies on three layers:
--   1. RLS FORCED + no UPDATE/DELETE policies → eventpulse_app cannot
--      mutate rows even though the GRANT (via ALTER DEFAULT PRIVILEGES
--      from 0001) includes UPDATE/DELETE. RLS denies before the grant
--      check matters.
--   2. eventpulse_admin BYPASSRLS retains the ability to mutate, used
--      only for retention sweeps (BFIU §15.1, 5-year window) via a
--      maintenance PR.
--   3. Application code MUST NOT issue UPDATE/DELETE against audit_logs
--      from any path except a maintenance migration. Convention,
--      enforced by /review.

-- ─── grants ────────────────────────────────────────────────────────────
--
-- Re-issue §4.2.1 grants for the new table specifically. eventpulse_app
-- gets SELECT + INSERT only at the GRANT level too (belt-and-braces
-- alongside the RLS policy absence). eventpulse_admin keeps the full
-- mutation set for retention sweeps.

GRANT SELECT, INSERT ON audit_logs TO eventpulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON audit_logs TO eventpulse_admin;

-- ALTER DEFAULT PRIVILEGES from 0001 would otherwise grant UPDATE +
-- DELETE to eventpulse_app on this new table; REVOKE the over-grant
-- explicitly so the authz contract reads consistently with the GRANT
-- block above and survives any future re-creation under different
-- ownership.

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM eventpulse_app;

COMMIT;
