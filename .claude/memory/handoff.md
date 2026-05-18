# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-18 (end of Sprint 2 Day 15)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 15 closed. Item 11 PR merged + 2 memory PRs (pre-code set-once decision + Day 15 closeout) landed.**

```text
<pending>   memory: Sprint 2 Day 15 closeout — Item 11 shipped + 2 new gotchas (this PR)
d0df904     feat(api-web): Day 15 Item 11 — Account-Type modal + tenant.type nullable + frontend test rig (#75)
377af28     memory: Sprint 2 Day 15 pre-code — tenant account_type set-once + per-domain audit reaffirmed + scheduled slots (#74)
e869efb     memory: Sprint 2 Day 14 closeout — Item 9 shipped + audit_logs scope decision + 2 new gotchas (#71)
d9d765f     feat(api): Sprint 2 Day 14 — Item 9 KYC submission state machine + submit endpoint + audit trail + notification scaffolding (#70)
```

## What landed in Day 15

**Pre-code memory (PR #74 `377af28`):**

- `tenants.type` set-once for MVP (NULL→value legal first-write; value→same idempotent; value→different rejects 409 `TENANT_TYPE_ALREADY_SET`). Change path = Phase 2 super admin "change tenant type" with cascading KYC re-review + fee re-pin + subdomain re-provision.
- One-per-domain audit helper pattern reaffirmed (`writeKycTransition`, `writeTenantTypeSet`, etc. — never a generic `writeAudit`). Type safety on diff/metadata shapes is the load-bearing reason.
- Closeout strategy amended: v2.3 CLAUDE.md playbook bump carved out into **Day 18 AM dedicated PR** (before Item 13 starts so Items 13 + 14 + 15 build against synchronised §13/§17/§9.1/§4.2.1 text). OAuth sign-in bug fix carved out into **Day 20 AM dedicated PR** (before `/sprint` retro). Remaining closeout candidates (S3 issuance backfill, audit_logs unset-GUC test, Reviewer S4/S6, KYC jsonb tightening) stay in the v0.2.0-sprint-2 bundle.

**Item 11 (PR #75 `d0df904`):**

- Migration 0006 — `tenants.type` nullable; `tenants_type_chk` rewritten to `(type IS NULL OR type IN ('organisation','individual'))`. Migration uses `DROP CONSTRAINT IF EXISTS` against both `tenants_type_check` (Postgres auto-named from migration 0001's inline CHECK) and `tenants_type_chk` (Drizzle-named target) so subsequent migrations have a stable reference.
- `writeTenantTypeSet` audit helper at `apps/api/src/services/audit/tenant.ts` — sibling to `writeKycTransition`, one-per-domain pattern.
- `GET /api/v1/tenant/me` — returns `{ data: { tenant: {...} } }` envelope. Explicit WHERE on tenant_id even though RLS filters (defence-in-depth per Day 15 /review finding #1).
- `requireTenantType` middleware — request-scoped caching via `c.set('tenantType', value)`. NO closure-captured Map, NO module-level state. A tenant type change in DB takes effect on the very next request, no stale-serving window.
- `POST /api/v1/tenant/account-type` — set-once setter inside a single `withTenant` tx. NULL→value writes audit + returns 201. Same→same returns 200 (no audit dup). A→B throws `TenantTypeAlreadySetError` → 409. Cross-tenant body smuggling rejected via zod strip + RLS UPDATE policy.
- `requireTenantType` applied to existing `/tenant/kyc/*` routes; modal blocks KYC until type is set.
- Frontend: `useTenantType` hook (native fetch — TanStack Query deferred to Item 12), `AccountTypeModal` with non-dismissable focus-trap modal using §19 ep-* tokens (zero hex literals), English+Bangla copy per §19.6, `TenantTypeGate` with no-remount ghost-of-children pattern, `(tenant)/layout.tsx` + placeholder dashboard.
- Frontend test rig: 6 dev deps (`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `vitest-axe`, `@vitest/coverage-v8` pinned `^2.1.9`), vitest config jsdom-scoped to apps/web only (apps/api stays on node), local `vitest-axe.d.ts` augmenting both `Chai.Assertion` + `Vi.Assertion` namespaces.
- 30 new tests (10 backend + 20 frontend). All green; 114 passing locally; 70 DB-gated skipped (CI runs them). Production build sanity confirmed dev deps don't leak into the bundle.
- /review: findings #1 + #2 fixed in-PR; finding #3 acknowledged as cosmetic-only.

## Next concrete step

**Day 16-17 — Item 12: KYC wizard (two-day item).** Per §13 (KYC engine) + §13.4 (graduation flow) + the Item 11 gate that ensures `tenants.type` is set before the wizard ever renders. The wizard branches on `tenants.type`: individual variant collects NID + photograph + bank statement (+ eTIN at tier_2); organisation variant collects trade license + MOA + AOA + authorised signatory NID + BIN.

**Item 12 scope sketch (subject to refinement at Day 16 `/start`):**

- New `(tenant)/kyc/wizard` route (gated by `requireTenantType` server-side; gated by `useTenantType` client-side — both layers already in place from Item 11).
- TanStack Query likely lands here (deferred from Item 11). The wizard has more justification: per-step server state, optimistic mutations on `POST /tenant/kyc/upload-url` + `POST /tenant/kyc/submissions`, cache invalidation on submission state changes.
- Per-tier zod schema tightening for `kyc_submissions.documents/fields` jsonb — was a Day 14 closeout candidate; folds naturally into Item 12 since the wizard's per-step required-document list IS the canonical source of the tighter schema.
- Multi-step state machine on the frontend with progress indicator. Mirror the §13.3 backend state machine shape (`draft → submitted → under_review → approved | rejected → draft`) so the UI's notion of "where am I in the flow" maps cleanly to row state.
- File uploads via the Day 13 `POST /tenant/kyc/upload-url` → PUT to S3 with signed URL → on success, frontend tracks document slot as filled.
- On final step submit, hits `POST /tenant/kyc/submissions` (Day 14 endpoint); response navigates the user to a "Submission under review" success page.
- All new components must include axe assertion + interaction coverage (frontend test infra precedent set Day 15). Wizard step transitions are the load-bearing test surface — focus traversal across step boundaries, error states per step, conditional fields per tier.

**STOP-ASK conditions for Day 16-17:**

- New dep beyond TanStack Query (e.g. dnd-kit for drag-and-drop file slots, react-hook-form for the form layer) → halt, ask whether to scope in or defer
- Schema change beyond what Item 12 strictly needs (e.g. `kyc_submissions.flags` jsonb if any automated validation appears) → halt; Item 10 deferral is still in force
- Day 16 STOP-ASK conditions inherit from Day 15 (set-once decision pushback, design-system token gap, AWS write beyond staging blast radius, contradictions with decisions.md)

## Scheduled mid-sprint PR slots (carved out of v0.2.0-sprint-2 closeout 2026-05-18)

- **Day 18 AM — v2.3 CLAUDE.md playbook bump (dedicated PR, runs BEFORE Item 13 starts).** Synchronises the playbook with reality so Items 13 + 14 + 15 build against current §13/§17/§9.1/§4.2.1 text. Bundles:
  - §17 amendment — canonical OIDC trust pattern (three-claim shape) as project standard
  - §13.0 amendment — drop "eTIN format check: local regex" + "BFIU sanctions screening: manual list-check" (Item 10 deferred)
  - §13.3 amendment — document the `draft` state added in migration 0005 for the `rejected → draft` resubmit lane
  - §9.1 amendment — `tenants.type` nullable (Item 11 / migration 0006)
  - §4.2.1 amendment — append-only audit-table invariant (REVOKE UPDATE/DELETE pattern per Day 14 gotcha)
  - Any additional §-touching decisions that land Days 16-17
- **Day 20 AM — OAuth sign-in bug fix (dedicated PR, runs BEFORE `/sprint` retro).** Code fix for button hrefs + `bootstrap-staging.sh` extension to materialise OAuth secrets. OAuth credentials are Moshiur's parallel-track.

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 release — NOT bundled into the v2.3 playbook bump)

- **S3 signed URL issuance audit_logs backfill** — single audit write inside `getKycUploadUrl()` (per Day 14 evening decision).
- **audit_logs unset-GUC smoke test** — one-test follow-up per Day 14 /review finding #1.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d trade-off.
- KYC `documents` / `fields` jsonb tightening — pairs with Day 16-17 wizard (Item 12); may fold into the wizard PR.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and later `prod`) — already a Sprint 1 carry.
- Sprint 4 — `eventpulse-deploy-prod` role using the canonical three-claim pattern.
- **Sprint 3 auth-hardening bundle PR** — session revocation fix in `apps/api/src/auth/middleware.ts` `extractAndVerify` + auth events audit_logs backfill (sign-in, sign-out, magic-link issued/consumed, OAuth link created).

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.
- **OAuth credentials for staging** (Google Cloud Client + Apple Services ID + private key with `https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/{google,apple}/callback` URLs registered) — needed for the Day 20 AM OAuth fix PR. If still missing at Day 20, the fix PR ships the code/secrets-scaffolding only and credential population becomes a follow-up.

## Hard guardrails (unchanged)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX implying platform endorsement.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only.
- audit_logs is APPEND-ONLY (§1.3 R8). No UPDATE/DELETE from application code; REVOKE enforces at the GRANT layer in addition to RLS policy absence.
- Idempotent inserts under RLS (`ON CONFLICT DO NOTHING + SELECT-back`) must handle zero-rows-after-collision as cross-tenant ownership (409, not 404 or 500).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. New audit domains create new sibling helpers in `apps/api/src/services/audit/<domain>.ts`. Type safety on diff/metadata shapes is the reason.
- **`tenants.type` is set-once for MVP** — NULL→value is legal, value→same is idempotent (200, no audit dup), value→different is rejected (409 `TENANT_TYPE_ALREADY_SET`). Phase 2 super admin "change tenant type" handles legitimate change requests.
- **`requireTenantType` middleware caching is request-scoped only** — Hono's `c.set('tenantType')` per-Context, never closure/module-level state. A tenant type change takes effect on the very next request with no stale window.
- **Frontend test rig precedent (Day 15 Item 11)** — every new interactive component test includes one `expect(await axe(container)).toHaveNoViolations()` assertion via vitest-axe. Use `@testing-library/user-event` (not raw `fireEvent`) for keyboard + focus interactions; it models the real event sequence (focus → keydown → keypress → input → keyup) that accessibility behaviour depends on.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually (no longer needed in normal flow — push to main auto-deploys)
gh workflow run deploy-staging.yml --ref main

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Run frontend tests with coverage report (not a CI gate; for local inspection)
pnpm --filter @eventpulse/web test --coverage

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent — for prod, swap ENVIRONMENT=prod + BRANCH=prod + INSTANCE_ID=...)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=publicpulseagency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh
```
