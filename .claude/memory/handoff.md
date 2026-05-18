# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (end of Sprint 2 Day 17)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 17 closed. Three PRs merged (1 pre-code memory + 2 feature) for Item 12 Part 2 — Organisation Tier A KYC wizard end-to-end + Individual Tier 1 polish + Playwright e2e infrastructure.**

```text
<pending>   memory: Sprint 2 Day 17 closeout — Item 12 Part 2 shipped (this PR)
479f3b3     feat(web): Day 17 Item 12 PR 2 — Org Tier A wizard + Individual Tier 1 polish + e2e infra (#84)
b994606     feat(api): Day 17 Item 12 PR 1 — Organisation Tier A backend (schemas + drafts router + tests) (#83)
b46d22b     memory: Sprint 2 Day 17 pre-code — Org Tier A 6-step decomposition + e2e local-only + polish scope locked (#82)
```

## What landed in Day 17

**Pre-code memory (PR #82 `b46d22b`):** three architectural decisions locked — (D) Org Tier A 6-step decomposition + financial schema reuse, (E) e2e Playwright local-only with staging cutover deferred, (F) polish scope = inline-on-blur error UX only.

**PR 1 backend (PR #83 `b994606`):** OrganisationTierA* schemas in shared-types (5-branch PATCH discriminated union + submit schema + step→jsonb-key mapping table); drafts router 501 branches removed + switch-based pickers (exhaustive vs ternary); `KycDraftStep` widened; carry test 1 (no-op PATCH early-return); 8 Org integration tests. /review BLOCKER (BIN regex accepted deprecated 9–12 digit formats vs NBR's 2019-11-30 13-digit mandate) + 2 important fixes landed in-PR.

**PR 2 frontend (PR #84 `479f3b3`):** 6 Org Tier A step components + variant root + KYC page route branch; Individual Tier 1 polish (`mode: 'onBlur'` on 3 step useForms); carry test 2 (optimistic-merge documents with waitFor); Playwright e2e infrastructure (webServer array + sign-in-smoke spec). /review BLOCKER (document-only step CTA allowed advance without uploads) + 1 important fix landed in-PR; BLOCKER 2 (jsonb key mismatch claim) verified as false positive against PR 1 server.

## Next concrete step

**Day 18 AM — v2.3 CLAUDE.md playbook bump (dedicated PR, runs BEFORE Item 13 starts).** Synchronises the playbook with reality so Items 13 + 14 + 15 build against current §-text. Bundles eight section amendments:

- §17 — canonical OIDC trust pattern (three-claim shape)
- §13.0 — drop "eTIN format check: local regex" + "BFIU sanctions: manual list-check" (Item 10 deferral)
- §13.3 — `draft` state documented for BOTH lanes (`rejected → draft` from Day 14 + wizard create-as-draft from Day 16)
- §13.3 — Org Tier A 6-step decomposition + financial-schema reuse note (per decisions.md 2026-05-19)
- §9.1 — `tenants.type` nullable (Item 11 / migration 0006)
- §4.2.1 — append-only audit-table invariant (Day 14 REVOKE pattern)
- §3.2 — ESM-typed workspace + `extensionAlias` pattern (Day 16 PR 3 gotcha)

Single PR titled `docs(playbook): v2.3 bump — Sprint 2 amendments`. Bump CLAUDE.md changelog (§-1 if it exists) + add a Sprint 2 section to the changelog noting all six amendments.

**Day 18 PM — Item 13: super admin review queue.** First reviewer-facing surface. Per `.claude/memory/decisions.md` "KYC reviewer role for MVP — super-admin-only" (2026-05-17):

- New `/admin/kyc/queue` route — list of submissions in `under_review` status (with `submitted → under_review` self-claim on row open)
- Per-submission detail view rendering BOTH wizard tiers' jsonb shapes:
  - Tier 1: `fields.identity` + `fields.address` + `fields.financial`
  - Tier A: `fields.org` + `fields.signatory` + `fields.financial`
- Inline document preview (NID images, trade license PDF, MOA/AOA) loaded from the S3 URIs in `documents` jsonb
- Approve / Reject action panel with `decisionReason` text field (required on reject per §13.3); reviewer action transitions `under_review → approved` or `under_review → rejected` via the state machine + writes audit row via `writeKycTransition({actorRole: 'super_admin'})` (the super_admin path the audit helper already supports)
- New `manual_nid_verified` checkbox in the reviewer UI that flips `kyc_submissions.nid_verified` — manual reviewer compares the submitted NID number against the uploaded NID image
- New "request more info" action that transitions `under_review → rejected` with a flag in `decisionReason` distinguishing it from a hard reject (no schema change; reviewer convention)

**Item 13 must cover both shapes** — verify the reviewer UI doesn't assume Tier 1 keys; per `.claude/memory/decisions.md` 2026-05-19 the Tier A jsonb keys are shortened (`fields.org`, `fields.signatory`), not the verbose step names.

**STOP-ASK conditions for Day 18:**

- New dep beyond what Day 16/17 landed (TanStack Query, react-hook-form, vitest-axe) → halt, ask.
- Schema change beyond what Item 13 strictly needs (e.g. new column on `kyc_submissions` for the request-more-info flag if the reviewer convention proves insufficient) → halt, ask.
- Any super-admin authentication assumption — Item 13 is the FIRST super-admin route; `requireSuperAdmin` middleware needs to be the correctness gate, NOT the tenant-context middleware. Per §5.1 the super-admin audience is separate; verify the audit row's `actor_type` is `'super_admin'`, not `'tenant_user'`.
- Reviewer queue counts mutate via `under_review` self-claim; concurrent reviewer opens of the same submission need to be considered (Day 18 likely ships without optimistic-locking; flag as Sprint 3 candidate if pattern emerges).
- v2.3 playbook bump touches §-text only; no code changes. If the bump introduces something that contradicts merged code, halt.

## Scheduled mid-sprint PR slots

- **Day 20 AM — OAuth sign-in bug fix (dedicated PR, runs BEFORE `/sprint` retro).** Code fix for button hrefs (`/api/auth/{provider}/start` 404s on web vhost → absolute `NEXT_PUBLIC_API_BASE_URL` + `/api/v1/auth/oauth/...` path) + `bootstrap-staging.sh` extension to materialise OAuth secrets. Moshiur's parallel-track credentials still required for staging cutover.

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 release)

**New from Day 17:**

- **Full Individual Tier 1 happy-path Playwright test** — Day 17 PR 2 carry. Needs globalSetup that mints a JWT via apps/api signTokens; walks 4 steps + uploads; asserts success. Local-only with KYC_S3_DRY_RUN=1.
- **Org Tier A axe coverage for steps 2-6** — Day 17 PR 2 ships axe on Step1OrgInfo only; queue the other 5 (~30 min).
- **`KycDraftPatchInput.body.step` union drift risk** — Day 17 PR 2 /review #2. Hand-coded 7-literal union should re-export from shared-types (`IndividualTier1Step | OrganisationTierAStep`). Sprint 3 task.
- **`maskAccount → maskLast4` + dedicated `maskEtin`** — Day 17 PR 2 /review #4 cosmetic.
- **Staging-real e2e Playwright cutover** — per decisions.md 2026-05-19. CI IAM outbound + Cloudflare allowlist + staging fixture + S3 PUT teardown.
- **Loading/saving indicator near wizard progress bar** — polish item deferred from Day 17.
- **Framer-motion step transitions with prefers-reduced-motion fallback** — polish item deferred from Day 17.

**Pre-existing (carried from Days 12–16):**

- **S3 signed URL issuance audit_logs backfill** — single helper call in `getKycUploadUrl()`. Per decisions.md 2026-05-17.
- **audit_logs unset-GUC smoke test** — Day 14 /review #1 follow-up.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and `prod`) — Sprint 1 carry.
- Sprint 4 — `eventpulse-deploy-prod` role using canonical three-claim pattern.
- **Sprint 3 auth-hardening bundle PR** — session revocation fix + auth events audit_logs backfill.

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.
- **OAuth credentials for staging** — needed for Day 20 AM OAuth fix PR.
- **Playwright runner staging connectivity** — Sprint 2 closeout dependency for the staging-real e2e cutover.
- **Reviewer auth context for Item 13** (Day 18 PM) — confirm the existing super-admin JWT minting path supports the reviewer queue without additional middleware. Likely yes per §5.1 but worth verifying before coding.

## Hard guardrails (unchanged)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only.
- audit_logs is APPEND-ONLY (§1.3 R8). No UPDATE/DELETE from application code.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Multiple helpers in the same KYC domain file are fine.
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()` via vitest-axe. Use `@testing-library/user-event` for keyboard + focus interactions.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — Day 16 PR 3 BLOCKER 1 + Day 17 server's `fieldsKeyForStep` mapping for verbose→short keys. Any future PATCH endpoint that merges jsonb must guard against empty-payload-wipes-prior-state.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory cache; sessionStorage holds only opaque IDs.
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — Day 16 PR 3 gotcha; documented in §3.2 amendment (Day 18 AM v2.3 bump).
- **BIN is 13 digits only per NBR 2019-11-30 mandate** — Day 17 PR 1 BLOCKER. Any future BD VAT field validation must follow.
- **Wizard step→jsonb-key mapping for Tier A** — verbose step names (`org_info`, `signatory_identity`) shorten to jsonb keys (`fields.org`, `fields.signatory`). PR 1 integration test pins this; PR 2 variant root has the comment cross-referencing.
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER. Org wizard's `isPrimaryDisabled` gates currentStepIndex 2 + 3 on `signatoryDocsComplete` / `orgDocsComplete`. Apply same gate pattern to any future variant.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Run Playwright e2e locally (boots both apps via webServer)
pnpm --filter @eventpulse/web exec playwright install --with-deps chromium
pnpm --filter @eventpulse/web test:e2e

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=publicpulseagency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh
```
