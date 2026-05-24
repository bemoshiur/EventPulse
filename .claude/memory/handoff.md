# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-24 (pre-Day-23 consolidation COMPLETE — held queue cleared, org-migration cascade closed, staging pristine, Day 23 ready)
**Driver:** Claude Code (Opus 4.7) — pre-Day-23 consolidation closeout; next session opens Sprint 3 Day 23 fresh

## State right now (2026-05-24 EOD)

**Pre-Day-23 consolidation COMPLETE.** What started as a routine queue-clearing task on 2026-05-20 unfolded across four sessions because of an org-level infrastructure migration that broke three independent trust relationships in sequence. All resolved; held PR queue cleared; staging pristine; Day 23 ready to begin.

**Staging EC2 verified pristine:**

- `origin/main` HEAD = `013446f` (#142, `@hookform/resolvers` 5.2.2 merge)
- Staging EC2 deployed code = `013446f` — **zero drift**
- Migrations 0001-0010 applied (`0010_tenants_subdomain_provisioning.sql` applied 2026-05-24 13:26:49 UTC)
- 5 vhosts: cert 2-SAN apex+wildcard valid through Aug 17 2026; all SSL=0; 4 return 200, api returns 404 on `/` (no route at root — expected; `/health` works)
- API `/health`: DB-aware JSON `{db: ok, checkedMs: 11}`
- Nginx `/nginx-health`: distinct, returns plain `ok`
- Trust Center: 18 v0.1 DRAFT-banner docs serving cleanly
- Pre-existing: OAuth `/start` returns 503 OAUTH_NOT_CONFIGURED — `eventpulse/staging/oauth-google` secret exists but bootstrap-staging.sh has not been re-run to materialise it into `.env.staging`. Same gap as the Day 20 handoff; not blocking anything.

**Cascade timeline (full archeology):**

1. **2026-05-19/20 GHA quota outage** — Free-tier org allowance exhausted with $0 spending limit; all GHA workflows failed for ~12 hours. Resolved by Moshiur raising the personal-account Actions spending limit to $20.
2. **2026-05-21 repo org migration discovered** — repo had moved from personal `publicpulseagency` to new org `The-Public-Pulse-Agency`. Cascade of three failures: (a) IAM trust policy mismatch on OIDC `sub` + `job_workflow_ref` claims (canonical login changed); (b) billing entity moved silently — personal-account spending limit doesn't carry to the new org; (c) deploy keys disabled org-wide + transferred key in stale state that authenticated on SSH greeting but rejected `git-upload-pack`.
3. **2026-05-24 consolidation session** — staging confirmed pristine; spending limit confirmed >$0 on the new org; held-PR merge sequence executed in dependency order; all queue items resolved.

**Held PR queue cleared (sequence executed 2026-05-24):**

- ✅ #122 — Decision O memory (earlier session)
- ✅ #123 — wildcard cert memory + 5 gotchas; rebased + merged as `51ab4ec`
- ✅ #124 — migration 0009 (earlier session)
- ✅ #125 — bilingual SES templates + selectLocale; merged as `1cafd40`
- ✅ #126 — tenant subdomain provisioning + migration 0010; merged as `d1d9b87`; **migration 0010 applied cleanly** (1 applied, 9 already in place)
- ✅ #127 — Fix 6b deploy.sh Nginx reload; merged as `01207a4`; **skip-path empirically verified** via workflow_dispatch on `01207a4..01207a4` empty-diff (log line: `no nginx vhost changes; skipping nginx reload`)
- 🟡 #128 — Day 22 EOD memory; CLOSED as superseded (stale pre-cascade prediction; rewritten in this PR)
- ✅ #129 — pre-Day-23 consolidation partial session (earlier session)
- ✅ #135 — IAM trust policy + docs for org migration; merged as `bc59747`
- ✅ #136 — combined aws-sdk client-s3 + s3-request-presigner coupled bump + dependabot grouping config; merged as `0301f36`; **#131 + #133 closed as superseded** (TS2345 peerdep coupling)
- 🟡 #134 — `@aws-sdk/client-sesv2` standalone; auto-closed by Dependabot when #136's grouping config landed; **REOPENED as #137 by Dependabot's next cycle as a grouped aws-sdk PR** (confirms grouping works)
- ✅ 4 safe Dependabot bumps: #96 (@tanstack/react-query patch), #98 (pg minor), #130 (hono patch), #132 (dev-deps group)
- ✅ #73 — `jose` 5→6 major; merged as `0e8e83e`; v6 breaking changes mapped clean against narrow usage
- 🟡 #93 — `@hookform/resolvers` 3→5 major; auto-closed by Dependabot during the cascade; manually recreated as #142 with the same bump; **#142 merged as `013446f`**
- 🟡 **#72 — `@noble/hashes` 1→2 major; DEFERRED to post-Days-24-25-EPS-truth-gate.** Labelled `deferred-post-eps-truth-gate`; PR remains OPEN. See decisions.md "@noble/hashes 1.8.0 → 2.2.0 deferred to post-Days-24-25-EPS-truth-gate" (2026-05-24).

**Memory captured (3 new gotchas + 1 decision + 1 CLAUDE.md amendment):**

- gotchas.md "GitHub repo transfer cascades through THREE owner-scoped trust relationships" (2026-05-20/21) — the full org-migration runbook
- gotchas.md "AWS SDK v3 packages share smithy internal Client types — must bump together" (2026-05-24) — TS2345 + grouping config recipe
- gotchas.md "Self-modifying deploy/bootstrap scripts don't take effect on the deploy that ships them" (2026-05-24) — needs TWO deploys to verify a deploy.sh change
- decisions.md "@noble/hashes 1.8.0 → 2.2.0 (Dependabot PR #72) deferred to post-Days-24-25-EPS-truth-gate" (2026-05-24)
- CLAUDE.md §11.2 amendment — `@noble/hashes` v2 `.js`-suffix note for the post-truth-gate bump

## Next concrete step

**Sprint 3 Day 23 — Event CRUD + `tenant_fee_config` exposure.** Staging is clean-pristine; deploy pipeline verified end-to-end; held queue zero. Day 23 starts here.

Pre-flight reads before Day 23 work begins:

- CLAUDE.md §2.4 (event lifecycle: `draft → published → on_sale → sold_out → live → completed → archived`)
- CLAUDE.md §9.3 (events schema)
- CLAUDE.md §14.4 (tenant fee override workflow — 4-eyes principle for >10 bps changes)
- CLAUDE.md §6 (API patterns: envelope, error codes, idempotency, pagination)

Day 23 main work:

- **Event CRUD API** (`apps/api/src/routes/tenant/events.ts`) — POST/GET/PATCH/DELETE; event slug generation (citext unique, reserved-handles guard, 3–30 chars); status state machine per §2.4.
- **`tenant_fee_config` exposed in super admin tenant detail view** — fee-override modal + `fee_override_log` audit (4-eyes principle for changes > 10 bps per §14.4).
- **Fixed form template per event type** — hardcoded React forms (full builder is Sprint 5+ per §26.1).

Cross-module e2e for Item 13 subdomain provisioning (`feat: tenant subdomain provisioning + migration 0010` carried this as a Day 23 morning task):

- Create a fixture tenant, submit KYC, approve, watch logs for `provisionTenantSubdomain: success` + new vhost serving at `<slug>.staging.eventpulse.com.bd/nginx-health` returning 200. This is the deferred follow-up from PR #126.

**Mandatory non-negotiable Day 24-25 EPS sandbox truth gate (per Decision N 2026-05-19, unchanged):**

- Run 4 real EPS sandbox transactions covering all §14.2 modes (subtotal 1,000 BDT, platform 0.25%, EPS 2.5%).
- Capture EPS's actual fee on each.
- Compare to calculator predictions: Mode A=2506, B=2500, C=2500, D=2506.
- Any delta in any cell is a calculator bug — adjust the calculator (NOT the sandbox observations), re-run §24.4 fee-mode tests, amend §14.2 to match.
- Mode C is the most likely-to-shift cell (Decision N picked calc 2500 over §14.2 primary 2506; sandbox is the empirical arbiter).
- Day 26 first-sandbox-order-verification cannot pass without this gate clearing.
- **Post-truth-gate** — reopen #72 (`@noble/hashes` 1→2) per its deferral plan in decisions.md.

**Sprint 3 pre-flight checklist (carries from earlier handoffs):**

- §29 #9 (AIT withholding) + #10 (VAT/Mushak) — tax opinions for fee calculator math (still pending; calculator ships PRE-WITHHOLDING per file header).
- `eventpulse/staging/eps` Secrets Manager entry — ✅ DONE Day 20 closeout retry.
- `eventpulse/staging/oauth-google` Secrets Manager entry — ✅ DONE Day 20.
- Apple OAuth — DROPPED from MVP per decisions.md 2026-05-19.
- EPS library decision LOCKED (in-house wrapper) — no re-litigation.

## STOP-ASK conditions for Sprint 3 (unchanged)

- §29 #9 / #10 tax opinions still pending by Day 22 → halt fee calculator work, surface to Moshiur.
- OAuth credentials still missing by Day 23 → document as Sprint 4 pending; no further verification work this sprint.
- Subdomain provisioning staging integration test fails in ways that suggest the SSM + Nginx + certbot chain is fragile → halt subdomain work, build something else, defer to Sprint 4.
- EPS wrapper finds `STAGING_PAYMENT_BLOCK` doesn't reliably guard against priced orders → halt all EPS work, file critical bug, surface immediately.
- **Day 24-25 EPS sandbox truth gate fails (any cell delta)** → calculator gets adjusted (not sandbox), §14.2 gets re-amended, fee-mode tests re-run. Day 26 sandbox-order work gates on this clearing. **The calculator is the variable to change, not the sandbox observations** — Decision N 2026-05-19.
- Counsel returns Trust Center v1.0 drafts mid-sprint → in-scope addition only if drafts arrive before Day 25; later than that, defer to Sprint 4 + consent_records work alongside.

## Net-new Dependabot PRs that arrived mid-consolidation (next session's triage)

- #137 — aws-sdk grouped PR (confirms grouping config from #136 works; likely contains sesv2 + other aws-sdk family bumps)
- #138 — `@tanstack/react-query` 5.100.11 → 5.100.14 (further patch beyond merged #96)
- #139 — `@hookform/resolvers` 3.10.0 → 5.4.0 (Dependabot doesn't yet know #142 landed 5.2.2; will recompute next cycle)
- #140 — `react-hook-form` 7.76.0 → 7.76.1 (patch)
- #141 — `geist` 1.7.0 → 1.7.1 (patch)

Defer triage to a future cycle; none are urgent. #137 in particular validates the grouping config from #136.

## Sprint 2 deliverable summary (locked in release notes — see docs/releases/v0.2.0-sprint-2.md)

Days 11-20 shipped:

- Day 11 — CLAUDE.md v2.2 bump + pre-push hook fix + RLS migration 0003 + OAuth callback routes + 8 staging-deploy attempts (5 fix PRs) (Sprint 2 kickoff)
- Day 12 — KYC bucket + dedicated CMK (Item 6)
- Day 13 — KYC schema + S3 client + upload-URL endpoint + OIDC infra closeout (Items 7+8)
- Day 14 — KYC state machine + submit endpoint + audit_logs table + notification stubs (Item 9)
- Day 15 — Post-login Account-Type modal + tenant.type nullable + frontend test rig (Item 11)
- Day 16 — KYC wizard backend + TanStack Query infra + Individual Tier 1 wizard frontend (Item 12 Part 1)
- Day 17 — Organisation Tier A wizard + polish + e2e Playwright infrastructure (Item 12 Part 2)
- Day 18 — Platform-wide manual-verification policy + v2.3 playbook bump + super admin KYC review queue (Item 13)
- Day 19 — Trust Center scaffolding + super admin Legal & Trust editor (Items 14+15)
- Day 20 — Item 16 truncated (Porichoy scaffold shipped; subdomain provisioning + SES templates deferred to Sprint 3 Day 21) + OAuth bug fix + EPS library investigation + closeout

## Sprint 3 to-date (Days 21-22 + pre-Day-23 consolidation)

- Day 21 — Fee calculator (PR #119, 33 tests) + Sprint 2 silent-partial-failure pattern resolution (5 fix PRs)
- Day 22 — Decision O (wildcard staging cert + tenants.preferred_locale) + SES templates + tenant subdomain provisioning + Fix 6b — all 6 Day 22 PRs landed across the 2026-05-24 consolidation session
- Pre-Day-23 — org-migration cascade resolved (OIDC + billing + deploy keys) + README professional rewrite + held queue cleared + 7 Dependabot bumps merged (5 minors/patches + 2 majors) + #72 deferred

## Hard guardrails (carry forward unchanged)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts` (Sprint 3 Day 21 deliverable).
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1). Owner login = `The-Public-Pulse-Agency` (post-org-migration). Trust policy + provisioning script defaults reflect this.
- `audit_logs` is APPEND-ONLY (§1.3 R8 + §4.2.1.1). No UPDATE/DELETE from application code. **`legal_document_versions` is also append-only** (Day 19 second-such-table); same invariant.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Multiple helpers in the same domain file are fine.
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()` via vitest-axe. Modal-open state needs its own axe scan.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — Day 16 PR 3 BLOCKER.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory; sessionStorage holds only opaque IDs. **Detail-view queries on PII surfaces MUST override the default TanStack Query cache** to `staleTime: 0` + `gcTime: 0` + `refetchOnWindowFocus: false` + `refetchOnReconnect: false` (Decision H, Day 18).
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — Day 16 PR 3 gotcha; deferred from v2.3 playbook bump to v2.4.
- **BIN 13-digit fact (NBR 2019-11-30) is reviewer-documentation, NOT server-side enforcement.** Day 17 PR 1 BLOCKER fix grandfathered as the one exception.
- **Wizard step→jsonb-key mapping for Tier A** — verbose step names (`org_info`, `signatory_identity`) shorten to jsonb keys (`fields.org`, `fields.signatory`).
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER.
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.** Per the 2026-05-19 platform-wide manual-verification policy.
- **Manual-verification policy is load-bearing.** Any temptation to add automated checks → halt, surface. Phase 2 trigger = 50 verified submissions/week sustained, 4-week trailing average.
- **Porichoy adapter scaffold-only shape is canonical** for all future automation integrations. Interface + env + Secrets Manager entry + TODO stub. `PorichoyNotImplementedError` throw is load-bearing — never silently downgrade to `{verified: false}`.
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts. DRAFT banner non-dismissable until counsel publishes v1.0.0 (Decision L).
- **`legal_document_versions` second append-only table.** Explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` per §4.2.1.1.
- **Admin route group lives under `/(admin)/admin/...`** to avoid `/kyc` collision with `/(tenant)/kyc`.
- **Markdown sanitization is via `renderLegalMarkdown()` in `apps/api/src/domain/legal/render.ts`** (Decision J). Single source of truth. `defaultSchema` allowlist unchanged. Widening requires its own decisions.md entry.
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K). `revalidate: 3600` + `revalidatePath()` on publish.
- **`consent_records` table is Sprint 3+ scope** (Decision L). Scope-creep red flags: any "click to acknowledge" button, IP/UA capture on Trust Center views, sign-up consent checkbox.
- **EPS library is in-house wrapper** at `apps/api/src/infra/eps/` (Day 20 decisions.md). NO SDK dependency.
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing.
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** Day 20 PR #104 regression-guard test fires loud if anyone reverts.
- **NEW 2026-05-20/21 — Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC trust policies + billing + deploy keys. Runbook in gotchas.md "GitHub repo transfer cascades through THREE owner-scoped trust relationships."
- **NEW 2026-05-24 — AWS SDK v3 packages must bump together.** Dependabot grouping config landed in `.github/dependabot.yml` (PR #136). Never bump a single `@aws-sdk/*` package independently.
- **NEW 2026-05-24 — Self-modifying scripts need TWO deploys to verify.** When changing `deploy.sh` (or any shell script invoked via SSM), the deploy that ships it runs the OLD copy from bash memory; the NEW copy doesn't exercise until the next deploy.
- **NEW 2026-05-24 — `@noble/hashes` stays at v1.8.0 through Days 24-25 truth gate.** PR #72 deferred per decisions.md "@noble/hashes 1.8.0 → 2.2.0 deferred to post-Days-24-25-EPS-truth-gate". Do NOT add `.js` suffixes to subpath imports yet (would break v1 resolution).

## Pending user actions

- **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked until counsel returns drafts.
- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — tax-opinion email status; needed before Day 24-25 truth gate for calculator math correctness.
- **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit only if compromise event arises.
- **Org-level Actions spending limit** — set >$0 on 2026-05-24 per Moshiur confirmation. Periodic re-check at <https://github.com/organizations/The-Public-Pulse-Agency/settings/billing/summary> if monthly Actions consumption pattern changes materially.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Run Playwright e2e locally (boots both apps/api + apps/web via webServer)
pnpm --filter @eventpulse/web exec playwright install --with-deps chromium
pnpm --filter @eventpulse/web test:e2e

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent; uses new org login)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=The-Public-Pulse-Agency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh

# Verify migration state on staging
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u postgres psql -d eventpulse_staging -c \"SELECT filename, applied_at FROM _eventpulse_schema_migrations ORDER BY applied_at DESC LIMIT 5;\""]' \
  --region ap-southeast-1 --profile eventpulse --query 'Command.CommandId' --output text
# Then `aws ssm get-command-invocation --command-id <id> ...` to fetch output
```
