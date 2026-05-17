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

**Software install** in progress on EC2 via SSM SendCommand. First attempt (id `651ab3e2…`) failed because base AMI lacks AWS CLI. Retried v2 with bootstrap commands that install `awscli` from apt then S3-pull the install script (id `c7e93f74-3ca8-416e-a23b-ed8276b57845`). When complete, Node 22 + PG 16 + Redis 7 + Nginx + certbot (+ snap dns-route53 plugin) + pm2 + CloudWatch Agent + fail2ban will all be installed and the `eventpulse` system user + `eventpulse_staging` Postgres DB + `eventpulse_admin` BYPASSRLS role will exist.

## Where we are in §26.1

- Day 1-2 → **done** (last session)
- Day 3-4 → **80% done** (Phases 1-4 fully done; 5a in flight; 5b + 6 pending)
- Day 5-6 (identity schema + RLS) — queued
- Day 7-8 (4 auth methods) — queued
- Day 9-10 (SES + PM2 + deploy.sh) — queued

## Immediate next steps the autonomy session will tackle (in order)

1. Finish Phase 5a (install) + 5b (Nginx + Postgres config + index page)
2. Phase 6: issue Let's Encrypt **STAGING** cert first as a dry-run; on success, switch to LE **production** for the 5 SAN list; reload Nginx for HTTPS
3. Verify HTTPS responds 200 on `https://staging.eventpulse.com.bd/health` and the other 4 hostnames
4. Open PR `feat/day-3-4-ec2-route53` → main, let CI run, squash-merge
5. Switch to Day 5-6 branch, write Drizzle identity schema + RLS migrations + tests (this is the big work item — playbook §9.1 + §9.14 + §9.15 expanded for v2.1)
6. Day 7-8 + Day 9-10 in subsequent PRs if time permits in the 12-hour window

## Open questions / decisions that need Moshiur's sign-off on his return

- **AWS Budgets at $40/mo** — I will create this myself as the cost canary (consistent with the §17.11 monitoring philosophy). Confirm OK or change the threshold.
- **`security@eventpulse.com.bd` mailbox** — does not yet exist. For staging LE cert I'm using `moshiur@publicpulse.com.bd` as the registration email; production cert deferred until mailbox set up. Suggest setting up an SES inbound rule to forward `security@`, `legal@`, `privacy@`, etc. to a personal mailbox before going to production.
- **GitHub plan upgrade** — still on Free. Branch protection on `main`/`prod` still discipline-only. Bump to Pro the day a second person gets repo access. See `gotchas.md`.
- **§29 #9 (AIT/withholding)** + **§29 #10 (VAT/Mushak)** — book legal consult by week 4-5 of Phase 1. Not blocking dev but blocking go-live.
- **7 slash commands** — content was placeholder last time. Re-send when ready.

## Half-done items at this moment

- Phase 5a install command (`c7e93f74…`) running. If it succeeds the next configure command runs automatically. If it fails I will diagnose and retry — but I will NOT proceed to cert issuance until the stack is verifiably up.
- Memory not yet committed since the 16th's IAM-bootstrap commit. Will commit batch 1 (decisions + gotchas + progress + handoff) before moving to the next sub-task.

## Hard guardrails I am operating under

- Single EC2 only — no production instance during dev, no RDS, no ALB, no ECS, no Lambda, no managed-pricey-service. Co-located stack per §17.1.
- ~$22/month projected. AWS Budget canary at $40 to catch drift.
- No SSH key, no port 22. All shell access via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main` or `prod`. All work via feature branches + PR; squash to main; merge-commit to prod.
- Memory commits (`memory:` prefix) separate from feature commits.
- No fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts` (will land in Day 9-10 or later).
