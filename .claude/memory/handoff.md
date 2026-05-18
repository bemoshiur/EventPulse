# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-18 (end of Sprint 2 Day 16)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 16 closed. Four PRs merged (1 pre-code memory + 3 feature) for Item 12 Part 1 — Individual Tier 1 KYC wizard end-to-end.**

```text
<pending>   memory: Sprint 2 Day 16 closeout — Item 12 Part 1 shipped + 4 new gotchas (this PR)
268f2e0     fix(api-web): Day 16 PR 3 /review BLOCKERs + a11y inconsistencies (#80 follow-up)
7520b07     feat(web): Day 16 Item 12 PR 3 — KYC wizard frontend (Individual Tier 1, end-to-end) (#80)
e46ff06     feat(web): Day 16 Item 12 PR 2 — TanStack Query infra + useTenantType migration (#79)
4b1c5d7     feat(api): Day 16 Item 12 PR 1 — KYC wizard backend (drafts router + per-tier schemas) (#78)
56d0bb9     memory: Sprint 2 Day 16 pre-code — server-side drafts + per-tier discriminated unions + TanStack Query landing (#77)
```

## What landed in Day 16

**Pre-code memory (PR #77 `56d0bb9`):** three architectural decisions locked before code — (A) server-side drafts (no localStorage), (B) per-tier zod discriminated unions, (C) TanStack Query landing.

**PR 1 backend (PR #78 `4b1c5d7`):** new `/api/v1/tenant/kyc/drafts` router (POST create + GET read + PATCH partial + POST submit); `packages/shared-types/src/bd.ts` (post-2018 BD divisions enum + EN/BN labels); audit helpers extended with `writeKycDraftCreated` + `writeKycDraftUpdated` + pure `computeFieldDiff`/`flattenPaths` utilities; PII-safety canonical regression test (value change → path-only diff, no values in serialised audit row); 16 unit + 18 integration tests; `KYC_DOCUMENT_TYPES` extended with `address_proof`. /review BLOCKER (high 92, AWS SDK leak) + 2 medium fixes landed in-PR.

**PR 2 TanStack Query (PR #79 `e46ff06`):** `@tanstack/react-query` + dev-only devtools; `lib/query-client.ts` singleton with locked defaults (staleTime 30s, gcTime 5min, retry 1); `QueryProvider` in `(tenant)/layout.tsx`; `useTenantType` migrated to `useQuery`; new `useInvalidateTenantType()` hook; per-test QueryClient wrapper pattern in tests; production build clean (devtools chunk 222 bytes shim only — real devtools NOT in prod bundle).

**PR 3 frontend wizard (PR #80 `7520b07` + `268f2e0`):** schemas relocated from `apps/api/src/schemas/kyc.ts` to `packages/shared-types/src/kyc-schemas.ts` (single source of truth for frontend + backend); `use-kyc-draft` hook with TanStack mutations + optimistic-update-with-rollback; `WizardFrame` + `ProgressIndicator` (axe-clean); `DocumentUpload` with 5-phase state machine + XHR-based upload-progress reporting; 4 Individual Tier 1 step components with react-hook-form + zodResolver; `IndividualTier1Wizard` variant root + `(tenant)/kyc/page.tsx`; sessionStorage holds only the random submissionId (PII NEVER persisted client-side); 21 new frontend tests (every interactive component has axe coverage). Production build: /kyc 33.4 KB + 151 KB shared. /review found 2 BLOCKERs + 3 important issues — all fixed in same PR before merge.

**New `extensionAlias` in `next.config.mjs`:** ESM-typed workspace packages' `.js → .ts` import rewrite (covered in `.claude/memory/gotchas.md` new entry).

## Next concrete step

**Day 17 — Item 12 Part 2: Organisation Tier A wizard + Individual Tier 1 polish + e2e Playwright test.**

Inherits everything from Day 16:
- Schemas extend the existing discriminated union in `packages/shared-types/src/kyc-schemas.ts` — add `OrganisationTierASubmissionSchema`, `OrganisationTierA{Identity,Authority,Financial}Schema`, `OrganisationTierAPatchSchema`. Tier A required fields per §13.3: trade license number + BIN + MOA + AOA + authorised signatory NID + bank/MFS account.
- Drafts router branches on `tenant.type` (already wired — Day 16 returns 501 NOT_IMPLEMENTED for organisation tenants).
- KYC page route renders `OrganisationTierAWizard` instead of the placeholder.
- Same wizard frame + progress indicator + document upload components.
- New step components for org variant + new variant root.

**Day 17 must-have integration test:** end-to-end Playwright test against staging exercising the full Individual Tier 1 happy path (create → upload 3 NID docs → fill identity → upload address proof → fill address → fill financial → submit). Validates the BLOCKER 1 fix's document-only PATCH preserves typed values across the real network boundary, not just unit-tested in isolation.

**Carries from Day 16 PR 3 /review** (not blockers; should land in Day 17 or as small follow-ups):

- Test covering the early-return path in PATCH handler when both fields + documents are empty (BLOCKER 1 fix's no-op guard at kyc-drafts.ts line ~370). One integration test, ~10 lines.
- Test for the optimistic-update document-merge path (issue #5 fix): PATCH races with doc-upload, snapshot preserves doc URIs. Frontend test in `use-kyc-draft.test.tsx`.

**STOP-ASK conditions for Day 17:**

- New dep beyond what Day 16 already landed (TanStack Query, react-hook-form, @hookform/resolvers) → halt, ask whether to scope in or defer.
- Schema change beyond what Item 12 Part 2 strictly needs (e.g. `kyc_submissions.org_metadata jsonb` for org-only fields if the existing `fields` jsonb feels cramped) → halt, ask.
- Day 17 STOP-ASK conditions inherit from Day 16 (set-once decision pushback, design-system token gap, AWS write beyond staging blast radius, contradictions with decisions.md).
- Playwright test against staging needs operator-side setup (staging KYC bucket reachable from CI's outbound IP, test tenant fixture seeded). If staging isn't reachable from the Playwright runner, halt and ask whether to defer e2e to Day 18 or run against a local Postgres + mocked S3.

## Scheduled mid-sprint PR slots (unchanged from Day 15 close-out)

- **Day 18 AM — v2.3 CLAUDE.md playbook bump (dedicated PR, runs BEFORE Item 13 starts).** Synchronises the playbook with reality so Items 13 + 14 + 15 build against current text. Bundles: §17 OIDC pattern + §13.0 manual-review language + §13.3 `draft` state (both `rejected → draft` AND wizard create-as-draft per `.claude/memory/decisions.md` 2026-05-18 "KYC wizard uses server-side drafts") + §9.1 `tenants.type` nullable + §4.2.1 append-only audit invariant + Day 16 PR 3's `next.config.mjs` extensionAlias documentation in §17 (or §3.2 — Claude's call when drafting).
- **Day 20 AM — OAuth sign-in bug fix (dedicated PR, runs BEFORE `/sprint` retro).**

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 release — NOT bundled into v2.3 playbook bump)

- **S3 signed URL issuance audit_logs backfill** — single helper call inside `getKycUploadUrl()`. Per decisions.md 2026-05-17.
- **audit_logs unset-GUC smoke test** — Day 14 /review #1 (confidence 82) follow-up.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d.
- **Day 16 PR 3 /review carries** (above) — early-return path test + optimistic-merge document test.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and `prod`) — Sprint 1 carry.
- Sprint 4 — `eventpulse-deploy-prod` role using canonical three-claim pattern.
- **Sprint 3 auth-hardening bundle PR** — session revocation fix in `apps/api/src/auth/middleware.ts` + auth events audit_logs backfill (per decisions.md 2026-05-17 "audit_logs scope at Item 9").

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.
- **OAuth credentials for staging** (Google Cloud Client + Apple Services ID + private key) — needed for Day 20 AM OAuth fix PR. If still missing at Day 20, the fix PR ships the code + secrets-scaffolding only; credential population becomes a follow-up.
- **Playwright runner staging connectivity** — Day 17 e2e test needs to reach staging KYC bucket + tenant subdomain. If CI's runner doesn't have outbound to staging, plan B is to defer e2e to Day 18 or run local-only.

## Hard guardrails (unchanged from Day 15)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX implying platform endorsement.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only.
- audit_logs is APPEND-ONLY (§1.3 R8). No UPDATE/DELETE from application code; REVOKE enforces at the GRANT layer in addition to RLS policy absence.
- Idempotent inserts under RLS (`ON CONFLICT DO NOTHING + SELECT-back`) must handle zero-rows-after-collision as cross-tenant ownership (409, not 404 or 500).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Per-domain = per-business-area (not per-helper); multiple helpers within the same KYC domain are fine and expected (see `writeKycTransition` + `writeKycDraftCreated` + `writeKycDraftUpdated`).
- **`tenants.type` is set-once for MVP** — NULL→value legal, value→same idempotent, value→different rejected (409 `TENANT_TYPE_ALREADY_SET`).
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes one `expect(await axe(container)).toHaveNoViolations()` assertion via vitest-axe. Use `@testing-library/user-event` for keyboard + focus interactions.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — see `.claude/memory/gotchas.md` Day 16 entry. Any future PATCH endpoint that merges jsonb must guard against empty-payload-wipes-prior-state.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory cache (no `persistQueryClient`); sessionStorage holds only opaque IDs, NEVER values; framer-motion: animation state only. Verified for the wizard; future PII surfaces must verify the same.
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — see `.claude/memory/gotchas.md` Day 16 entry.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Run frontend tests with coverage report (not a CI gate; for local inspection)
pnpm --filter @eventpulse/web test --coverage

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=publicpulseagency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh
```
