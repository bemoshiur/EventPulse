-- 0020 — notification_log per §9.10. A queryable delivery record for every
-- outbound email/SMS.
--
-- Surfaced as a real gap during the 2026-06-05 EPS go-live smoke: a real paid
-- order's ticket-email delivery could only be INFERRED from app logs because
-- this table (defined in §9.10) was never migrated. With it, "did message X to
-- recipient Y send, and what's its provider message id?" is a one-line query.
--
-- ════════════════════════════════════════════════════════════════════
-- Shape + semantics
-- ════════════════════════════════════════════════════════════════════
--
-- One row per send attempt. status is 'sent' when the provider (SES) accepts
-- the message, 'failed' on a send error, 'queued' reserved for future async
-- paths. Bounce/complaint STATE lives in email_suppression_list (0014); this
-- table records what we attempted to send + the provider message id, so a
-- later bounce SNS event can be correlated by provider_message_id.
--
-- tenant_id is NULLABLE — auth/system emails (magic links, etc.) have no
-- tenant. RLS enforces tenant isolation on the tenant-facing read path
-- (GET /tenant/notification-log, §10.2): a NULL-tenant row never matches a
-- tenant policy, so tenants never see system emails. Delivery writes run under
-- withSuperAdmin (BYPASSRLS) in the delivery worker.
--
-- R5 (no PII in logs): recipient_hash is sha256(lower(email)); the raw
-- recipient is NOT stored. Matches email_suppression_list.email_hash.

CREATE TABLE IF NOT EXISTS notification_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id),
  channel             text NOT NULL,
  template_id         text NOT NULL,
  recipient_hash      text NOT NULL,
  provider            text NOT NULL,
  provider_message_id text,
  status              text NOT NULL,
  payload             jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_log_channel_chk
    CHECK (channel IN ('email','sms','in_app','push')),
  CONSTRAINT notification_log_status_chk
    CHECK (status IN ('queued','sent','delivered','bounced','failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_log_tenant
  ON notification_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_provider_msg
  ON notification_log (provider_message_id);

-- Grants — standard pattern per §4.2.1. Operational log (NOT an append-only
-- audit table like audit_logs), so both roles keep full mutations: a future
-- bounce-correlation path may UPDATE status, and that webhook runs as
-- eventpulse_app.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON notification_log TO eventpulse_app, eventpulse_admin;

-- RLS — tenant isolation on the tenant read path (§10.2). NULL-tenant (system)
-- rows never match a tenant policy. Delivery writes bypass via withSuperAdmin.
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON notification_log
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_insert" ON notification_log
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_update" ON notification_log
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_delete" ON notification_log
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
