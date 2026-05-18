# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (Day 18 pre-flight — platform-wide manual-verification policy locked)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 17 closed. One pre-Day-18 memory PR scoped: consolidates three prior per-item KYC-verification deferrals (Porichoy, eTIN/sanctions, Day 17's BIN BLOCKER near-miss) into a single platform-wide "manual verification only for MVP" policy. Day 18's plan adjusts as a direct consequence: AM playbook bump grows from 8 to 9 §-section amendments (§13.0 promoted from Porichoy-specific to platform-wide); PM Item 13 review queue scope simplifies (no validation badges, no `flags` jsonb column, raw data + per-field reviewer helper text + reviewer-notes free-text field).**

```text
<pending>   memory: Sprint 2 — platform-wide manual verification policy for MVP (this PR)
4c8047c     memory: Sprint 2 Day 17 closeout — Item 12 Part 2 shipped (3 PRs + 2 BLOCKERs fixed in-PR) (#85)
479f3b3     feat(web): Day 17 Item 12 PR 2 — Org Tier A wizard + Individual Tier 1 polish + e2e infra (#84)
b994606     feat(api): Day 17 Item 12 PR 1 — Organisation Tier A backend (schemas + drafts router + tests) (#83)
b46d22b     memory: Sprint 2 Day 17 pre-code — Org Tier A 6-step decomposition + e2e local-only + polish scope locked (#82)
```

## What landed in this memory PR (pre-Day-18)

**decisions.md** — new consolidated entry at top: "Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)". Supersedes two prior 2026-05-17 entries (Item 10 scope amendment + Porichoy deferred), each annotated with `Superseded by:` notes; both remain in the log for archaeology. The new entry covers: rationale (MVP volume operationally fine for manual review; half-built automation worse than no automation; third-party procurement risk; reviewer queue is already where humans look); Day 18 consequences (Item 13 scope adjustments + v2.3 playbook bump §13.0 amendment); already-shipped surfaces unchanged; Phase 2 trigger (50 verified submissions/week sustained 4-week trailing average — reviewer-capacity criterion, not feature ambition); Phase 3 plan (advisory flags alongside manual review, never auto-reject).

**gotchas.md** — new entry at top: "BIN 13-digit fact is reviewer-documentation, not server-side enforcement". Reframes the Day 17 PR 1 BLOCKER fact (regex tightened from 9-13 digits to 13 digits per NBR 2019-11-30): the BIN regex remains in code as a passing-test guard against the original specific regression, but the broader principle does NOT generalise. New format fields default to plain-string structural validation only. Future schemas adding format regex must cross-reference a decisions.md entry justifying departure from the manual-verification policy.

**handoff.md** — this regeneration. Day 18 plan adjusted: 9 amendments (was 8) + Item 13 scope simplifications. New hard guardrails added for Day 18 (no validation badges in queue; no `flags` jsonb column in Item 13; format regex additions require decisions.md cross-reference).

## Next concrete step

**Day 18 AM — v2.3 CLAUDE.md playbook bump (dedicated PR, runs BEFORE Item 13 starts).** Synchronises the playbook with reality so Items 13 + 14 + 15 build against current §-text. Now bundles **9 section amendments** (was 8; the new amendment is §13.0):

- **§13.0 — REPLACED.** Old block was Porichoy-specific deferral language ("Porichoy deferred — manual NID review for MVP"). New block is the platform-wide manual-verification policy from decisions.md 2026-05-19: zero automated verification of any submitted KYC data for MVP; Phase 2 trigger (50 verified submissions/week sustained, 4-week trailing average, reviewer-capacity criterion); Phase 3 plan (advisory flags alongside reviewer judgment, never auto-reject); explicit list of fields covered (BIN, RJSC, eTIN, NID, address proof, bank/MFS account name match, sanctions, signatory, board resolution authenticity — everything). Cross-references decisions.md 2026-05-19 entry as authoritative.
- §17 — canonical OIDC trust pattern (three-claim shape).
- §13.3 — `draft` state documented for BOTH lanes (`rejected → draft` from Day 14 + wizard create-as-draft from Day 16).
- §13.3 — Org Tier A 6-step decomposition + financial-schema reuse note (per decisions.md 2026-05-19).
- §9.1 — `tenants.type` nullable (Item 11 / migration 0006).
- §4.2.1 — append-only audit-table invariant (Day 14 REVOKE pattern).
- §3.2 — ESM-typed workspace + `extensionAlias` pattern (Day 16 PR 3 gotcha).

Single PR titled `docs(playbook): v2.3 bump — Sprint 2 amendments`. Bump CLAUDE.md changelog (§-1) + add a Sprint 2 section to the changelog noting all nine amendments. §13.0 amendment is the new and largest item; the other 8 are unchanged in scope from yesterday's plan.

**Day 18 PM — Item 13: super admin review queue.** First reviewer-facing surface. Per `.claude/memory/decisions.md` "KYC reviewer role for MVP — super-admin-only" (2026-05-17) + the platform-wide manual-verification policy (2026-05-19):

- New `/admin/kyc/queue` route — list of submissions in `under_review` status (with `submitted → under_review` self-claim on row open).
- Per-submission detail view rendering BOTH wizard tiers' jsonb shapes:
  - Tier 1: `fields.identity` + `fields.address` + `fields.financial`
  - Tier A: `fields.org` + `fields.signatory` + `fields.financial`
