-- Sprint 3 Day 25 — ticket_tiers table per CLAUDE.md §9.3.
--
-- 16 columns: §9.3 spec verbatim. Day 23 deferred this table from the
-- events workstream (decisions.md "Scope = events table ONLY;
-- ticket_tiers is Day 25" 2026-05-24) so the events migration could
-- land focused; Day 25 ships the tier surface.
--
-- price_paisa bigint per §1.3 R2 — money is paisa as bigint, never
-- float, never decimal. CHECK price_paisa >= 0 — free tiers are
-- allowed (the §13.5 free-event behaviour exercises price_paisa = 0).
--
-- capacity integer NOT NULL CHECK > 0 — per-tier capacity is required
-- and positive. NULL capacity (unlimited) is allowed on the parent
-- event but NOT on tiers; the spec mandates a per-tier ceiling because
-- the order pipeline needs a numerical bound for the FOR UPDATE
-- capacity lock that Day 29 lands.
--
-- sold integer NOT NULL DEFAULT 0 — running count, updated by the
-- order pipeline at paid-state transition. Pessimistic locking via
-- SELECT ... FOR UPDATE on this row lands Day 29; today the column
-- exists but only the application-layer service updates it as part
-- of order lifecycle (no DB-level enforcement of sold <= capacity
-- because race-free enforcement requires the Day-29 row lock).
--
-- sales_start_at / sales_end_at — nullable window. NULL start = "open
-- from event publish"; NULL end = "open until event start_at"; both
-- non-null = explicit window. Application-layer enforcement only;
-- DB validates only that if both are non-null, end > start (CHECK).
--
-- min_per_order DEFAULT 1, max_per_order DEFAULT 10 — per §9.3 spec.
-- CHECK enforces min >= 1 and max >= min.
--
-- is_complimentary boolean — separates revenue-bearing free tiers
-- from "comp" tiers (sponsor passes, organiser invites, etc.) for
-- reporting + reconciliation. price_paisa MUST be 0 when
-- is_complimentary = true (CHECK constraint).
--
-- sort_order integer DEFAULT 0 — display ordering on the public event
-- page + tenant portal. Lower values come first; ties broken by
-- created_at ASC (application-layer).
--
-- archived_at timestamptz — soft-archive per §1.3 R7. Archived tiers
-- stay attached to existing orders but cannot accept new orders.
-- Distinct from a hard delete; preserves audit-trail integrity.
--
-- Indexes per §9.3:
--   idx_tickets_event (event_id) — covers the "list tiers for event X"
--   query the public event page + tenant tier list both run.
--
-- RLS: tenant-scoped CRUD per §4.3 template (mirrors events 0011).
-- DELETE policy IS present (matches events policy); application layer
-- uses archived_at for the standard "remove tier" UX, but the DELETE
-- policy lets RLS isolation tests cover the "wrong tenant cannot
-- delete" assertion without contortion.
--
-- Sprint 2 Day 11 Item 5 carry (gotchas.md): every new migration
-- explicitly re-issues the §4.2.1 GRANT boilerplate for both roles.
--
-- NOT append-only: UPDATEs (sold counter; sales_window edits; archive)
-- are core. No REVOKE pattern from §4.2.1.1 applies here.

BEGIN;

-- ─── table ─────────────────────────────────────────────────────────────

CREATE TABLE ticket_tiers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id           uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name               text        NOT NULL,
  description        text,
  price_paisa        bigint      NOT NULL,
  capacity           integer     NOT NULL,
  sold               integer     NOT NULL DEFAULT 0,
  sales_start_at     timestamptz,
  sales_end_at       timestamptz,
  min_per_order      integer     NOT NULL DEFAULT 1,
  max_per_order      integer     NOT NULL DEFAULT 10,
  is_complimentary   boolean     NOT NULL DEFAULT false,
  sort_order         integer     NOT NULL DEFAULT 0,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ticket_tiers_price_chk           CHECK (price_paisa >= 0),
  CONSTRAINT ticket_tiers_capacity_chk        CHECK (capacity > 0),
  CONSTRAINT ticket_tiers_sold_chk            CHECK (sold >= 0),
  CONSTRAINT ticket_tiers_min_per_order_chk   CHECK (min_per_order >= 1),
  CONSTRAINT ticket_tiers_max_per_order_chk   CHECK (max_per_order >= min_per_order),
  CONSTRAINT ticket_tiers_window_chk
    CHECK (sales_end_at IS NULL OR sales_start_at IS NULL OR sales_end_at > sales_start_at),
  CONSTRAINT ticket_tiers_complimentary_price_chk
    CHECK (is_complimentary = false OR price_paisa = 0)
);

CREATE INDEX idx_tickets_event ON ticket_tiers (event_id);

-- ─── RLS policies (standard tenant-scoped per §4.3) ──────────────────

ALTER TABLE ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tiers FORCE  ROW LEVEL SECURITY;

CREATE POLICY ticket_tiers_tenant_select ON ticket_tiers
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ticket_tiers_tenant_insert ON ticket_tiers
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ticket_tiers_tenant_update ON ticket_tiers
  FOR UPDATE
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ticket_tiers_tenant_delete ON ticket_tiers
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── grants ───────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON ticket_tiers TO eventpulse_app, eventpulse_admin;

COMMIT;
