-- Day 39 Phase 2 — consent_records table (Buyer-Terms-Lite v1.0 wire-in).
--
-- Spec at CLAUDE.md §9.11 amended in Phase 2 for guest-buyer reality:
--
--   - `user_id` is NULLABLE (guest buyers at checkout have no user_id;
--     the §9.11 NOT NULL constraint precluded guest-checkout consent).
--   - `order_id` is NEW — the guest-checkout anchor; populated by the
--     order-creation tx-seam INSERT.
--   - CHECK requires at least one of (user_id, order_id) to be set so
--     orphaned consent rows are impossible.
--   - The §9.11 UNIQUE (user_id, document_id, version_id) is dropped —
--     guest consents wouldn't satisfy it (user_id NULL) and the
--     authenticated-user uniqueness story can ship later when a `/my`
--     consent surface lands. Out of v1.0 scope.
--
-- Access pattern (mirrors legal_document_versions per Decision K
-- 2026-05-19): all reads + writes via withSuperAdmin() under the
-- eventpulse_admin BYPASSRLS role. RLS is enabled + FORCED with NO
-- policies — defence-in-depth so non-BYPASSRLS routes hit a hard
-- "permission denied" at the policy layer rather than leaking via
-- a missing-policy silent failure. Future tenant-portal or `/my`
-- read surfaces add policies in their own migrations alongside the
-- read code.
--
-- NOT append-only: `withdrawn_at` is UPDATE'd to mark consent
-- withdrawal. The §4.2.1.1 append-only invariant explicitly does
-- NOT apply here. `eventpulse_admin` retains full mutation grants
-- inherited from ALTER DEFAULT PRIVILEGES (0001).

BEGIN;

CREATE TABLE consent_records (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES users(id),
  order_id      uuid        REFERENCES orders(id),
  tenant_id     uuid        REFERENCES tenants(id),
  document_id   uuid        NOT NULL REFERENCES legal_documents(id),
  version_id    uuid        NOT NULL REFERENCES legal_document_versions(id),
  consented_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text,
  withdrawn_at  timestamptz,

  CONSTRAINT consent_records_anchor_chk
    CHECK (user_id IS NOT NULL OR order_id IS NOT NULL)
);

-- Per-anchor read indexes (partial — most consent rows have only one
-- anchor set, so the partial indexes skip the NULL half).
CREATE INDEX idx_consent_user
  ON consent_records(user_id, consented_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX idx_consent_order
  ON consent_records(order_id)
  WHERE order_id IS NOT NULL;

-- For "how many consents exist for document X version Y" queries
-- (compliance dashboards, audit reports).
CREATE INDEX idx_consent_document_version
  ON consent_records(document_id, version_id, consented_at);

-- RLS — enable + force, NO policies. See migration header for rationale.
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

COMMIT;
