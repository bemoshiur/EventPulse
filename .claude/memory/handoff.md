# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-03 — **Day 46.** Shipped browser-auth + super-admin login on prod (verified). Then attempted the BDT-100 EPS-rate smoke → **BLOCKED: production EPS payments don't work yet** (prod endpoint 404, never validated). **No money moved.**
**LAUNCH TARGET: 2026-06-10 (7 days out) — now gated on fixing production EPS.**
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling.**

## 🚨 THE launch blocker — production EPS endpoint 404

The smoke surfaced that **no paid order can process on prod**: EPS `GetToken` → **HTTP 404** at `https://pgapi.eps.com.bd/api/v1/GetToken`. The truth-gate only ever validated **sandbox** (`sandboxpgapi.eps.com.bd` + `/v1/Auth/...`); the **production** config in `apps/api/src/infra/eps/core.ts` (`BASE_URLS.production` + `V5_PRODUCTION_PATHS` = `/api/v1/GetToken|InitializeEPS|CheckMerchantTransactionStatus`) was authored from the V5 guide but **never hit a live prod EPS server**, and it 404s.

**To unblock (operator/EPS dependency):**
1. Confirm the correct **production** EPS base URL + the three endpoint paths from the **V5 production integration guide** (likely they mirror sandbox `/v1/Auth/...` + `/v1/EPSEngine/...`, or the host differs).
2. Confirm the merchant is **activated for production** at that endpoint.
3. Then a small config fix in `core.ts` (base + paths are isolated in `EpsConfig`) → re-run the smoke per `docs/runbooks/production-smoke.md` (seeded guest-checkout, no login).
- **Do NOT guess-and-retry** against the live production EPS API.

## ✅ Shipped + verified this session (browser-auth)

- **Browser-auth core** (Option B: CORS + HttpOnly `ep_session` cookie + `/auth/magic` consume page) — #270/#271, deployed, curl-verified on prod.
- **Super-admin browser login** — #272 (`/admin-sign-in` + MagicLinkForm API-base fix), deployed. `moshiur@publicpulse.com.bd` is super-admin; **operator logged in end-to-end** (`app.eventpulse.com.bd/admin-sign-in` → magic link → `/admin/kyc`). Verified.

## State + invariants

- **Prod safe + pristine:** `STAGING_PAYMENT_BLOCK=1` re-locked + verified; seeded smoke data fully cleaned (0 tenants/events/orders); ~1 user (the operator). No money moved.
- **Config added live (not yet in bootstrap):** `EPS_SUCCESS_URL/FAIL_URL/CANCEL_URL` in `.env.production` → `api.eventpulse.com.bd/api/v1/public/orders/eps-return/{success,fail,cancel}`. **Codify in `bootstrap-prod.sh`** so a re-bootstrap doesn't drop them.
- `EPS_MODE=production`, `MAIL_DRY_RUN=0`. Prod box `i-0c41fae1286527654` @ EIP `52.76.69.96`; API `https://api.eventpulse.com.bd`.

## 🎯 Next session

1. **Fix production EPS** (above) — THE launch blocker. Then re-smoke.
2. **Tenant browser login** (multi-tenant context §4.2) — the full-UI-smoke gap; entangled with unbuilt tenant onboarding + a product decision.
3. **Smaller deferred:** Step 7 layout auth-gate, Step 8 e2e, `/refresh`, codify EPS return URLs in bootstrap, decommission staging at launch.

## Standing invariants

- Money math only via fee-calculator.ts. RLS via the exact 3-role model. Memory commits via PRs separate from feature commits. Branch protection on main. Privilege grants on prod DB + real-money steps are harness-gated → explicit operator authorization. The Day-45 auth-bypass stays closed (audience server-resolved from the session row).
