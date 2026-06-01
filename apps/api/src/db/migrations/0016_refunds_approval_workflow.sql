-- Day 41 Sprint 4 — refunds approval workflow columns.
--
-- Extends the `refunds` table (migration 0013) with the columns needed for
-- the tenant-initiated → super-admin-approved → EPS-dashboard-processed
-- refund flow per CLAUDE.md §26.1 Day 7-8 + §29 #5.
--
-- Current refunds table (0013) has: id, tenant_id, order_id, amount_paisa,
-- reason, initiated_by, status, processed_at, created_at.
--
-- Missing for the approval workflow:
--   - approved_by / approved_at   (super-admin who approved + when)
--   - rejected_by / rejected_at   (super-admin who rejected + when)
--   - processed_by                (super-admin who marked processed after EPS
--                                  dashboard refund)
--   - reason_code                 (categorical reason for downstream analytics
--                                  + audit; existing `reason` stays as the
--                                  free-text field)
--   - super_admin_notes           (free-text reviewer notes captured at
--                                  approve/reject time)
--
-- The existing Phase 2b disputed-manual refunds (PR #232 `markDisputedOrderRefunded`)
-- already populate `reason = 'manual_refund_after_non_bkash_dispute'` in
-- the free-text column. The new categorical `reason_code` column
-- backfills those rows to 'disputed_manual' so analytics + audit
-- queries have a stable categorical filter going forward.
--
-- No new RLS policies needed — the existing tenant-scoped policies
-- (migration 0013) cover the new columns automatically since they
-- attach to row visibility, not column visibility. The new super-admin
-- write paths (approve / reject / mark-processed) all run under
-- withSuperAdmin / BYPASSRLS per established pattern.

BEGIN;

ALTER TABLE refunds
  ADD COLUMN approved_by        uuid REFERENCES users(id),
  ADD COLUMN approved_at        timestamptz,
  ADD COLUMN rejected_by        uuid REFERENCES users(id),
  ADD COLUMN rejected_at        timestamptz,
  ADD COLUMN processed_by       uuid REFERENCES users(id),
  ADD COLUMN reason_code        text NOT NULL DEFAULT 'tenant_requested',
  ADD COLUMN super_admin_notes  text;

-- Categorical reason taxonomy. Free-text `reason` (existing column)
-- carries the human-readable justification; reason_code carries the
-- categorical tag for analytics + cohort queries.
ALTER TABLE refunds
  ADD CONSTRAINT refunds_reason_code_chk
  CHECK (reason_code IN (
    'tenant_requested',                  -- Day 41 default: tenant-portal-initiated request
    'disputed_manual',                   -- Phase 2b: backfill for existing markDisputedOrderRefunded() callers
    'reconciliation_correction',         -- Phase 2+ settlement-side correction
    'other'
  ));

-- Backfill Phase 2b disputed-manual refunds. Identify them by the
-- free-text reason string the PR #232 service writes verbatim. New
-- refunds (Day 41+) get the column default 'tenant_requested'.
UPDATE refunds
SET reason_code = 'disputed_manual'
WHERE reason = 'manual_refund_after_non_bkash_dispute'
   OR reason LIKE 'v1.0 single-method launch: non-bKash method%';

-- Anchor consistency: a refund row is in exactly one terminal state
-- on its lifecycle (approved | rejected | processed). The status enum
-- already gates this at the row level via the existing CHECK
-- (status IN ('pending','approved','rejected','processed','failed')).
-- We add a defensive cross-column check: only one of (approved_at,
-- rejected_at) can be NOT NULL — a refund cannot be both approved
-- and rejected.
ALTER TABLE refunds
  ADD CONSTRAINT refunds_approve_reject_exclusive_chk
  CHECK (
    NOT (approved_at IS NOT NULL AND rejected_at IS NOT NULL)
  );

-- Helpful indexes for the super-admin queue + per-status counts.
CREATE INDEX idx_refunds_status_created ON refunds(status, created_at);
CREATE INDEX idx_refunds_tenant_status  ON refunds(tenant_id, status);

COMMIT;
