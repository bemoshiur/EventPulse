-- 0022 — tenant_payout_accounts (§9.7). The disbursement ENTRY POINT: a tenant
-- adds a bank / MFS account to receive payouts.
--
-- KYC-at-disbursement (decisions.md 2026-06-06 "KYC gate at disbursement, not
-- paid-tier"): free + paid events publish without KYC; KYC is required only
-- when a tenant sets up a payout account. The application layer enforces the
-- gate (kyc_status must be 'approved') before any row is inserted here; this
-- table is the surface that gate protects.
--
-- account_number is financial PII; held under RLS (tenant isolation) like the
-- rest of the tenant's data. A dedicated payouts CMK (alias/eventpulse-payouts)
-- for at-rest encryption beyond RLS is planned (§17.9) but not in MVP scope.

CREATE TABLE IF NOT EXISTS tenant_payout_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  account_type    text NOT NULL,
  account_name    text NOT NULL,
  account_number  text NOT NULL,
  bank_name       text,
  branch_name     text,
  routing_number  text,
  is_primary      boolean NOT NULL DEFAULT false,
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_payout_accounts_type_chk
    CHECK (account_type IN ('bank','bkash','nagad','rocket','upay'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_payout_accounts_tenant
  ON tenant_payout_accounts (tenant_id, created_at DESC);

-- Grants — standard pattern per §4.2.1.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON tenant_payout_accounts TO eventpulse_app, eventpulse_admin;

-- RLS — tenant isolation per §4.3. Writes run under withTenant (eventpulse_app).
ALTER TABLE tenant_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_payout_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON tenant_payout_accounts
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_insert" ON tenant_payout_accounts
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_update" ON tenant_payout_accounts
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_delete" ON tenant_payout_accounts
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
