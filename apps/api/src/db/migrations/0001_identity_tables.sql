-- Sprint 1 Day 5-6 — identity tables (CLAUDE.md §9.1 + §9.12 + §9.14)
-- v2.1 schema: handles share a global namespace with tenant slugs; personal
-- tenants auto-provision on first event publish; reserved-handles guard
-- impersonation. RLS policies live in 0002_*.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── Roles ────────────────────────────────────────────────────────────
-- eventpulse_app:    NOLOGIN, subject to RLS. withTenant() SETs to this.
-- eventpulse_admin:  NOLOGIN, BYPASSRLS. withSuperAdmin() SETs to this.
--
-- Why both: in CI the connection user (POSTGRES_USER from the postgres
-- image) is a SUPERUSER. Superusers always bypass RLS regardless of
-- FORCE ROW LEVEL SECURITY. The only way RLS actually engages is to
-- SET LOCAL ROLE to a non-superuser role. We always do that at the
-- start of every request -- see apps/api/src/db/client.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eventpulse_app') THEN
    CREATE ROLE eventpulse_app WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eventpulse_admin') THEN
    CREATE ROLE eventpulse_admin WITH NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT eventpulse_app TO CURRENT_USER;
GRANT eventpulse_admin TO CURRENT_USER;

-- ─── users ─────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                 uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext     NOT NULL UNIQUE,
  phone              text,
  full_name          text       NOT NULL,
  handle             citext     UNIQUE,
  handle_chosen_at   timestamptz,
  password_hash      text,
  mfa_enabled        boolean    NOT NULL DEFAULT false,
  mfa_secret         text,
  email_verified_at  timestamptz,
  phone_verified_at  timestamptz,
  avatar_url         text,
  locale             text       NOT NULL DEFAULT 'en',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_handle ON users (handle);

-- ─── tenants ───────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id                  uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text       NOT NULL CHECK (type IN ('organisation','individual')),
  name                text       NOT NULL,
  slug                citext     NOT NULL UNIQUE,
  is_personal         boolean    NOT NULL DEFAULT false,
  owner_user_id       uuid       REFERENCES users(id),
  status              text       NOT NULL DEFAULT 'pending_kyc'
                                 CHECK (status IN ('pending_kyc','active','suspended','terminated')),
  kyc_tier            text       NOT NULL DEFAULT 'tier_1'
                                 CHECK (kyc_tier IN ('tier_1','tier_2','tier_3','org_a','org_b','org_c')),
  kyc_status          text       NOT NULL DEFAULT 'not_submitted'
                                 CHECK (kyc_status IN ('not_submitted','submitted','under_review','approved','rejected')),
  fee_override_bps    integer,
  brand_logo_url      text,
  brand_color_primary text,
  brand_color_accent  text,
  monthly_gmv_paisa   bigint     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT tenants_personal_owner_chk
    CHECK ((is_personal = false) OR (owner_user_id IS NOT NULL))
);

CREATE INDEX idx_tenants_owner_personal ON tenants (owner_user_id) WHERE is_personal = true;
CREATE INDEX idx_tenants_status ON tenants (status);

