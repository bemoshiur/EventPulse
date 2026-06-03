# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-04 — **Day 46 (cont.).** Big sweep: every launch-gating EPS bug + the tenant browser-login gap closed. **8 PRs** (#282, #284–289). **LAUNCH TARGET: 2026-06-10.**
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling.**

## ✅ Shipped + merged to main (→ staging) this session

- **EPS redirect-param bug FIXED (#285).** Buyers hit `/orders/return/error` after paying because EPS appends our id as **PascalCase `MerchantTransactionId`** (ground truth from a read-only prod nginx-log probe). Handler now accepts it. Status/ErrorCode/EPSTransactionId ignored (§1.3 R3). gotchas.md updated (#286).
- **EPS fee 175 → 200 bps (#287).** Operator-confirmed (prod smoke measured 2.04/102.00 = 2.0%). TDD across calculator + `/pricing` page + new `eps-fee-estimate.test.ts`; 175-block reframed as sandbox archaeology. Money math still only via fee-calculator.ts. decisions.md (#288).
- **Tenant browser login (#289)** — *always show a picker* (decisions.md 2026-06-04). New `GET /my/contexts` + `POST /my/contexts/switch` (requireUser middleware; switch re-checks `tenant_users` membership, mints a tenant session) + `/choose-tenant` web page; `consumeHomePath('attendee')` → `/choose-tenant`. Full TDD (6 api route tests + 4 RTL + portal). Self-serve login gap CLOSED (super-admin already worked).
- Earlier: EPS return URLs in bootstrap (#282), real buyer identity → EPS init (#284), font/animation polish (#283 — last session).
- **Dependabot: triaged → launch-week FREEZE recommended** (no security advisories; hold all 10, esp. #72 @noble/hashes major + #247 vitest major). Not merged.

## 🔴 The 2 prod-side gates before first paying tenant (BOTH need Moshiur; gated — nothing touched on prod)

1. **Re-smoke** to confirm the 200-bps fee against production (real-money step; runbook rule).
2. **Prod deploy** so #285/#287/#289 reach production (main→staging only so far). DNS not pointed at prod = no public traffic until cutover.

## Next / remaining

- **Layout auth-gate + token `/refresh` rotation** — the one deprioritized item (underspecified; tenant routes still rely on the cookie/session, no server-side layout redirect yet).
- Verify the tenant-login end-to-end on staging (browser → `/choose-tenant` → switch → `/dashboard`).
- Decommission staging at launch.

## Invariants (unchanged)

Prod safe: `STAGING_PAYMENT_BLOCK=1` locked, `EPS_MODE=production`, ~1 user (operator/super-admin), 0 tenants/orders. Money math only via `fee-calculator.ts`. RLS via the 3-role model. **Prod deploys + block-lift + real payments + privilege grants are harness-gated → explicit per-step operator auth.** Memory commits via PRs separate from feature commits.
