-- 0023 — add 'ticket_access' to magic_links.purpose.
--
-- "My tickets" buyer self-service (QA P1-1/P1-4): a guest buyer enters their
-- email, we email a single-use link, and clicking it lists their orders +
-- tickets (QR + PDF re-download). Reuses the magic_links token primitive with a
-- dedicated purpose so the consume path can't be cross-used with auth tokens.

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
  CHECK (purpose IN ('signup','signin','email_change','email_verify','password_reset','ticket_access'));
