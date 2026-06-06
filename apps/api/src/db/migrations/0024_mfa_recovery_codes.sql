-- 0024 — MFA recovery codes (QA P2). `users.mfa_enabled` + `users.mfa_secret`
-- already exist (§9.1); this adds the single-use recovery codes (SHA-256
-- hashes only — the plaintext is shown to the user once at enrollment and never
-- stored). A used code is removed from the array.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[] NOT NULL DEFAULT '{}'::text[];
