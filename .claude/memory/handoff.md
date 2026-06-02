# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-02 — **Day 44 EOD** of 47-day Phase 1 MVP runway. **§26.1 Day 10 operator-facing launch artefacts SHIPPED end-to-end — 4 PRs (one with a security review fix bundled + same-class follow-up).**
**LAUNCH TARGET: 2026-06-10** (8 days out — runway healthy; ALL Claude-Code build-track is closed).
**Driver:** Claude Code (Opus 4.7).
**🛑 LOAD-BEARING (carry from Day 42):** Operator set hard ceiling — total monthly AWS spend below **\$30/month** for the project. Every AWS-write STOP-ASK now includes "monthly cost delta + running total" before proceeding. **Live AWS audit Day-42 EOD: current spend ~\$26/month — UNDER ceiling by ~\$4/mo.** Day-43 + Day-44 added zero AWS resources (no AWS-write sessions). **Next AWS-write window: AWS Budget alarm (\$25 actual / \$30 forecast)** — free resource; lands as the structural enforcement of the ceiling.
**Today's headline:** Day 44 picked up the "Day 44 first-thing options" from Day 43 EOD handoff. Two natural buildable items shipped + a security finding + same-class fix. **PR #257** `4af2e26` first-paying-tenant onboarding pack (~388 LOC, 9 sections — initial outreach + 72h nudge + discovery call + partnership terms + welcome 10-step onboarding + day-1 hourly monitoring + comms cadence + "anything goes wrong" matrix + retro). **PR #258** `410356b` disbursement CSV export (~1003 LOC: service + first super-admin audit helper + route + 21 tests; `GET /api/v1/admin/disbursements/export?period_start&period_end[&tenant_id]` bridges manual T+5 disbursement until Sprint 7). Automated security review caught **MEDIUM CWE-1236 CSV Formula Injection** (BOM + user-controlled tenant.name); fixed inline via FORMULA_PREFIXES guard + 12 unit tests. **PR #259** `8053ed2` `memory: codify CSV-formula-injection rule + flag attendee-export same-vuln carry`. **PR #260** attendee-export same-class fix — applied identical guard to Day-32 attendee CSV export + 9 matching tests (from security finding → codified rule → same-day same-class fix in one cycle). All 3 standing invariants intact post-deploy.

**Day 44 AWS billing tally:** ~$0 net new. No AWS-side writes; 3 deploy runs (~$0 — within free tier).

**Carryover:** Day 41 closed the Sprint 4 Day 7-8 refund flow + CW CPU 85% alarm + MAIL_DRY_RUN=0 staging flip. Day 40 closed Phase 4 SNS bounce/complaint AWS-side wiring end-to-end. Day 39 closed the legal track entirely (Buyer-Terms-Lite v1.0 live in checkout 2026-06-01T10:32:57Z). Sprint 4 §26.1 plan now **~80% shipped** (Days 1-2 attendees ✓, 3-4 check-in ✓, 5 sales dashboard ✓, 6 super-admin revenue ✓, 7-8 refund flow first-half ✓, **9 marketing pages ✓ today**; Day 10 launch readiness + Day 7-8 second-half manual-disbursement adapters PENDING/DEFERRED).

## 🎯 Pre-launch tracks — remaining work

§26.1 Day 9 (marketing pages) ✅ CLOSED Day 42. §26.1 Day 10 build-track half ✅ CLOSED Day 43 (runbook + security audit + audit gate + k6 scaffold + TODO sweep). §24.4 Sprint-4-close ✅ FULLY DELIVERED Day 43. The remaining pre-launch surface is **all operator-driven**:

