-- Day 39 Phase 4 — email suppression list per the AWS SES production-
-- access commitment (decisions.md 2026-05-31 "SES production access
-- GRANTED ... NEW PRE-LAUNCH COMMITMENT").
--
-- Gates MAIL_DRY_RUN=0: before the platform sends real emails to
-- production audiences, the bounce/complaint pipeline MUST exist and
-- consult this table on every outbound send. The pre-launch commitment
-- to AWS Support case 177899559700777 reply explicitly requires this
-- wiring before production sending starts.
--
-- ════════════════════════════════════════════════════════════════════
-- Design (per Day 39 Phase 4 scope):
-- ════════════════════════════════════════════════════════════════════
--
-- One row per suppressed email address. The PK is the lowercase email
-- string itself; this is a global suppression list (not per-tenant) so
-- a bounce/complaint on one tenant's send poisons no other tenant's
-- reputation. AWS classification feeds the reason column:
--
--   - 'hard_bounce'           — permanent failure (e.g. mailbox does
--                                not exist). Permanent suppression
--                                (suppressed_until = NULL).
--   - 'complaint'             — buyer marked the message as spam.
--                                Permanent suppression (NULL).
--   - 'soft_bounce_temporary' — temporary failure (mailbox full,
--                                server timeout). Temporary
--                                suppression with suppressed_until
--                                set to a future timestamp. The
--                                outbound-send guard treats
--                                suppressed_until > now() as
--                                "still suppressed"; once expired,
--                                future sends try again.
--   - 'soft_bounce_promoted'  — soft bounce exceeded retry budget
--                                → promoted to permanent. NULL.
--
-- The ON CONFLICT pattern in the application layer is "INSERT ... ON
-- CONFLICT (email_hash) DO UPDATE" — multiple SNS events for the same
-- address update the latest state (hard bounce overrides soft bounce;
-- a complaint overrides anything). The source_message_id is updated
-- to the latest SNS Message id for traceability.
--
-- ════════════════════════════════════════════════════════════════════
-- Privacy + R5 (no PII in logs):
-- ════════════════════════════════════════════════════════════════════
--
-- The email address IS stored in this table — without it, the
-- outbound-send guard can't do its job. PII in this table is
-- application-layer access-controlled via withSuperAdmin (no tenant
-- can read another tenant's bounce list because there's no per-tenant
-- query path; the guard runs under super-admin BYPASSRLS).
--
-- The optional `email_hash` column carries a sha256(lower(email))
-- digest for log + audit references where the raw email shouldn't
-- appear (per §1.3 R5). Application code logs the hash, not the
-- address.
--
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_suppression_list (
  email           citext      PRIMARY KEY,
  email_hash      text        NOT NULL,
  reason          text        NOT NULL,
  source_message_id text,
  suppressed_until timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_suppression_reason_chk
    CHECK (reason IN ('hard_bounce','complaint','soft_bounce_temporary','soft_bounce_promoted'))
);

-- Index for the "is suppressed RIGHT NOW?" query — the outbound-send
-- guard's hot path. Most rows will have suppressed_until = NULL
-- (permanent suppressions); the partial index keeps the temporal
-- subset small.
CREATE INDEX IF NOT EXISTS idx_email_suppression_until
  ON email_suppression_list (suppressed_until)
  WHERE suppressed_until IS NOT NULL;

-- Grants — standard pattern per §4.2.1. Both roles need full
-- mutations because:
--   - eventpulse_app inserts/updates from the SNS webhook handlers
--     (which run as the application role).
--   - eventpulse_admin reads from the outbound-send guard (which runs
--     as the super-admin BYPASSRLS role because there's no tenant
--     context on a transactional send).
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON email_suppression_list TO eventpulse_app, eventpulse_admin;

-- No RLS — this is a platform-wide table, not tenant-scoped. The
-- access boundary is the application-layer routes (SNS webhook
-- routes are public-but-signature-verified; outbound-send guard runs
-- under withSuperAdmin).
