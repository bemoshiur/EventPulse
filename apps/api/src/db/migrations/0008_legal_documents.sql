-- Sprint 2 Day 19 Items 14+15 — Trust Center scaffolding.
--
-- Two tables land together because they form one unit of meaning
-- (a legal document + its version history). Both are platform-global
-- — there is no `tenant_id` on either table; legal documents are the
-- platform's contract with its users, not a per-tenant artefact.
--
-- Schema mirrors §9.11 of CLAUDE.md literally, extended with the
-- `canonical_url_path` column on `legal_documents` (Decision M.3,
-- 2026-05-19). The §9.11 DDL is amended in the Sprint 2 closeout
-- playbook bump (v2.4 candidate).
--
-- `legal_document_versions` is the SECOND append-only table after
-- `audit_logs` (migration 0005). Per §4.2.1.1 (codified in the v2.3
-- bump, PR #87), append-only tables require explicit
-- `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` because
-- ALTER DEFAULT PRIVILEGES from 0001 silently over-grants those
-- operations on every new table. Without the REVOKE, the authz
-- contract relies on RLS-policy-absence alone — a "missing UPDATE
-- policy returns no rows affected" silent failure mode that we
-- pay the migration-line cost to upgrade into a hard "permission
-- denied" at the GRANT layer.
--
-- Access pattern (Decision K, 2026-05-19):
--   - All reads and writes from application code use withSuperAdmin()
--     → eventpulse_admin (BYPASSRLS) role.
--   - Public Trust Center pages are Next.js Server Components that
--     call the service-layer directly under this role.
--   - eventpulse_app has no policy and no expected access path.
--     RLS is enabled FORCED with no policies as a defence-in-depth
--     backstop in case future code mistakenly routes a query through
--     the tenant role.

BEGIN;

-- ─── legal_documents ─────────────────────────────────────────────────
--
-- One row per legal/trust document. `slug` is the stable database
-- identifier (flat, never nested — see Decision M.3 for why). The
-- public URL is stored in `canonical_url_path` (e.g. '/privacy',
-- '/trust/security/disclosure'). Routing reads the URL path column;
-- adding a new document = INSERT a row + create the matching Next.js
-- route file at that path.

CREATE TABLE legal_documents (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text        NOT NULL UNIQUE,
  canonical_url_path   text        NOT NULL UNIQUE,
  category             text        NOT NULL,
  title                text        NOT NULL,
  one_liner            text        NOT NULL,
  current_version_id   uuid,
  requires_signature   boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legal_documents_category_chk
    CHECK (category IN ('legal_contract','trust_artefact')),

  CONSTRAINT legal_documents_canonical_url_path_chk
    CHECK (canonical_url_path LIKE '/%')
);

CREATE INDEX idx_legal_documents_url ON legal_documents(canonical_url_path);
CREATE INDEX idx_legal_documents_category ON legal_documents(category);

-- ─── legal_document_versions (APPEND-ONLY) ───────────────────────────
--
-- One row per published version. `(document_id, version)` is unique
-- so re-publishing the same version string for a document errors
-- cleanly. `body_md` is the canonical authoring form; `body_html` is
-- the pre-rendered + sanitized output (per Decision J — rendered
-- server-side at publish via the unified pipeline in
-- apps/api/src/domain/legal/render.ts). Public pages serve `body_html`
-- directly to avoid re-sanitizing per request.

CREATE TABLE legal_document_versions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          uuid        NOT NULL REFERENCES legal_documents(id),
  version              text        NOT NULL,
  effective_at         timestamptz NOT NULL,
  body_md              text        NOT NULL,
  body_html            text        NOT NULL,
  summary_of_changes   text,
  material_change      boolean     NOT NULL DEFAULT false,
  created_by           uuid        REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legal_document_versions_doc_version_uq
    UNIQUE (document_id, version)
);

CREATE INDEX idx_legal_versions_document
  ON legal_document_versions(document_id, effective_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────
--
-- Both tables are platform-global (no tenant_id). RLS is enabled
-- FORCED with NO policies, which means non-BYPASSRLS roles
-- (eventpulse_app, future per-feature roles) cannot SELECT/INSERT/
-- UPDATE/DELETE at all. eventpulse_admin (BYPASSRLS) is the only
-- application role with access; this matches the Decision K contract
-- that all reads + writes go through withSuperAdmin().
--
-- This is a deliberate departure from the §4.3 tenant-policy template
-- — there's no tenant predicate to enforce, and exposing legal
-- documents to eventpulse_app via a `USING (true)` policy would muddy
-- the role contract for no benefit.

ALTER TABLE legal_documents          ENABLE  ROW LEVEL SECURITY;
ALTER TABLE legal_documents          FORCE   ROW LEVEL SECURITY;

ALTER TABLE legal_document_versions  ENABLE  ROW LEVEL SECURITY;
ALTER TABLE legal_document_versions  FORCE   ROW LEVEL SECURITY;

-- ─── grants ───────────────────────────────────────────────────────────
--
-- Carry from §4.2.1 + 0005 pattern: explicit GRANTs per table on top
-- of the ALTER DEFAULT PRIVILEGES that 0001 issued. Re-issuing here
-- makes the per-table authz contract reviewable in one file and
-- survives ownership shifts (manual psql application, dump+restore).
--
-- eventpulse_admin gets the full mutation set on BOTH tables. For
-- legal_documents this includes UPDATE (the publish flow bumps
-- current_version_id). For legal_document_versions, UPDATE/DELETE
-- exist only for retention sweeps under audit-of-the-audit logging
-- per §4.2.1.1 — application code never issues them.
--
-- eventpulse_app gets nothing. The ALTER DEFAULT PRIVILEGES from
-- 0001 would otherwise grant SELECT/INSERT/UPDATE/DELETE; REVOKE
-- removes the over-grant so the GRANT layer enforces "no access for
-- the tenant role" even if a future bug routed a query through the
-- wrong helper. Belt-and-braces alongside the RLS-policy-absence
-- above.

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON legal_documents          TO eventpulse_admin;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON legal_document_versions  TO eventpulse_admin;

REVOKE ALL ON legal_documents          FROM eventpulse_app;
REVOKE ALL ON legal_document_versions  FROM eventpulse_app;

-- Defence-in-depth on the append-only invariant: even if a future
-- migration accidentally re-grants UPDATE/DELETE/TRUNCATE to
-- eventpulse_app on legal_document_versions, the next round-trip
-- through the §4.2.1.1 audit will flag the missing REVOKE. Logging
-- this in the migration's comment block keeps the convention
-- visible to /review.

COMMIT;