-- ─── oauth_identities ──────────────────────────────────────────────────
CREATE TABLE oauth_identities (
  id                uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text       NOT NULL CHECK (provider IN ('google','apple')),
  provider_user_id  text       NOT NULL,
  email             citext,
  raw_profile       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_provider_user_uq UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_user ON oauth_identities (user_id);

-- ─── magic_links ───────────────────────────────────────────────────────
CREATE TABLE magic_links (
  token_hash   text       PRIMARY KEY,
  user_id      uuid       REFERENCES users(id) ON DELETE CASCADE,
  email        citext     NOT NULL,
  purpose      text       NOT NULL CHECK (purpose IN ('signup','signin','email_change')),
  ip_prefix    inet,
  consumed_at  timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_links_email ON magic_links (email, expires_at);

-- ─── super_admins ──────────────────────────────────────────────────────
CREATE TABLE super_admins (
  user_id      uuid       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permissions  text[]     NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── tenant_users ──────────────────────────────────────────────────────
CREATE TABLE tenant_users (
  tenant_id    uuid       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text       NOT NULL CHECK (role IN ('owner','admin','editor','scanner','finance')),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX idx_tenant_users_user ON tenant_users (user_id);

-- ─── sessions ──────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id           text       PRIMARY KEY,
  user_id      uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience     text       NOT NULL CHECK (audience IN ('super-admin','tenant','attendee')),
  tenant_id    uuid       REFERENCES tenants(id) ON DELETE CASCADE,
  ip           inet,
  user_agent   text,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_tenant_consistency_chk
    CHECK ((audience = 'tenant' AND tenant_id IS NOT NULL)
        OR (audience <> 'tenant' AND tenant_id IS NULL))
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ─── tenant_fee_config ─────────────────────────────────────────────────
-- Default platform fee: 25 bps (= 0.25%).
-- Default mode: pass_through per decision 2026-05-16 (CLAUDE.md §14.1).
CREATE TABLE tenant_fee_config (
  tenant_id                 uuid       PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  platform_fee_bps          integer    NOT NULL DEFAULT 25
                                       CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000),
  default_fee_mode          text       NOT NULL DEFAULT 'pass_through'
                                       CHECK (default_fee_mode IN ('absorb','pass_through')),
  allow_per_event_override  boolean    NOT NULL DEFAULT true,
  custom_arrangement_note   text,
  effective_from            timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid       REFERENCES users(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ─── fee_override_log ──────────────────────────────────────────────────
CREATE TABLE fee_override_log (
  id                uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  changed_by        uuid       NOT NULL REFERENCES users(id),
  previous_fee_bps  integer    NOT NULL,
  new_fee_bps       integer    NOT NULL,
  previous_mode     text       NOT NULL CHECK (previous_mode IN ('absorb','pass_through')),
  new_mode          text       NOT NULL CHECK (new_mode IN ('absorb','pass_through')),
  reason            text       NOT NULL,
  effective_from    timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fee_log_tenant ON fee_override_log (tenant_id, created_at);

-- ─── reserved_handles ──────────────────────────────────────────────────
CREATE TABLE reserved_handles (
  handle    citext     PRIMARY KEY,
  reason    text       NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  uuid       REFERENCES users(id)
);

-- ─── handle_history ────────────────────────────────────────────────────
CREATE TABLE handle_history (
  id                    uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid       REFERENCES users(id) ON DELETE CASCADE,
  tenant_id             uuid       REFERENCES tenants(id) ON DELETE CASCADE,
  old_handle            citext     NOT NULL,
  new_handle            citext     NOT NULL,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  redirect_expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT handle_history_exactly_one_owner_chk
    CHECK ((user_id IS NOT NULL) <> (tenant_id IS NOT NULL))
);

CREATE INDEX idx_handle_history_old ON handle_history (old_handle, redirect_expires_at);

-- ─── updated_at triggers (set on UPDATE for tables that need it) ───────
CREATE OR REPLACE FUNCTION _eventpulse_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

CREATE TRIGGER trg_tenant_fee_config_updated_at
  BEFORE UPDATE ON tenant_fee_config
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

-- ─── grant table + sequence privileges to BOTH app + admin roles ──────
-- BYPASSRLS only skips RLS *policy* checks; the role still needs
-- ordinary table privileges to read/write. ALTER DEFAULT PRIVILEGES
-- propagates the same grants to any future tables created in this
-- schema by CURRENT_USER (the migration runner).
GRANT USAGE ON SCHEMA public TO eventpulse_app, eventpulse_admin;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO eventpulse_app, eventpulse_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eventpulse_app, eventpulse_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO eventpulse_app, eventpulse_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO eventpulse_app, eventpulse_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eventpulse_app, eventpulse_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO eventpulse_app, eventpulse_admin;

COMMIT;
