# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-27 (Trust Center v1.0 core counsel docs delivered — **launch gate 3 → 2**).
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 36; **next session continues Day 36 truth-gate prep.**

## ⚠️ Major gate-state change (2026-05-27)

**Trust Center v1.0 — core counsel documents in hand (Law Legacy Bangladesh, Mahmudus Salehin).** Decision codified in `decisions.md` 2026-05-27 entry (top of file). Net effect:

- **3 contracts delivered today:** ToS, Organiser Agreement, Privacy Policy. Drafts of Buyer Terms / Refund / AUP / Cookie / DPA delivered; bodies of 4-8 still to be confirmed in counsel follow-up.
- **Agency model anchored to Section 182, Contracts Act 1872** across ToS + Organiser Agreement → **satisfies the AIT decision's contract dependency.** Disbursement-leg no-withholding treatment is now contract-backed AND tax-authority-confirmed. Calculator stays unchanged.
- **AIT clauses embedded per CA brief:** specified-person self-deposit, 15-day A-Challan deadline, recovery-from-disbursements, NBR indemnification, individual-organiser exemption.
- **Liability cap structured** (Organiser Agreement v1.3 clause 6.2): 12-month-fees cap WITH carve-outs (gross negligence / wilful misconduct / fraud / breach of fiduciary duty / death-injury / non-limitable Bangladesh statutory).
- **Incorporation recommendation ON RECORD:** counsel advises Public Pulse Agency (currently sole proprietorship; Moshiur personally liable) incorporate a Pvt Ltd before significant third-party-fund volumes. Contracts include novation clause to let agreements transfer at incorporation time. **NOT a code item; owner decision.**
- **Trust Center placeholder constraint partially lifts immediately** (tenant + organiser consent surfaces — sign-up + ToS + Privacy + Organiser Agreement). **Fully lifts on Buyer Terms body confirmation** (the checkout-consent UI in the buyer form stays on the Day-34 link-footer pattern until the Buyer Terms text is final).
- **Launch gate: 3 → 2.**

## ⚠️ FIRST THING DAY 36 (resumed) — truth-gate prep sequence

GitHub Actions billing fixed. In-flight branches:

1. **PR #206** (`fix/eps-hash-base64-sandbox-url` at `39a5697`) — EPS wire-format bug-fix: hash hex → Base64, sandbox URL `sandbox-pgapi` → `sandboxpgapi`. Re-run CI → merge → watch deploy. Also pre-fixes the production hash encoding.
2. **CI optimization branch** (`ci/skip-docs-only-prs` at `64ec054`, not yet pushed/opened) — docs-only skip + drop redundant push trigger. Push → open PR → merge → watch deploy.
3. **Wire `sandbox-config.ts`** — load sandbox secret at harness-invocation time; sandbox EpsConfig constructed independently; `.env.staging` + pm2 services untouched; STAGING_PAYMENT_BLOCK stays enforcing. Bidirectional isolation: harness can't hit prod, prod can't hit sandbox.
4. **Re-verify** STAGING_PAYMENT_BLOCK=1 + swap active → STOP. Truth-gate execution (4 §14.2 sandbox transactions) is a separate gated prompt.

## ⚠️ The launch gate state — NOW 2 blockers (was 3, was 4)

1. **EPS sandbox credentials** ← ✓ **PROVISIONED 2026-05-26** at `eventpulse/staging/eps-sandbox` (VersionId `37db11ab…`). Truth-gate execution now actually runnable once PR #206 ships + sandbox-config wires up. **This item is fully unblocked; the remaining work is execution, not procurement.**
2. **SES out-of-sandbox approval** — ⚠️ **DRAFT READY** at `docs/ops/ses-out-of-sandbox-request.md` (PR #196). Awaiting Moshiur review + submission.
3. ~~**Trust Center v1.0 documents from counsel**~~ — ✅ **CORE DOCS DELIVERED 2026-05-27**. ToS + Organiser Agreement + Privacy in hand; Buyer Terms / Refund / AUP / Cookie / DPA drafts delivered, bodies to be confirmed. See decisions.md 2026-05-27 entry.

~~4. §29 #9 AIT withholding tax opinion~~ — ✅ **RESOLVED 2026-05-26** via CA consultation.

**Remaining counsel follow-ups (sub-tracked under item 3 above, not blocking launch):**

- (a) Confirm full bodies of docs 4-8 — **Buyer Terms is the load-bearing one** for unblocking the buyer-form checkout-consent UI. Other surfaces (tenant sign-up, organiser onboarding) can move forward today.
- (b) Owner incorporation decision (Moshiur). Pre-significant-volume; on-record per counsel.

**Standing pattern (decisions.md 2026-05-26 Day-35 entry):** the build track owns surfacing what's draftable. With AIT resolved + Trust Center substantially resolved, the natural Day-36+ draft is now the **EPS production-credentials request memo** (item 1 of the original 4-item gate; now an "execution-not-procurement" item but a clean memo would help if Moshiur wants to negotiate a separate dedicated set instead of using the existing prod creds for the post-sandbox real-money smoke).

## ⚠️ Build-track items unblocked by today's counsel delivery

These are NOW plannable (were blocked on v1.0 docs); none are shipped yet:

- **Load counsel's v1.0 markdown bodies into `legal_documents` + `legal_document_versions` tables** for ToS + Privacy + Organiser Agreement; mark `requires_signature=true` for the 3 contracts.
- **Tenant sign-up consent capture** — ToS + Privacy at sign-up; writes `consent_records` row per §9.11 schema. Already-designed substrate; only wire-up missing.
- **Organiser onboarding consent capture** — Organiser Agreement at KYC submission OR at first paid-tier creation (decisions.md §13.4 KYC-gating moment).
- **Re-consent on material-change architecture** per §20.4 — gating: only fires after a `legal_document_versions` row is published with `material_change=true`. Already-designed flow; only wire-up missing.
- **Buyer-form checkout-consent UI** — STILL GATED on Buyer Terms body confirmation. Until then, the link-footer pattern from PR #193 stays correct.

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
