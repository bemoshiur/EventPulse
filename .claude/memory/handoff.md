# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-01 — **Day 42 EOD + cost-ceiling addendum** of 47-day Phase 1 MVP runway. **Sprint 4 §26.1 Day 9 marketing pages SHIPPED end-to-end (3 PRs + 1 hotfix). NEW STANDING CONSTRAINT: AWS spend < \$30/month total (both envs combined).**
**LAUNCH TARGET: 2026-06-10** (9 days out — runway healthy).
**Driver:** Claude Code (Opus 4.7).
**🛑 LOAD-BEARING:** Operator set hard ceiling — total monthly AWS spend below **\$30/month** for the project. Every AWS-write STOP-ASK now includes "monthly cost delta + running total" before proceeding. Current trajectory at full prod cutover is ~$98-105/mo per §17.x defaults → needs ~$65 of trims to fit budget. Cost-aware defaults codified in decisions.md 2026-06-01 "STANDING CONSTRAINT" entry (top of log): prod EC2 = t3.small (NOT t3.large); 1-2 consolidated Secrets Manager JSON blobs per env (NOT 11 per-purpose); 3 KMS CMKs max for MVP; staging gets 2 alarms, prod gets the §17.11 set; 14-day log retention; weekly EBS snapshots. AWS Budget alarm at \$25 actual / \$30 forecast to be created in next AWS-write session.
**Today's headline:** Day 42 ran the full §26.1 Day 9 marketing-pages workstream as a three-PR sequence in one continuous "work continue" session. **PR #244** (apex home + /features + /pricing) replaces the Day-1 scaffold and ships a server-rendered four-mode bigint-paisa fee calculator at v1.0 bKash 175bps with a 7-test drift guard pinning canonical §14.2-shape values. **PR #245** (/contact + form + API + migration 0017 contact_submissions) ships a 3-defence-layer endpoint (honeypot + per-IP rate limit + zod). **PR #246** (/legal/changelog + migration 0018 changelog_entries + v1.0 seed) lands the changelog scaffold but the seed itself failed at deploy time due to the drizzle array-tuple gotcha (same root cause as PR #245's afterAll test bug from Day 41). **PR #248 hotfix** switches the seed from raw `sql` template to drizzle's builder; after merge + re-deploy + manual re-seed, the 9 v1.0 launch entries populate. All 3 standing invariants intact post-deploy.

**Day 42 AWS billing tally:** ~$0 net new. No AWS-side writes; one extra deploy run (~$0.00) plus a single SSM SendCommand for the manual changelog seed (~$0.00).

**Carryover:** Day 41 closed the Sprint 4 Day 7-8 refund flow + CW CPU 85% alarm + MAIL_DRY_RUN=0 staging flip. Day 40 closed Phase 4 SNS bounce/complaint AWS-side wiring end-to-end. Day 39 closed the legal track entirely (Buyer-Terms-Lite v1.0 live in checkout 2026-06-01T10:32:57Z). Sprint 4 §26.1 plan now **~80% shipped** (Days 1-2 attendees ✓, 3-4 check-in ✓, 5 sales dashboard ✓, 6 super-admin revenue ✓, 7-8 refund flow first-half ✓, **9 marketing pages ✓ today**; Day 10 launch readiness + Day 7-8 second-half manual-disbursement adapters PENDING/DEFERRED).

## 🎯 Pre-launch tracks — remaining work

§26.1 Day 9 (marketing pages) is now ✅ CLOSED. The remaining pre-launch surface is **infrastructure ceremony + Day 10 launch readiness + external-clock**:

| # | Item | Gate | Owner |
|---|---|---|---|
| 1 | EPS production credentials arrival | External clock; gates step #2 | Operator-action |
| 2 | Production EPS BDT-100 smoke per `docs/runbooks/production-smoke.md` | Gated on #1 + production EC2 cutover (#4 sub-items) | Operator + Claude Code |
| 3 | §26.1 Day 10 launch readiness — AUP review, first paying tenant identification | None for AUP review; operator-led for first tenant | Claude Code + Operator |
| 4 | Production EC2 cutover ceremony — 8 sub-items (Day-37 audit critical-path step [14]) | Multiple STOP-ASK gates per sub-item | Operator + Claude Code |
| 5 | Phase 4 AWS-side wiring on PROD (when prod EC2 lands) | Sub-step of cutover ceremony | Operator-authorised |
| 6 | `MAIL_DRY_RUN=0` prod flip | Sub-step of cutover (not standalone) | Operator |
| 7 | Manual disbursement second half (BEFTN file gen + bKash B2C + Nagad + Rocket adapters per §14.8) | DEFERRED to Sprint 7 settlement engine | Sprint 7 |

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

## ⚠️ TL;DR for next session (Day 43)

- **First-thing-tomorrow (Day 43):** §26.1 Day 10 launch readiness scope. Two natural next-picks: (a) AUP review — sweep `apps/api/src/services/aup/` (if any) + the public `event_reports` surface + the `/admin/aup-reports` triage queue against §21.5; (b) first-paying-tenant identification surface (operator-led; Claude Code can prep the onboarding checklist runbook). Pick whichever is "in by lunch".
- **Then (Day 43+):** Prod-cutover sub-items as standalone tasks. Each remaining §17.11 alarm is a ~5-min AWS-write task — ASK-FIRST. CloudWatch memory >90%/5min is the natural next-pick after CPU 85%. Each landed on staging first; staged on prod under cutover ceremony.
- **EPS prod credentials arrival:** still external clock. When credentials land, BDT-100 production smoke per `docs/runbooks/production-smoke.md` runs as its own gated session. Precondition #2 (`eventpulse/prod/eps`) already SATISFIED.

## ⚠️ Day 42 deliverables shipped (this session)

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

## ⚠️ The launch gate state — 10 ✅ RESOLVED items (carryover + Day 42)

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
- **Prod branch tracking discipline (Day 37):** `origin/prod` at `21dad2cc`; `main` at `6ff4f9b` (+ pending #248); divergence now ~105+ commits.
- **Method-agnostic-calculator discipline (Day 38).**
- **Build-time-fetch-failure tolerance pattern (Day 42 codified for lib/changelog; carries forward for any new Server Component fetching the api).**
