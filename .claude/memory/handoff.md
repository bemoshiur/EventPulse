# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-06 — **Day 49 (cont).** Prod on **v0.4.35**. Single EC2 `i-0c41fae1286527654` (`eventpulse-prod`, IP 52.76.69.96), SSM-only, deploy via `deploy-prod.yml` (checks out the **release tag**). API `api.eventpulse.com.bd`; web apex + `app.`/`admin.`. Org `The-Public-Pulse-Agency/EventPulse`, AWS `739275468267`. **Staging fully decommissioned** — production is the only environment.

## ✅ Shipped this session (v0.4.23 → v0.4.35, all LIVE + verified)
- **EPS payments LIVE** (all methods) + the first real-money smoke caught **3 prod-only bugs** (v5 Verify null PaymentReferance, missing /orders/return + /buyer-terms pages, BullMQ jobId `:`) — all fixed; ticket re-delivered. + **ticket PDF download** (v0.4.26), **notification_log** (v0.4.27, migration 0020).
- **A — Password onboarding** (v0.4.28, migration 0021): signup→email-verify→login, forgot/reset, magic-link removed.
- **B — KYC at disbursement** (v0.4.29, migration 0022): `tenant_payout_accounts` + RLS, payout-account add gated on kyc_status='approved'.
- **Discover** (v0.4.31): BookMyShow-style `/discover` — category + area (venue.district) + search; GET /api/v1/public/discover[/cities].
- **Marketing parity** (v0.4.30): homepage metrics strip + footer legal links.
- **QA audit + UAT plan** → `docs/qa/UAT-plan.md` (#351). All P1 findings fixed:
- **P1 My-tickets** (v0.4.32, migration 0023): `/my-tickets` — buyer retrieves tickets by email (single-use link) → view + PDF re-download. + payout T+5 disclosure.
- **P2 MFA/2FA** (v0.4.33, migration 0024): in-house TOTP (RFC 6238), enroll/confirm/disable/verify + login challenge gate + 128-bit recovery codes + Settings UI. (2 security-review fixes folded in: recovery entropy 40→128-bit, code schema max 20→40.)
- **P2 Bilingual `/bn`** (v0.4.34): middleware rewrite /bn/*→/* (pages already bilingual inline → no mixed-language state, SSG preserved), EN|বাংলা toggle in nav+footer, hreflang.
- **Staging decommissioned** (v0.4.35): deleted deploy-staging.yml + load-test.yml + staging nginx conf + bootstrap-staging.sh; deploy.sh fallback → production; STAGING_PAYMENT_BLOCK env var removed (guard now inert). No staging EC2/DNS/vhost remain (already gone). EPS *sandbox* mode + the inert guard code kept deliberately.

## 🔑 Test accounts created on PROD (rotate/delete after testing)
- **Super-admin:** `admin@eventpulse.com.bd` / `Adm-FrH154yoXXz6A9!` (login `/admin-sign-in`).
- **Organiser:** `organiser@eventpulse.com.bd` / `Org-xKenx3JXwZ7NA9!` (tenant "Test Organiser", active + KYC-approved; portal via `/choose-tenant`).
- Both pre-verified. All logins verified working (admin 200, org attendee+tenant 200, wrong-pw 401).

## ⏭ Open
- **Operator UAT pass** (`docs/qa/UAT-plan.md`) — the human+inbox smokes (payment, onboarding email, MFA enroll, my-tickets).
- **Optional / offered, not done:** (a) nginx hard-404 for `staging.*` (currently wildcard-catches to marketing — harmless); (b) focused removal of the now-inert payment-guard code; (c) `/bn` Bengali-*primary* presentation (currently same bilingual content under both locales).
- Legal docs still v0.1 placeholders → counsel review gates the first *paying* tenant.

## Next step
Operator runs UAT. Prod = main = v0.4.35, all green. Nothing half-built.
