# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-03 — **Day 46.** This session built **and shipped** the browser-auth core (Option B: session-cookie + CORS) **and** finished + verified **super-admin browser login on prod**. Production live + secured since Day 45.
**LAUNCH TARGET: 2026-06-10 (7 days out).** Tenant browser login + the EPS-rate smoke remain.
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling** (decommission staging at launch holds it).

## ✅ Shipped + deployed + verified this session

- **Browser-auth core** (PR #270 + memory #271) — CORS allow-listing portal origins + Allow-Credentials; API reads HttpOnly `ep_session` cookie → `resolveSession` (live-row check); signup/login/consume set it, logout clears; magic-link URL → sign-in portal (request Origin, no open-redirect) + audience; `/auth/magic` consume page. Deployed to prod (`9a34385`). **Verified on prod via curl** (CORS echoes origin + credentials; cookie set; cookie read → 403 vs 401).
- **Super-admin login** (PR #272, `8c80395`, deployed) — `/admin-sign-in` page requests a super-admin link; **fixed a latent prod bug** (MagicLinkForm POSTed a RELATIVE `/api/v1` URL → 404 on prod; now uses `NEXT_PUBLIC_API_BASE_URL`). `moshiur@publicpulse.com.bd` granted super-admin. **Operator clicked the magic link → landed `/admin/kyc` logged in → super-admin browser login CONFIRMED end-to-end on prod.** `/admin-sign-in` live (200).
- **No new prod env vars needed** (CORS default = prod portals; cookie host-only on `api.eventpulse.com.bd`; magic-link uses request Origin).

## 🎯 Next session — remaining for full self-serve + the smoke

1. **Tenant browser login** — the multi-tenant context entry (tenant audience needs a `tenantId` at login, §4.2 open decision). This is the gap blocking the **full-UI** smoke (tenant creates event + submits KYC). Decide UX: auto-select when the user has one tenant vs a context picker.
2. **Deferred follow-ups:** Step 7 layout auth-gate UX (today: API-401 → hooks error, no clean redirect); Step 8 Playwright e2e; no `/refresh` endpoint (session is the 7-day store).
3. **BDT-100 EPS-rate smoke** — the launch-critical EXTERNAL unknown. Runnable **now** via **seeded guest-checkout** (no login) per `docs/runbooks/production-smoke.md`; or via full-UI once tenant login lands. This confirms the 175bps production bKash rate; first paying tenant is gated on it.
4. **Decommission staging** (restores the $30 ceiling) — after the smoke.

## Login facts (for next session)

- Super-admin self-serve: `app.eventpulse.com.bd/admin-sign-in` → email link → `/admin/kyc`. (No subdomain routing — `/admin/*` paths serve from any host.)
- `moshiur@publicpulse.com.bd` is a super-admin on prod. Prod DB otherwise ~1 user (the operator).
- The generic `/sign-in` requests `attendee`; `/admin-sign-in` requests `super-admin`. Tenant has no self-serve sign-in yet (needs §4.2).

## Standing invariants (unchanged)

- **$30/mo ceiling**; decommission-staging-at-launch holds it.
- prod `.env.production`: **`STAGING_PAYMENT_BLOCK=1`** (only lifts, session-scoped, for the BDT-100 smoke). **`MAIL_DRY_RUN=0`**. **`EPS_MODE=production`**, real creds verified. All re-confirmed this session post-deploy.
- Prod box `i-0c41fae1286527654` @ EIP **52.76.69.96**; API `https://api.eventpulse.com.bd`. Money math only via fee-calculator.ts. RLS via the exact 3-role model.
- Memory commits via PRs, separate from feature commits. Branch protection on main. First prod payment steps are harness-gated → explicit per-step auth. Privilege grants on prod DB (super_admins) need explicit operator authorization (the classifier enforces this).
