# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (end of Sprint 2 Day 18)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode (1 day/session, `/start` → `/work` → `/end`)

## State right now

**Sprint 2 Day 18 closed. Five PRs merged across the day** — the largest single-day delivery of Sprint 2: a platform-wide policy consolidation, a 9-amendment playbook bump, three Item 13 PRs (pre-code memory + backend + frontend). The super admin KYC review queue is now reviewable end-to-end at `/admin/kyc` (queue) and `/admin/kyc/[id]` (detail). The highest-PII surface in the entire project is live.

```text
<pending>   memory: Sprint 2 Day 18 closeout — Item 13 shipped (5 PRs)
1925e2c     feat(web): Day 18 PM Item 13 frontend — super admin KYC review queue UI (#90)
f509efd     feat(api): Day 18 PM Item 13 backend — super admin KYC review queue + decision API (#89)
4782b05     memory: log Day 18 Item 13 pre-code — read-audit + cache-zero + structured checklist (#88)
bbf5409     docs(playbook): bump CLAUDE.md to v2.3 — 9 §-section amendments synchronising Days 11-18 reality (#87)
62fcef7     memory: Sprint 2 — platform-wide manual verification policy for MVP (#86)
```

## What landed in Day 18

**Pre-day-18 memory (PR #86 `62fcef7`):** consolidated three prior per-item KYC-verification deferrals (Porichoy 2026-05-17, Item 10 eTIN/sanctions 2026-05-17, Day 17 BIN BLOCKER near-miss) into a single platform-wide "manual verification only for MVP" decisions.md entry. Both prior entries marked `Superseded by`. Reframed BIN 13-digit fact in gotchas.md as reviewer-documentation, not server-side enforcement directive.

**AM playbook bump (PR #87 `bbf5409`):** v2.3 bump with 9 §-section amendments. Highlights: §13.0 replaced with platform-wide policy text (verbatim alignment with PR #86 decisions.md); §17.9.1 new sub-subsection codifying the canonical GitHub→AWS OIDC three-claim trust pattern; §4.2.1.1 new sub-subsection codifying the append-only table invariant + REVOKE pattern; §29 Resolved-in-v2.3 block. /review: 2 BLOCKERs (subtitle still v2.2; v2.2 §-1 bullet contradicted new policy) + 1 IMPORTANT (§29 Porichoy supersession) fixed in-PR; 2 IMPORTANTs (§3.2 extensionAlias, §9.2 'draft' state CHECK) deferred to v2.4 with documented rationale.

**Pre-code memory (PR #88 `4782b05`):** locked three Item 13 architecture decisions G/H/I as canonical project decisions before code started.

**Backend (PR #89 `f509efd`):** migration 0007 (`reviewer_checklist jsonb` + `reviewer_notes text` + composite index on audit_logs for conflict-of-interest queries); new shared-types schemas (per-tier REQUIRED_CHECKLIST_KEYS + decision/toggle/notes schemas); presigned-GET URL helper (15-min TTL); four new sibling audit helpers (viewed/checklist_toggled/notes_updated/decided); five endpoints under `/api/v1/admin/kyc` (list with cursor pagination, detail with audit-on-fetch + self-claim submitted→under_review, checklist toggle, notes update, decide with conflict-of-interest + checklist-completeness server-enforcement). 27 integration tests. /review: 3 IMPORTANTs (PATCH terminal-state guard, COI on reject, detail-view defensive comment) all fixed in-PR. CI lint failure on first push (prettier-check) fixed in follow-up commit.

**Frontend (PR #90 `1925e2c`):** admin route group at `/(admin)/admin/kyc/`; viewport guard < 1024px; queue list page (status filter, cursor, no PII); detail page (two-column desktop); SubmissionDetail with per-tier field rendering + helper text; DocumentViewer with browser-native `<img>` + per-doc verified checkbox + image-dimensions surface; ReviewerNotes with auto-save + Saved indicator; DecisionActions with typed-APPROVE modal + reject reason + ESC dismiss + focus return to trigger button (WCAG 2.1 SC 2.1.2 + 2.4.3); useAdminKyc hook with Decision H per-query cache override on detail. 64 web tests. /review: 2 BLOCKERs (ESC key missing, focus return missing) + 3 IMPORTANTs (misleading hook comment, missing checkbox-click test, missing modal-open axe scans) all fixed in-PR with new tests. CI e2e Playwright build failed first push on route group collision (`/(admin)/kyc/` and `/(tenant)/kyc/` both resolved to bare `/kyc`); fixed by moving admin pages under `/(admin)/admin/kyc/` so URL becomes `/admin/kyc`.

**Final routes:** `/admin/kyc` (static, 3.03 kB + 118 kB shared) + `/admin/kyc/[id]` (dynamic, 5.43 kB + 136 kB shared).

## Next concrete step

**Day 19 — Items 14 + 15 bundled in one PR — Trust Center scaffolding + super admin Legal & Trust editor.**

Per `.claude/memory/decisions.md` "Trust Center v0.1 placeholders — skeleton-only" (2026-05-17): **skeleton-only placeholder content** — real headings + one-sentence "PLACEHOLDER — to be drafted by counsel covering X" per section + non-dismissable DRAFT banner. **NO AI-generated full-text legal drafts.** Onboarding flow gates on consent → consent gates on v1.0 documents → first paying tenant blocked until counsel returns drafts.

**Scope:**

- New tables `legal_documents` + `legal_document_versions` per §9.11 (migration 0008). `legal_document_versions` is the **second append-only table** after `audit_logs`; needs the explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` boilerplate per §4.2.1.1 (codified in v2.3 bump, PR #87).
- Seed entries for all 18 documents (6 legal contracts + 12 trust artefacts) per §20.2 with v0.1 placeholder body_md.
- Public routes for all 18 paths per §20.1: `/privacy`, `/terms`, `/eula`, `/dpa`, `/cookies`, `/refund-policy`, plus 12 `/trust/...` paths.
- Each page renders the placeholder body, the version metadata, and the non-dismissable DRAFT banner at the top.
- Super admin Legal & Trust editor at `/admin/legal-trust` — list view of all documents, per-document version history view, new-version create form (markdown editor + body_html pre-render). Tightly scoped: text-area-based editor, no rich-text formatting, no media upload.
- `consent_records` table is **NOT** in Day 19 scope — that lands when the v1.0 legal documents are signed (post-counsel-review). The onboarding consent prompt is queued for Sprint 3 alongside the v1.0 publish.

**STOP-ASK conditions for Day 19:**

- New dep beyond what's already landed → halt, ask.
- Schema change beyond migration 0008's two tables → halt, ask.
- **Any temptation to add real legal-language drafts** (whether AI-generated, ported from open-source templates, or transcribed from another project) → halt, surface to Moshiur. This is a load-bearing decision per `.claude/memory/decisions.md` 2026-05-17; counsel must produce v1.0. v0.1 is skeleton-only.
- Markdown sanitization at render: trust-document body_html is pre-rendered server-side from body_md by the editor PR; ensure the editor passes through a server-side sanitizer (DOMPurify equivalent, or strict allow-list HTML) before storing body_html. If no clean way to do this without a new dep, halt.
- Any reviewer-checklist-style structured data on legal documents (e.g. "approver checklist") → out of scope; queue for Sprint 3+.

## Scheduled mid-sprint PR slots

- **Day 20 AM — OAuth sign-in bug fix (dedicated PR, runs BEFORE `/sprint` retro).** Code fix for button hrefs (`/api/auth/{provider}/start` 404s on web vhost → absolute `NEXT_PUBLIC_API_BASE_URL` + `/api/v1/auth/oauth/...` path) + `bootstrap-staging.sh` extension to materialise OAuth secrets. Moshiur's parallel-track credentials still required for staging cutover.

## Sprint 2 closeout candidates (queued for v0.2.0-sprint-2 release)

**New from Day 18:**

- **v2.4 playbook bump candidates from PR #87 /review deferrals:**
  - §3.2 amendment — add the `extensionAlias` pattern in `next.config.mjs` for ESM-typed workspace packages with `.js` re-exports (Day 16 PR 3 gotcha). Already documented in gotchas.md; the playbook line is the deferred surface.
  - §9.2 amendment — update the `kyc_submissions.status` CHECK to include `'draft'` (migration 0005 reality from Day 14). Important because §9.2 is a schema reference; the current DDL would mislead anyone using the playbook as schema source-of-truth.
- **Conflict-of-interest "approve disabled with tooltip" pre-detection** — Day 18 PR 4 surfaces the 409 server response as a friendly inline error. The user brief §2.3 mentions a tooltip-disable version (requires fetching audit history per submission) — Sprint 2 closeout polish.
- **E2E Playwright happy-path through admin KYC queue** — needs admin JWT minting in setup, walks list → detail → checklist toggle → approve → notification stub fired. Estimated 2-3 hours focused.
- **`useAdminKycDetail` test coverage for the cache override** — current PR 4 tests don't directly assert `staleTime: 0` / `gcTime: 0` are present; relies on the hook's source being correct. Could pin via a unit test that inspects the QueryClient state after navigation away.

**Pre-existing (carried from Days 12–17):**

- **Full Individual Tier 1 happy-path Playwright test** — Day 17 PR 2 carry. Needs globalSetup that mints a JWT via apps/api signTokens; walks 4 steps + uploads; asserts success. Local-only with KYC_S3_DRY_RUN=1.
- **Org Tier A axe coverage for steps 2-6** — Day 17 PR 2 ships axe on Step1OrgInfo only; queue the other 5 (~30 min).
- **`KycDraftPatchInput.body.step` union drift risk** — Day 17 PR 2 /review #2. Hand-coded 7-literal union should re-export from shared-types.
- **`maskAccount → maskLast4` + dedicated `maskEtin`** — Day 17 PR 2 /review #4 cosmetic.
- **Staging-real e2e Playwright cutover** — per decisions.md 2026-05-19. CI IAM outbound + Cloudflare allowlist + staging fixture + S3 PUT teardown.
- **Loading/saving indicator near wizard progress bar** — polish item deferred from Day 17.
- **Framer-motion step transitions with prefers-reduced-motion fallback** — polish item deferred from Day 17.
- **S3 signed URL issuance audit_logs backfill** — single helper call in `getKycUploadUrl()`. Per decisions.md 2026-05-17.
- **audit_logs unset-GUC smoke test** — Day 14 /review #1 follow-up.
- Reviewer S4 (Day 12) — dedicated KMS key-admin role for the KYC CMK.
- Reviewer S6 (Day 12) — noncurrent-version transitions to GLACIER_IR vs STANDARD-90d.

## Cross-sprint carries (not closeout)

- GitHub Pro upgrade → Environment branch-protection on `staging` (and `prod`) — Sprint 1 carry.
- Sprint 4 — `eventpulse-deploy-prod` role using canonical three-claim pattern (§17.9.1 codified in v2.3 bump).
- **Sprint 3 auth-hardening bundle PR** — session revocation fix + auth events audit_logs backfill.

## Open questions for Moshiur

- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal consult email queued. Needed by end of Sprint 2 for Sprint 3 fee calculator.
- **Counsel engagement for Trust Center v1.0 drafts** — Day 19 ships v0.1 placeholders only. Counsel must produce v1.0 before the first paying tenant can complete onboarding (consent → v1.0 docs gating per decisions.md 2026-05-17). Email queued?
- **EPS sandbox credentials** in `eventpulse/staging/eps` — Sprint 3 dependency.
- **EPS library question** (`eps-gateway-nodejs` npm vs EPS-PG/EPS_Nodejs GitHub) — queued for the last session of Sprint 2.
- **OAuth credentials for staging** — needed for Day 20 AM OAuth fix PR.
- **Playwright runner staging connectivity** — Sprint 2 closeout dependency for the staging-real e2e cutover.

## Hard guardrails (unchanged + 3 new for Day 19)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1).
- audit_logs is APPEND-ONLY (§1.3 R8 + §4.2.1.1). No UPDATE/DELETE from application code.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Multiple helpers in the same domain file are fine (4 KYC reviewer helpers in `services/audit/kyc.ts` per Day 18).
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()` via vitest-axe. Modal-open state needs its own axe scan (Day 18 PR 4 /review I3).
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — Day 16 PR 3 BLOCKER 1.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory; sessionStorage holds only opaque IDs. **Detail-view queries on PII surfaces MUST override the default TanStack Query cache to `staleTime: 0` + `gcTime: 0` + `refetchOnWindowFocus: false` + `refetchOnReconnect: false`** so PII evaporates on navigation away (Decision H, Day 18).
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — Day 16 PR 3 gotcha; deferred from v2.3 playbook bump to v2.4.
- **BIN 13-digit fact (NBR 2019-11-30) is reviewer-documentation, NOT server-side enforcement.** Day 17 PR 1 BLOCKER fix grandfathered as the one exception. Future schemas adding format regex must cross-reference a decisions.md entry justifying departure from the manual-verification policy.
- **Wizard step→jsonb-key mapping for Tier A** — verbose step names (`org_info`, `signatory_identity`) shorten to jsonb keys (`fields.org`, `fields.signatory`).
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER. Same pattern for any future variant.
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.** Per the 2026-05-19 platform-wide manual-verification policy. Reviewer-notes free-text + per-field helper text + approve-modal-confirm + reject-typed-reason are the entire concern-surfacing surface for MVP.
- **Manual-verification policy is load-bearing.** Any temptation to add automated checks (format regex, sanctions matcher, validator stub) on the strength of "the queue would be cleaner with it" → halt, surface to Moshiur. The Phase 2 trigger (50 verified submissions/week sustained 4-week trailing average, reviewer-capacity criterion) is the only sanctioned re-evaluation gate.
- **Porichoy adapter scaffold-only shape is the canonical pattern for all future automation integrations.** Interface + env vars + Secrets Manager entry + TODO stub. Day 20 Item 16 Porichoy scaffold work continues unchanged.
- **NEW for Day 19 — Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts. Real headings + one-sentence "PLACEHOLDER — to be drafted by counsel covering X" per section + non-dismissable DRAFT banner. Per `.claude/memory/decisions.md` "Trust Center v0.1 placeholders — skeleton-only" 2026-05-17 (load-bearing). Onboarding consent gating queued for Sprint 3 once counsel returns v1.0.
- **NEW for Day 19 — `legal_document_versions` is the second append-only table.** Migration 0008 must include the explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` boilerplate per §4.2.1.1 (codified in v2.3 bump, PR #87). RLS forced + SELECT/INSERT policies only (no UPDATE/DELETE policies).
- **NEW for Day 19 — super-admin Legal & Trust editor uses server-side markdown sanitization.** body_html is rendered + sanitized server-side from body_md. If no clean way to sanitize without a new dep, halt.
- **NEW for Day 19 — admin route group lives under `/(admin)/admin/...` to avoid /kyc route collision with /(tenant)/kyc.** Day 18 PR 4 hit this and moved everything under `/admin/...`. Apply the same convention to `/admin/legal-trust` (the Legal & Trust editor).

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
