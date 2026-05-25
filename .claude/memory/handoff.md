# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-26 (Sprint 4 Day 35 SHIPPED + **AIT blocker RESOLVED via CA consultation — launch gate 4 → 3**).
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 35; **next session opens Day 36.**

## ⚠️ Major gate-state change (2026-05-26 post-EOD)

**AIT (Advance Income Tax) treatment under ITA 2023 — RESOLVED via CA consultation.** Decision codified in `decisions.md` (2026-05-26 entry, top of file). Net effect:

- **Leg 1 (disbursement to organiser): NO AIT withholding.** Calculator's pre-withholding `netToOrganiserPaisa` confirmed CORRECT. `withholdingTaxPaisa = 0` is the steady-state, not a placeholder. **§29 #9 closed.**
- **Leg 2 (platform commission): 10% AIT under §93 — organiser self-deposit (Option 1).** Specified-person organisers withhold + deposit themselves + provide A-Challan within 10-15 days post month-end. Individual (unregistered) organisers exempt at transaction level. **Calculator UNCHANGED.** Compliance is A-Challan tracking (Sprint-7-era; data model anticipates).
- **Coupling created:** the Leg-1 no-withholding treatment is contingent on the TOS + Organiser Agreement establishing the agency model explicitly. The Trust-Center-v1.0 blocker (item 3 below) now carries this tax-correctness weight on top of consent. Counsel brief documented in the decisions entry (agency-model clauses + commission-AIT recovery clauses).
- **Launch gate: 4 → 3.**

## ⚠️ FIRST THING DAY 36 — review the SES draft

