# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-17 (end of Sprint 2 Day 13)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 13 closed. Two PRs merged to main + first end-to-end auto-deploy verified.**

```text
977df1b feat(infra): Sprint 2 Day 13 closeout — GitHub OIDC infra + deploy.sh SHA handling (#67)
7c30539 feat(api): Sprint 2 Day 13 — KYC pipeline foundations (Items 7 + 8) (#66)
cad2d62 memory: Sprint 2 Day 12 closeout — Item 6 (KYC bucket) shipped + StringNotEqualsIfExists gotcha (#65)
a422847 feat(infra): Sprint 2 Item 6 — KYC bucket + dedicated CMK (#64)
9d83172 memory: Sprint 2 Item 5 closeout — first real staging deploy + 7 gotchas (#63)
```

## What landed in Day 13

**Items 7+8 + 3 Day 12 carries absorbed (PR #66):**

- `kyc_submissions` table + RLS + per-table grants (migration 0004); 5 cross-tenant RLS tests; NO DeleteObject grant per BFIU §15.1
- `apps/api/src/infra/s3/client.ts` + `apps/api/src/routes/tenant/kyc.ts` with `POST /api/v1/tenant/kyc/upload-url`; SSE-KMS + key-id headers baked into presigned URL signature; 8 integration tests
- `bootstrap-staging.sh` step 0 (Postgres superuser prep — roles, ADMIN OPTION, ownership)
- `api-build` CI job mirroring `deploy.sh`'s build command
- `STAGING_DEPLOY_ENABLED=true` flipped

**Day 13 closeout (PR #67):**

- AWS OIDC provider `arn:aws:iam::739275468267:oidc-provider/token.actions.githubusercontent.com`
- IAM role `arn:aws:iam::739275468267:role/eventpulse-deploy/eventpulse-deploy-staging` with the **canonical three-claim trust** (aud + sub=environment + job_workflow_ref) per `.claude/memory/decisions.md` "Canonical GitHub Actions → AWS OIDC trust pattern (project standard)" 2026-05-17
- Inline policy `eventpulse-deploy-staging-ssm` scoped to one instance + AWS-RunShellScript document, with BOTH `ec2:instance` and `ssm:managed-instance` ARN forms for `SendCommand`
- `infra/scripts/setup-github-oidc.sh` developer-side orchestrator (idempotent, parameterised for prod cutover)
- `deploy.sh` REF resolution accepts both branch names and SHAs
- GH secrets `AWS_OIDC_ROLE_STAGING` (real ARN) + `STAGING_EC2_INSTANCE_ID` (corrected) both validated

**End-to-end verification:** workflow_dispatch run [25988575225](https://github.com/publicpulseagency/EventPulse/actions/runs/25988575225) — all 10 steps green; EC2-side `deploy.sh` returned exit 0; all 3 smoke endpoints `200`.

**Migration state on staging:** all four migrations (0001/0002/0003/0004) applied; `kyc_submissions` table is live.

## Next concrete step

**Day 14 — Item 9 only.** Item 10 (eTIN regex + BFIU sanctions matcher) **deferred to Phase 2** per the Sprint 2 plan amendment landed today (decisions.md 2026-05-17 "Sprint 2 Item 10 scope amendment — third-party verification deferred to manual review"). Same operational pattern as the Porichoy deferral two days earlier: sub-50-submissions/week at MVP, reviewer is already looking at every submission, false-confidence risk of half-built automation. Checkpoint #5 dissolved — `infra/compliance/sanctions.json` no longer in Sprint 2 scope; do NOT pre-stage it.

**Item 9 scope:**

- KYC submission state machine per §13.3 — `draft → submitted → under_review → approved | rejected`, with `rejected → draft` for resubmit. No other transitions legal.
- `POST /tenant/kyc/submissions` — finalises a submission after the Day 13 upload-url step. Idempotent on `(tenant_id, submission_id)` (double-click returns same row). Server regenerates S3 object keys from `submission_id`; never trusts client-supplied keys. Body validates against the per-type zod schema (individual vs org per Item 8), including eTIN and NID number as **plain captured data fields** (no automated format validation — Item 10 deferred).
- Audit every transition (not just terminal): `audit_logs` row per §9.10 with `from_state`, `to_state`, `actor_user_id`, `actor_role`, `reason` (nullable; required on rejection), `at_timestamp`, `tenant_id`, `submission_id`.
- Notification firing scaffolded (templates land Item 16 / Day 20): on `→ under_review` fire `kyc_submitted`, on `→ approved` fire `kyc_approved`, on `→ rejected` fire `kyc_rejected` with reason. Stub functions in `apps/api/src/services/notifications/kyc.ts` wired to the state machine; SES templates land at Item 16.
- RLS: submit endpoint runs under `withTenant(tenant_id)`, never `withSuperAdmin`. Cross-tenant negative test required as defence in depth (signed URL from Day 13 already enforces at S3 layer).
- Tests required: cross-tenant negative (RLS), idempotency (double-submit returns same row), state machine transitions (all legal pass, all illegal throw clear errors), audit log write per transition, notification stub firing per terminal transition. **No eTIN regex tests, no sanctions matcher tests.**
- **Item 10 residual** — surface eTIN + NID number captured in `fields` jsonb clearly in the reviewer queue UI — absorbs into Item 13 (Day 18) rather than standing as its own item.

## Sprint 2 standard execution mode (still in force for Days 14-20)

- One session per day. `/start` reads context + proposes focus; `/end` updates progress.md + handoff.md + any new gotchas same-day.
- `/review` (iac-reviewer or feature-dev:code-reviewer subagent) **before every commit on KYC-touching code** (Items 6-13). Every commit. PII + §1.3 R4.
- Memory commits separate from feature commits. `memory:` prefix for memory-only.
- STOP-ASK in force for §29 Open Decisions, contradictions with decisions.md, RLS policies unjustified against §4, money math outside `fee-calculator.ts`, AWS writes with prod blast radius, anything committing to a legal/regulatory position not already in decisions.md.

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 + v2.3 CLAUDE.md bump)

- **CLAUDE.md §17 amendment** — codify the canonical OIDC trust pattern (three-claim shape) as project standard in the playbook.
- **CLAUDE.md §13.0 amendment** — drop "eTIN format check: local regex" and "BFIU sanctions screening: manual list-check against `infra/compliance/sanctions.json`" from the §13.0 MVP-scope language. Replace with "Both deferred to manual reviewer responsibility for MVP" alongside the existing Porichoy deferral paragraph. Path back to automation in Phase 2 per decisions.md "Sprint 2 Item 10 scope amendment" 2026-05-17.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d trade-off.
- Session revocation gap in `apps/api/src/auth/middleware.ts` — fix before Day 16-17 wizard ships.
- KYC `documents` / `fields` jsonb tightening — pairs with Day 16-17 wizard.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and later `prod`) — already a Sprint 1 carry; pairs with the canonical OIDC pattern decision.
- Sprint 4 — `eventpulse-deploy-prod` role using the same canonical three-claim pattern with `environment:production` + `deploy-prod.yml@refs/heads/prod`.

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
