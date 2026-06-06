-- 0021 — widen magic_links.purpose for the password-onboarding overhaul.
--
-- Decision (decisions.md 2026-06-06 "Onboarding → password-only + email
-- verification; magic-link LOGIN removed"): the app moves from magic-link-only
-- to email+password with a verification step + password reset. The magic-link
-- LOGIN method is removed from the UI/API, but the magic_links table remains
-- the single-use, TTL'd, /24-bound TOKEN primitive — now also backing
-- 'email_verify' (confirm address after signup) and 'password_reset'.
--
-- The original CHECK (migration 0001) was inline + unnamed, so Postgres
-- auto-named it (magic_links_purpose_check). Drop it robustly by definition
-- match, then add a well-named constraint covering the new purposes.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'magic_links'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%purpose%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE magic_links DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE magic_links
  ADD CONSTRAINT magic_links_purpose_chk
  CHECK (purpose IN ('signup','signin','email_change','email_verify','password_reset'));