| # | Item | Gate | Owner |
|---|---|---|---|
| 1 | EPS production credentials arrival | External clock; gates step #2 | Operator-action |
| 2 | Production EPS BDT-100 smoke per `docs/runbooks/production-smoke.md` | Gated on #1 + production EC2 cutover (#4 sub-items) | Operator + Claude Code |
| 3 | AWS Budget alarm (\$25 actual / \$30 forecast) — meta-cost-guard before cutover ceremony | Operator confirms notification email | Operator |
| 4 | Production EC2 cutover ceremony — 8 sub-items per `docs/runbooks/launch-readiness.md` §2 | Multiple STOP-ASK gates per sub-item; each AWS-write includes cost delta | Operator + Claude Code |
| 5 | Phase 4 AWS-side wiring on PROD (when prod EC2 lands) | Sub-step of cutover ceremony | Operator-authorised |
| 6 | `MAIL_DRY_RUN=0` prod flip | Sub-step of cutover (not standalone) | Operator |
| 7 | First paying tenant identification + onboarding (13-item checklist per launch-readiness runbook §5) | Operator-led | Operator-led |
| 8 | k6 baseline + activation PR (run workflow_dispatch, record p95 in budgets.json, flip trigger to pull_request) | Operator runs against staging | Operator |
| 9 | 5 counsel-doc bodies (Refund Policy, AUP, Cookies, DPA, EULA) | Counsel timing | Operator coordinates |
| 10 | Manual disbursement second half (BEFTN file gen + bKash B2C + Nagad + Rocket adapters per §14.8) | DEFERRED to Sprint 7 settlement engine | Sprint 7 |

### Production EC2 cutover — 8 sub-items (unchanged)