- Inline document preview (NID images, trade license PDF, MOA/AOA) loaded from the S3 URIs in `documents` jsonb.
- **Per-field helper text** describing what the reviewer should check (e.g. next to BIN: "Verify against NBR VAT portal at vat.gov.bd; current format is 13 digits per NBR 2019-11-30").
- **Reviewer notes field per submission** (free text, captured in audit_log on save).
- Approve action: **modal confirmation** that the reviewer has reviewed all required fields and documents. Transitions `under_review → approved` via state machine + writes audit row via `writeKycTransition({actorRole: 'super_admin'})`.
- Reject action: **typed reason required** that goes to the tenant in the rejection email and persists in audit_log.
- New `manual_nid_verified` checkbox in the reviewer UI that flips `kyc_submissions.nid_verified` — manual reviewer compares the submitted NID number against the uploaded NID image.
- "Request more info" action that transitions `under_review → rejected` with a flag in `decisionReason` distinguishing it from a hard reject (no schema change; reviewer convention).

**Scope reduced from the original Day 17 plan per the platform-wide manual-verification policy:**

- **No validation badges** in queue list view (no automated checks → nothing to badge).
- **No `kyc_submissions.flags` jsonb column** (was speculative for sanctions hits in Item 10's original scope; not needed under the policy — when Phase 3 automation lands, the flag column lands in the same migration as the validator code).
- **No auto-flag UI affordances.** Reviewer-notes free-text is the only "concern surfacing" mechanism; the reviewer types the concern in their own words rather than the system pre-populating.
- **Notification copy for rejections** must surface the reviewer's typed reason verbatim, not a templated "automated check failed" message.

**Item 13 must cover both shapes** — verify the reviewer UI doesn't assume Tier 1 keys; per `.claude/memory/decisions.md` 2026-05-19 the Tier A jsonb keys are shortened (`fields.org`, `fields.signatory`), not the verbose step names.

**STOP-ASK conditions for Day 18:**

- New dep beyond what Day 16/17 landed (TanStack Query, react-hook-form, vitest-axe) → halt, ask.
- Schema change beyond what Item 13 strictly needs (e.g. new column on `kyc_submissions` for the request-more-info flag if the reviewer convention proves insufficient) → halt, ask.
- **Any temptation to add format regex / sanctions matcher / auto-flag logic** on the strength of "the queue would be cleaner with it" → halt, ask. The platform-wide manual-verification policy is load-bearing; adding automation absorbs scope and reopens decisions the policy explicitly closed.
- Any super-admin authentication assumption — Item 13 is the FIRST super-admin route; `requireSuperAdmin` middleware needs to be the correctness gate, NOT the tenant-context middleware. Per §5.1 the super-admin audience is separate; verify the audit row's `actor_type` is `'super_admin'`, not `'tenant_user'`.
- Reviewer queue counts mutate via `under_review` self-claim; concurrent reviewer opens of the same submission need to be considered (Day 18 likely ships without optimistic-locking; flag as Sprint 3 candidate if pattern emerges).
- v2.3 playbook bump touches §-text only; no code changes. If the bump introduces something that contradicts merged code, halt.
- v2.3 §13.0 amendment text must align verbatim with the decisions.md 2026-05-19 policy entry. The decisions log is the canonical source; the playbook restates it concisely.

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

## Hard guardrails (unchanged + 3 new for Day 18)

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
- **BIN 13-digit fact (NBR 2019-11-30) is reviewer-documentation, NOT server-side enforcement.** Day 17 PR 1 BLOCKER fix grandfathered as the one exception; new format fields default to plain-string structural validation only. See `.claude/memory/gotchas.md` "BIN 13-digit fact is reviewer-documentation, not server-side enforcement" + decisions.md 2026-05-19 platform-wide manual-verification policy. Future schemas adding format regex must cross-reference a decisions.md entry justifying departure.
- **Wizard step→jsonb-key mapping for Tier A** — verbose step names (`org_info`, `signatory_identity`) shorten to jsonb keys (`fields.org`, `fields.signatory`). PR 1 integration test pins this; PR 2 variant root has the comment cross-referencing.
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER. Org wizard's `isPrimaryDisabled` gates currentStepIndex 2 + 3 on `signatoryDocsComplete` / `orgDocsComplete`. Apply same gate pattern to any future variant.
- **NEW for Day 18 — Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.** Per the 2026-05-19 platform-wide manual-verification policy. Reviewer-notes free-text + per-field helper text + approve-modal-confirm + reject-typed-reason are the entire concern-surfacing surface for MVP. If Item 13 scope creeps to add any of these, halt and ask.
- **NEW for Day 18 — manual-verification policy is load-bearing.** Any temptation to add automated checks (format regex, sanctions matcher, validator stub) on the strength of "the queue would be cleaner with it" → halt, surface to Moshiur. The Phase 2 trigger (50 verified submissions/week sustained 4-week trailing average, reviewer-capacity criterion) is the only sanctioned re-evaluation gate.
- **NEW for Day 18 — Porichoy adapter scaffold-only shape is the canonical pattern for all future automation integrations.** Interface + env vars + Secrets Manager entry + TODO stub. Live wiring lands as a focused PR alongside the operational decision to flip from manual-only to manual-plus-flag (Phase 3). Day 20 Item 16 Porichoy scaffold work continues unchanged but is now an instance of the pattern, not a vendor-specific exception.

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
