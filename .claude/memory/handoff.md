# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (end of Sprint 2 Day 19)
**Driver:** Claude Code (Opus 4.7) — Sprint 2 standard execution mode, autonomous (Day 19 brief approved "do all, do not to ask my, work on autonomus")

## State right now

**Sprint 2 Day 19 closed. Four PRs merged across the day** — Day 19's Items 14+15 bundled into Trust Center substrate (memory + backend + public endpoints + frontend). The platform now has 18 public Trust Center documents seeded at v0.1 placeholders (DRAFT banner on each), a working super admin Legal & Trust editor for counsel-driven v1.0 publishes, and a render-at-publish + edge-cache + revalidatePath pipeline. Combined with Day 18's KYC review queue, the platform now has its two highest-stakes super-admin surfaces live.

```text
<pending>   memory: Sprint 2 Day 19 closeout — Items 14+15 shipped (4 PRs)
1c5ed7f     feat(web): Day 19 Items 14+15 frontend — Trust Center public pages + super admin Legal & Trust editor (#102)
f0e8684     feat(api): Day 19 Item 14 public Trust Center read endpoints (#101)
49298f2     feat(api): Day 19 Items 14+15 backend — Trust Center scaffolding + Legal & Trust editor (#100)
085451d     memory: log Day 19 Items 14+15 pre-code — markdown sanitization + Server Components + consent gate deferral + canonical_url_path (#99)
4d5bd8b     memory: Sprint 2 Day 18 closeout — Item 13 shipped (5 PRs) (#91)
```

## What landed in Day 19

