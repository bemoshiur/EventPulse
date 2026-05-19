# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (Sprint 2 Day 19 in flight — pre-code memory PR ready)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode, autonomous (Day 19 brief approved "do all, do not to ask my, work on autonomus")

## State right now

**Day 18 closed end-of-day with five PRs merged. Day 19 is now in flight — Items 14+15 (Trust Center scaffolding + super admin Legal & Trust editor) bundled across three PRs.** Pre-code memory PR drafted (Decisions J, K, L, M locked); backend + frontend PRs queued behind it.

```text
<pending>   memory: Day 19 pre-code — Decisions J/K/L/M for Trust Center + Legal & Trust editor
4d5bd8b     memory: Sprint 2 Day 18 closeout — Item 13 shipped (5 PRs) (#91)
1925e2c     feat(web): Day 18 PM Item 13 frontend — super admin KYC review queue UI (#90)
f509efd     feat(api): Day 18 PM Item 13 backend — super admin KYC review queue + decision API (#89)
4782b05     memory: log Day 18 Item 13 pre-code — read-audit + cache-zero + structured checklist (#88)
bbf5409     docs(playbook): bump CLAUDE.md to v2.3 — 9 §-section amendments synchronising Days 11-18 reality (#87)
62fcef7     memory: Sprint 2 — platform-wide manual verification policy for MVP (#86)
```

**Day 19 PR 1 (memory, this PR) locks four decisions for the Trust Center work:**

- **Decision J** — markdown sanitization via `rehype-sanitize` (unified family), `defaultSchema` allowlist unchanged, render-at-publish (5 new runtime deps in `apps/api` — all unified ecosystem)
- **Decision K** — public Trust Center pages are Next.js Server Components calling the service-layer directly; no client-side hydration; `revalidate: 3600` + `revalidatePath()` on publish
- **Decision L** — re-consent enforcement gate (consent_records table + interstitial + cron + onboarding gate) DEFERRED to Sprint 3 alongside counsel-produced v1.0 documents. Day 19 ships only the document substrate
- **Decision M** — defer to §20 verbatim (6 contracts + 12 artefacts); flat database slugs + `canonical_url_path text NOT NULL UNIQUE` column for data-driven URL routing; sub-processors IS in legal_documents with markdown-editor publish path (structured `<SubprocessorsEditor />` deferred to Sprint 3)

## What landed in Day 18

