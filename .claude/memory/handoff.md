# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-02 — **Day 45** of 47-day Phase 1 MVP runway. **🚀 PRODUCTION IS PUBLICLY LIVE over HTTPS.** Cutover #1 (EC2 provision + app deploy) + #2 (DNS) + #3 (wildcard cert) + #4 (deploy OIDC role) + #6 (KYC bucket) all DONE + verified. App serving on the real domain behind STAGING_PAYMENT_BLOCK=1 + MAIL_DRY_RUN=1 (no tenants/events yet).

**Verified public (2026-06-02 ~11:02 UTC):** `https://eventpulse.com.bd` + www/app/admin/my → 200; `https://api.eventpulse.com.bd/health` → 200 `{db:ok}`; wildcard tenant subdomain → 200; LE cert `CN=eventpulse.com.bd` SAN `*.eventpulse.com.bd + eventpulse.com.bd` valid → 2026-08-31. Prod DB schema: 27 tables, 23 RLS-forced, audit_logs append-only enforced, legal_documents seeded (19). pm2 web+api online 0 restarts.
**LAUNCH TARGET: 2026-06-10** (8 days out).
**Driver:** Claude Code (Opus 4.8 1M).
**🛑 LOAD-BEARING — $30/mo AWS ceiling.** Resolved this session: **decommission staging at prod launch** keeps steady-state ~$26/mo. **Current spend ~$45/mo (cutover-week OVERLAP — bounded + intentional; settles to ~$26-28 after staging is decommissioned post-smoke).** Budget alarm $25/$30 live → fires on the overlap, expected. Every AWS-write STOP-ASK still includes cost delta.

**Today's headline:** Operator said "EPS prod creds already added." Verified `eventpulse/prod/eps` present since 2026-05-31 (Day-44 handoff was stale; Open #1 CLOSED). Creds alone don't unblock the BDT-100 smoke — it needs a prod environment, which didn't exist. So the session became the **production EC2 cutover ceremony**. Chose **clean scripted build** (operator). Wrote the prod IaC, created all prod foundation resources, provisioned + verified the prod box. Caught + fixed **3 latent script bugs** mid-cutover.

## 🟢 Prod resources created this session (account 739275468267, ap-southeast-1)

