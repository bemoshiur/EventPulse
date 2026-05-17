-- Sprint 2 Day 11 Item 3 — user-scoped RLS policies (CLAUDE.md §4.3 + §5.3).
--
-- Migration 0002 enabled RLS on every identity table and added tenant-scoped
-- policies for tenant-isolated data. It deliberately left five tables with
-- RLS ENABLED but NO permissive policies (BYPASSRLS-only) pending Day 7-8 /
-- Day 11 user-scoped work:
--
--   users                — self-read needed for /my/profile + auth middleware
--   sessions             — user lists own active sessions ("sessions on other devices")
--   oauth_identities     — user lists own linked OAuth accounts
--   magic_links          — operational table; stays BYPASSRLS-only (see below)
--   handle_history       — audit table; stays BYPASSRLS-only (see below)
--
-- This migration adds SELECT policies for the first three, keyed on a new
-- session variable `app.current_user_id` set by the `withUser(userId, ...)`
-- client helper (apps/api/src/db/client.ts).
--
-- Per `.claude/memory/decisions.md` "Sprint 2 plan approved with 5 amendments"
-- (2026-05-17), amendment 2 — per-table specificity:
--
--   * `sessions` and `oauth_identities` get user-scoped read for the
--     UX surfaces those tables exist to power ("active sessions" +
--     "linked accounts" in settings).
--   * `magic_links` and `handle_history` stay BYPASSRLS-only. They are
--     operational + audit tables, not user-facing surfaces:
--       - magic_links: tokens are consumed exactly once by the magic-link
--         consume endpoint (which already runs as withSuperAdmin); exposing
--         them via RLS would create a foot-gun (e.g. listing your own
--         unconsumed magic links is a phishable surface).
--       - handle_history: append-only audit trail consumed only by the
--         handle-redirect middleware. Users don't read it; super-admin
--         + the middleware read it via BYPASSRLS.
--
-- Per the playbook, INSERT/UPDATE/DELETE for user-scoped tables stay
-- super-admin-only for now (server-side auth flows write them).
-- Settings-surface mutations (edit profile, unlink Google, revoke a
-- session) will add UPDATE/DELETE policies in follow-up migrations when
-- those UI surfaces ship. YAGNI applies to RLS policies the same way it
-- applies to code.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- users.users_self_select
--
-- Authenticated user reads only their own row. Auth middleware reads
-- the user row via withUser() on every authenticated request, so this
-- policy is in the hot path.
-- ────────────────────────────────────────────────────────────────────────

CREATE POLICY users_self_select ON users
  FOR SELECT
  USING (id = current_setting('app.current_user_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────
-- sessions.sessions_self_select
--
-- User lists their own active sessions. Used by /my/settings/sessions
-- ("sessions on other devices" UX) when that ships in Phase 2.
-- ────────────────────────────────────────────────────────────────────────

CREATE POLICY sessions_self_select ON sessions
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────
-- oauth_identities.oauth_identities_self_select
--
-- User lists their own linked OAuth accounts. Used by
-- /my/settings/security ("linked accounts" UX) when that ships in Phase 2.
-- ────────────────────────────────────────────────────────────────────────

CREATE POLICY oauth_identities_self_select ON oauth_identities
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────
-- magic_links and handle_history: NO new policies (BYPASSRLS-only).
-- See header comment for rationale. This is a deliberate non-action;
-- documenting it inline so a future "why is there no policy here?"
-- has an answer in `git blame` and not just in the migration header.
-- ────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────
-- INDEX: sessions(user_id, expires_at) — supports the "my active sessions"
-- query (WHERE user_id = $1 AND expires_at > now()) and supersedes the
-- existing idx_sessions_user (single-column user_id) because (user_id)
-- queries can use the leftmost prefix of (user_id, expires_at).
--
-- Per Moshiur's micro-amendment at Item 3 approval: the original proposal
-- was a partial index `WHERE expires_at > now()`. That syntax is REJECTED
-- by Postgres because index predicates require IMMUTABLE functions and
-- now() is STABLE (it can change across transactions). Concretely:
--
--   ERROR:  functions in index predicate must be marked IMMUTABLE
--
-- The non-partial composite index ships the same query plan benefit and
-- costs only the storage of expired rows that will be removed by the
-- session-cleanup job anyway (~30 days TTL on JWT-refresh; sessions
-- table grows on the order of users × devices).
--
-- The existing idx_sessions_expires (single-column expires_at) stays —
-- the expiration-sweep cron will use it.
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_sessions_user;
CREATE INDEX idx_sessions_user_active ON sessions(user_id, expires_at);

COMMIT;
