# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-17 (mid-session checkpoint during 12-hour autonomy window)
**Driver:** Claude Code (Opus 4.7) under autonomy mandate from Moshiur

## State right now

On branch `feat/day-3-4-ec2-route53` (un-pushed work-in-progress; will land via PR before any merge to `main`). `main` HEAD remains `edcd6f9` (last commit was the postcss bump #16).

**AWS resources live in `739275468267` / `ap-southeast-1`:**

- KMS CMK `f8eeb424-6c1f-4c14-bc79-aae499815cb8` aliased `alias/eventpulse-staging` (rotation on)
- IAM role `eventpulse-staging-ec2` + instance profile (same name) — `AmazonSSMManagedInstanceCore` + `eventpulse-staging-app` inline + `eventpulse-staging-acme-route53` inline (scoped to zone `Z003493917KJX7VCR8ZMR`)
- S3 bucket `eventpulse-staging-ssm-logs` (BlockPublicAccess all, KMS encryption, versioning, 90d lifecycle, TLS-only + KMS-only bucket policy)
- CW Logs group `/eventpulse/staging/ssm-sessions` KMS-encrypted, 90d retention
- SSM document `SSM-SessionManagerRunShell` configured with both S3 + CW Logs sinks
- Security group `sg-0f4fd53e848eda1f9` ("eventpulse-staging-web") inbound 80/443 v4+v6 only — **no port 22**
- Elastic IP `eipalloc-0641d86f38bbf5ef0` = **`18.141.7.246`** attached to instance
- EC2 `i-02e4fddeb923c14f9` (t3.small, Ubuntu 24.04 noble AMI `ami-04592e28abc2b9fc9`, 30GB gp3 KMS-encrypted, IMDSv2 required, in `subnet-094036f117b4a2934` AZ `ap-southeast-1b`, instance profile attached, SSM agent Online)
- Route 53: 5 staging A records under zone `Z003493917KJX7VCR8ZMR` (`staging`, `app.staging`, `admin.staging`, `api.staging`, `my.staging` → `18.141.7.246`), TTL 300, change `C0701652V9QV6127UVNF` INSYNC

**Software install** COMPLETE on EC2: Node 22.22.2, pnpm 9.15.9, pm2 7.0.1, Postgres 16.14 cluster running on `:5432` with `eventpulse_staging` DB + pgcrypto + citext extensions, `eventpulse_admin` BYPASSRLS role, Redis 8.6.3 on localhost:6379, Nginx 1.24 with HTTP-to-HTTPS redirect vhost + HTTPS vhost serving `/health` and `/`, certbot 5.6 with auto-renew systemd timer, CloudWatch Agent installed (not yet configured), fail2ban running.

**TLS cert** issued by Let's Encrypt (production server) covering all 5 SAN names — `staging.eventpulse.com.bd`, `app.staging.eventpulse.com.bd`, `admin.staging.eventpulse.com.bd`, `api.staging.eventpulse.com.bd`, `my.staging.eventpulse.com.bd`. ECDSA, issuer "E7", expires 2026-08-15. Auto-renew via certbot's systemd timer.

**HTTPS verified externally:** all 5 hostnames respond HTTPS 200; HTTP returns 301 to HTTPS. The placeholder page renders.

**AWS Budget** `eventpulse-monthly` set at $40/mo USD with email alerts at 50% actual, 80% actual, and forecast 100% to `moshiur@publicpulse.com.bd`. Confirm-or-change on Moshiur's return.

## Where we are in §26.1

- Day 1-2 → **done** (last session)
- Day 3-4 → **done** (PR pending merge to main; commit `0ae79a1` memory + AWS infra all live)
- Day 5-6 (identity schema + RLS) — **next**, will land on branch `feat/day-5-6-identity-schema`
- Day 7-8 (4 auth methods) — queued
- Day 9-10 (SES + PM2 + deploy.sh) — queued

## Immediate next steps the autonomy session will tackle (in order)

1. Open PR `feat/day-3-4-ec2-route53` → main, let CI run, squash-merge
2. Switch to Day 5-6 branch, write Drizzle identity schema (`users`, `tenants` + `is_personal`/`owner_user_id`, `oauth_identities`, `magic_links`, `sessions`, `tenant_users`, `super_admins`, `tenant_fee_config`, `fee_override_log`, `reserved_handles`, `handle_history`, `event_reports`) + RLS policies + cross-tenant RLS negative tests + reserved-handles seed
3. Day 7-8: Auth flows (Lucia + email/pw + magic link + Google OAuth via arctic + Apple Sign-In via arctic with JWT client_secret)
4. Day 9-10: SES domain identity + transactional templates + PM2 ecosystem + deploy.sh/rollback.sh, CI green end-to-end

## Open questions / decisions that need Moshiur's sign-off on his return

- **AWS Budgets at $40/mo** — I will create this myself as the cost canary (consistent with the §17.11 monitoring philosophy). Confirm OK or change the threshold.
- **`security@eventpulse.com.bd` mailbox** — does not yet exist. For staging LE cert I'm using `moshiur@publicpulse.com.bd` as the registration email; production cert deferred until mailbox set up. Suggest setting up an SES inbound rule to forward `security@`, `legal@`, `privacy@`, etc. to a personal mailbox before going to production.
- **GitHub plan upgrade** — still on Free. Branch protection on `main`/`prod` still discipline-only. Bump to Pro the day a second person gets repo access. See `gotchas.md`.
- **§29 #9 (AIT/withholding)** + **§29 #10 (VAT/Mushak)** — book legal consult by week 4-5 of Phase 1. Not blocking dev but blocking go-live.
- **7 slash commands** — content was placeholder last time. Re-send when ready.

## Half-done items at this moment

- Day 3-4 PR not yet merged to `main`. Will open + squash-merge as the next sub-task.
- Day 5-6 / 7-8 / 9-10 not yet started.

## Hard guardrails I am operating under

- Single EC2 only — no production instance during dev, no RDS, no ALB, no ECS, no Lambda, no managed-pricey-service. Co-located stack per §17.1.
- ~$22/month projected. AWS Budget canary at $40 to catch drift.
- No SSH key, no port 22. All shell access via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main` or `prod`. All work via feature branches + PR; squash to main; merge-commit to prod.
- Memory commits (`memory:` prefix) separate from feature commits.
- No fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts` (will land in Day 9-10 or later).
