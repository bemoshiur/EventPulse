-- Sprint 3 Day 26 Phase 3 — order pipeline schema per CLAUDE.md §9.5.
--
-- Five tables land together because they are the ORDER PIPELINE
-- unit: orders + order_items + attendees + order_events + refunds.
-- Each is referenced by Day 26 Phase 4 (order creation), Day 27
-- (callback/webhook), Day 28 (QR/PDF/email), Day 29 (idempotency +
-- capacity lock). Shipping them together prevents the "schema
-- migrated half-way" failure mode where one table lands one day and
-- another lands the next, leaving service layer half-wired.
--
-- ════════════════════════════════════════════════════════════════════
-- IMPORTANT — this is the MONEY TABLE migration. Per the Day 26
-- brief's mandatory STOP-ASK gate, the design below is reviewed by
-- Moshiur BEFORE this file is applied to staging. Once `orders` rows
-- exist, reshaping the schema is a live-data migration.
-- ════════════════════════════════════════════════════════════════════
--
-- Per CLAUDE.md §9.5 verbatim, plus 4 fee-snapshot columns added per
-- §14.4 explicit guidance ("snapshots the bps into the order"). The
-- 4 extension columns are:
--
--   - platform_fee_bps  integer NOT NULL     (snapshot of tenant_fee_config at create time)
--   - eps_fee_bps       integer NOT NULL     (snapshot of order-time input from payment-method)
--   - platform_fee_handling text NOT NULL    (snapshot of events.platform_fee_handling)
--   - eps_fee_handling     text NOT NULL     (snapshot of events.eps_fee_handling)
--
-- These four extensions are LOAD-BEARING per §14.4 + Decision N:
--   - §14.4: "The `fee-calculator` reads `tenant_fee_config` at
--     order-creation time, snapshots the bps into the order, and
--     never re-evaluates afterward. The order is immutable on fee."
--   - Decision N: if calculator output ever drifts from what EPS
--     actually charged, post-mortem requires the snapshotted inputs
--     to be on the order row — otherwise we cannot reconstruct what
--     the calculator was fed.
--   - Without these on the order row, reconciliation against
--     EPS settlements is unauditable: we'd be reconstructing inputs
--     from foreign-key joins that may have CHANGED since order-time.
--
-- ════════════════════════════════════════════════════════════════════
-- STATUS LIFECYCLE — §9.5 verbatim 11-state CHECK enum.
-- ════════════════════════════════════════════════════════════════════
--
-- §9.5 spec: 'pending','awaiting_payment','paid','completed',
-- 'cancelled','failed','refund_requested','refunded','disputed',
-- 'chargeback','reversed'. §11 + §2.5 describe transition semantics;
-- the CHECK enforces value-set membership only (linear transitions
-- validated by a future state-machine module mirroring the
-- event-state-machine.ts purity pattern from migration 0011).
--
-- The Day 26 brief mentions 'expired' as a possible §11 state — this
-- is NOT in §9.5 and is NOT added here. If §11 callback handling
-- requires it Day 27+, that's a focused future migration with its
-- own STOP-ASK and a coordinated state-machine update.
--
-- ════════════════════════════════════════════════════════════════════
-- BUYER-WRITE PATH UNDER RLS — the design crux per Day 26 brief.
-- ════════════════════════════════════════════════════════════════════
--
-- Buyers do NOT have a tenant session. They arrive at a public event
-- page and POST to /api/v1/public/orders. The order belongs to the
-- event's tenant; the buyer is not authenticated.
--
-- Resolution: the public order-creation route uses `withSuperAdmin()`
-- (BYPASSRLS) to INSERT. The route is the trust boundary — it
-- (a) resolves event_id → tenant_id, (b) validates the event is
-- sellable + tier exists, (c) explicitly sets tenant_id on the
-- insert. Subsequent reads/updates by tenant context are RLS-scoped
-- as normal.
--
-- This mirrors the Day 25 public-events read pattern (decisions.md
-- "Public event reads use withSuperAdmin + path-mode URLs"). The
-- common shape: any read/write that genuinely CROSSES tenant scope
-- (because the caller has no tenant context) runs under
-- withSuperAdmin with the route handler as the trust boundary,
-- rather than warping RLS into a synthetic "public-buyer" role.
--
-- The RLS policies below apply to tenant-context reads + updates +
-- deletes. The buyer-write path is the documented exception.
--
-- ════════════════════════════════════════════════════════════════════
-- APPEND-ONLY: order_events ONLY.
-- ════════════════════════════════════════════════════════════════════
--
-- Per §4.2.1.1: `audit_logs` was the first append-only table. The
-- same pattern (REVOKE UPDATE, DELETE, TRUNCATE from eventpulse_app)
-- applies to any future append-only table. `order_events` is
-- append-only by design (event sourcing trail per §2.5: "Each
-- transition writes to order_events").
--
-- `orders`, `order_items`, `attendees`, `refunds` are NOT
-- append-only — status transitions UPDATE these rows in normal
-- operation. They get the standard grants block; no REVOKE.
--
-- ════════════════════════════════════════════════════════════════════
-- Carry from Sprint 2 Day 11 Item 5 (gotchas.md): every new
-- migration explicitly re-issues the §4.2.1 GRANT boilerplate for
-- both roles.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── orders ──────────────────────────────────────────────────────────

CREATE TABLE orders (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id                 uuid        NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  merchant_transaction_id  text        NOT NULL UNIQUE,

  -- Buyer fields per §9.5 (PII — handled per §1.3 R5: never log raw;
  -- application layer hashes for traceability if needed).
  buyer_name               text        NOT NULL,
  buyer_email              citext      NOT NULL,
  buyer_phone              text        NOT NULL,
  buyer_nid_last4          text,

  -- Money snapshot per §9.5 — all paisa (§1.3 R2 "money never lies").
  subtotal_paisa           bigint      NOT NULL,
  eps_fee_paisa            bigint      NOT NULL DEFAULT 0,
  platform_fee_paisa       bigint      NOT NULL,
  withholding_tax_paisa    bigint      NOT NULL DEFAULT 0,
  total_paisa              bigint      NOT NULL,
  net_to_organiser_paisa   bigint      NOT NULL,
  currency                 text        NOT NULL DEFAULT 'BDT',

  -- Fee-handling + bps snapshots per §14.4 (EXTENSION beyond §9.5).
  -- These four are LOAD-BEARING for reconciliation + Decision N.
  -- See the file header for rationale.
  platform_fee_bps         integer     NOT NULL,
  eps_fee_bps              integer     NOT NULL,
  platform_fee_handling    text        NOT NULL,
  eps_fee_handling         text        NOT NULL,

  -- Status — §9.5 11-state enum exactly.
  status                   text        NOT NULL DEFAULT 'pending',

  -- EPS gateway-side references — captured at init + verify time.
  eps_transaction_id       text,
  eps_payment_method       text,
  eps_verified_at          timestamptz,

  -- Request metadata for audit + abuse triage.
  ip                       inet,
  user_agent               text,
  utm                      jsonb,

  -- Idempotency — §9.5 + §1.3 R6. Day 29 middleware reads this column
  -- (partial unique index below). NULL allowed because non-money-moving
  -- paths (admin-manual creation) won't have a buyer-supplied key.
  idempotency_key          text,

  paid_at                  timestamptz,
  cancelled_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_status_chk
    CHECK (status IN (
      'pending','awaiting_payment','paid','completed','cancelled',
      'failed','refund_requested','refunded','disputed','chargeback','reversed'
    )),
  CONSTRAINT orders_platform_fee_handling_chk
    CHECK (platform_fee_handling IN ('absorb','pass_through')),
  CONSTRAINT orders_eps_fee_handling_chk
    CHECK (eps_fee_handling IN ('absorb','pass_through')),
  -- Money sanity — no negative amounts. The fee-calculator enforces
  -- this internally; DB enforcement is defence in depth.
  CONSTRAINT orders_subtotal_nonneg_chk           CHECK (subtotal_paisa >= 0),
  CONSTRAINT orders_eps_fee_nonneg_chk            CHECK (eps_fee_paisa >= 0),
  CONSTRAINT orders_platform_fee_nonneg_chk       CHECK (platform_fee_paisa >= 0),
  CONSTRAINT orders_withholding_nonneg_chk        CHECK (withholding_tax_paisa >= 0),
  CONSTRAINT orders_total_nonneg_chk              CHECK (total_paisa >= 0),
  CONSTRAINT orders_net_to_organiser_nonneg_chk   CHECK (net_to_organiser_paisa >= 0),
  CONSTRAINT orders_platform_fee_bps_nonneg_chk   CHECK (platform_fee_bps >= 0),
  CONSTRAINT orders_eps_fee_bps_nonneg_chk        CHECK (eps_fee_bps >= 0),
  CONSTRAINT orders_currency_chk                  CHECK (currency = 'BDT')
);

CREATE INDEX idx_orders_tenant_status
  ON orders (tenant_id, status, created_at);
CREATE INDEX idx_orders_event
  ON orders (event_id, status, created_at);
CREATE INDEX idx_orders_eps_txn
  ON orders (eps_transaction_id)
  WHERE eps_transaction_id IS NOT NULL;
-- Partial unique idempotency index per (tenant_id, idempotency_key).
-- Day 29 middleware queries against this to detect replays. Distinct
-- tenants can reuse keys (the namespace is per-tenant); NULL allowed
-- so non-buyer-flow inserts don't trip the constraint.
CREATE UNIQUE INDEX idx_orders_idempotency_key
  ON orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION _eventpulse_set_updated_at();

-- ─── order_items ─────────────────────────────────────────────────────

CREATE TABLE order_items (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id            uuid    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- ticket_tier_id is the Day-29 FOR UPDATE lock target. RESTRICT so
  -- archiving a tier that has live order items is blocked at the FK
  -- layer (application layer surfaces a friendly error first; FK is
  -- defence in depth).
  ticket_tier_id      uuid    NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
  quantity            integer NOT NULL,
  unit_price_paisa    bigint  NOT NULL,
  subtotal_paisa      bigint  NOT NULL,

  CONSTRAINT order_items_quantity_pos_chk     CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_nonneg    CHECK (unit_price_paisa >= 0),
  CONSTRAINT order_items_subtotal_nonneg      CHECK (subtotal_paisa >= 0)
);

CREATE INDEX idx_order_items_order
  ON order_items (order_id);

-- ─── attendees ───────────────────────────────────────────────────────

CREATE TABLE attendees (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id            uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id       uuid        NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  ticket_tier_id      uuid        NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
  attendee_name       text        NOT NULL,
  attendee_email      citext,
  attendee_phone      text,
  submission_data     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- qr_code globally UNIQUE: scanner reads a code → row lookup must
  -- be unambiguous across all tenants. Day 28 generates the value.
  qr_code             text        NOT NULL UNIQUE,
  checked_in_at       timestamptz,
  -- checked_in_by → users.id: scanners + tenant staff users.
  checked_in_by       uuid        REFERENCES users(id),
  checked_in_gate     text,
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendees_event
  ON attendees (tenant_id, order_id);
CREATE INDEX idx_attendees_qr
  ON attendees (qr_code);

-- ─── order_events (APPEND-ONLY per §4.2.1.1 pattern) ────────────────

CREATE TABLE order_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id    uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  -- actor_type: 'user' / 'tenant_user' / 'super_admin' / 'system' /
  -- 'webhook' — mirrors audit_logs.actor_type. Application enforces
  -- the enum at the helper layer; no DB CHECK to keep the column
  -- forward-compatible for new actor categories (e.g. 'gateway' if
  -- EPS-side identification ever lands).
  actor_type  text        NOT NULL,
  actor_id    uuid,
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order
  ON order_events (order_id, created_at);

-- ─── refunds ─────────────────────────────────────────────────────────

CREATE TABLE refunds (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      uuid        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_paisa  bigint      NOT NULL,
  reason        text        NOT NULL,
  initiated_by  uuid        NOT NULL REFERENCES users(id),
  status        text        NOT NULL DEFAULT 'pending',
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refunds_amount_pos_chk
    CHECK (amount_paisa > 0),
  CONSTRAINT refunds_status_chk
    CHECK (status IN ('pending','approved','rejected','processed','failed'))
);

CREATE INDEX idx_refunds_order
  ON refunds (order_id, created_at);

-- ─── RLS — standard tenant-scoped per §4.3 template ─────────────────
--
-- All five tables get tenant-scoped SELECT/INSERT/UPDATE/DELETE
-- policies. order_events gets SELECT + INSERT only — the table is
-- append-only at the GRANT layer (UPDATE/DELETE/TRUNCATE revoked
-- from eventpulse_app below). DELETE policy is omitted entirely for
-- order_events; UPDATE/DELETE attempts via eventpulse_app fail at
-- the GRANT layer with "permission denied", which is the load-bearing
-- guarantee per §4.2.1.1.
--
-- Buyer-write path (public order creation) runs under withSuperAdmin
-- (BYPASSRLS); these policies cover tenant-context access only.

ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         FORCE  ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    FORCE  ROW LEVEL SECURITY;
ALTER TABLE attendees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendees      FORCE  ROW LEVEL SECURITY;
ALTER TABLE order_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events   FORCE  ROW LEVEL SECURITY;
ALTER TABLE refunds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds        FORCE  ROW LEVEL SECURITY;

-- orders policies
CREATE POLICY orders_tenant_select ON orders
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY orders_tenant_insert ON orders
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY orders_tenant_update ON orders
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY orders_tenant_delete ON orders
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- order_items policies
CREATE POLICY order_items_tenant_select ON order_items
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY order_items_tenant_insert ON order_items
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY order_items_tenant_update ON order_items
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY order_items_tenant_delete ON order_items
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- attendees policies
CREATE POLICY attendees_tenant_select ON attendees
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY attendees_tenant_insert ON attendees
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY attendees_tenant_update ON attendees
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY attendees_tenant_delete ON attendees
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- order_events policies — SELECT + INSERT ONLY (append-only).
CREATE POLICY order_events_tenant_select ON order_events
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY order_events_tenant_insert ON order_events
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- refunds policies
CREATE POLICY refunds_tenant_select ON refunds
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY refunds_tenant_insert ON refunds
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY refunds_tenant_update ON refunds
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY refunds_tenant_delete ON refunds
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── grants — standard §4.2.1 boilerplate (per-migration carry) ─────

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON orders, order_items, attendees, order_events, refunds
  TO eventpulse_app, eventpulse_admin;

-- ─── append-only REVOKE for order_events (§4.2.1.1 pattern) ─────────
--
-- The standard GRANT above over-grants UPDATE/DELETE on order_events
-- (this is the exact `ALTER DEFAULT PRIVILEGES` gotcha from
-- gotchas.md "`ALTER DEFAULT PRIVILEGES` over-grants UPDATE/DELETE
-- on new append-only tables — REVOKE explicitly"). The REVOKE below
-- moves the denial up to the GRANT layer where it surfaces as a
-- hard "permission denied" error, not a silent zero-rows-affected.
--
-- eventpulse_admin retains full grants for legitimate operations
-- (regulator-required redaction, post-incident remediation under
-- audit-of-the-audit logging). This is intentional — there must be
-- a path to physically remove rows when regulation requires it
-- (BFIU 5-year retention ceiling), but that path runs only through
-- the BYPASSRLS super-admin role.

REVOKE UPDATE, DELETE, TRUNCATE
  ON order_events FROM eventpulse_app;

COMMIT;
