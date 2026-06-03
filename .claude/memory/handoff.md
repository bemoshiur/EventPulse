# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-03 — **Day 46.** Production live + secured since Day 45. This session **built the browser-auth core** (Option B: session-cookie + CORS) — **PR #270, CI fully green** — which closes the API + magic-consume half of the Day-45 launch blocker (logged-in portals couldn't authenticate from a browser).
**LAUNCH TARGET: 2026-06-10 (7 days out).** Full self-serve still needs the deferred web pieces; a guest-checkout-narrow launch remains viable.
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling** (decommission staging at launch holds it).

## ✅ Done this session — browser-auth Option B core (PR #270, green, NOT yet merged)

Steps 1–6 of `docs/design/browser-auth-integration.md`, TDD throughout:
1. **CORS** — allow-listed portal origins (`EVENTPULSE_CORS_ORIGINS`) + Allow-Credentials; never `*`.
2. **Cookie read** — API middleware reads HttpOnly `ep_session` → `resolveSession` (LIVE row check; rejects revoked/expired).
3. **Cookie set** — signup/login/magic-consume.
4. **Cookie clear** — logout.
6. **Magic-link URL** — targets the sign-in portal (request Origin if allow-listed) + carries audience; default `app.eventpulse.com.bd` (not staging).
5. **Web `/auth/magic` consume page** — POSTs token (credentials:include) → API sets cookie → lands audience home (super-admin → `/admin/kyc`).

**Net: super-admin (and attendee) browser login works end-to-end** — what's needed to approve KYC in the smoke. Local suites green (api 1316 + web 206, 0 fail); all CI jobs green.

## 🎯 Next session — first actions

1. **Merge PR #270** (browser-auth core) + this memory PR. #270 is CI-green; auth code — operator may want a glance first.
2. **Deploy needs env vars per environment** (NOT yet set anywhere): `EVENTPULSE_CORS_ORIGINS` (CORS default = prod portals only → **staging/prod must set this or browser-auth is CORS-blocked**), `EVENTPULSE_COOKIE_DOMAIN=eventpulse.com.bd` (one cookie across app/admin/my/api), `EVENTPULSE_BASE_URL`. Set via the bootstrap script / SSM. Prod deploy is **harness-gated**.
3. **Then super-admin browser login is usable on prod** → unblocks the smoke's KYC-approval step (operator logs into `admin.eventpulse.com.bd` via magic link with `audience=super-admin`; requires a `super_admins` row created for them).
4. **Deferred follow-ups (in #270 body):** Step 7 layout auth-gate UX (today: API-401 → hooks error, no clean redirect); Step 8 Playwright e2e; **multi-tenant context entry for the tenant/app portal** — tenant login needs a `tenantId` (§4.2 open decision); no `/refresh` endpoint.
5. **The BDT-100 EPS smoke** remains the launch-critical external unknown — still runnable anytime via **seeded guest-checkout** (no login needed) per `docs/runbooks/production-smoke.md`; or via the full UI once super-admin + tenant login + KYC flow are deployed.

## ⚠️ Web-layer findings (shape the remaining work)

- **No subdomain→portal middleware** (§7.5's `middleware.ts` doesn't exist) — all route groups serve from one app on any host; audience travels in the magic link, not host-inferred.
- **`(my)` attendee portal has zero pages** (Phase 2). Meaningful MVP logins are **super-admin** (`/admin/*`) and **tenant** (`/dashboard`, needs the context decision).

## Standing invariants (unchanged)

- **$30/mo ceiling**; decommission-staging-at-launch holds it. AWS-write STOP-ASK includes cost delta.
- prod `.env.production`: **`STAGING_PAYMENT_BLOCK=1`** (only lifts, session-scoped, for the BDT-100 smoke). **`MAIL_DRY_RUN=0`** (suppression-guarded). **`EPS_MODE=production`**, real prod creds loaded + verified.
- Prod box `i-0c41fae1286527654` @ EIP **52.76.69.96**; API `https://api.eventpulse.com.bd`. Money math only via fee-calculator.ts. RLS via the exact 3-role model.
- Memory commits via PRs, separate from feature commits. Branch protection on main. First prod deploy/payment steps are harness-gated → explicit per-step auth.
- The critical auth-bypass (client-trusted audience) was fixed + verified live on prod Day 45 (#267); this session's `ep_session` cookie path keeps that enforcement (audience resolved server-side from the session row).
