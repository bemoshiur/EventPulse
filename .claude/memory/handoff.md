# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-02 — **Day 45** of 47-day Phase 1 MVP runway. **Production EC2 cutover STARTED + provisioned end-to-end. Cutover sub-item #1 (prod EC2) DONE; #4 (deploy OIDC role) + #6 (KYC bucket) DONE.**
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

## 🟡 Open PRs (review + merge to unblock)

- **PR #262** `feat(infra): prod EC2 provisioning IaC` (feat/prod-cutover-iac) — provision-prod.sh + bootstrap-prod.sh + eventpulse-prod.conf + deploy.sh env-marker + the **3 bug-fix commits** (AWS-CLI install, OIDC env-name/portability, render_template export). **MUST MERGE before #1e-app** (the prod box `git fetch origin main`es bootstrap-prod.sh + the nginx vhost).
- **PR #263** `memory: Day 45 …` (this branch) — decisions.md + this handoff + progress + gotchas.

## ⚠️ 3 latent script bugs caught + fixed this session (all in PR #262)

1. **provision-prod.sh** called `aws secretsmanager` but Ubuntu 24.04 ships no AWS CLI → added AWS CLI v2 install (`369c2e6`).
2. **setup-github-oidc.sh** (a) conflated the GitHub env-name with the role/file suffix — prod's `deploy-prod.yml` declares `environment: name: production` but role/file use `prod`; added `GH_ENVIRONMENT` (pass `production` for prod). (b) used bash-4 `${VAR^}`/`${VAR^^}` → broke on macOS bash 3.2; made portable via python3/tr (`c0459f7`).
3. **setup-kyc-bucket.sh** `render_template` checked vars via `${!v}` (sees non-exported) then ran `envsubst` (child — needs EXPORTED) → KYC_KMS_KEY_ARN rendered empty on the alias-reuse path → empty KMSMasterKeyID. Added `export` in the loop (`b20ec0d`). **FLAG: staging KYC bucket encryption may have the same latent miss — verify staging's get-bucket-encryption uses the dedicated CMK, not SSE-S3/AWS-managed.** (Staging is test-only + slated for decommission, low urgency.)

## 🎯 Next session — resume the cutover

**First action: merge PR #262 + #263.** Then, in dependency order:
1. **#1e-app** (BLOCKED on #262 merge): SSM-run `bootstrap-prod.sh` on `i-0c41fae1286527654` (git checkout main + materialise `.env.production` + write `.eventpulse-env=production` + symlink prod vhost + pm2), then `deploy.sh main`. nginx -t will fail until #3 cert — expected.
2. **#7 prod-branch ff-merge** (`origin/prod` @ `21dad2cc` → main) — needed so `deploy-prod.yml` exists on the prod branch for the OIDC job_workflow_ref to match on real CI deploys.
3. **#2 Route 53** 8-record set → EIP 52.76.69.96 + **#3 wildcard cert** (DNS-01, `eventpulse.com.bd` + `*.eventpulse.com.bd`) — do close to go-live (makes prod publicly resolvable).
4. **#8 §17.11 alarms** (7 on prod; CW agent NOT installed → mem/disk alarms need it) + **Phase 4 SNS prod wiring** + **MAIL_DRY_RUN=0 prod flip**.
5. **#5 remaining secrets** — oauth-google/apple optional (else clean 503); jwt auto.
6. **§7 security checklist sweep**, then **BDT-100 smoke** (lift STAGING_PAYMENT_BLOCK on prod per runbook §4; the prod .env boots it =1), then **decommission staging**.

**Cutover-cost note:** remaining steps are ~$0 except whatever the alarms add (~$0.70). Steady-state lands ~$26-28/mo only AFTER staging decommission (post-smoke).

## Standing invariants (unchanged)

- $30/mo ceiling; decommission-staging-at-launch is the plan to hold it.
- prod `.env.production` boots `STAGING_PAYMENT_BLOCK=1` + `MAIL_DRY_RUN=1` (deliberate; lifted at smoke/Phase-4 respectively).
- `EPS_MODE=production` (from eventpulse/prod/eps).
- Money math only via fee-calculator.ts. RLS roles via the exact 3-role model (self-checked by provision-prod.sh).
- Memory commits via PRs, separate from feature commits. Branch protection on main.
- Prod box not publicly reachable yet (no prod DNS; nginx serves default page).
