-- Sprint 3 Day 23 Workstream 1 — events table per CLAUDE.md §9.3.
--
-- 27 columns: §9.3 spec minus primary_domain_id (deferred to Sprint 7
-- when custom_domains table lands per Phase 2 white-label scope —
-- decisions.md 2026-05-24 "EPS fee is NOT per-tenant configurable" PR
-- pre-flight resolution). MVP routing relies on tenant subdomain
-- (provisionTenantSubdomain, Day 22) + path-mode URLs.
--
-- Status CHECK constraint enforces value-set membership only. The
-- linear transition chain (draft → published → on_sale → sold_out →
-- live → completed → archived per §2.4) is validated by
-- apps/api/src/domain/event-state-machine.ts as a PURE function
-- (mirrors fee-calculator.ts purity pattern). State-machine validation
-- is separate from side effects; downstream sprints (capacity locking,
-- settlement, notifications) hook into the validated TRANSITION RESULT,
-- not into the validation logic.
--
-- type CHECK enforces the 8-value event-type enum per CLAUDE.md §1.2 +
-- §6.1 createEventSchema + §10.2.
--
-- visibility CHECK enforces the 3-value enum per §9.3. is_listed_publicly
-- (Phase 3 /discover opt-in) defaults false per §9.3 — KYC tenants only
-- can flip to true; application layer enforces.
--
-- platform_fee_handling + eps_fee_handling default 'pass_through' per
-- §14.1 ("Both default to pass_through for new tenants"). Per-tenant
-- default lives in tenant_fee_config.default_fee_mode; the per-event
-- snapshot is applied at event-create time by the service layer reading
-- tenant_fee_config and writing here. The snapshot is what the
-- fee-calculator uses at order time — immutable on the order even if
-- the tenant config later changes (per §14.4 non-retroactive rule).
--
-- venue jsonb — shape validated by application zod, NOT DB CHECK. §9.3
-- says venue jsonb NOT NULL; structure is { type, name, address, ... }
-- per §6.1 (loose enough for online events {type:'online', url:'...'}
-- and BD venues {type:'physical', name, division, district, ...}).
--
-- refund_policy jsonb default {"allowed":false} per §9.3 — events
-- default to non-refundable; tenants override via tenant-portal UI
-- per §14.1 + §15.4.
--
-- settings jsonb default {} — open extension point for per-event
-- feature flags (waitlist, age_gate, etc.); no schema enforcement.
--
-- UNIQUE (tenant_id, slug) — same slug can exist across tenants;
-- per-tenant slug is the public URL component.
--
-- created_by → users.id NOT NULL: enforces every event has an actor;
-- distinguishes from system-created events (none exist in MVP).
--
-- deleted_at: soft-delete per §1.3 R7. Application layer filters
-- WHERE deleted_at IS NULL by default; super-admin tooling can hard-
-- delete via withSuperAdmin().
--
-- ends_at >= starts_at CHECK — guards a class of UI bugs where date
-- pickers swap order. Equal allowed for instantaneous events (rare).
--
-- capacity > 0 CHECK (nullable: NULL = unlimited; ticket-tier capacity
-- can still be set per-tier even when event capacity is unlimited).
--
-- Indexes per §9.3:
--   idx_events_tenant_status (tenant_id, status, starts_at) — covers
--     tenant portal's "list my events by status, sorted by date" query
--   idx_events_starts_at_active (starts_at) WHERE status IN (...)  —
--     partial index for public discovery + admin upcoming-events queries
--     (Phase 3 /discover page; §17.4 admin upcoming-events widget)
--
-- RLS: tenant-scoped CRUD per §4.3 template; super-admin via
-- withSuperAdmin(). DELETE policy IS present (distinct from
-- kyc_submissions's no-DELETE pattern) because events are tenant-owned
-- content without regulatory retention floor — tenants use soft-delete
-- (deleted_at) via the service layer; the policy exists so RLS isolation
-- tests covering "wrong tenant cannot delete" are well-formed.
--
-- Carry from Sprint 2 Day 11 Item 5 (gotchas.md): every new migration
-- explicitly re-issues the §4.2.1 GRANT boilerplate for both roles.

BEGIN;

-- ─── table ─────────────────────────────────────────────────────────────

CREATE TABLE events (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug                   citext      NOT NULL,
  type                   text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'draft',
  visibility             text        NOT NULL DEFAULT 'public',
  is_listed_publicly     boolean     NOT NULL DEFAULT false,
  title                  text        NOT NULL,
  title_bn               text,
  description            text,
  description_bn         text,
  starts_at              timestamptz NOT NULL,
  ends_at                timestamptz NOT NULL,
  timezone               text        NOT NULL DEFAULT 'Asia/Dhaka',
  venue                  jsonb       NOT NULL,
  capacity               integer,
  banner_image_url       text,
  og_image_url           text,
  -- primary_domain_id intentionally deferred to Sprint 7 (custom_domains
  -- is Phase 2 white-label scope) — MVP routing via tenant subdomain +
  -- path-mode. 2026-05-24 Day 23 pre-flight decision.
  eps_fee_handling       text        NOT NULL DEFAULT 'pass_through',
  platform_fee_handling  text        NOT NULL DEFAULT 'pass_through',
  refund_policy          jsonb       NOT NULL DEFAULT '{"allowed":false}'::jsonb,
  settings               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  published_at           timestamptz,
  created_by             uuid        NOT NULL REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT events_status_chk
    CHECK (status IN ('draft','published','on_sale','sold_out','live','completed','archived')),
  CONSTRAINT events_visibility_chk
    CHECK (visibility IN ('public','unlisted','private')),
  CONSTRAINT events_type_chk
    CHECK (type IN ('concert','alumni','standup','conference','workshop','community','sports','other')),
  CONSTRAINT events_eps_fee_handling_chk
    CHECK (eps_fee_handling IN ('absorb','pass_through')),
  CONSTRAINT events_platform_fee_handling_chk
    CHECK (platform_fee_handling IN ('absorb','pass_through')),
  CONSTRAINT events_capacity_chk
    CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT events_ends_after_starts_chk
    CHECK (ends_at >= starts_at),
  CONSTRAINT events_tenant_slug_uq
    UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_events_tenant_status
  ON events (tenant_id, status, starts_at);

CREATE INDEX idx_events_starts_at_active
  ON events (starts_at)
  WHERE status IN ('published','on_sale','live');

-- ─── updated_at trigger (mirrors §4.3 + 0001 pattern) ────────────────

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

-- ─── RLS policies (standard tenant-scoped per §4.3) ──────────────────

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE  ROW LEVEL SECURITY;

CREATE POLICY events_tenant_select ON events
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY events_tenant_insert ON events
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY events_tenant_update ON events
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY events_tenant_delete ON events
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── grants ───────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON events TO eventpulse_app, eventpulse_admin;

COMMIT;
