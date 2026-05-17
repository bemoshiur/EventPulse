# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-17 (end of Sprint 2 Day 12)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 12 closed. Item 6 (KYC bucket + dedicated CMK) merged to main at `a422847`.**

```text
a422847 feat(infra): Sprint 2 Item 6 — KYC bucket + dedicated CMK (#64)
9d83172 memory: Sprint 2 Item 5 closeout — first real staging deploy + 7 gotchas (#63)
58c96f6 fix(api): tsconfig.build inherits declarationMap=true from base; turn it off (#62)
51c1fad fix(infra): override NODE_ENV for install to force devDeps (#61)
0ac609f fix(infra): deploy install uses NPM_CONFIG_PRODUCTION + auto-confirm modules purge (#60)
4265b5a fix(infra): deploy.sh installs devDeps (--prod=false) + HUSKY=0 (#59)
```

## What landed in Day 12

- **AWS** (account 739275468267, ap-southeast-1):
  - Dedicated KMS CMK `761fc958-d62b-47cb-9b16-575afad0c8e9` aliased `alias/eventpulse-kyc-staging` (rotation on)
  - S3 bucket `eventpulse-kyc-staging` with 6 security controls (BlockPublicAccess all-on, versioning, BucketOwnerEnforced, SSE-KMS default w/ BucketKey, lifecycle Glacier_IR-at-30d on `tenants/`, bucket policy with 6 deny statements)
  - EC2 role `eventpulse-staging-ec2` inline policy `eventpulse-staging-app` extended with 3 KYC-scoped statements (now 11 total)
  - Secrets Manager `eventpulse/staging/kyc` JSON entry with bucket+key identifiers
- **Repo:** `infra/scripts/setup-kyc-bucket.sh` (developer-side, idempotent, ENVIRONMENT-parameterised for prod cutover); 5 envsubst templates under `infra/scripts/kyc-bucket/`; `infra/scripts/bootstrap-staging.sh` extended to materialise `KYC_BUCKET_NAME` + `KYC_KMS_KEY_*` into `.env.staging` (secret_put hardened: file:// via 0600 temp file, not argv); decisions.md entry for Checkpoint #2; gotchas.md entry for `StringNotEqualsIfExists` semantics.
- **Verification (live, post-deploy):** 6 negative tests green — HTTP/HTTPS-anon GET → 403; PUT no SSE → AccessDenied; PUT SSE=aws:kms no key-id → AccessDenied (M1 fix); PUT wrong key-id → AccessDenied; PUT correct explicit key → OK.

## Next concrete step

**Day 13 — Items 7+8 bundled (PR target).** `kyc_submissions` Drizzle schema + migration 0004 (RLS forced, tenant_id-scoped + `current_user_id`-derived audit columns) PAIRED with the signed-URL upload API (`POST /tenant/kyc/upload-url`). The API reads `KYC_BUCKET_NAME` + `KYC_KMS_KEY_ARN` from `.env.staging` and generates a pre-signed PUT with `ServerSideEncryption: 'aws:kms'` + `SSEKMSKeyId: '<CMK ARN>'` headers baked into the signature (so the M1 deny doesn't trip in production). One PR, one `/review` pass (KYC-touching code per Sprint 2 mandate).

## Half-done items at this moment

- None on Day 12 work itself.
- **Day 12 carries (queued, not started — not blocking Day 13):**
  - Codify Postgres role/grant/ownership setup into `bootstrap-staging.sh` (from Item 5 — currently runtime state on the EC2 only)
  - Add `pnpm --filter @eventpulse/api build` to CI matrix (would have caught the Item 5 declarationMap issue pre-deploy; would NOT have caught the Item 6 prettier issue since the JSON files are in `infra/`, not `apps/`)
  - Enable `STAGING_DEPLOY_ENABLED=true` after 1-2 more manual deploy cycles
  - Reviewer S4: dedicated key-admin role for the KYC CMK
  - Reviewer S6: revisit noncurrent-version transitions

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued as Moshiur's parallel-track responsibility per Sprint 2 kick-off. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **`infra/compliance/sanctions.json`** (BFIU public-notice seed) — Moshiur to pre-stage before Day 14 (Item 10). If absent at start of Day 14, Claude Code STOPS and surfaces; will not invent from web search.
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency; if not obtained by end of Sprint 2, email `integration@eps.com.bd` via the template in prior memory.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.
- **AWS Budget** still at $40/mo. Item 6 added ~$1/mo (KMS CMK) + tiny S3 storage — well within. No action needed.
- **`security@eventpulse.com.bd` mailbox** — still doesn't exist; SES inbound + S3 + Lambda forwarder scheduled for Sprint 3 (carried).

## Sprint 2 standard execution mode (confirmed at Day 12 kick-off, in force for Days 13-20)

- One session per day. `/start` reads context + proposes focus; `/end` updates progress.md + handoff.md + any new gotchas same-day.
- `/review` (iac-reviewer or feature-dev:code-reviewer subagent) **before every commit on KYC-touching code** (Items 6-13). Not at end of day. Every commit. PII + §1.3 R4 sensitivity demands it.
- Memory commits separate from feature commits. `memory:` prefix for memory-only; `feat:` / `fix:` / `style:` / `docs:` for everything else. (Same PR is fine; squash collapses.)
- STOP-ASK in force for §29 Open Decisions, contradictions with decisions.md, RLS policies that can't be justified against §4, money math outside `fee-calculator.ts`, AWS writes with prod blast radius, anything committing to a legal/regulatory position not already in decisions.md.

## Day plan (remaining Sprint 2)

- Day 13 — Items 7+8 (schema + upload API), bundled, one PR
- Day 14 — Items 9 + 10 (state machine + sanctions/eTIN; CHECKPOINT #5 gates Item 10)
- Day 15 — Item 11 (Account-Type modal)
- Day 16-17 — Item 12 (KYC wizard, two-day)
- Day 18 — Item 13 (review queue; CHECKPOINT #4 = super-admin-only confirmed)
- Day 19 — Items 14+15 bundled (Trust Center + Legal & Trust editor; CHECKPOINT #3 = skeleton-only confirmed)
- Day 20 — Item 16 (Porichoy scaffold; CHECKPOINT #1 = scaffold-only confirmed) + notifications + provisioning + `/sprint` retro + `v0.2.0-sprint-2` tag + release notes + Sprint 3 kick-off issue

## Hard guardrails (unchanged)

- Single EC2 only. No prod instance during dev. No RDS/ALB/ECS. ~$22/mo + $1 KYC CMK = ~$23/mo, $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX implying platform endorsement.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement; always pair `StringNotEquals` with a `Null` deny on the same key. Code review enforces.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy
aws ssm send-command --document-name AWS-RunShellScript \
  --instance-ids i-02e4fddeb923c14f9 \
  --parameters 'commands=["sudo -u eventpulse bash -lc \"/home/eventpulse/app/infra/deploy/deploy.sh main\""]' \
  --profile eventpulse

# Re-run KYC bucket setup (idempotent — re-applies all settings)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Verify KYC bucket security still in place
aws s3api get-bucket-policy --bucket eventpulse-kyc-staging --profile eventpulse \
  --query 'Policy' --output text | jq '[.Statement[].Sid]'
# Expect: ["DenyInsecureTransport","DenyPutWithoutKmsHeader","DenyPutWithWrongKmsKey",
#          "DenyPutWithoutExplicitKmsKeyId","DenyUnencryptedTransitMetadata",
#          "DenyDestructiveActionsByEC2Role"]
```
