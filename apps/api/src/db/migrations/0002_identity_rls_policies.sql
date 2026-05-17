-- Sprint 1 Day 5-6 — RLS policies for identity tables (CLAUDE.md §4.3, R11).
--
-- Policies enforce tenant isolation at the database layer. Application
-- code calls `withTenant(tenantId, ...)` which sets the session var
-- `app.current_tenant_id`; every policy below reads that var.
--
-- Tables WITHOUT tenant_id (users, oauth_identities, magic_links,
-- super_admins, sessions, reserved_handles, handle_history) are not
-- tenant-scoped — they use different policies described inline.
--
-- `eventpulse_admin` (BYPASSRLS) is the super-admin escape hatch; ALL
-- super-admin code must run via `withSuperAdmin(...)`.

BEGIN;

-- ─── helper: app.current_tenant_id reader ──────────────────────────────
-- A SECURITY DEFINER function would let us reuse the same expression
-- across policies, but `current_setting('app.current_tenant_id', true)`
-- inline is simpler and matches the §4.2 example.

-- ────────────────────────────────────────────────────────────────────────
-- TENANT-SCOPED TABLES — policy template per §4.3.
-- ────────────────────────────────────────────────────────────────────────

-- tenants: a tenant user can read ONLY their own tenant row.
-- (Super-admin uses withSuperAdmin -> eventpulse_admin BYPASSRLS.)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_self_select ON tenants
  FOR SELECT
  USING (id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenants_self_update ON tenants
  FOR UPDATE
  USING (id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_tenant_id', true)::uuid);

-- INSERT and DELETE on tenants are super-admin only (no tenant policy).
-- BYPASSRLS will allow eventpulse_admin to insert / delete; non-admin
-- attempts will be rejected because no policy permits them.

-- tenant_users: only the tenant whose id is in the session can see / mutate.
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_users_tenant_select ON tenant_users
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_users_tenant_insert ON tenant_users
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_users_tenant_update ON tenant_users
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_users_tenant_delete ON tenant_users
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- tenant_fee_config: tenant can READ its own config; only super-admin writes.
ALTER TABLE tenant_fee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_fee_config FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_fee_config_self_select ON tenant_fee_config
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- INSERT / UPDATE / DELETE on tenant_fee_config: super-admin only (no policy).

-- fee_override_log: tenant can READ its own audit trail; only super-admin writes.
ALTER TABLE fee_override_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_override_log FORCE ROW LEVEL SECURITY;

CREATE POLICY fee_override_log_self_select ON fee_override_log
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────
-- USER-SCOPED TABLES — sessions, magic_links, handle_history.
-- These have no tenant_id; isolation is per user_id and via the
-- application-layer auth check. RLS is still enabled to deny non-admin
-- callers that DON'T set a tenant context (e.g. unauthenticated requests
-- that somehow reach the DB). Non-tenant audiences use withSuperAdmin or
-- a dedicated `withUser(userId, ...)` wrapper (to be added in Day 7-8
-- when sessions/auth code lands).
--
-- For now, sessions, magic_links, handle_history, oauth_identities,
-- super_admins are read/write by the *application* role only — RLS
-- enabled with no permissive policies means BYPASSRLS is the only way
-- in. This is a deliberate tighten: until Day 7-8 builds the auth code,
-- these tables are super-admin-only.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
-- (intentional: no policy. BYPASSRLS only until Day 7-8 wires withUser.)

ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_links FORCE ROW LEVEL SECURITY;
-- (intentional: no policy. BYPASSRLS only until Day 7-8.)

ALTER TABLE oauth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_identities FORCE ROW LEVEL SECURITY;
-- (intentional: no policy. BYPASSRLS only until Day 7-8.)

ALTER TABLE handle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE handle_history FORCE ROW LEVEL SECURITY;
-- (intentional: no policy — reserved-handles middleware uses BYPASSRLS.)

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admins FORCE ROW LEVEL SECURITY;
-- (intentional: no policy — super-admin allowlist, BYPASSRLS only.)

-- ────────────────────────────────────────────────────────────────────────
-- GLOBAL LOOKUP TABLES — users, reserved_handles.
-- users: every authenticated user can read their OWN row (matched at
-- application layer). For now RLS-enabled with no policy means only
-- BYPASSRLS sees it; the auth code in Day 7-8 will add a "self only"
-- policy via a session variable `app.current_user_id`.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- (intentional: no policy until Day 7-8 sets up app.current_user_id.)

ALTER TABLE reserved_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_handles FORCE ROW LEVEL SECURITY;

-- reserved_handles is a public lookup — everyone reads, only super-admin writes.
CREATE POLICY reserved_handles_public_read ON reserved_handles
  FOR SELECT USING (true);

COMMIT;