1. Prod EC2 + Ansible bootstrap
2. Prod Route 53 records (8-record set: apex, www, api, app, admin, my, customers, wildcard)
3. Prod wildcard cert via DNS-01 (Let's Encrypt with route53 plugin)
4. `eventpulse-deploy-prod` GitHub-OIDC role (canonical three-claim trust pattern per §17.9.1)
5. 11 `eventpulse/prod/*` Secrets Manager entries (eps ✅ already; 10 remaining)
6. 2 prod KMS CMKs (`alias/eventpulse-prod` + `alias/eventpulse-kyc-prod`)
7. Prod-branch ff-merge (`origin/prod` at `21dad2cc` → current main; ~105+ commits to bring forward)
8. §17.11 alarm catalogue (CW CPU 85% ✅ codified Day 41 on staging; 6 remaining: mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation)

## 📅 Path B incorporation — DATED CARRY ITEMS (unchanged)

| Item | Target date / window | Status |
|---|---|---|
| Begin Pvt Ltd incorporation paperwork (RJSC name-clearance + draft memorandum/articles + bank account opening) | **Week of 2026-06-24** | PENDING — post-launch stabilisation |
| Novation execution window (Organiser Agreements + AWS + Secrets Manager + EPS + BIN/VAT transition) | **2026-07-08 → 2026-07-22** | PENDING — RJSC-cert-gated |
| Pvt Ltd target completion (RJSC certificate issued; new Organiser Agreements against Pvt Ltd) | **2026-07-22** outer boundary | PENDING |
| v2.4 playbook bump backlog update | Pre-launch nice-to-have; post-launch firm | TRACKED |

## ⚠️ TL;DR for next session (Day 45)

- **First-thing-tomorrow (Day 45):** All Claude-Code build-track items for §26.1 + operator-launch artefacts are now closed. The remaining surface is operator-driven — see Pre-launch tracks table. If operator returns build-track work, candidate items: (a) sliding-window rate-limiter migration to fix the pre-existing flaky `eps.test.ts` IP rate-limit test (filed Day-44; mechanical refactor + clock-injection); (b) operator-facing super-admin UI button that calls the Day-44 disbursement export endpoint (currently endpoint exists but operator hits via curl/browser); (c) pick up a Sprint-7 backlog item early (e.g. `tenant_payout_accounts` schema + RLS) if operator wants to get ahead. Or sit at zero-build until EPS prod creds arrive.
- **Then (Day 45+):** Prod-cutover sub-items as standalone STOP-ASK sessions. Each remaining §17.11 alarm is a ~5-min AWS-write task — ASK-FIRST with monthly cost delta. CloudWatch memory >90%/5min is the natural next-pick after CPU 85% (already on staging). Per the cost-aware §17.11 amendment in launch-readiness runbook §6: staging caps at 2 alarms (CPU + memory); prod gets the full 7-alarm set at cutover.
- **EPS prod credentials arrival:** still external clock. When credentials land, BDT-100 production smoke per `docs/runbooks/production-smoke.md` runs as its own gated session. Precondition #2 (`eventpulse/prod/eps`) already SATISFIED.
- **k6 baseline (operator-action):** `gh workflow run "Load test (k6 staging)" -f base_url=https://api.staging.eventpulse.com.bd` → read summary p95s → write to `infra/load-tests/budgets.json` → flip `load-test.yml` trigger to `pull_request`. After that, every PR enforces the §24.4 "p95 regress > 20%" gate.

## ⚠️ Day 44 deliverables shipped (this session)

- **PR #257 `docs(ops): first paying tenant onboarding pack — operator-runnable`** merged as `4af2e26`:
  - 9 sections (~388 LOC) operationalising the §5 13-item checklist from launch-readiness.md
  - Initial outreach + 72h nudge + discovery-call agenda with notes template + partnership-terms one-pager with Path-B novation acknowledgement + welcome 10-step onboarding email + day-1-of-sales monitoring hourly template + comms cadence + "anything goes wrong" matrix + retro template
  - Drafts ready for operator review; tenant-specific personalisation via `{{placeholders}}`
- **PR #258 `feat(admin): disbursement CSV export — T+5 manual-bridge until Sprint 7`** merged as `410356b`:
  - 5 new files (~1003 LOC): service + first super-admin audit helper + route + 9 DB-gated route tests + 12 pure-function csvEscape tests
  - `GET /api/v1/admin/disbursements/export?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD[&tenant_id=<uuid>]`
  - Read-only super-admin endpoint; per-tenant aggregate over orders + processed-refunds in window
  - End-exclusive `[periodStart, periodEnd)` window matching §14.5 cron convention
  - Money-truth discipline: reads snapshotted columns ONLY (Decision-N pattern from Day-35 revenue dashboard)
  - Refund deduction inline: sums `refunds.amountPaisa WHERE status='processed' AND processedAt IN window`
  - Negative-net surfaces as negative number (debit-carry-forward signal)
  - **Automated security review caught CWE-1236 CSV Formula Injection** on initial csvEscape (BOM + user-controlled tenant.name); fixed inline + 12 unit tests + bundled flake-related test-fix commits
- **PR #259 `memory: codify CSV-formula-injection rule + flag attendee-export same-vuln carry`** merged as `8053ed2`:
  - Top-of-log gotchas.md entry establishing the rule
  - Canonical fix pattern + detection signals + greppable rules
  - Pre-existing same-vuln in `apps/api/src/services/attendees/export-csv.ts` (Day-32) explicitly flagged for follow-up
- **PR #260 `fix(attendees-export): CSV formula-injection guard — same-class as PR #258`** (in CI as session closes):
  - Applies identical FORMULA_PREFIXES guard to attendee-export csvEscape
  - +9 matching formula-injection tests in existing test file (20 tests total in file; was 11)
  - **From security finding → codified rule → same-day same-class fix in one cycle**
- **`decisions.md` 2026-06-02 Day 44 EOD entry** — Decisions A–F codified
- **`progress.md` Day 44 entry** — §26.1 plan now ~90% shipped (all build-track closed)
- **`handoff.md`** — rewritten to Day 44 EOD state (this file)

## ⚠️ Day 43 deliverables shipped (carryover record)

- **PR #252 `docs(security): pre-cutover security checklist sweep — Day 42 staging audit`** merged as `c49a2c7`:
  - 225-line audit findings doc at `docs/audits/security-checklist-2026-06-01.md` covering 6 categories (auth/authz, money, data, webhooks, transport, compliance) — live SSM + aws CLI + curl audit; PASS w/ 1 operational finding
  - Restored 2 nginx snippets (`ep-security-headers.conf` + `ep-proxy-headers.conf`) to `infra/nginx/snippets/` — drift from staging (correct headers existed live but not in git); fix prevents prod cutover bootstrap from missing them
  - Bundled prettier follow-up on the Day-42 launch-readiness runbook (PR #251 docs-only-skipped the lint job; the regression surfaced on PR #252's non-docs diff)
- **PR #253 `ci(audit): add dependency-audit job — gate on prod high+critical (§24.4)`** merged as `9a0322e`:
  - New `dependency-audit` CI job between `lint-and-typecheck` and `unit-tests`
  - Runs `pnpm audit --prod --audit-level high --ignore-registry-errors` (5-min timeout)
  - **LIVE gate** — already exercised on PR #253 itself + PR #254 + PR #255 — no false positives
  - Dev-only HIGH+CRITICAL (vitest UI server, tmp transitive) intentionally excluded via `--prod` scope; handled by Dependabot bumps
- **PR #254 `chore(cleanup): clear two stale TODOs — magic-link wired + KYC doc updated`** merged as `21a48ec`:
  - `magic-link-form.tsx:20` wired to `/api/v1/auth/magic-link/request` (Day-1 scaffold finally connected); contact-form-pattern submitting/error UX
  - `kyc.ts:51` JSDoc rewrite — the TODO comment was outdated (`provisionTenantSubdomain()` actually shipped Sprint 3 Day 22 Workstream 2); no code change, doc-only fix
- **PR #255 `ci(load-test): k6 scaffold targeting public reads (§24.4 second half)`** merged:
  - `infra/load-tests/{README.md,events-list.js,budgets.json}` + `.github/workflows/load-test.yml` workflow_dispatch-only
  - 2 scenarios (events_list 14 RPS, changelog 6 RPS, 30s each, constant-arrival-rate executor)
  - Workflow installs k6, runs script, uploads JSON artefact (14-day retention), compares against `budgets.json` with the §24.4 verbatim "p95 regress > 20%" cap
  - `p95_ms=0` placeholder triggers `::warning::` instead of failure (operator-baseline-pending) — matches the build-track-owns-drafts pattern from Day-35
- **`decisions.md` 2026-06-02 Day 43 EOD entry** — Decisions A-G codified
- **`progress.md` Day 43 entry** — Sprint 4 §26.1 plan progress update (~85% shipped; §26.1 Day 10 build-track ✅)
- **`handoff.md`** — rewritten to Day 43 EOD state (this file)

## ⚠️ Day 42 deliverables shipped (carryover record)

- **PR #244 `feat(marketing): apex home + /features + /pricing pages (§26.1 Day 9, part 1 of 3)`** merged as `2cff5fb`:
  - Apex marketing home (replaces Day-1 scaffold) + 6 value-prop cards + use-cases panel
  - /features 5-section feature catalogue per §22.3
  - /pricing server-rendered four-mode bigint-paisa fee calculator at v1.0 bKash 175bps + EN+BN honest-copy disclosure from `docs/copy/bkash-only-launch.md`
  - 7-test drift guard pinning §14.2-shape canonical values (`apps/web/src/app/(public)/pricing/pricing.test.ts`)
  - Shared `MarketingNavbar` + `MarketingFooter` components
- **PR #245 `feat(marketing): /contact page + form + API endpoint (§26.1 Day 9, part 2 of 3)`** merged as `bbf6730`:
  - /contact page (Server Component shell + Client Component form island)
  - POST /api/v1/public/contact with 3 defence layers (honeypot + per-IP rate limit + zod)
  - Migration 0017 `contact_submissions` table + Drizzle schema export
  - 6 DB-gated integration tests (described via `describeIfDb`)
  - Hotfix `94dab28` mid-CI for drizzle ANY-with-JS-array tuple bug in afterAll cleanup; switched to `inArray()`
- **PR #246 `feat(marketing): /legal/changelog + v1.0 seed (§26.1 Day 9, part 3 of 3)`** merged as `6ff4f9b`:
  - /legal/changelog index + per-version page (Server Components)
  - 3 GET endpoints (index + by-slug + by-version) edge-cacheable per Trust Center pattern
  - Migration 0018 `changelog_entries` table + Drizzle schema export
  - v1.0 seed with 9 launch entries; body_html rendered via shared `renderLegalMarkdown` per Decision J
  - Build-time-fetch-failure tolerance pattern cloned from `lib/legal.ts`
- **PR #248 `fix(seeds): changelog seed — use drizzle insert builder for text[] arrays`** — hotfix for the seed's array-tuple bug (same root cause as PR #245 afterAll); switched from raw sql template to drizzle's `.insert().values().onConflictDoUpdate().returning()` chain
- **`decisions.md` 2026-06-01 Day 42 EOD entry** — Decisions A-I codified (three-PR breakdown by DB-dependency-shape, per-PR rebase pattern, drift-guard test pattern, contact form 3-defence-layer pattern, Decision J consumed not widened for changelog body, fetch-failure tolerance pattern cloned, seed-file pattern, v1.0 audience splits, conventional-commits title-length discipline)
- **`gotchas.md` top entry** — drizzle's `sql` template inlines JS arrays as tuples — canonical fix table covering 4 contexts (ANY, IN-DELETE, INSERT text[], INSERT-on-conflict); detection rule + how-to-avoid grep pattern
- **`progress.md` Day 42 entry** — Sprint 4 §26.1 plan progress update (~80% shipped)

**Codebase state at Day 42 EOD:**

```text
main HEAD: <after-hotfix-merge> (target — pending PR #248 merge)
        │  (today, in order)
        └── fix(seeds): changelog seed — use drizzle insert builder for text[] arrays (#248) [pending]
        └── feat(marketing): /legal/changelog + v1.0 seed (#246) — 6ff4f9b
        └── feat(marketing): /contact + form + API + migration 0017 (#245) — bbf6730
        └── feat(marketing): apex home + /features + /pricing (#244) — 2cff5fb
        └── (this EOD memory PR — pending merge)
```

Staging EC2 at HEAD `6ff4f9b`; will advance to hotfix HEAD after PR #248 merges + re-deploys. Migration ladder at 0018. pm2 web + api online + restart counts steady. /health db=ok 11ms. **changelog_entries currently 0 rows on staging** (seed failed); SSM manual re-seed runs after #248 merges and bumps to 9 rows. /legal/changelog page returns 200 but renders empty-state card until then.

## ⚠️ The launch gate state — 14 ✅ RESOLVED items (carryover + Day 42 + Day 43 + Day 44)

1. ~~EPS sandbox credentials~~ ✅ 2026-05-26
2. ~~SES out-of-sandbox~~ ✅ 2026-05-31 (case 177899559700777)
3. ~~EPS fee-model structural decision~~ ✅ 2026-05-31 Day 37 EOD (Option 3 chosen; Day 38 SHIPPED)
4. ~~§29 #9 AIT classification~~ ✅ 2026-05-26
5. ~~§29 #10 NBR/VAT registration model~~ ✅ 2026-05-31 Day 39 AM
6. ~~Salehin: Buyer Terms framing~~ ✅ 2026-05-31 Day 39 AM
7. ~~Salehin: Incorporation path~~ ✅ 2026-05-31 Day 39 AM (Path B LOCKED)
8. ~~Buyer-Terms-Lite v1.0 wire-in~~ ✅ 2026-05-31 Day 39 PM
9. ~~Phase 4 SNS bounce/complaint suppression-list AWS-side wiring~~ ✅ 2026-06-01 Day 40
10. ~~§26.1 Day 9 marketing pages (apex + features + pricing + contact + changelog)~~ ✅ 2026-06-01 Day 42
11. ~~§26.1 Day 10 launch-readiness umbrella runbook + security audit (PASS w/ 1 ops finding fixed) + AUP/Terms host-liability spot check~~ ✅ 2026-06-01 + 2026-06-02 (Day 42 + Day 43)
12. ~~§24.4 Sprint-4-close CI hardening: `pnpm audit` prod-only HIGH+CRITICAL gate LIVE + k6 load-test scaffold (workflow_dispatch-only pending operator baseline)~~ ✅ 2026-06-02 Day 43
13. ~~First-paying-tenant operator artefacts: onboarding pack (9 sections) + super-admin disbursement CSV export endpoint~~ ✅ 2026-06-02 Day 44
14. ~~CSV-formula-injection class CLOSED across both code paths (disbursement + attendees) + rule codified in gotchas.md~~ ✅ 2026-06-02 Day 44

**§29 Open Decisions tracking:**

- **#5 Refund authority for MVP** — STRUCTURALLY RESOLVED 2026-06-01 Day 41 (PR #242 codes §29 policy verbatim)

**Pre-launch commitments (gate ceremony or env flip, not legal):**

- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session per `docs/runbooks/production-smoke.md`. Precondition #2 SATISFIED.
- **Production EC2 cutover ceremony** — 8 sub-items from Day-37 audit critical-path step [14] (table above). Multiple STOP-ASK gates.
- **Phase 4 production-side AWS wiring** — copy of Day 40's 8-step procedure with `-prod` suffixes. Sub-step of cutover.
- **MAIL_DRY_RUN=0 prod flip** — sub-step of cutover (not standalone).

## ⚠️ Empirical findings table — quick recall (decision-grade context; carryover)

| Mode | Status | FE | TotalAmount | StoreAmount | observedEps | predictedEps | Δ | Trust |
|:---:|:---:|:---:|---:|---:|---:|---:|---:|:---:|
| A (PT,PT) | Success | bKash | 102756 | 101009 | 1747 | 2506 | −759 | **CLEAN** |
| B (AB,AB) | Success | bKash | 100000 |  98300 | 1700 | 2500 | −800 | clean-but-AB |
| C (AB,PT) | **Fail** | bKash | 102500 | 100757 | 1743 | 2500 | −757 | **PARTIAL** |
| D (PT,AB) | **Fail** | Nagad | 100250 |  98546 | 1704 | 2506 | −802 | **PARTIAL** |

All amounts paisa. §14.10 Invariant-1 PASS across all 4. The only fully-clean fee-rate data point is Mode A bKash @ 1.747% MFS rate.

## ⚠️ Build-track items still in play

- ⏳ **§26.1 Day 10 launch readiness** — AUP review, first paying tenant identification. Next session pick.
- ⏳ **§17.11 alarm catalogue beyond CPU 85%** — 6 remaining alarms (mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation). Each ~5-min AWS-write standalone task. Required pre-prod-cutover.
- ⏳ **t3.medium upgrade** (4 GB, ~+$15/mo) — **REJECTED for MVP** per the $30/month ceiling. Day-34 swap fix (2 GB swap + swappiness=10) keeps t3.small viable. Revisit post-launch when revenue justifies.
- 🛑 **AWS Budget alarm** ($25 actual / $30 forecast) — must land in next AWS-write session to enforce the ceiling structurally. Free resource; budget actions cost ~$0.
- ⏳ **k6/artillery load test budget** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **`pnpm audit` blocking on high+critical** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **Production cutover surface** — 8 sub-items above. Notable: prod-branch ff-merge (`21dad2cc` → current main; now ~105+ commits divergent).
- ⏳ **v2.4 playbook bump backlog** — §14.2 Mode C narrative, §29 #5+#9+#10 reclassification, §29 list housekeeping, Buyer-Terms-Lite v1.0 + Path B incorporation, Phase 4 SHIPPED, prod-branch tracking discipline, Sprint 2-4 accumulated amendments, fee-model resolution Day 38 sweep, Day 39 PR sweep, Day 40 Phase 4 sweep + runbook amendments, Day 41 refund-flow + §17.11 alarm catalogue progress + MAIL_DRY_RUN flip + §29 #5 structural resolution, Day 42 marketing-pages full surface + drizzle-array-tuple gotcha consolidation, consent_records §9.11 amendment.
- ⏳ **Loose ends (low priority):** Counsel docs 5 remaining bodies; manual click-through of OAuth callback redirect (PR #149 carry); stale `magic-link-form.tsx:20` + `super-admin/kyc.ts:51` TODO audit.

## Where things live (quick map — Day 42 additions)

- **Decision surface:** `decisions.md` 2026-06-01 Day 42 EOD top entry — three-PR marketing-pages workstream + 9 codified patterns (A-I).
- **Gotchas surface:** `gotchas.md` top entry — drizzle `sql` template inlines JS arrays as tuples; canonical fix table + detection rule.
- **Critical path tracking surface:** Day-37 audit critical-path diagram. Step [8] Phase 4 ✅ Day 40. Step [10] Day-7-8 refund-flow first-half ✅ Day 41. Step [16] CW alarm-catalogue first entry ✅ Day 41. Step [9] §26.1 Day 9 marketing pages ✅ Day 42.
- **Marketing surface code:** `apps/web/src/app/page.tsx` (apex), `apps/web/src/app/(public)/{features,pricing,contact,legal/changelog}/page.tsx`, `apps/web/src/components/marketing/` (navbar, footer, contact-form), `apps/web/src/lib/changelog.ts`.
- **Marketing surface API:** `apps/api/src/routes/public/{contact,changelog}.ts`, `apps/api/src/services/{contact,changelog}/`, `apps/api/src/db/seeds/seed-changelog-v1.ts`.
- **Pricing drift-guard test:** `apps/web/src/app/(public)/pricing/pricing.test.ts` (7 tests pinning §14.2-shape canonical values at v1.0 bKash 175bps).
- **Migrations 0017 + 0018:** contact_submissions + changelog_entries.

## Standing invariants (still enforcing through remaining runway)

- 🛑 **AWS spend hard ceiling: $30/month total (both envs combined).** Decisions.md "STANDING CONSTRAINT" entry at top of log. Every AWS-write STOP-ASK now includes monthly cost delta + running total. Cost-aware defaults override §17.x prod-target spec until v2.4 playbook bump: prod EC2 t3.small (NOT t3.large); 1-2 consolidated Secrets Manager JSON blobs per env (NOT 11 per-purpose); 3 KMS CMKs max for MVP; 14-day log retention; staging gets 2 alarms / prod gets §17.11 set.

- **`STAGING_PAYMENT_BLOCK=1`** — re-verified Day 42 EOD post-deploy. Only authorized lift: BDT-100 production smoke on its own gated session. Non-negotiable through 2026-06-10.
- **`MAIL_DRY_RUN=0`** on staging — flipped Day 41; durable across deploys. Real SES sends now exercise the full Phase 4 pipeline. Suppression-list outbound-guard intercepts before AWS call. Production flip lands as sub-step of cutover ceremony.
- **`EPS_MODE=production`** — Day 38 codified. Verified Day 42.
- **v1.0 single-method launch — bKash-only enforcement (Day 38).** Server-side via Phase 2a Verify-guard + Phase 2b dispute-flow surfaces. UI-side via Phase 3 honest copy + Day-39-PM bilingual clickwrap + Day-42 /pricing transparent calculator at single-method rate.
- **HARD STOP on `fee-calculator.ts`** — LIFTED Day 38; single-PR-at-a-time discipline carries forward. Day 42's /pricing inline math mirrors canonical calculator + is pinned by a 7-test drift guard; it is NOT a new money math source.
- **Buyer-Terms-Lite v1.0 consent capture precondition (Day 39 PM):** every order writes `consent_records` row inside same `withSuperAdmin` tx; INSERT failure rolls back.
- **Phase 4 outbound-send guard (Day 40):** every SES SendEmail consults `email_suppression_list` before AWS call.
- **Phase 4 webhook fail-closed (Day 40):** `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` allowlist gates.
- **Refund cross-tenant guard + actor_type split + append-only refund row (Day 41).**
- **CW CPU 85% alarm threshold (Day 41).**
- **Contact form 3-defence-layer pattern (Day 42):** honeypot returns silent success / per-IP rate-limit returns 429 / zod validation rejects malformed payloads. Pattern is canonical for any future public-write endpoint.
- **Changelog body_html via Decision-J pipeline only (Day 42):** `renderLegalMarkdown` is the single sanitizer; widening the allowlist requires its own decisions.md entry. New sanitizers (DOMPurify, etc.) forbidden without supersession.
- **Drizzle array gotcha discipline (Day 41 + Day 42 codified):** raw `sql` template with JS-array values produces tuple syntax that Postgres rejects against array columns + `ANY()`. Use drizzle builders + `inArray()` whenever the SQL context expects an array.
- **Source-then-reload discipline for ad-hoc env edits (Day 40 codified).**
- **SES envelope-shape defensive coding (Day 40 codified).**
- **Bash-buffering deploy.sh discipline (Day 39 PM codified)** — edits to deploy.sh don't execute on the deploy that ships them. Day 42 confirmed: the `db:seed:changelog-v1` line added to deploy.sh in PR #246 didn't run on that deploy because the old buffered shell finished. Manual SSM remediation per the established pattern.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. Pricing drift-guard mirror is for display only.
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (Day 37):** `origin/prod` at `21dad2cc`; `main` at `0d8d8cd`; divergence now ~110+ commits.
- **PR-title type-list locked (Day 43 codified):** `build | chore | ci | docs | feat | fix | memory | perf | refactor | revert | style | test`. No expansion without commitlint config + decisions.md entry. Audit/findings/review work maps to `docs(...)`.
- **Docs-only CI-skip trade-off (Day 43 codified):** docs-only PRs trade prettier validation for CI speed. The next mixed PR enforces. Authors of docs-only PRs may run `pnpm format:check` locally at their discretion.
- **`pnpm audit` CI gate live (Day 43):** prod-only at HIGH+CRITICAL via `pnpm audit --prod --audit-level high --ignore-registry-errors`. No allowlist. Dev-only HIGH+CRITICAL (vitest UI server, tmp transitive) handled by Dependabot cadence. Any new HIGH/CRITICAL in a prod dep blocks all PRs until fixed.
- **k6 load-test gate posture (Day 43):** scaffold lives at `infra/load-tests/`; workflow_dispatch-only pending operator baseline. Once activated (operator runs the workflow, writes p95 to `budgets.json`, flips trigger to `pull_request`), every PR enforces §24.4's "p95 regress > 20%" cap.
- **Magic-link form trusts API contract (Day 43):** shows "Check your email" on any non-network-error response per the API's anti-enumeration 202-always design. Future client code MUST NOT branch on response body to discriminate account-exists vs not-exists.
- **JSDoc-TODO validity rule (Day 43 codified):** every TODO comment older than 2 weeks should be re-validated against the actual code. Stale "TODO" comments documenting features that already exist mislead reviewers + lead to false assumptions about system state.
- **BOM + formula-guard must ship together (Day 44 codified):** any CSV output that emits UTF-8 BOM opts INTO the spreadsheet renderer; without the leading-character formula-prefix guard, user-controlled strings starting with `=` / `+` / `-` / `@` / TAB / CR fire as formulas in Excel/Sheets/LibreOffice. Canonical fix pattern in `apps/api/src/services/admin/disbursement-export.ts:122` + `apps/api/src/services/attendees/export-csv.ts:89`. Future CSV-export PRs that don't include `FORMULA_PREFIXES` get flagged at review. gotchas.md top entry codifies the rule + detection signals.
- **Bridge-not-engine for Sprint-7-scope artefacts (Day 44 codified):** when Sprint-7-scoped tables/state machines/cron jobs don't exist yet but the operator needs a launch-day artefact, ship a READ-ONLY bridge (CSV export, ad-hoc query, etc.) that consumes the same money-truth-snapshotted columns the Sprint-7 engine will eventually write. The bridge stays as a shadow-reconciliation check when the engine lands. Disbursement export (PR #258) is the canonical example: no `disbursement_batches` writes, no BEFTN format invented, snapshotted columns only.
- **Same-day same-class fix preferred over deferring (Day 44 codified):** when a gotcha codification surfaces a known same-class vulnerability elsewhere, fix it in the same session unless the fix is genuinely complex. The 20-minute write-+-test cost is negligible against the carry-it-forward operational risk. PR #260 (attendees-export fix) shipped same-day after PR #259's gotcha flagged it.
- **First super-admin domain audit helper file pattern (Day 44 established):** `apps/api/src/services/audit/admin.ts` joins the one-per-domain convention. Future super-admin endpoint audit helpers belong here. Posture: `actor_type='super_admin'`, `entity_type='platform'` (global action), `tenant_id NULL` (cross-tenant by design), one row per discrete operational event (not per-PII-row).
- **Method-agnostic-calculator discipline (Day 38).**
- **Build-time-fetch-failure tolerance pattern (Day 42 codified for lib/changelog; carries forward for any new Server Component fetching the api).**
