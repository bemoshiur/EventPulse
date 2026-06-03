# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-04 — **Day 47.** 🚀 **PRODUCTION CUTOVER DONE (v0.4.0) + STAGING DECOMMISSIONED.** Prod is the only environment now. **LAUNCH TARGET: 2026-06-10.**
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling (just got ~$25/mo back from killing staging).**

## ✅ Production is live on v0.4.0 (commit 732bf7b)

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
