-- Day 42 Sprint 4 §26.1 Day 9 marketing pages part 2 — contact_submissions.
--
-- Implements §9.11 contact_submissions schema verbatim. Backs the public
-- POST /api/v1/public/contact endpoint (rate-limited at the app layer).
--
-- The table is platform-wide (no tenant_id) — anyone on the open
-- internet can submit a contact form. RLS is NOT enabled; access is
-- gated entirely at the application layer:
--
--   - INSERT path: public POST endpoint, rate-limited 3 submissions/
--                  hour/IP per CLAUDE.md §22.1 + honeypot field at
--                  the app layer.
--   - READ path:   super-admin only via withSuperAdmin / BYPASSRLS
--                  (no read endpoint exposed in this PR; admin UI
--                  follows in a later PR per the build-track-owns-
--                  drafts pattern).
--
-- The `topic` field maps to the routing the §22.1 spec describes —
-- sales / support / legal / partnership / press / security / other.
-- The application layer routes by topic to the appropriate inbox.

BEGIN;

CREATE TABLE IF NOT EXISTS contact_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        citext NOT NULL,
  phone        text,
  organisation text,
  subject      text NOT NULL,
  message      text NOT NULL,
  topic        text CHECK (topic IN (
    'sales','support','legal','partnership','press','security','other'
  )),
  ip           inet,
  user_agent   text,
  status       text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','triaged','responded','closed','spam')),
  assigned_to  uuid REFERENCES users(id),
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_submissions_status_created
  ON contact_submissions(status, created_at DESC);

CREATE INDEX idx_contact_submissions_topic_created
  ON contact_submissions(topic, created_at DESC);

-- Grant patterns per §4.2.1. eventpulse_app inserts; eventpulse_admin
-- has full grants for the super-admin queue (when wired in a follow-up
-- PR). No RLS — platform-wide table; access is application-layer-only.
GRANT SELECT, INSERT ON contact_submissions TO eventpulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_submissions TO eventpulse_admin;

COMMIT;
