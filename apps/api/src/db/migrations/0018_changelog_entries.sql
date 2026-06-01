-- Day 42 Sprint 4 §26.1 Day 9 marketing pages part 3 — changelog_entries.
--
-- Implements §9.11 changelog_entries schema verbatim. Backs the public
-- GET /api/v1/public/changelog endpoints + the tenant-facing
-- /dashboard/whats-new "what's new" widget.
--
-- The table is platform-wide (no tenant_id). RLS is NOT enabled;
-- access pattern:
--
--   - READ (public): super-admin authoring path publishes entries with
--                    a published_at timestamp. Public endpoints
--                    filter WHERE published_at IS NOT NULL + audience
--                    contains 'public'.
--   - READ (tenant): same filter but with audience contains 'tenant'.
--   - WRITE: super-admin only via withSuperAdmin (no write endpoint
--            in this PR; admin authoring UI lands in a follow-up).
--
-- This PR seeds v1.0 launch entries (Sprint 1 through Sprint 4 highlights)
-- in a separate seed step (apps/api/src/db/seeds/changelog-v1.ts);
-- the migration is schema-only.

BEGIN;

CREATE TABLE IF NOT EXISTS changelog_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  version      text NOT NULL,
  title        text NOT NULL,
  body_md      text NOT NULL,
  body_html    text NOT NULL,
  category     text NOT NULL CHECK (category IN (
    'feature','improvement','fix','breaking','security','deprecation'
  )),
  audience     text[] NOT NULL DEFAULT ARRAY['tenant','public']::text[],
  published_at timestamptz,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_changelog_published
  ON changelog_entries(published_at DESC);

CREATE INDEX idx_changelog_version
  ON changelog_entries(version);

GRANT SELECT ON changelog_entries TO eventpulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON changelog_entries TO eventpulse_admin;

COMMIT;