**Pre-day-18 memory (PR #86 `62fcef7`):** consolidated three prior per-item KYC-verification deferrals (Porichoy 2026-05-17, Item 10 eTIN/sanctions 2026-05-17, Day 17 BIN BLOCKER near-miss) into a single platform-wide "manual verification only for MVP" decisions.md entry. Both prior entries marked `Superseded by`. Reframed BIN 13-digit fact in gotchas.md as reviewer-documentation, not server-side enforcement directive.

**AM playbook bump (PR #87 `bbf5409`):** v2.3 bump with 9 §-section amendments. Highlights: §13.0 replaced with platform-wide policy text (verbatim alignment with PR #86 decisions.md); §17.9.1 new sub-subsection codifying the canonical GitHub→AWS OIDC three-claim trust pattern; §4.2.1.1 new sub-subsection codifying the append-only table invariant + REVOKE pattern; §29 Resolved-in-v2.3 block. /review: 2 BLOCKERs (subtitle still v2.2; v2.2 §-1 bullet contradicted new policy) + 1 IMPORTANT (§29 Porichoy supersession) fixed in-PR; 2 IMPORTANTs (§3.2 extensionAlias, §9.2 'draft' state CHECK) deferred to v2.4 with documented rationale.

**Pre-code memory (PR #88 `4782b05`):** locked three Item 13 architecture decisions G/H/I as canonical project decisions before code started.

**Backend (PR #89 `f509efd`):** migration 0007 (`reviewer_checklist jsonb` + `reviewer_notes text` + composite index on audit_logs for conflict-of-interest queries); new shared-types schemas (per-tier REQUIRED_CHECKLIST_KEYS + decision/toggle/notes schemas); presigned-GET URL helper (15-min TTL); four new sibling audit helpers (viewed/checklist_toggled/notes_updated/decided); five endpoints under `/api/v1/admin/kyc` (list with cursor pagination, detail with audit-on-fetch + self-claim submitted→under_review, checklist toggle, notes update, decide with conflict-of-interest + checklist-completeness server-enforcement). 27 integration tests. /review: 3 IMPORTANTs (PATCH terminal-state guard, COI on reject, detail-view defensive comment) all fixed in-PR. CI lint failure on first push (prettier-check) fixed in follow-up commit.

**Frontend (PR #90 `1925e2c`):** admin route group at `/(admin)/admin/kyc/`; viewport guard < 1024px; queue list page (status filter, cursor, no PII); detail page (two-column desktop); SubmissionDetail with per-tier field rendering + helper text; DocumentViewer with browser-native `<img>` + per-doc verified checkbox + image-dimensions surface; ReviewerNotes with auto-save + Saved indicator; DecisionActions with typed-APPROVE modal + reject reason + ESC dismiss + focus return to trigger button (WCAG 2.1 SC 2.1.2 + 2.4.3); useAdminKyc hook with Decision H per-query cache override on detail. 64 web tests. /review: 2 BLOCKERs (ESC key missing, focus return missing) + 3 IMPORTANTs (misleading hook comment, missing checkbox-click test, missing modal-open axe scans) all fixed in-PR with new tests. CI e2e Playwright build failed first push on route group collision (`/(admin)/kyc/` and `/(tenant)/kyc/` both resolved to bare `/kyc`); fixed by moving admin pages under `/(admin)/admin/kyc/` so URL becomes `/admin/kyc`.

**Final routes:** `/admin/kyc` (static, 3.03 kB + 118 kB shared) + `/admin/kyc/[id]` (dynamic, 5.43 kB + 136 kB shared).

## Next concrete step

**Day 19 PR 2 (backend) — opens immediately after memory PR squash-merges.**

**Scope:**

- **Five new runtime deps** in `apps/api/package.json` (Decision J): `unified`, `remark-parse`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`. Lockfile commit included.
- **Migration 0008** — `legal_documents` + `legal_document_versions` per §9.11 + Decision M extension (`canonical_url_path text NOT NULL UNIQUE` on `legal_documents`). `legal_document_versions` is the **second append-only table** after `audit_logs`; needs explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` per §4.2.1.1 (codified in v2.3 bump, PR #87). FK back-reference (`legal_documents.current_version_id` → `legal_document_versions.id`) is deferred — added via `ALTER TABLE` after both tables exist, or set NULL initially + populated by seed (use the second approach for transactional cleanliness).
- **Drizzle schema** entries for both tables matching the SQL exactly.
- **`apps/api/src/domain/legal/render.ts`** — single source of truth for markdown sanitization via the unified pipeline (Decision J). Pipeline + `defaultSchema` + `renderLegalMarkdown(md): Promise<string>` export.
- **`apps/api/src/domain/legal/queries.ts`** — service-layer reads for the public Trust Center: `fetchLegalDocumentByUrlPath`, `fetchLegalDocumentBySlug`, `listLegalDocumentsForTrustCenterLanding`, `fetchVersionHistoryForDocument`. All run under `withSuperAdmin()` (platform-global, not tenant-scoped).
- **`apps/api/src/services/audit/legal.ts`** — new domain helper file with `writeLegalVersionPublished` (one-per-domain rule, sibling helpers can be added later).
- **`apps/api/src/routes/super-admin/legal.ts`** — five endpoints under `requireSuperAdminAuth`:
  - `GET    /api/v1/admin/legal/documents` — list all 18 with current version metadata
  - `GET    /api/v1/admin/legal/documents/:slug` — single document + version history (server-side join)
  - `GET    /api/v1/admin/legal/documents/:slug/versions/:versionId` — single version body_md + body_html for editor pre-fill
  - `POST   /api/v1/admin/legal/documents/:slug/versions` — create new version (body_md → server-side sanitize → store body_html; sets material_change + summary_of_changes; on success bumps `legal_documents.current_version_id`; writes `writeLegalVersionPublished` audit row)
  - The publish endpoint also calls Next.js `revalidatePath(canonical_url_path)` via the internal API helper so the public page updates within ~1s.
- **Seed script `scripts/seed-legal-documents.ts`** — idempotent insert of 18 `legal_documents` rows + 18 `legal_document_versions` v0.1 rows using the skeleton template from Decision M.2 (single-section DRAFT placeholder + auto-generated "What this document will cover" paragraph from §20.2 one-liner). Sub-processors uses the same single-paragraph DRAFT — structured editor + JSON-encoded body is Sprint 3 scope.
- **Tests** (vitest + supertest against test DB):
  - migration RLS test (SELECT works, INSERT requires admin context, UPDATE/DELETE/TRUNCATE on `legal_document_versions` rejected for `eventpulse_app`)
  - render pipeline tests (round-trip, `<script>` stripped, `javascript:` href stripped, `<iframe>` stripped, `data:` img stripped, `https://` img preserved, snapshot of placeholder body)
  - service-layer query tests (by-url-path, by-slug, landing list)
  - admin route tests (list / detail / single version / publish — including audit row written, body_html computed server-side, current_version_id bumped)
  - seed-script idempotency test (run twice → same row count, no duplicates)

**PR 3 (frontend) follows PR 2 — locked after PR 2 squash-merges. Brief scope:**

- 19 server-component pages under `apps/web/src/app/(public)/` — 18 individual documents + `/trust/page.tsx` landing
- Shared `<LegalDocumentPage>` + `<TrustCenterLandingGrid>` components
- Admin Legal & Trust editor at `/(admin)/admin/legal-trust/` — list + per-document version history + new-version create form (textarea-based markdown, server pre-renders to body_html on submit)
- Frontend tests (vitest jsdom for components + Playwright smoke for the 19 public routes returning 200 + DRAFT banner visible)
- Seed-script invocation hook (Day 20 deploy will re-run idempotently)

**STOP-ASK conditions for the remaining Day 19 PRs:**

- Schema change beyond migration 0008's two tables → halt, ask.
- New dep beyond the five Decision-J-approved unified-family deps → halt, ask.
- **Any temptation to add real legal-language drafts** (AI-generated, open-source-templated, or cross-project transcribed) → halt, surface to Moshiur. Decision L + 2026-05-17 entry; counsel must produce v1.0.
- Allowlist widening from `defaultSchema` → halt, requires Sprint-3+ decisions.md entry per Decision J.
- Any temptation to add `consent_records`, `requires_reconsent`, an interstitial route, or any sign-up consent UI → halt. Decision L scope-creep red flag.
- Sub-processors editor going structured (form-based JSON edit) in Day 19 instead of Sprint 3 → halt per Decision M.
- Re-implementing a markdown sanitizer elsewhere (not via `renderLegalMarkdown()`) → halt.

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
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts. Single-section DRAFT placeholder per Decision M.2 — title + non-dismissable DRAFT banner + auto-generated "What this document will cover" paragraph from §20.2 one-liner. Per `.claude/memory/decisions.md` "Trust Center v0.1 placeholders — skeleton-only" 2026-05-17 (load-bearing).
- **`legal_document_versions` is the second append-only table.** Migration 0008 includes explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` per §4.2.1.1 (codified in v2.3 bump, PR #87). RLS forced + SELECT/INSERT policies only.
- **Admin route group lives under `/(admin)/admin/...`.** Day 18 PR 4 hit the `/kyc` route-collision (admin + tenant groups both registering `/kyc`). Apply same convention to `/admin/legal-trust`.
- **NEW for Day 19 (Decision J) — markdown sanitization is via the `renderLegalMarkdown()` function in `apps/api/src/domain/legal/render.ts`.** Single source of truth. The unified pipeline (`unified` + `remark-parse` + `remark-rehype` + `rehype-sanitize` + `rehype-stringify`) with unchanged `defaultSchema` allowlist. Render-at-publish (NOT render-at-request). Widening the allowlist requires its own decisions.md entry. Never re-implement sanitization in any other module.
- **NEW for Day 19 (Decision K) — public Trust Center pages are Server Components with direct service-layer DB reads.** No client-side hydration. No TanStack Query. `revalidate: 3600` + `revalidatePath()` invalidation on publish. The web app imports service-layer functions from `apps/api/src/domain/legal/queries.ts` directly per §3.2.
- **NEW for Day 19 (Decision L) — `consent_records` table is NOT in Day 19 scope.** Deferred to Sprint 3 alongside counsel-produced v1.0. Scope-creep red flags: any "click to acknowledge" button, IP/UA capture on Trust Center views, sign-up consent checkbox, "preview consent" toggle, any users/tenants column referencing consent state → halt and surface.
- **NEW for Day 19 (Decision M.1) — document set is §20.2 verbatim.** 6 contracts + 12 artefacts. No additions, no slug renames, no category re-mappings. Adding a new document later: row insert + matching Next.js route file; the two are paired (the editor cannot create routes).
- **NEW for Day 19 (Decision M.3) — flat database slugs + `canonical_url_path text NOT NULL UNIQUE` column.** Routing is data-driven: the Server Component for a path calls `fetchLegalDocumentByUrlPath(<path>)`. No central middleware/regex/glob mapping.
- **NEW for Day 19 (Decision M.2) — sub-processors uses single-paragraph DRAFT placeholder in v0.1.** Structured `<SubprocessorsEditor />` UI + the daily diff job (§20.6) defer to Sprint 3. v0.1 edits flow through the standard markdown editor.

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