`docs/ops/ses-out-of-sandbox-request.md` (PR #196 merged today) is a complete AWS Support case body — use-case description, bounce/complaint handling, consent model, volume forecast, domain-auth state, pre-submission checklist. Your action:

1. Read the draft.
2. Verify the SES domain identity for `eventpulse.com.bd` is actually verified in `ap-southeast-1` (the case will be rejected if not).
3. Edit numbers + claims to match your actual operational intent.
4. Submit via AWS Support Center → Service Limit Increase → SES Sending Limits → Production Access.
5. Paste the outcome into `decisions.md` once AWS responds.

**If submitted + approved, the launch gate drops from 3 to 2.** AIT moved the gate from 4 to 3 today already; SES is the next-cheapest move.

## ⚠️ The launch gate state — NOW 3 blockers (was 4)

1. **EPS sandbox credentials confirmed** OR authorized controlled `STAGING_PAYMENT_BLOCK` lift + new `decisions.md` entry per §11.0 (4 × small real charges). **No draft yet.** Day-36+ candidate: I can draft a request-to-EPS memo with integration specs (the in-house wrapper at `apps/api/src/infra/eps/`, the merchantTransactionId format per §11.4, the truth-gate definition) so EPS issues credentials matching our integration.
2. **SES out-of-sandbox approval** — ⚠️ **DRAFT READY** at `docs/ops/ses-out-of-sandbox-request.md`. Awaiting Moshiur review + submission.
3. **Trust Center v1.0 documents from counsel** — placeholder DRAFT today; buyer form ships without a binding consent checkbox under v0.1 docs (decisions.md 2026-05-26 Day-34 entry). **Now also carrying the AIT contract-clauses requirement** — the agency-model clauses + commission-AIT recovery clauses from the AIT decision are part of the counsel brief. Day-36+ candidate: I can draft a per-page outline + the specific tax-correctness contract clauses (agency model + commission-AIT recovery) for counsel to flesh out — the clauses are now well-specified by the AIT decision.

~~4. §29 #9 AIT withholding tax opinion~~ — ✅ **RESOLVED 2026-05-26** via CA consultation. See decisions.md top-of-file entry. Calculator unchanged; compliance tracking Sprint-7-era.

**Standing pattern (decisions.md 2026-05-26 Day-35 entry):** the build track owns surfacing what's draftable. If a session ends without proposing a draft for at least one gate item that I CAN draft, I have silently treated the gate as Moshiur's homework and should be called out. With AIT resolved, the natural Day-36+ draft is the Trust-Center-v1.0 counsel brief (now with concrete agency + commission-AIT clauses to specify).

## ⚠️ Carry-items from Day 34

- ⏳ **CloudWatch >85% memory alarm — STILL OPEN.** Small AWS-write follow-up; out of Day-35 Phase-3 scope because no Moshiur pre-authorization for the AWS write. 5-minute task when authorized. Suggested: start any future infra-touching session with this.
- ⏳ **t3.medium upgrade (4 GB, ~+$15/mo) — STILL OPEN.** Pre-production Moshiur decision. Swap is a stopgap; production wants real headroom. STOP-ASK any infra session that would resize.

## Day 35 deliverables (3 PRs merged today + EOD memory)

**PR #196 (Phase 0.5) — SES out-of-sandbox case body DRAFT (`b26de1e`):**

- `docs/ops/ses-out-of-sandbox-request.md` (89 lines) — full AWS Support case body + pre-submission checklist + post-submission "update decisions.md" reminder.
- Best-guess volume forecast (50k/day, 14/sec) sourced from §16 + §26; edit before submitting if actual differs.
- This is the FIRST build-track move on any launch-gate item in 5 days.

**PR #197 (Phase 1) — super-admin revenue service + endpoints (`56c5db4`):**

- `apps/api/src/services/admin/revenue.ts` — `getPlatformRevenueDashboard()` (full payload in one query batch: headline 24h KPIs + 30-day time-series in Asia/Dhaka + top-20 leaderboards × 3 + settlement queue + 3 anomaly cards) + `getRevenueLedger()` (drillable detail with §14.10 Invariant 1 per-row check).
- `apps/api/src/routes/super-admin/revenue.ts` — `GET /api/v1/admin/revenue` + `GET /api/v1/admin/revenue/ledger`, both behind `requireSuperAdminAuth`.
- 12 DB-gated tests: **4 SECURITY-CRITICAL auth-gate tests** (no token 401, tenant-audience 403, attendee-audience 403, ledger-also-rejects-tenant 403) + 6 dashboard-math tests + 2 ledger drill tests.
- Service file header documents the security model in full — cross-tenant aggregation IS the point; auth gate is the entire perimeter.

**PR #198 (Phase 2) — super-admin revenue dashboard UI (`edf25c1`):**

- `apps/web/src/hooks/use-admin-revenue.ts` — TanStack Query hooks; wire types mirror the API exactly; `credentials: 'include'`.
- `apps/web/src/app/(admin)/admin/revenue/page.tsx` — 4-card KPI grid + Recharts 2-series LineChart + 2 leaderboards + settlement queue table + 3 anomaly cards + FORBIDDEN-specific error copy.
- 6 unit tests including loading/empty/happy/403-renders-hint/anomalies/axe-clean.
- Settlement queue labelled honestly: "Aggregated from paid orders not yet refunded. Disbursement batching lands Sprint 7; no payout action here."
- EPS reconciliation card is a placeholder stub stating "lands Sprint 7 when `eps_settlements` ships."

**EOD staging verification (all GREEN):**

- main HEAD = `edf25c1` post-Phase-2; staging matches; zero drift
- `STAGING_PAYMENT_BLOCK=1` in `.env.staging` + pm2 env (id=1)
- Swap: 2.0Gi active, 106Mi used (working under build), swappiness=10
- 5 vhosts all 200/404 (api 404 at root is correct)
- `/health`: db=ok
- `GET /api/v1/admin/revenue` (unauth) → **401 AUTH_REQUIRED** (auth gate live on staging)

## Two decisions codified today (decisions.md "Sprint 4 Day 35")

- **Cross-tenant-by-design + auth-gate-is-the-entire-security-model** for §14.7 platform-revenue surface. Inverse of Day-33 Choice B (which remains the default for everything tenant-facing). The 4 auth-gate tests in `revenue.test.ts` are the security backstop. Settlement queue is READ-ONLY until Sprint 7 — pinned so the widget doesn't drift into action by accretion.
- **Build-track owns gate-track drafts.** SES draft today is the first; drafts for AIT/Trust Center/EPS land as separate `docs(ops):` PRs when I can produce them. Silent omission is no longer acceptable — if a session ends without proposing a draft for at least one gate item I CAN draft, call it out.

## Day 36 — recommended sequence

Sprint 4 (Days 31-40) — five days remain (36/37/38/39/40). Buildable items still in play per §26.1:

- **Refund flow + manual disbursement** (§26.1 Day 7-8). Refund flow has free-event applicability today (refund-of-paid-zero is a no-op; the workflow is testable for the priced case once truth-gate clears). Manual disbursement UI + BEFTN CSV export can be built + tested with seed data; actual money movement is truth-gate-gated.
- **Marketing pages** (§26.1 Day 9) — apex `/`, `/features`, `/pricing`, `/contact`, `/legal/changelog`. Mostly static + design-system work. Payment-independent.
- **Launch readiness** (§26.1 Day 10) — AUP review, prod EC2 cutover (truth-gate-gated), first paying tenant (gated).
- **CW memory alarm follow-up** — 5-minute AWS-write item; start session with it if Moshiur pre-authorizes.

**Plus build-track moves on launch-gate drafts** (per Day-35 decision):

- AIT withholding tax-counsel question memo (Day 36+ candidate)
- Trust Center v1.0 per-page outlines for counsel (Day 36+ candidate)
- EPS credential request memo with integration specs (Day 36+ candidate)

**Recommended Day 36 sequence:** refund flow service + UI (closes §26.1 Day 7 cleanly) — payment-independent for display; truth-gate-gated for actual EPS refund execution. Pair with one gate-track draft (AIT memo OR Trust Center outlines) so the gate moves AND the build track moves. Pair with the 5-minute CW alarm if Moshiur authorizes the AWS write at session start.

## Where things live (quick map — Day 35 additions)

- **Admin revenue service:** `apps/api/src/services/admin/revenue.ts` (cross-tenant aggregates under `withSuperAdmin`)
- **Admin revenue routes:** `apps/api/src/routes/super-admin/revenue.ts` (auth-gated)
- **Admin revenue tests:** `apps/api/src/routes/super-admin/revenue.test.ts` (4 security tests + 8 math/ledger)
- **Admin revenue UI:** `apps/web/src/app/(admin)/admin/revenue/page.tsx`
- **Admin revenue hook:** `apps/web/src/hooks/use-admin-revenue.ts`
- **SES out-of-sandbox draft:** `docs/ops/ses-out-of-sandbox-request.md`
- **App route mount:** `apps/api/src/app.ts:185` — `app.route('/api/v1/admin/revenue', adminRevenueRoutes)`

## Standing invariants (still enforcing)

- `STAGING_PAYMENT_BLOCK=1` in `.env.staging` + pm2 env id=1 + `cfg()` in `apps/api/src/infra/eps/client.ts`. Removing requires a new `decisions.md` entry per §11.0.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; no direct commits to `main`.
- Memory protocol: decisions land in `decisions.md` the turn they're made; gotchas the moment learned.
- Money math single source: `apps/api/src/domain/payments/fee-calculator.ts`. No fee arithmetic elsewhere.
- Snapshot-vs-current display discipline (Day-33 Choice A, extended to cross-tenant Day-35): money dashboards read snapshotted fee fields, NEVER recompute from current config.
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35): every admin endpoint MUST have audience-rejection tests pinning 403 for tenant/attendee tokens.
- Build-track owns surfacing what's draftable for the launch gate (Day-35): drafts for SES/AIT/Trust-Center/EPS land as separate `docs(ops):` PRs; silent omission flagged.
