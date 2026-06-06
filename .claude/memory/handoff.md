# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-06 — **Day 49.** Prod on **v0.4.30**. Driver: Claude Code (Opus 4.8). Single EC2 `i-0c41fae1286527654`, SSM-only, deploy via `deploy-prod.yml` (checks out the **release tag**, NOT the prod branch). API `api.eventpulse.com.bd`; web `app.`/apex/`my.`. Org `The-Public-Pulse-Agency/EventPulse`, AWS acct `739275468267`.

## ✅ Shipped this session (v0.4.23 → v0.4.30, all LIVE + verified)
- **EPS PAYMENTS WENT LIVE.** All methods open (retired bKash-only guard); `STAGING_PAYMENT_BLOCK=0` flipped via SSM. The first real ৳357 smoke caught **3 prod-only bugs** (all fixed): (1) v5 Verify `PaymentReferance: null` rejected by schema → `.nullable().optional()` (#339, v0.4.24); (2) `/orders/return/*` + `/buyer-terms` 404 → built return pages + status endpoint + buyer-terms (#341, v0.4.25); (3) BullMQ jobId had `:` → ticket delivery never enqueued → `delivery-${id}` (#340). Operator's order re-enqueued + ticket delivered.
- **On-page ticket PDF download** (#343, v0.4.26) — `GET /public/orders/:id/tickets.pdf`, multi-page, shared `drawTicketPage`.
- **notification_log** (#344, v0.4.27, migration 0020) — queryable per-send delivery record; delivery worker writes a row per email (recipient hashed, R5).
- **A — Password onboarding** (#345/#346, v0.4.28, migration 0021) — signup→email-verify→password login, forgot/reset, **magic-link LOGIN removed** (token store kept). Bilingual verify/reset emails. CLAUDE.md §5.2/§1.6 updated.
- **B — KYC at disbursement** (#347, v0.4.29, migration 0022) — `tenant_payout_accounts` + RLS; `POST /tenant/payout-accounts` gated on `kyc_status='approved'` (403 KYC_NOT_APPROVED); `/payouts` "verify to get paid" CTA. NO add-paid-tier gate existed to remove.
- **D/E — Parity** (#348, v0.4.30) — homepage "by the numbers" metrics strip; footer Trust column completed (SLA/EULA/DPA/Cookies). Cross-check found homepage (12+ bilingual sections) + /trust (6+12 card grid) were ALREADY at parity.
- **G — QA:** link sweep = all 30 marketing/trust/auth routes 200, zero broken links.

## ⏭ Open (next session)
- **C — Bilingual `/bn` routing + EN|বাংলা toggle** — the ONE real remaining TenderPulse gap. Pages show both langs inline but no toggle / `/bn` URLs. Deliberately deferred: cross-cutting refactor; half-done = mixed-language site. Do in one clean stretch: dict structure → LanguageToggle → `/bn` rewrite (NO middleware.ts exists yet — greenfield) → page-by-page. Locked decisions: `/bn` prefix (EN un-prefixed), magic-link removed, KYC disbursement-only.
- **A-smoke (operator):** real signup→confirm-email→signin→reset (can't do — needs a mailbox).
- Watch: `webhook.ses.bounce.suppressed` seen earlier — if a ticket/auth email doesn't land, check SES suppression list (operator's address was NOT suppressed; sends are real, DKIM-verified).

## Next step
Start C (bilingual /bn) as a focused task, or whatever the operator raises. Nothing is half-built; prod = main = v0.4.30, all green.
