# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-17 (Sprint 1 → Sprint 2 boundary)
**Driver:** Claude Code (Opus 4.7) — operating /sprint protocol after Moshiur's "sprint" command

## State right now

**Sprint 1 closed. Tag `v0.1.0-sprint-1` published at commit `53ae000`.**

```text
53ae000 chore: install workflow slash commands + log SES sandbox-exit request (#51)
cd76e97 memory: end of Sprint 1 + 12h autonomy window closeout (#50)
f41f9e0 feat(infra): Sprint 1 Day 9-10 — SES + PM2 + deploy scripts (#49)
7f7707e feat(auth):  Sprint 1 Day 7-8 — argon2id + sessions + magic links + JWT (#47)
ddffd96 feat(db):    Sprint 1 Day 5-6 — identity schema + RLS + cross-tenant tests (#43)
61fb2b4 feat(infra): Sprint 1 Day 3-4 — EC2 + Route 53 + TLS staging up (#42)
```

GitHub release page: <https://github.com/publicpulseagency/EventPulse/releases/tag/v0.1.0-sprint-1>.
All 14 Sprint 1 issues (#21-#34) closed against their respective merged PRs.

**Sprint 2 plan presented to Moshiur for approval.** No code written yet — explicit instruction is "Show me the plan, wait for approval before Day 11 starts." Plan covers Days 11-20 in ~16 atomic items per the next-section breakdown.

## Sprint 2 plan (awaiting approval)

**Days 11-12 — Foundation re-baseline.** CLAUDE.md v2.2 PR (auth swap + SSM/EBS/DNS clarifications + BYPASSRLS role-hierarchy guidance to §4). RLS migration 0003 with `app.current_user_id` + `withUser()` helper. OAuth callback routes (Google + Apple). Real staging deploy via `deploy.sh` first run.

**Days 13-15 — KYC pipeline.** S3 + KMS bucket (CHECKPOINT #2 before creation). `kyc_submissions` + RLS. Signed-URL upload API. State machine + audit + notifications. eTIN regex. BFIU sanctions JSON seed (CHECKPOINT #5 before code).

**Days 16-18 — KYC UI.** Tenant Account-Type modal, KYC wizard (individual + org). Super admin review queue with manual NID fields + approve/reject. CHECKPOINT #4 default: super admin only.

**Day 19 — Trust Center scaffolding.** `legal_documents` + `legal_document_versions` tables. 18 placeholder pages with "DRAFT" banner. Super admin editor with version control. CHECKPOINT #3 before any v1.0 content.

**Day 20 — Porichoy scaffold + sprint closeout.** Adapter interface + env vars + Secrets Manager placeholder + TODO. CHECKPOINT #1 immediately before: procurement status check. Tenant subdomain provisioning logic. KYC notification templates. Sprint 2 retro + `v0.2.0-sprint-2` tag.

## Five human-required checkpoints (non-negotiable, including under autonomy)

1. Porichoy procurement status — before Day 19-20
2. S3 bucket region + per-tenant prefix — before bucket creation
3. First Trust Center document content — before any v1.0 contracts land
4. KYC reviewer role assignment — before building the review UI (default: super admin only)
5. BFIU sanctions list source — before any matching code runs

## AWS resources (unchanged from Sprint 1 close)

- **Compute:** EC2 `i-02e4fddeb923c14f9` (t3.small, Ubuntu noble, 30GB gp3 KMS-encrypted, IMDSv2, instance profile attached, SSM Online). Elastic IP `18.141.7.246` attached.
- **Security:** SG `sg-0f4fd53e848eda1f9` (80/443 v4+v6 only — no port 22). IAM role `eventpulse-staging-ec2` + instance profile. KMS CMK `f8eeb424-6c1f-4c14-bc79-aae499815cb8` aliased `alias/eventpulse-staging` (rotation on).
- **Storage:** S3 `eventpulse-staging-ssm-logs` (KMS, BlockPublicAccess, 90d lifecycle). CW Logs group `/eventpulse/staging/ssm-sessions` (KMS, 90d retention). SSM document `SSM-SessionManagerRunShell` with logging targets.
- **DNS:** Route 53 hosted zone `Z003493917KJX7VCR8ZMR`. 5 staging A records (`staging`, `app.staging`, `admin.staging`, `api.staging`, `my.staging`). 3 SES DKIM CNAMEs + SPF + DMARC.
- **Email:** SES domain verified, DKIM SUCCESS (RSA 2048). Sandbox-exit request submitted; awaiting AWS Support response.
- **TLS:** LE prod cert covering 5 SAN names; expires 2026-08-15; certbot timer auto-renews.
- **Cost:** AWS Budget `eventpulse-monthly` $40/mo with 50%/80%/forecast-100% alerts.

## On-the-box (EC2)

Node 22.22.2 + pnpm 9.15.9 + pm2 7.0.1 + Postgres 16.14 (cluster `eventpulse_staging` with all identity tables + RLS forced) + Redis 8.6.3 + Nginx 1.24 + certbot 5.6 + CloudWatch Agent + fail2ban. **Real app artefact not yet deployed — Nginx still serves the placeholder.** First real deploy is Day 11-12 of Sprint 2.

## Process amendments for Sprint 2

- `/review` runs **before every commit** that touches KYC code (PII + §1.3 R4)
- `/end` runs at the end of **each working day**, not just at sprint closeout
- Procurement check at every sprint kick-off (done for Sprint 2 in the kick-off decision)

## Open questions for Moshiur

- **Sprint 2 plan approval** — waiting on go-signal for Day 11 to start
- **AWS Budget threshold** — still $40/mo. Adjust if too low/high for Sprint 2 (S3 bucket + KMS will add small ongoing cost; KYC docs are small)
- **§29 #9 (AIT/withholding) + #10 (VAT/Mushak)** — book legal consult by Phase 1 Week 4-5; relevant before any disbursement code lands
- **`security@eventpulse.com.bd` mailbox** — still doesn't exist; SES inbound + S3 + Lambda forwarder is the proper solution, scheduled for Sprint 3
- **GitHub plan upgrade** — still on Free. Branch protection still pre-push-hook + CI gates only

## Half-done items at this moment

None — Sprint 1 is fully closed at the tag and Sprint 2 has not yet been authorised to start.

## Hard guardrails (unchanged)

- Single EC2 only — no production instance during dev, no RDS, no ALB, no ECS. ~$22/mo projected, $40/mo canary.
- No SSH, no port 22. All shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main` or `prod`. Feature branches + PR; squash to main. Tag pushes from main use `--no-verify` per documented override; log to gotchas.md if used.
- Memory commits (`memory:` prefix) separate from feature commits where the change is about persistent project knowledge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- Treat §21.3 host-liability clause as load-bearing — do not weaken via code defaults or UX implying platform endorsement.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Run a query against staging Postgres (from the EC2 shell)
sudo -u postgres /usr/lib/postgresql/16/bin/psql -d eventpulse_staging

# Trigger a staging deploy
aws ssm send-command --document-name AWS-RunShellScript \
  --instance-ids i-02e4fddeb923c14f9 \
  --parameters 'commands=["sudo -u eventpulse bash -lc \"/home/eventpulse/app/infra/deploy/deploy.sh main\""]' \
  --profile eventpulse

# Check SES verification + budget
aws sesv2 get-email-identity --email-identity eventpulse.com.bd --profile eventpulse
aws budgets describe-budgets --account-id 739275468267 --profile eventpulse

# Sprint 1 release
gh release view v0.1.0-sprint-1
```