**Pre-code memory (PR #99 `085451d`):** locked four canonical architecture decisions (J, K, L, M) — markdown sanitization pipeline + Server Component render shape + re-consent deferral to Sprint 3 + §20.2 deferral with flat slugs + canonical_url_path column.

**Backend (PR #100 `49298f2`):** migration 0008 (`legal_documents` + `legal_document_versions` per §9.11 + Decision M.3 extension; second append-only table after audit_logs with explicit REVOKE per §4.2.1.1; both tables RLS forced no-policies, eventpulse_admin-only). 5 new runtime deps in apps/api (unified + remark-parse + remark-rehype + rehype-sanitize + rehype-stringify). `renderLegalMarkdown()` single source of truth at `apps/api/src/domain/legal/render.ts` — `defaultSchema` allowlist unchanged, render-at-publish. 6 service-layer query functions at `domain/legal/queries.ts`. `writeLegalVersionPublished` audit helper (one-per-domain, tenant_id NULL system-action). 5 super-admin endpoints under `/api/v1/admin/legal`. Idempotent seed for 18 documents with Decision M.2 single-section DRAFT placeholder body. 41 new tests (render pipeline sanitization + seed shape + admin routes DB-gated). /review: CI integration job caught 3 failures on first push (403 vs 401 expectation; 23505 unique-violation catch missing drizzle's `err.cause` wrap; afterAll FK back-ref) — all fixed in follow-up commit before merge.

**Public API (PR #101 `f0e8684`):** `apps/api/src/routes/public/legal.ts` unauthenticated read endpoints (`GET /landing` + `GET /by-url-path?path=...`) with `Cache-Control: public, max-age=300, s-maxage=3600`. 5 DB-gated tests.

**Frontend (PR #102 `1c5ed7f`):** (public) route group with §1.5 gradient mesh; 19 Server Component pages (6 individual contracts at apex + 12 trust artefacts under /trust/* + /trust landing) all with `revalidate = 3600`; shared `<LegalDocumentPage>` + `<TrustCenterLandingGrid>` + `<DraftBanner>` (non-dismissable per Decision L, auto-disappears when isDraft flips false on v1.0.0). `lib/legal.ts` HTTP fetch wrapper with graceful network-failure handling (build doesn't depend on apps/api being up). Super admin Legal & Trust editor at `/(admin)/admin/legal-trust/` (list + detail + collapsible publish form, textarea-based markdown, material-change checkbox surfacing the Sprint-3 re-consent flag). TanStack Query hooks. Next.js `/api/internal/revalidate-trust` route handler with shared-secret auth. 21 new web tests (DraftBanner + LegalDocumentPage + TrustCenterLandingGrid + PublishVersionForm with axe coverage + /trust Playwright smoke). Production build: 29 routes total, 20 prerendered static-with-revalidate.

**Final routes:** `/trust` + 18 individual document paths (static, ~193 B + 102 kB shared, revalidate 1h), `/admin/legal-trust` (static, 2.52 kB + 118 kB), `/admin/legal-trust/[slug]` (dynamic, 3.55 kB + 119 kB), `/api/internal/revalidate-trust` (dynamic route handler, 193 B).

## What landed in Day 18

**Pre-day-18 memory (PR #86 `62fcef7`):** consolidated three prior per-item KYC-verification deferrals (Porichoy 2026-05-17, Item 10 eTIN/sanctions 2026-05-17, Day 17 BIN BLOCKER near-miss) into a single platform-wide "manual verification only for MVP" decisions.md entry. Both prior entries marked `Superseded by`. Reframed BIN 13-digit fact in gotchas.md as reviewer-documentation, not server-side enforcement directive.

**AM playbook bump (PR #87 `bbf5409`):** v2.3 bump with 9 §-section amendments. Highlights: §13.0 replaced with platform-wide policy text (verbatim alignment with PR #86 decisions.md); §17.9.1 new sub-subsection codifying the canonical GitHub→AWS OIDC three-claim trust pattern; §4.2.1.1 new sub-subsection codifying the append-only table invariant + REVOKE pattern; §29 Resolved-in-v2.3 block. /review: 2 BLOCKERs (subtitle still v2.2; v2.2 §-1 bullet contradicted new policy) + 1 IMPORTANT (§29 Porichoy supersession) fixed in-PR; 2 IMPORTANTs (§3.2 extensionAlias, §9.2 'draft' state CHECK) deferred to v2.4 with documented rationale.

**Pre-code memory (PR #88 `4782b05`):** locked three Item 13 architecture decisions G/H/I as canonical project decisions before code started.

**Backend (PR #89 `f509efd`):** migration 0007 (`reviewer_checklist jsonb` + `reviewer_notes text` + composite index on audit_logs for conflict-of-interest queries); new shared-types schemas (per-tier REQUIRED_CHECKLIST_KEYS + decision/toggle/notes schemas); presigned-GET URL helper (15-min TTL); four new sibling audit helpers (viewed/checklist_toggled/notes_updated/decided); five endpoints under `/api/v1/admin/kyc` (list with cursor pagination, detail with audit-on-fetch + self-claim submitted→under_review, checklist toggle, notes update, decide with conflict-of-interest + checklist-completeness server-enforcement). 27 integration tests. /review: 3 IMPORTANTs (PATCH terminal-state guard, COI on reject, detail-view defensive comment) all fixed in-PR. CI lint failure on first push (prettier-check) fixed in follow-up commit.

**Frontend (PR #90 `1925e2c`):** admin route group at `/(admin)/admin/kyc/`; viewport guard < 1024px; queue list page (status filter, cursor, no PII); detail page (two-column desktop); SubmissionDetail with per-tier field rendering + helper text; DocumentViewer with browser-native `<img>` + per-doc verified checkbox + image-dimensions surface; ReviewerNotes with auto-save + Saved indicator; DecisionActions with typed-APPROVE modal + reject reason + ESC dismiss + focus return to trigger button (WCAG 2.1 SC 2.1.2 + 2.4.3); useAdminKyc hook with Decision H per-query cache override on detail. 64 web tests. /review: 2 BLOCKERs (ESC key missing, focus return missing) + 3 IMPORTANTs (misleading hook comment, missing checkbox-click test, missing modal-open axe scans) all fixed in-PR with new tests. CI e2e Playwright build failed first push on route group collision (`/(admin)/kyc/` and `/(tenant)/kyc/` both resolved to bare `/kyc`); fixed by moving admin pages under `/(admin)/admin/kyc/` so URL becomes `/admin/kyc`.

**Final routes:** `/admin/kyc` (static, 3.03 kB + 118 kB shared) + `/admin/kyc/[id]` (dynamic, 5.43 kB + 136 kB shared).

## Next concrete step

**Day 20 — Item 16 (Porichoy scaffold + tenant subdomain provisioning + bilingual SES templates) + OAuth sign-in bug fix + `/sprint` retro + `v0.2.0-sprint-2` tag + Sprint 3 kick-off.**

The schedule was already documented for Day 20 in the Sprint 2 plan; nothing changed structurally. Carrying forward without rework:

- **AM PR — OAuth sign-in bug fix** (runs BEFORE `/sprint` retro per the previous handoff): code fix for button hrefs (the `/api/auth/{provider}/start` 404s on the web vhost — switch to absolute `NEXT_PUBLIC_API_BASE_URL` + `/api/v1/auth/oauth/...` path) + `bootstrap-staging.sh` extension to materialise OAuth secrets. **Moshiur's parallel-track credentials still required** (Google Cloud Client + Apple Services ID with staging callback URLs registered, handed back for Secrets Manager population) before staging cutover.
- **Item 16 PR — Porichoy scaffold + subdomain provisioning + SES templates.** Porichoy adapter is scaffold-only per CHECKPOINT #1 (interface + env vars + Secrets Manager entry placeholder + TODO stub for `nidVerify()`); the Day 19 manual-verification policy means no live calls happen until counsel-driven Phase 2 reassessment. Tenant subdomain provisioning lands as the Item 13 TODO-stubbed `[STUB] subdomain provisioning` log marker now wires to Nginx vhost generation via SSM SendCommand. `kyc_approved` + `kyc_rejected` bilingual SES templates land alongside (English + Bangla copy from §16.2).
- **Sprint 2 closeout PR (memory + tag + release):** `/sprint` retro covering Days 11–20; `v0.2.0-sprint-2` annotated git tag; release notes; Sprint 3 kick-off issue covering attendee accounts + self-service hosting (per §26.2 Sprint 8 brought forward).

**STOP-ASK conditions for Day 20:**

- Porichoy adapter going live (any actual call to `porichoy.gov.bd` with real credentials) → halt, surface to Moshiur. Scaffold-only is the load-bearing decision per `decisions.md` 2026-05-17 "Porichoy deferred" + 2026-05-19 "Platform-wide manual verification only for MVP". Credentials must arrive + procurement complete before this changes.
- Subdomain provisioning hitting Cloudflare for SaaS APIs → halt. Custom-domain layer is Phase 2 Sprint 7 per §26.2, not Item 16 scope. Item 16 covers Nginx vhost generation on the EC2 only.
- Any temptation to land the OAuth fix as a sub-task of Item 16 instead of its own PR → halt. The Day 18 handoff explicitly schedules it as a dedicated PR (separate review surface, separate revert path).
- Sprint 3 work bleeding into the Day 20 closeout → halt. The kick-off issue is the artefact; the work itself starts in the Sprint 3 sessions.

## Sprint 2 deliverable summary (for `/sprint` retro)

Shipped across Days 11–19 (Day 20 pending):

- Day 11 — CLAUDE.md v2.2 bump + pre-push hook fix + RLS migration 0003 + OAuth callback routes + 8 staging-deploy fixes (Sprint 2 kickoff)
- Day 12 — KYC bucket + dedicated CMK (Item 6)
- Day 13 — KYC submissions schema + S3 client + upload-URL endpoint + Day 12 carry absorption (Items 7+8)
- Day 14 — KYC state machine + submit endpoint + audit_logs table + notification stubs (Item 9)
- Day 15 — Post-login Account-Type modal + tenant.type nullable + frontend test rig (Item 11)
- Day 16 — KYC wizard backend + TanStack Query infra + Individual Tier 1 wizard frontend (Item 12 Part 1)
- Day 17 — Organisation Tier A wizard + polish + e2e Playwright infra (Item 12 Part 2)
- Day 18 — Platform-wide manual-verification policy + v2.3 playbook bump + super admin KYC review queue (Item 13)
- Day 19 — Trust Center scaffolding + super admin Legal & Trust editor (Items 14+15)
- Day 20 (pending) — Porichoy scaffold + subdomain provisioning + SES templates + OAuth fix + closeout (Item 16)

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

**New from Day 19:**

- **v2.4 playbook bump candidates from Day 19** — §9.11 amendment to add `canonical_url_path text NOT NULL UNIQUE` to the published `legal_documents` DDL (Decision M.3 extension; currently only in migration 0008 + Drizzle schema, not §9.11). Adds to the existing §3.2 + §9.2 v2.4 candidates from Day 18 PR #87.
- **Deep E2E Playwright happy-path through Trust Center** — seed → visit `/trust` + sample 3-5 individual pages → assert DRAFT banner is in DOM + version metadata correct → open admin Legal & Trust editor → publish v0.2 → verify the public page reflects within ~2s (after revalidatePath fires). Estimated 2 hours focused.
- **Admin Legal & Trust editor: version-diff view** — currently the version history shows version strings + dates + summary-of-changes; opening a past version requires `GET /documents/:slug/versions/:versionId`. Sprint 3 polish: side-by-side diff between current and historical versions in the UI (the API endpoint exists; just needs a diff renderer).
- **Re-render-all-versions maintenance script** — Decision J anticipates that widening the allowlist will require re-running `renderLegalMarkdown` against every stored `body_md` to refresh cached `body_html`. Currently no such script exists; queue as Sprint 3 when (or if) the allowlist widens. Audit row shape: `legal_document_version.rerendered`.
- **`apps/web` admin route group axe coverage parity** — PR #102 ships axe on DraftBanner + LegalDocumentPage + TrustCenterLandingGrid + PublishVersionForm. The admin document list + detail components have no axe yet (~30 min follow-up to match Day 15 precedent).
- **CHECKPOINT #3 satisfied + acknowledged** — Trust Center v0.1 ships skeleton-only with non-dismissable DRAFT banner; no AI-generated legal text; consent gating queued for Sprint 3. Document this checkpoint as closed in the `/sprint` retro alongside CHECKPOINT #1 (Porichoy scaffold) which closes Day 20.

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

## Hard guardrails

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
- **Admin route group lives under `/(admin)/admin/...`.** Day 18 PR 4 hit the `/kyc` route-collision (admin + tenant groups both registering `/kyc`). Same convention applied to `/admin/legal-trust`.
- **Markdown sanitization is via the `renderLegalMarkdown()` function in `apps/api/src/domain/legal/render.ts`** (Decision J). Single source of truth. The unified pipeline (`unified` + `remark-parse` + `remark-rehype` + `rehype-sanitize` + `rehype-stringify`) with unchanged `defaultSchema` allowlist. Render-at-publish (NOT render-at-request). Widening the allowlist requires its own decisions.md entry. Never re-implement sanitization in any other module.
- **Public Trust Center pages are Server Components, fetched over HTTP** (Decision K — refined from "direct service-layer import" since §3.2 forbids cross-app imports; the public API endpoints at `/api/v1/public/legal/*` from PR #101 are the seam). No client-side hydration. No TanStack Query. `revalidate: 3600` + `revalidatePath()` invalidation on publish. Lib wrapper at `apps/web/src/lib/legal.ts` returns null/empty on network failure so build doesn't depend on apps/api being up.
- **`consent_records` table is OUT OF SCOPE until Sprint 3** (Decision L). Deferred alongside counsel-produced v1.0. Scope-creep red flags: any "click to acknowledge" button, IP/UA capture on Trust Center views, sign-up consent checkbox, "preview consent" toggle, any users/tenants column referencing consent state → halt and surface.
- **Document set is §20.2 verbatim** (Decision M.1). 6 contracts + 12 artefacts. No additions, no slug renames, no category re-mappings. Adding a new document later: row insert + matching Next.js route file; the two are paired (the editor cannot create routes).
- **Flat database slugs + `canonical_url_path text NOT NULL UNIQUE` column** (Decision M.3). Routing is data-driven: the Server Component for a path calls `fetchLegalDocumentByUrlPath(<path>)`. No central middleware/regex/glob mapping.
- **Sub-processors uses single-paragraph DRAFT placeholder in v0.1** (Decision M.2). Structured `<SubprocessorsEditor />` UI + the daily diff job (§20.6) defer to Sprint 3. v0.1 edits flow through the standard markdown editor.

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
