# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-17 (end of Sprint 2 Day 14)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 14 closed. Item 9 PR merged to main + 2 memory PRs (Item 10 scope amendment + Day 14 closeout) landed.**

```text
<pending>     memory: Sprint 2 Day 14 closeout — Item 9 shipped + audit_logs scope decision + 2 new gotchas (this PR)
d9d765f       feat(api): Sprint 2 Day 14 — Item 9 KYC submission state machine + submit endpoint + audit trail + notification scaffolding (#70)
42f1bb9       memory: log Sprint 2 Item 10 scope amendment — third-party verification deferred to manual review (#69)
9622c93       memory: Sprint 2 Day 13 closeout — KYC pipeline shipped + canonical OIDC pattern + 4 new gotchas (#68)
977df1b       feat(infra): Sprint 2 Day 13 closeout — GitHub OIDC infra + deploy.sh SHA handling (#67)
7c30539       feat(api): Sprint 2 Day 13 — KYC pipeline foundations (Items 7 + 8) (#66)
```

## What landed in Day 14

**Morning — Sprint 2 plan amendment (PR #69 `42f1bb9`):**

- Item 10 (eTIN regex + BFIU sanctions matcher) deferred to Phase 2 — same operational pattern as the Porichoy deferral two days earlier
- Day 14 reduced to Item 9 only; Item 10 residual (surface eTIN/NID in reviewer UI) absorbs into Item 13 (Day 18)
- Checkpoint #5 dissolved — `infra/compliance/sanctions.json` no longer in Sprint 2 scope; do NOT pre-stage
- CLAUDE.md §13.0 update queued for Sprint 2 closeout v2.3 bump

**Item 9 (PR #70 `d9d765f`):**

- Migration 0005 — `kyc_submissions.status` CHECK widened to add `draft` (for `rejected → draft` resubmit lane); new `audit_logs` table per §9.10 with RLS forced + tenant-scoped policies + REVOKE UPDATE/DELETE/TRUNCATE FROM eventpulse_app for defence-in-depth immutability (§1.3 R8)
- KYC state machine module (`apps/api/src/domain/kyc/state-machine.ts`) — `transition()` for existing rows only (row creation routed through route handler since de-facto-draft is the upload-url step); `canTransition()` predicate; `InvalidKycTransitionError` with greppable from/to
- Audit helper (`apps/api/src/services/audit/kyc.ts`) — `writeKycTransition(tx, ...)` writes atomically inside withTenant tx
- Three notification stubs (`apps/api/src/services/notifications/kyc.ts`) — `kyc_submitted`/`approved`/`rejected` with `[STUB]` log marker and Item 16 TODO
- `POST /api/v1/tenant/kyc/submissions` — discriminated zod (individual + tier_1/2/3 vs organisation + org_a/b/c), client-supplied submissionId as row PK for natural idempotency, server regenerates `documents` jsonb as `s3://` URIs from JWT tenantId via new `buildKycObjectUri()` (extracted into `infra/s3/client.ts` as single source of truth), atomic withTenant tx with INSERT … ON CONFLICT DO NOTHING + SELECT-back, cross-tenant submissionId conflict → 409, notification fire-and-forget after commit with logged `.catch()` (per /review finding #3 to prevent 500-after-commit risk when Item 16 wires real SES)
- 33 new tests: 17 state-machine unit + 8 audit_logs RLS + 8 submit-endpoint integration. All gated by `describeIfDb` so they auto-skip locally without DATABASE_URL; CI's integration-tests job runs them against PG 16
- /review (feature-dev:code-reviewer): finding #3 (high — notification 500-after-commit) fixed in-PR; findings #2 + #4 (medium) clarified with comments; finding #1 (low — audit_logs unset-GUC smoke test) queued to Sprint 2 closeout

**Evening — audit_logs scope decision logged (this memory commit):**

- audit_logs writes at Item 9 are KYC-transitions-only by design, not by oversight (decision logged with full rationale)
- S3 signed URL issuance backfill → Sprint 2 closeout (single helper call in `getKycUploadUrl`; KYC-scoped, natural extension of Item 6+7+8 work)
- Auth events backfill (sign-in/out, magic-link issued/consumed, OAuth link) → Sprint 3 paired with the session-revocation fix as a single auth-hardening PR

## Next concrete step

**Day 15 — Item 11: post-login Account-Type modal.** Per §1.6 ("Account type chosen on first dashboard load via a friendly modal, not at sign-up") + §2.4 (the modal kicks the user into the appropriate onboarding path — Path A self-service free, Path B self-service paid, Path C organisation).

**Item 11 scope (planned, subject to refinement at Day 15 `/start`):**

- New `/dashboard/account-type` modal route (Next.js app router under `(tenant)`) — shows on first dashboard load when `users.account_type_chosen_at` is null
- Three cards: "Host events for myself" (individual, Path A/B), "Host events for an organisation I represent" (org, Path C), "Just here to attend / browse" (attendee context, no tenant)
- Persists choice to `users.account_type_chosen_at` + writes audit row (`action='user.account_type_chosen'`, `entity_type='user'`) — wire `writeAuditEvent` helper for non-KYC actions OR keep KYC-specific writer and add a thin generic helper (Day 15 plan decides)
- Frontend work: design system Card + Glass primitives, modal with backdrop blur, three CTA cards with hover-lift animation per §1.5 motion principles
- Routing follow-through: individual → `/dashboard` (no KYC gate yet, paths A/B), org → `/dashboard/kyc/wizard` (gates publishing per CHECKPOINT #4), attendee → `/my` redirect

**STOP-ASK conditions** for Day 15 (same protocol as Days 12-14):

- New table or schema column needed beyond what the modal requires → halt
- Any AWS write beyond staging blast radius → halt
- §29 Open Decision arising mid-item → halt
- Contradictions with decisions.md → halt
- Audit writer pattern question (KYC-specific vs generic helper) → halt and surface as a design decision

## Sprint 2 standard execution mode (still in force for Days 15-20)

- One session per day. `/start` reads context + proposes focus; `/end` updates progress.md + handoff.md + any new gotchas same-day.
- `/review` (iac-reviewer or feature-dev:code-reviewer subagent) **before every commit on KYC-touching code** (Items 6-13). Every commit. PII + §1.3 R4.
- Memory commits separate from feature commits. `memory:` prefix for memory-only.
- STOP-ASK in force for §29 Open Decisions, contradictions with decisions.md, RLS policies unjustified against §4, money math outside `fee-calculator.ts`, AWS writes with prod blast radius, anything committing to a legal/regulatory position not already in decisions.md.

## Scheduled mid-sprint PR slots (carved out of the original closeout bundle 2026-05-18)

- **Day 18 AM — v2.3 CLAUDE.md playbook bump (dedicated PR, runs BEFORE Item 13 starts).** Synchronises the playbook with reality so Items 13 + 14 + 15 don't build against stale text. Bundles:
  - §17 amendment — canonical OIDC trust pattern (three-claim shape) as project standard
  - §13.0 amendment — drop "eTIN format check: local regex" + "BFIU sanctions screening: manual list-check against `infra/compliance/sanctions.json`" language (Item 10 deferred)
  - §13.3 amendment — document the `draft` state added in migration 0005 for the `rejected → draft` resubmit lane
  - §9.1 amendment — `tenants.type` nullable (Item 11 / migration 0006 relaxed NOT NULL)
  - §4.2.1 amendment — append-only audit-table invariant (REVOKE UPDATE/DELETE pattern per Day 14 gotcha)
  - Any additional §-touching decisions that land Days 16-17
- **Day 20 AM — OAuth sign-in bug fix (dedicated PR, runs BEFORE `/sprint` retro).** Discovered 2026-05-17 evening while investigating `https://staging.eventpulse.com.bd/sign-in`:
  - Button hrefs `/api/auth/{provider}/start` 404 on the web vhost (actual API routes live at `https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/{provider}/start`)
  - OAuth credentials never provisioned: `eventpulse/staging/oauth-google` + `eventpulse/staging/oauth-apple` Secrets Manager entries don't exist; `googleClient()`/`appleClient()` throw on first request → 500
  - Code-fix scope (this PR): switch hrefs to absolute `NEXT_PUBLIC_API_BASE_URL` + correct `/api/v1/auth/oauth/...` path; extend `bootstrap-staging.sh` to materialise OAuth secrets into `.env.staging` like the existing KYC step does
  - Credential-provisioning (parallel-track Moshiur): create Google OAuth 2.0 Client + Apple Services ID / private key with staging callback URLs registered; hand back so Claude Code can write the Secrets Manager entries

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 release — NOT bundled into the v2.3 playbook bump)

- **S3 signed URL issuance audit_logs backfill** — single audit write inside `getKycUploadUrl()` (per Day 14 evening decision).
- **audit_logs unset-GUC smoke test** — one-test follow-up to `rls-cross-tenant.test.ts` per Day 14 /review finding #1.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d trade-off.
- KYC `documents` / `fields` jsonb tightening — pairs with Day 16-17 wizard.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and later `prod`) — already a Sprint 1 carry; pairs with the canonical OIDC pattern decision.
- Sprint 4 — `eventpulse-deploy-prod` role using the same canonical three-claim pattern with `environment:production` + `deploy-prod.yml@refs/heads/prod`.
- **Sprint 3 auth-hardening bundle PR** — session revocation fix in `apps/api/src/auth/middleware.ts` `extractAndVerify` (moved from Sprint 2 closeout per Day 14 decision so it can be joint-reviewed with the auth events backfill) + auth events audit_logs backfill (sign-in success/fail, sign-out, magic-link issued/consumed, OAuth link created).

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued as Moshiur's parallel-track responsibility per Sprint 2 kick-off. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency. If not obtained by end of Sprint 2, email `integration@eps.com.bd` via the template in prior memory.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.

## Hard guardrails (unchanged)

- Single EC2 only. ~$23/mo total (added $1 for KYC CMK Day 12; OIDC role + provider free). $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge. Auto-deploy on push-to-main is now live; the gate is `STAGING_DEPLOY_ENABLED=true`.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX implying platform endorsement.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: **canonical three-claim shape only** (aud + sub=environment + job_workflow_ref). Inline policies for SSM-based deploys include **both** `ec2:instance` and `ssm:managed-instance` ARN forms. See `decisions.md` for the project standard; PRs that diverge get rejected.
- **audit_logs is APPEND-ONLY** (§1.3 R8). No UPDATE/DELETE from application code; REVOKE enforces at the GRANT layer in addition to RLS policy absence. Retention sweeps go through a maintenance PR via `withSuperAdmin`.
- **Idempotent inserts under RLS** (e.g. ON CONFLICT DO NOTHING + SELECT-back) must handle the zero-rows-after-collision case as cross-tenant ownership (409 CONFLICT), not 404 or 500. See `gotchas.md` for the trap.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually (no longer needed in normal flow — push to main auto-deploys)
gh workflow run deploy-staging.yml --ref main

# Verify OIDC infra still in place
aws iam get-role --role-name eventpulse-deploy-staging --profile eventpulse \
  --query 'Role.AssumeRolePolicyDocument' --output json | jq '.Statement[0].Condition'
# Expect: StringEquals on aud + sub=environment:staging + job_workflow_ref

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent — for prod, swap ENVIRONMENT=prod + BRANCH=prod + INSTANCE_ID=...)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=publicpulseagency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh
```
