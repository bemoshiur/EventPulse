-- Sprint 3 Day 22 Workstream 2 — tenant subdomain provisioning state on tenants.
--
-- Adds two timestamp columns to track the provisioning lifecycle:
--
--   subdomain_provisioned_at      timestamptz NULL  -- success timestamp
--   subdomain_provisioning_failed_at timestamptz NULL  -- last failure ts
--
-- Both nullable because they're set lazily on the first KYC approve
-- transition (Item 13). Until then they stay NULL — which means "no
-- subdomain has been provisioned for this tenant yet."
--
-- Why two columns instead of one status enum:
--
--   - Success and failure carry different semantic meaning. After a
--     successful provision, subdomain_provisioned_at is permanent; the
--     tenant.slug subdomain serves real requests from that timestamp
--     forward.
--   - Failures are transient by nature (Nginx reload errored, SSM
--     timed out, etc.). The retry path needs to know "did this just
--     fail or has it never succeeded yet?" — distinguishing the two
--     columns answers it directly. Both NULL = never tried (or never
--     approved). subdomain_provisioned_at NOT NULL = success state.
--     subdomain_provisioning_failed_at NOT NULL AND subdomain_provisioned_at
--     IS NULL = stuck-in-failure; surfaces in admin queue as "approved
--     but provisioning failed — manual intervention needed" per the
--     Day 20 brief.
--   - A status enum 'pending' | 'provisioned' | 'failed' would conflate
--     "never tried" with "currently trying" — better to leave NULL/NULL
--     as the explicit "no attempt yet" sentinel.
--
-- Idempotency at the application layer: when provisionTenantSubdomain
-- is called for a tenant whose subdomain_provisioned_at is already
-- non-NULL, the task no-ops and returns the existing timestamp. The
-- DB columns don't enforce this — the application module does.
--
-- CLAUDE.md §9.1 still documents tenants without these columns;
-- §9.1 amendment queued as a v2.4 playbook bump candidate per
-- progress.md cross-sprint carries (alongside the preferred_locale
-- amendment from migration 0009).
--
-- Grants + RLS unchanged. The §4.2.1 boilerplate from earlier migrations
-- already covers the tenants table for both eventpulse_app and
-- eventpulse_admin; added columns don't affect either layer.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN subdomain_provisioned_at timestamptz,
  ADD COLUMN subdomain_provisioning_failed_at timestamptz;

COMMIT;