| Resource | ID / name |
|---|---|
| Prod EC2 (t3.small, Ubuntu 24.04, IMDSv2, 30GB gp3 enc) | `i-0c41fae1286527654` |
| Elastic IP | **52.76.69.96** |
| Security group | `sg-014d2ec01d9c5e9ef` (eventpulse-prod-web, 80/443, no 22) |
| IAM role + instance profile | `eventpulse-prod-ec2` (SSMCore + eventpulse-prod-app + eventpulse-prod-acme-route53) |
| KMS general CMK | `alias/eventpulse-prod` → key/d97a3235-35f4-4478-862b-5a79f64848c9 |
| KMS KYC CMK | `alias/eventpulse-kyc-prod` → key/d7ac8d85-0fca-4e01-ae25-b27bdf7533e0 |
| Deploy OIDC role (#4) | `arn:...:role/eventpulse-deploy/eventpulse-deploy-prod` (trust = environment:production + deploy-prod.yml@refs/heads/prod; SSM dual-ARN) |
| KYC bucket (#6) | `eventpulse-kyc-prod` (SSE-KMS w/ KYC CMK ✓, PAB, TLS-only, Glacier_IR 30d, no expiry) |
| AWS Budget | `eventpulse-monthly-ceiling` ($25 actual / $30 forecast → moshiur@publicpulse.com.bd) |
| Secrets created | `eventpulse/prod/database` (provision), `eventpulse/prod/kyc` (setup-kyc-bucket). `eventpulse/prod/eps` pre-existed. jwt-* auto-created by bootstrap. |
| GitHub secrets set | `AWS_OIDC_ROLE_PROD`, `PROD_EC2_INSTANCE_ID` (`PROD_DEPLOY_ENABLED` left OFF) |

**Prod OS provisioning VERIFIED:** Node 22.22.2 / PG 16.14 / Redis 8.8 / nginx 1.24 / certbot 5.6 / aws-cli 2.34 / pnpm 9.15.9 / pm2 7.0.1. Postgres roles exact: `eventpulse_app` non-super/non-BYPASSRLS, `eventpulse_admin` BYPASSRLS, pool-owner non-super. DB `eventpulse_prod` + citext/pgcrypto. Services active; swap 2G/swappiness10.

## 🟢 PRs merged

- **PR #262** `feat(infra): prod EC2 provisioning IaC` MERGED (`17394f7`) — provision/bootstrap/nginx-vhost/deploy-marker + 3 bug-fix commits.
- **PR #263** `memory: Day 45 …` MERGED (`69a261d`).
- **This session's prod-LIVE memory** → its own new PR (`memory/day45-prod-live`).

## ⚠️ 3 latent script bugs caught + fixed this session (all in PR #262)

1. **provision-prod.sh** called `aws secretsmanager` but Ubuntu 24.04 ships no AWS CLI → added AWS CLI v2 install (`369c2e6`).
2. **setup-github-oidc.sh** (a) conflated the GitHub env-name with the role/file suffix — prod's `deploy-prod.yml` declares `environment: name: production` but role/file use `prod`; added `GH_ENVIRONMENT` (pass `production` for prod). (b) used bash-4 `${VAR^}`/`${VAR^^}` → broke on macOS bash 3.2; made portable via python3/tr (`c0459f7`).
3. **setup-kyc-bucket.sh** `render_template` checked vars via `${!v}` (sees non-exported) then ran `envsubst` (child — needs EXPORTED) → KYC_KMS_KEY_ARN rendered empty on the alias-reuse path → empty KMSMasterKeyID. Added `export` in the loop (`b20ec0d`). **Staging KYC encryption VERIFIED CORRECT** (uses dedicated CMK `761fc958…` = `alias/eventpulse-kyc-staging`) — flag CLEARED, no remediation. A 4th gap found post-merge (non-blocking, not yet codified): **`bootstrap-prod.sh` should `rm -f /etc/nginx/sites-enabled/default`** — the stock Ubuntu site collided with the prod vhost's `default_server` (fixed live on the box; a fresh re-run would hit it).

## 🎯 Next session — remaining cutover (prod is already LIVE)

Done: #1 (provision+app), #2 (DNS), #3 (cert), #4 (OIDC), #6 (KYC), budget alarm. Remaining:

1. **Codify 2 follow-ups** (small infra PR): (a) `bootstrap-prod.sh` `rm -f /etc/nginx/sites-enabled/default`; (b) re-deploy prod (`deploy.sh main` via SSM) to populate legal/changelog static pages now that `api.eventpulse.com.bd` is reachable (build-time fetch failed pre-DNS).
2. **#8 §17.11 alarms** — 7 on prod. CPU works on default metrics; **mem>90% / disk>80% need the CloudWatch agent installed** (provision-prod.sh does NOT install it — add it or install ad-hoc). + **Phase 4 SNS prod wiring** (copy Day-40 staging procedure with `-prod` suffixes + `api.eventpulse.com.bd` URLs) → then **flip `MAIL_DRY_RUN=0`** on prod (`.env.production` + `pm2 reload api --update-env`).
3. **#7 prod-branch ff-merge** (`origin/prod` @ `21dad2cc` → main) — so `deploy-prod.yml` exists on the prod branch for CI-based deploys (the OIDC role `eventpulse-deploy-prod` + GH secrets are already set; `PROD_DEPLOY_ENABLED` is OFF).
4. **#5 remaining secrets** — oauth-google/apple optional (else clean 503); jwt auto-created.
5. **§7 security checklist sweep** (launch-readiness.md §7), then **BDT-100 prod EPS smoke** — GATED: operator on-call + lift `STAGING_PAYMENT_BLOCK` on prod per runbook §4 (prod `.env` boots it =1), real bKash BDT-100 + refund, confirm 175bps. **High-severity — needs explicit per-step authorization (harness gates prod deploys/payments).**
6. **Decommission staging** (only after smoke passes) — drops cost back to ~$26-28/mo and resolves the ceiling overlap.

**Cost now ~$45/mo (overlap).** Remaining steps ~$0 except CW agent metrics + ~7 alarms (~$0.70). Decommission staging is what restores the ceiling.

## Standing invariants (unchanged)

- $30/mo ceiling; decommission-staging-at-launch is the plan to hold it.
- prod `.env.production` boots `STAGING_PAYMENT_BLOCK=1` + `MAIL_DRY_RUN=1` (deliberate; lifted at smoke/Phase-4 respectively).
- `EPS_MODE=production` (from eventpulse/prod/eps).
- Money math only via fee-calculator.ts. RLS roles via the exact 3-role model (self-checked by provision-prod.sh).
- Memory commits via PRs, separate from feature commits. Branch protection on main.
- Prod box not publicly reachable yet (no prod DNS; nginx serves default page).
