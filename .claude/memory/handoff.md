# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-02 — **Day 45 (continued)** of the 47-day Phase 1 MVP runway. **🚀 PRODUCTION IS PUBLICLY LIVE over HTTPS and now SECURED** (critical auth bypass fixed + verified). But a **launch blocker surfaced: the authenticated browser flow was never wired end-to-end.** The BDT-100 EPS smoke is **re-deferred**; `STAGING_PAYMENT_BLOCK=1` was never lifted — prod is safe.
**LAUNCH TARGET: 2026-06-10 (8 days out) — now AT RISK for a full self-serve launch; a guest-checkout-narrow launch remains viable.**
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling still load-bearing** (current ~$45/mo overlap; decommission staging post-smoke restores ~$26-28).

## ✅ Done this session (continued)

1. **Critical auth bypass (PR #267) deployed to prod + VERIFIED LIVE.** signup→201; login `audience:super-admin` (non-admin)→**403**; `audience:tenant`+arbitrary tenantId→**403**; legit attendee→**200**. Throwaway test user deleted — prod DB back to **0 users**. Memory **PR #268 merged**.
2. **Discovered + scoped a launch blocker: browser-auth is unwired.** Wrote `docs/design/browser-auth-integration.md` (this PR). No code changes — docs + memory only.

## 🔴 The blocker — no working browser sign-in (tenant/admin/attendee portals)

Four verified gaps: (1) **no CORS** on the API; (2) web hooks send **cookies** but the API reads **only `Authorization: Bearer`** and nothing attaches Bearer; (3) **no session cookie is ever set** (consume returns JSON tokens; no `/auth/magic` page, no cookie-setter); (4) **magic-link** uses unset `EVENTPULSE_BASE_URL`→points to **staging** + `/auth/magic` page **doesn't exist**. Plus **no `/refresh` endpoint**. Hidden because every test used `app.request` with a hand-made Bearer, or guest checkout — never a real browser login. The API itself + guest checkout + public pages all work. Full root-cause in gotchas.md + decisions.md Day-45 top entries.

## 🎯 Next session — first actions

1. **OPERATOR/ARCHITECT SIGN-OFF (gates everything):** credential transport — **Option B** (HttpOnly session-cookie read by API + CORS-with-credentials; recommended, reuses `resolveSession`+`sessions`, no `/refresh` needed) **vs Option C** (Next BFF proxy; stronger isolation, more web build). Option A (token in JS) rejected. See design doc §3.1 + §4.
2. **Decide June-10 posture (design doc §4.4):** guest-checkout-narrow (ops publishes events; buyers use guest checkout — works today) vs full self-serve (needs this integration).
3. **Implement via the 9-step TDD breakdown** (design doc §5): CORS → API cookie-read → consume sets cookie → logout clears → `/auth/magic` page → magic-link URL+env → layout auth-gate → Playwright e2e → (tenant context switch). Deploy + verify on prod.
4. **THEN the full-UI BDT-100 smoke** is runnable. **OR run the seeded guest-checkout smoke anytime** to confirm the EPS production bKash rate (175 bps) independently — it needs no login (`docs/runbooks/production-smoke.md` + the seeded-smoke pivot). The EPS rate is the biggest external unknown and is the one thing worth unblocking soonest.

## Standing invariants (unchanged)

- **$30/mo ceiling**; decommission-staging-at-launch holds it. Every AWS-write STOP-ASK includes cost delta.
- prod `.env.production`: **`STAGING_PAYMENT_BLOCK=1`** (only lifts, session-scoped, for the BDT-100 smoke). **`MAIL_DRY_RUN=0`** (Phase 4, suppression-guarded). **`EPS_MODE=production`**, real prod EPS creds loaded (verified present + materialized).
- Prod box `i-0c41fae1286527654` @ EIP **52.76.69.96**; API `https://api.eventpulse.com.bd`. Money math only via fee-calculator.ts. RLS via the exact 3-role model.
- Memory commits via PRs, separate from feature commits. Branch protection on main. First prod deploy/payment steps are harness-gated → explicit per-step auth.

## Carried (pre-existing, from prior handoff)

- Open PRs to merge if not yet: #265 (bootstrap default-site), #266 (DB backups) — check status.
- App-level CW alarms (BLOCKED on app emitting custom metrics — code feature). CloudTrail (account-level, shared w/ TenderPulse — operator decision). #7 prod-branch ff-merge (pre-push hook; §18.3 wants tag/dispatch). #5 OAuth creds (operator-supplied; `OAUTH_NOT_CONFIGURED` is clean/optional). SNS alarm email sub — operator click-to-confirm.
