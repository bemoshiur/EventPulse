# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-04 — **Day 47.** 🚀 **PROD v0.4.3 — full self-serve loop LIVE: sign up → create → publish → share.** (v0.4.0 cutover → v0.4.1 auth front-door → v0.4.2 self-service create → v0.4.3 publish+share manage hub; staging decommissioned.) Prod is the only environment. **LAUNCH TARGET: 2026-06-10.**
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling (got ~$25/mo back from killing staging).**

## ✅ Prod is live on v0.4.1 (commit 3fef86c) — auth front-door fixed

Operator hit "nothing works / can't tell how to log in." Diagnosed: the engine was fine (CORS + login endpoint + email all verified live); the FRONT-END entry was broken. Fixed + deployed v0.4.1 (#299), browser-verified on prod:
- **`/sign-up` works** (was 404 — every marketing "Start free" CTA pointed at it). Passwordless: new email → magic-link consume CREATES the account (display name derived from email via `deriveDisplayName`); existing email signs in. `password/signup` untouched.
- **Auth pages no longer statically cached** — `export const dynamic` on `(auth)/layout`. They were prerendered `s-maxage=1y`, so a browser could pin a STALE login shell → broken form / "Network error" on submit (the operator's symptom). Now `no-store`.
- Sign-in ↔ sign-up cross-links fixed; favicon added (`app/icon.svg`).
- **Login map:** admin = `app.eventpulse.com.bd/admin-sign-in`; organiser/tenant = `/sign-in`; new = `/sign-up`. All email-magic-link only.

### ✅ NEW (v0.4.2) — self-service "create your first event" is BUILT (§2.4 Path A)

A new user can now sign up + log in → `/choose-tenant` → **"Create your first event"** → `POST /my/hosting/start` auto-provisions their **personal tenant** (`ensurePersonalTenant`: type=individual, is_personal, owner, status=active so free hosting needs no KYC §13.5) + enters its context → `/events/new` (renders the existing `EventForm`) → `POST /tenant/events` → event's tickets page. Dashboard has "+ Create event"; existing-tenant users get "+ Host a new event". Verified on prod: `/my/hosting/start`→401(gated), `/events/new`→200. DB-gated CI test covers the provisioning.

### ✅ NEW (v0.4.3) — publish + share manage hub (loop complete)

Create now lands on **`/events/[eventId]`** (the manage hub, `EventManage` component): **Publish** (draft→published via `POST /tenant/events/:id/transition {to:'published'}`, free = no KYC) → once live, the **public share URL** `eventpulse.com.bd/{tenantSlug}/{eventSlug}` (slug from `GET /tenant/me` → `data.tenant.slug`) with Copy link + View page (the existing `(public)/[tenant]/[event]` landing page is the target). Cards to Tickets/Attendees/Check-in. TDD'd (`event-manage.test.tsx`). Verified on prod: `/events/[id]`→200, commit `21c354c`.

**Full organiser journey now exists end-to-end, no admin:** sign up → create → publish → share a working public link.

**Still next polish (NOT blocking launch):** add-paid-tier → KYC graduation (§13.4); richer event-edit; an events LIST page (dashboard + manage-hub are the only entry points to an event today — no "all my events" list yet). **Operator should live-test the loop** (needs their inbox for the magic link).

## ✅ (from v0.4.0) — cutover baseline

Deployed via `deploy-prod.yml` (`--ref prod`). All session work live + verified on prod:

Deployed via `deploy-prod.yml` (`--ref prod`, tag v0.4.0). All session work is live + verified on prod:
- **Email-only auth** — Google/third-party login REMOVED (#294): sign-in shows only the magic link; `/api/v1/auth/oauth/google/start` → 404.
- **Tenant browser login** (#289) — `/choose-tenant` picker + `/my/contexts`. **Layout auth-gate** (#291) — `/auth/session` → 401 unauth.
- **EPS:** redirect-param fix (#285, PascalCase `MerchantTransactionId`), fee **200 bps** (#287), buyer-info (#284), bootstrap URLs (#282).
- Prod safety intact: `STAGING_PAYMENT_BLOCK=1`, `EPS_MODE=production`, `MAIL_DRY_RUN=0`.
- Prod box `i-0c41fae1286527654` @ EIP `52.76.69.96`. API `https://api.eventpulse.com.bd`.

## ✅ Staging gone

EC2 `i-02e4…` terminated, EBS deleted, EIP `18.141.7.246` released, 6 DNS records deleted (zone + all prod records KEPT), 2 buckets deleted, log group + alarm deleted, `STAGING_DEPLOY_ENABLED=false`. 6 `eventpulse/staging/*` secrets + 2 KMS keys scheduled for deletion — **recoverable until 2026-06-11**, then gone.

## 🔴 The ONE thing left before the first paying tenant (operator-gated)

- **EPS re-smoke** on prod to confirm the **200 bps** fee with a real BDT charge (lift `STAGING_PAYMENT_BLOCK` for the smoke, then re-lock). Real money → explicit per-step operator auth.

## Deploy mechanics (LEARNED THIS SESSION — read before next prod deploy)

1. Advance the `prod` branch to the release commit: `git push --no-verify origin main:prod` (pre-push hook blocks main/prod; `--no-verify` is its sanctioned override — log to gotchas).
2. Cut a `vX.Y.Z` tag (must match `^v\d+\.\d+\.\d+$`; the `-sprint-N` tags don't).
3. `gh workflow run deploy-prod.yml --ref prod -f confirm_target=production -f release_tag=vX.Y.Z`. **MUST be `--ref prod`** — the prod OIDC trust pins `job_workflow_ref @refs/heads/prod`; dispatching from main → "Not authorized to AssumeRoleWithWebIdentity" (gotchas.md).
4. The workflow may RED-flag on the `aws ssm wait` timeout even when the deploy succeeds — #296 fixes that; until #296 reaches prod, verify via `aws ssm get-command-invocation` Status / `deploy.log` before assuming failure.

## Invariants (unchanged)

Money math only via `fee-calculator.ts`. RLS via the 3-role model. **Prod deploys + block-lift + real payments + privilege grants are harness-gated → explicit per-step operator auth.** Memory commits via PRs separate from feature commits. No staging to fall back on — prod changes go through tag + deploy-prod + on-prod verification (block stays locked = payment-safe).
