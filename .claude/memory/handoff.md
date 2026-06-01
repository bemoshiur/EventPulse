# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-31 — **Day 39** of 47-day Phase 1 MVP runway. Memory reconciliation to overnight legal replies + Buyer-Terms-Lite surfaced as NEW pre-launch deliverable + Path B incorporation LOCKED + §29 #10 NBR/VAT RESOLVED.
**LAUNCH TARGET: 2026-06-10** (calendar countdown continues; runway materially de-risked today by §29 #10 resolution).
**Driver:** Claude Code (Opus 4.7).
**Today's headline (Day 39 AM):** Both overnight legal replies captured verbatim in `decisions.md`. **§29 #10 NBR/VAT RESOLVED with written record** (CA confirmed disclosed-agency interpretations (a)(b)(c) in writing; commission falls under existing PPA BIN 009043032-0102; Mushak-9.1 nil-return cadence continues; revisit only on operational-model change / commission-structure revision / turnover-approaching-VAT-threshold). **Both §29 launch-blocking legal questions now RESOLVED** (#9 AIT resolved 2026-05-26; #10 NBR/VAT today). **Path B incorporation LOCKED:** soft-launch June 10 on existing sole proprietorship + Pvt Ltd 4–6 weeks post-launch per Salehin's recommendation; novation clause in Organiser Agreement is the load-bearing transfer mechanism; carry items dated 2026-06-24 (incorporation paperwork start) and 2026-07-08 → 2026-07-22 (novation execution window). **Buyer Terms reading (a) confirmed** by Salehin as primary with practical qualification: NO full parallel Buyer Terms needed; lightweight Buyer-Terms-Lite at checkout required, covering 4 topics (platform usage / Event Pulse's limited role disclaimer / data processing consent / basic liability carve-outs). Buyer-Terms-Lite drafted today (Phase 2); operator emails to Salehin for review-this-week offer once approved. HARD STOP on `fee-calculator.ts` LIFTED yesterday per Option 3 entry. STAGING_PAYMENT_BLOCK=1 re-verified live this session and stays enforcing through remaining runway.
**Day 38 EOD shipped (carryover):** Option 3 fee-model decision implemented end-to-end. `DEFAULT_EPS_FEE_BPS_ESTIMATE` = 175 bps (PR #227). Server-side Verify-guard rejects non-bKash payments → `disputed` status (PR #228). Buyer-facing UI copy honest about bKash-only + bilingual + tested (PR #229). Production BDT-100 smoke runbook with 7 preconditions + 9-step procedure + decision rules matrix (PR #230).
**Audit:** "Pending Work to Ship EventPulse" — 137 findings across 5 lenses + completeness critic; verdict good-with-minor-gaps; the 17-step critical path is the tracking surface.

## 🎯 The 17-step critical path (audit-derived; replaces §26.1 day-by-day plan)

```text
[1] OPERATOR: EPS fee-model decision (Options 1/2/3/4)   ✅ RESOLVED 2026-05-31 EOD
     │                                                      → Option 3 chosen
     ├──────────┬──────────┬──────────┐                     (single-method launch,
     │          │          │          │                      bKash-only for v1.0)
[2] Update    [3] V5-     [7] Refund  [8] SNS bounce/         ✅ DONE Day 38:
    fee-calc      tolerant     flow +     complaint           PR #227 calculator
    per Option    schema PR    manual     suppression         bKash 175 bps;
    3 — bKash     (Day 37)     disburse-  pipeline            PR #228 Verify-guard
    @175 bps      ✅ shipped   ment       (gates step 9       rejects non-bKash →
    + buyer-      PR #223      (Phase     MAIL_DRY_RUN=0)     disputed; PR #229
    method        ✅ Day 38    2b queued                       buyer-form bKash-only
    restriction +    PR #228   for Day                         copy + forward-looking
    honest copy.     PR #229   39+. Now                        copy plan; PR #230
                               decoupled                       BDT-100 smoke
                               from fee-                       runbook.
                               model.)
     │                            │
[4] Operator + EPS: prod                  ← Operator-action #1 still un-started
    credential procurement                  (gate for [5][6]; STOP-ASK at Day 38
     │                            │         Phase 5)
[5] STAGING_PAYMENT_BLOCK
    lift (decisions.md entry)     │
     │                            │
[6] BDT-100 prod smoke ←──────────┘      ← Its own gated session;
    via bKash specifically                 STAGING_PAYMENT_BLOCK=1 every
    — confirms bKash rate                  other session.
    matches 175 bps. If                    Runbook: docs/runbooks/
    rate ≠ 175 bps → STOP,                 production-smoke.md (PR #230,
    adjust calculator,                     Day 38).
    re-smoke. Then
    re-enable block.
     │                                     
     ├──────────┬──────────┐
     │          │          │
[10] Marketing  [13] §29   [14] Prod EC2 + Route 53
     pages w/        #10        + OIDC role + Ansible
     fee-mode-       NBR        + Secrets Manager (11)
     calc            VAT        + KMS CMKs (2) + wildcard
                    opinion     cert + alarm catalogue
                              + prod-branch ff-merge (21dad2cc → ad0f5fe9)
     │                              │
[11] Counsel returns Buyer Terms body  ← Operator-action #2 today
     │
[12] Wire real consent_records on buyer-form
     │
[15] t3.medium upgrade decision        ← Pre-cutover Moshiur decision
     │
[16] CloudWatch alarms wired           ← ASK-FIRST AWS-write
     │
[17] Sprint 4 Day 10 launch readiness:
     AUP review + host-liability lawyer sign-off
     + security checklist + prod cutover
     + onboard first paying tenant     ← Operator-action #4 today
```

## 🚨 Four reconciliation gaps captured today (see decisions.md 2026-05-31 Day 37 entry)

1. **Modes C+D `Status: Fail` reframed** — Phase 1.4 truth-gate empirical state is **partial: only Mode A's bKash transaction (1.747% MFS rate) cleanly succeeded.** No card rate, no Nagad clean success, no other MFS, no bank-transfer observation. Fee-model decision (Options 1/2/3/4) is being made on a **single clean data point**. This shapes Option 4's "robust to data scarcity by design" framing.
2. **§29 #9 AIT documentation drift** — resolved 2026-05-26 in memory, still "open" in CLAUDE.md §29. v2.4 bump backlog item.
3. **§29 #10 NBR/VAT opinion** — was NOT tracked as external clock; **NOW IS** (this entry + operator-action #3 below).
4. **prod branch SHA divergence** — `origin/prod` at `21dad2cc` (Sprint 1 era); `main` at `ad0f5fe`. Sprint 2-4 work (~80+ commits) NOT on prod. ff-merge or cherry-pick required before any production deploy. Critical-path step [14] sub-task.

## 📨 Operator parallel actions QUEUED TODAY (not Claude Code's job)

These are 5-minute emails/messages the operator sends today so external clocks start running:

1. **EPS production credentials** — email EPS to request prod creds for `eventpulse.com.bd` live merchant account. Same contact who provided V5 docs + sandbox creds. Specify prod base URL (`pgapi.eps.com.bd`), confirm V5 integration guide received, request `merchant_id` / `store_id` / `username` / `password` / `hash_key` set. Critical-path step [4]; clock must start today.
2. **Counsel follow-up (Salehin)** — (a) Buyer Terms body for buyer-form `consent_records` UI (critical-path step [11]); (b) Pvt Ltd incorporation question given June 10 launch with real money flow — is the recommendation to incorporate before first paying tenant?
3. **NBR/VAT opinion (§29 #10)** — written opinion on the platform's VAT registration model. Fastest path: ask the CA who handled AIT (their opinion was excellent and fast). External clock; gates launch per playbook framing.
4. **Candidate first paying tenant** — identify a real organiser ready to sign Organiser Agreement + complete KYC + have an event to ticket. Without this, "platform ready" ≠ "earning real money on launch day." Critical-path step [17].

## ⚠️ TL;DR for next session

- **First-thing-tomorrow (Day 39):** Phase 2b — buyer-notification SES template + admin disputed-orders queue endpoint. Phase 2a (PR #228) shipped the server-side enforcement (non-bKash → `disputed`); Phase 2b ships the operational surface around it. Specifically:
  - **`order_disputed_wrong_method` SES template (EN + BN)** — full copy already drafted in `docs/copy/bkash-only-launch.md` (PR #229); pull-into-template work is mechanical
  - **Admin endpoint `GET /admin/orders/disputed`** + manual `POST /admin/orders/:id/mark-refunded` action — lightweight; full React UI deferred to a Phase 2b-follow-up. v1.0 launch posture is acceptable without the React UI (ops queries `audit_logs WHERE action = 'order.disputed'` directly) but the endpoint + mark-refunded action are still useful for log-driven ops
- **Then (Day 39-40):** SNS bounce/complaint suppression-list wiring per the scope in `decisions.md` 2026-05-31 SES entry (2 SNS topics + sig-verified webhook handlers + global Postgres suppression list + outbound-send guard). Gates `MAIL_DRY_RUN=0` per the AWS commitment in case 177899559700777 reply. Sequenceable parallel with Phase 2b.
- **Then (Day 39+, subject to EPS prod-credential arrival):** BDT-100 production bKash smoke per critical-path step [6] using the runbook shipped today (`docs/runbooks/production-smoke.md`, PR #230). Own gated session; 9-step procedure; CONFIRMED case clears first paying tenant onboarding. STAGING_PAYMENT_BLOCK lift recorded in decisions.md per §11.0; re-enable immediately after. **Runbook precondition #2 ("Production credentials loaded into AWS Secrets Manager at `eventpulse/prod/eps`") is SATISFIED at Day 38 EOD-late** — operator authorised `eventpulse/prod/eps` (AWSCURRENT version `6754cc98-164d-4504-aa92-e82c2c446409`) as the canonical prod-cred holder; digest-verified to contain the same credentials currently in memory on staging api process (Day-20 directive: staging credentials are production-tier). Remaining preconditions (#1 EPS prod credentials received, #3 prod EC2 + Nginx + DNS + wildcard cert in place, #4 prod-branch ff-merge, #5 EPS_MODE=production on prod EC2 once provisioned, #6 operator on-call, #7 reversal path pre-arranged) all still gate the smoke session.
- **Sprint 4 buildables — refund-flow coupling SIMPLIFIED by Option 3 choice (confirmed shipped today):** Day 7-8 refund flow + manual disbursement can be authored INDEPENDENTLY of the fee-model decision. Under Option 3 the calculator's predicted fee IS the actual fee (single method → exact match within the floor-rounding ±7 paisa); refund-flow returns the calculator-predicted EPS fee cleanly. Day 9 marketing pages with single-method honest pricing display (no two-mode calculator surface). Day 10 launch readiness ceremony (multi-task; critical-path step [17]).
- **Post-launch roadmap explicit (per decisions.md 2026-05-31 Option 3 entry):** Card-method addition is the immediate next addition — target week 1 post-launch. Each new method requires its own production rate-confirmation smoke before going live (same discipline as v1.0 bKash; runbook generalises). Copy plan at `docs/copy/bkash-only-launch.md` captures the multi-method copy strings for when methods join.

## ✅ Operator-action external clocks — TWO RESOLVED at Day 39 AM; remaining clocks still healthy

**Day 39 update:** two of the four overnight legal replies arrived; both captured verbatim in today's `decisions.md` entries. Status table below reflects the materially improved state:

1. **EPS production credentials request** — sent before Day 38; awaiting EPS reply. Gates critical-path step [4]→[5]→[6] (Production smoke). Once received, the next-available session can open the production smoke per `docs/runbooks/production-smoke.md` + the Day-38-EOD-late confirmation that runbook precondition #2 (`eventpulse/prod/eps`) is SATISFIED. **Status: clock still running.**
2. **NBR/VAT opinion (§29 #10)** — ✅ **RESOLVED 2026-05-31 Day 39 AM with written record** (see `decisions.md` 2026-05-31 Day 39 "CA written opinion received on NBR/VAT" top entry). All three interpretations (a)(b)(c) confirmed in writing; commission within existing PPA BIN 009043032-0102; Mushak-9.1 nil-return cadence continues; revisit only on (operational-model change / commission-structure revision / turnover-approaching-VAT-threshold). **Both §29 launch-blocking legal questions now RESOLVED** (#9 AIT 2026-05-26; #10 NBR/VAT today).
3. **Counsel follow-up (Salehin)** — ✅ **PARTIALLY RESOLVED 2026-05-31 Day 39 AM with two written replies** (see `decisions.md` 2026-05-31 Day 39 "Salehin written opinion received on Buyer Terms" + "...on incorporation" entries). Buyer Terms reading (a) primarily confirmed with practical qualification → NEW pre-launch deliverable Buyer-Terms-Lite (4 topics: platform usage / limited role / data consent / liability carve-outs); Phase 2 produces first draft today. Incorporation: Path B LOCKED (soft-launch + post-launch Pvt Ltd 4–6 weeks). **Remaining Salehin item:** review Buyer-Terms-Lite draft (operator emails him this week per his review-this-week offer).
4. **Candidate first paying tenant** — IDENTIFIED at Day 38 EOD; bKash-audience-suitable for v1.0 single-method launch shape per Option 3 implication (b). **Status: identified; onboarding ready to proceed once Phase 2b + production smoke + Buyer-Terms-Lite-into-checkout-wire land.**

**Implication for June 10 launch math:** §29 #10 RESOLVED materially de-risks the runway. Only one external-clock blocker remains (EPS prod credentials for the smoke session). Remaining work is build-track (Phase 2b + SNS suppression + Buyer-Terms-Lite wire-into-checkout) + the one external clock (EPS) + the operational ceremony (first-tenant onboarding) — sequenceable inside the remaining runway with healthy slack now.

## 📅 Path B incorporation — DATED CARRY ITEMS (per Day 39 operator instruction)

Path B chosen 2026-05-31 (see `decisions.md` 2026-05-31 Day 39 "Salehin written opinion received on incorporation; Path B LOCKED" entry). Carry items below have **dated calendar markers** (not vague "post-launch"):

| Item | Target date / window | Status |
|---|---|---|
| Begin Pvt Ltd incorporation paperwork (RJSC name-clearance + draft memorandum/articles + bank-account-opening initiation) | **Week of 2026-06-24** | PENDING — starts after launch stabilises |
| Novation execution window (transfer (a) Organiser Agreements + (b) AWS account + Secrets Manager ownership + (c) EPS merchant account ownership + (d) BIN/VAT registration transition) | **2026-07-08 → 2026-07-22** | PENDING — gated on RJSC certificate of incorporation |
| Pvt Ltd target completion (RJSC certificate issued; new Organiser Agreements sign against Pvt Ltd directly) | **2026-07-22** (outer boundary of Salehin's 4–6 weeks recommended window) | PENDING |
| Update CLAUDE.md §29 #9 + #10 + Path B + Buyer-Terms-Lite to v2.4 playbook bump backlog | Pre-launch nice-to-have; post-launch firm | TRACKED |

## ⚠️ Day 39 AM deliverables (this session's first batch)

- **THIS memory PR** — Phase 1 reconciliation to overnight Salehin + CA written replies. Three new `decisions.md` top entries (CA NBR/VAT — §29 #10 RESOLVED + Salehin incorporation — Path B LOCKED + Salehin Buyer Terms — reading (a) primary + Buyer-Terms-Lite surfaced). `handoff.md` overwritten to Day 39 state: §29 #10 marked RESOLVED in operator-action table; Path B dated carry items added (2026-06-24 incorporation paperwork start; 2026-07-08 → 2026-07-22 novation execution window); Buyer-Terms-Lite added to pre-launch commitments.
- **(Phase 2)** `docs/legal/buyer-terms-lite-draft.md` first draft — 4 sections per Salehin's framing (platform usage / limited role disclaimer / data processing consent / liability carve-outs); BN-first bilingual per R12. Operator review + edits before any send to Salehin. (STOP-ASK after draft per Day 39 prompt.)
- **(Phase 3)** Phase 2b technical follow-up to PR #228: SES bilingual dispute-notification template (`order_disputed_wrong_method`) + admin endpoint `GET /admin/orders/disputed` + manual-refund execution flow (status `disputed → refunded`).
- **(Phase 4)** SNS bounce/complaint suppression-list scaffolding: schema + webhook handlers + outbound-send guard. Code-only PR; AWS-side SNS topic creation + IAM changes STOP-ASK for separate operator-authorised session.
- **(Phase 5)** Day 39 EOD memory + handoff closeout.

## ⚠️ Day 38 EOD shipped (yesterday — carryover record)

- **PR #227 `fix(fees)`** `8afb079` — Phase 1 calculator: `DEFAULT_EPS_FEE_BPS_ESTIMATE` 250 → 175 (bKash MFS rate per truth-gate Mode A 1.747%, rounded). JSDoc cites Option 3 decision + observed 1.747% + capture-base arithmetic (+7-paisa floor delta). New `EPS_BPS_175_BKASH_V1` test constant + 3 new tests pin Mode A reproduction + truth-gate delta + §14.10 Invariant-1 at the launch rate. Existing §14.2 worked-example tests at 250 bps UNCHANGED (spec archaeology). Truth-gate `scenarios.ts:49` LEFT at 250 (§14.2-narrative-bound historical artifact). Prettier drive-by fix on yesterday's `fee-model.md`. Merged (CI re-ran after the prettier fix). v2.4 backlog: scenarios.ts rewire + CLAUDE.md §14.2 worked-example doc update.
- **PR #228 `feat(checkout)`** `8fefa41` — Phase 2a Verify-guard rejection (operator chose mechanism (d)). NEW `bkash-financial-entity.ts` predicate (case-insensitive trimmed exact match; fails closed on null/missing/non-string) + 15 predicate tests. State machine extended: `awaiting_payment → disputed` newly legal. NEW `writeOrderDisputed` audit helper captures `dispute_reason` + verbatim `FinancialEntity`. settle.ts integrates the guard; `/orders/return/wrong-method` redirect added. 8 new integration tests covering happy-bKash + card-disputed + Nagad-disputed + missing-FE-fail-closed + EPS-failed-not-success + audit + events + no-delivery. Two pre-existing settle.test.ts mocks updated to include `FinancialEntity: 'bKash'` (CI caught this on first push; fix-up commit landed). Merged with all 8 checks green.
- **PR #229 `feat(copy)`** `79177d7` — Phase 3 honest UI copy. buyer-form.tsx: bilingual bKash-only notice below subtotal + submit-button label `Continue to payment` → `Continue with bKash` (paid tier only). 4 new tests pin notice + button across paid/free/bilingual/isFreeEvent-gating. NEW `docs/copy/bkash-only-launch.md` living document with canonical EN+BN strings for surfaces that don't yet exist (marketing pages, Day 28+ buyer-return frontend pages incl. `/orders/return/wrong-method`, tenant pre-Organiser-Agreement disclosure, Phase 2b dispute-notice email template). Counsel-owned legal docs surveyed: NONE imply multi-method support; no follow-up flag needed. Email templates surveyed: method-agnostic; no change. KYC step-3-financial.tsx is organiser PAYOUT options (distinct from buyer); no change. Merged.
- **PR #230 `docs(runbook)`** — Phase 4 BDT-100 production bKash smoke runbook. 7 hard preconditions + smoke transaction parameters + expected Verify response shape + derived rate calculation + decision rules matrix + 9-step procedure + post-smoke gates + post-launch evolution. Documented but NOT run this session. (Pending CI / merge at EOD memory-PR-author time; expected to land cleanly as docs-only PR.)
- **THIS memory PR** — Day 38 EOD closeout per Phase 5 prompt. decisions.md captures the 4-PR sweep + 5 operator decisions (Phase 1 bps + Phase 1 scenarios + Phase 2 mechanism + Phase 2a sub-decision A admin queue UI + Phase 2a sub-decision B match semantics). handoff.md overwritten to Day 38 EOD state: critical-path steps [2][3] now ✅ DONE; standing invariants updated to reflect HARD STOP lift on fee-calculator.ts; operator-action external clocks #1-#4 surfaced as STILL UN-STARTED.

**Code touched in `apps/api/src/domain/payments/fee-calculator.ts` this session: NONE** — the file itself stayed untouched per the method-agnostic design (Day 21 author's foresight); the rate change lived in services/orders/index.ts caller default. HARD STOP carried through the entire Phase 1 PR + lifted at merge per Option 3 entry's "What stays unchanged" section.

## ⚠️ The launch gate state — 0 active blockers; both §29 legal questions RESOLVED at Day 39 AM

1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26.
2. ~~SES out-of-sandbox~~ ✅ RESOLVED 2026-05-31 (case 177899559700777, ap-southeast-1).
3. ~~EPS fee-model structural decision~~ ✅ RESOLVED 2026-05-31 Day 37 EOD — Option 3 chosen + implementation SHIPPED Day 38 across PRs #227 / #228 / #229 / #230.
4. ~~§29 #9 AIT classification~~ ✅ RESOLVED 2026-05-26 (CA written opinion).
5. ~~§29 #10 NBR/VAT registration model~~ ✅ **RESOLVED 2026-05-31 Day 39 AM** (CA written opinion; entry above). Both §29 launch-blocking legal questions now RESOLVED with written records.
6. ~~Salehin: Buyer Terms framing~~ ✅ RESOLVED 2026-05-31 Day 39 AM — reading (a) primary; full Buyer Terms NOT needed; Buyer-Terms-Lite required (NEW pre-launch deliverable).
7. ~~Salehin: Incorporation path~~ ✅ RESOLVED 2026-05-31 Day 39 AM — Path B LOCKED; soft-launch + post-launch Pvt Ltd 4–6 weeks.

**Pre-launch commitments (gate env flips, not launch itself):**

- **Buyer-Terms-Lite document at checkout (NEW at Day 39 AM)** — Salehin's required 4-topic lightweight terms (platform usage / Event Pulse's limited role / data processing consent / basic liability carve-outs). Phase 2 produces first draft today; operator emails to Salehin via his review-this-week offer; once Salehin signs off and operator approves final version, wired into checkout's `consent_records` capture. **Replaces the obsolete "Buyer Terms body" line from the Day 38 handoff** — Salehin clarified full Buyer Terms NOT needed; Buyer-Terms-Lite is the correct framing.
- **SNS bounce/complaint suppression-list wiring** (decisions.md 2026-05-31 SES entry) — gates `MAIL_DRY_RUN=0`. AWS commitment (case 177899559700777 reply). Phase 4 ships code-only PR today; AWS-side SNS topic creation + IAM changes STOP-ASK for separate operator-authorised session.
- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session per `docs/runbooks/production-smoke.md`; re-enable immediately after. Precondition #2 (`eventpulse/prod/eps`) SATISFIED per Day-38-EOD-late verification (PR #231 once merged); remaining preconditions still gate the smoke.
- **Phase 2b — buyer-notification SES template + admin disputed-orders queue endpoint** (Day 38 deferred) — Phase 3 today ships these. Operational surface for the Phase 2a Verify-guard mechanism (PR #228). v1.0 launch posture acceptable without React UI (ops uses `audit_logs` queries directly) but template + endpoint are still useful.
- **Production bKash smoke** — runbook in `docs/runbooks/production-smoke.md` (PR #230); smoke session itself opens once EPS prod-credentials arrive (operator-action #1 still pending).

## ⚠️ Empirical findings table — quick recall (decision-grade context for Day 38)

| Mode | Status | FE | TotalAmount | StoreAmount | observedEps | predictedEps | Δ | Trust |
|:---:|:---:|:---:|---:|---:|---:|---:|---:|:---:|
| A (PT,PT) | Success | bKash | 102756 | 101009 | 1747 | 2506 | −759 | **CLEAN** |
| B (AB,AB) | Success | bKash | 100000 |  98300 | 1700 | 2500 | −800 | clean-but-AB |
| C (AB,PT) | **Fail** | bKash | 102500 | 100757 | 1743 | 2500 | −757 | **PARTIAL** |
| D (PT,AB) | **Fail** | Nagad | 100250 |  98546 | 1704 | 2506 | −802 | **PARTIAL** |

All amounts paisa. §14.10 Invariant-1 PASS across all 4. **The only fully-clean fee-rate data point is Mode A bKash @ 1.747% MFS rate.** No card-rate observation exists.

## ⚠️ Build-track items still in play

- ⏳ **CloudWatch >85% memory alarm — STILL OPEN.** 5-minute AWS-write task. ASK-FIRST.
- ⏳ **Full §17.11 alarm catalogue** beyond memory: CPU >85%/10min, mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation. Required pre-prod-cutover.
- ⏳ **t3.medium upgrade** (4 GB, ~+$15/mo) — pre-prod-cutover Moshiur decision.
- ⏳ **k6/artillery load test budget** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **`pnpm audit` blocking on high+critical** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **Production cutover surface** — 11 `eventpulse/prod/*` Secrets Manager entries; 2 prod KMS CMKs (`alias/eventpulse-prod` + `alias/eventpulse-kyc-prod`); prod EC2 Ansible bootstrap; prod Route 53 records (8-record set); prod wildcard cert via DNS-01; `eventpulse-deploy-prod` OIDC role; prod-branch ff-merge (`21dad2cc` → `ad0f5fe9`).
- ⏳ **v2.4 playbook bump backlog** — §14.2 Mode C narrative, §29 #9 AIT reclassification, §29 list housekeeping, prod-branch tracking discipline, Sprint 2-4 accumulated amendments, fee-model resolution once decided.
- ⏳ **Sprint 4 remaining buildable** — Refund flow + manual disbursement + BEFTN file generator (§26.1 Day 7-8) + Marketing pages w/ two-fee-mode calculator (§26.1 Day 9) + Launch readiness (§26.1 Day 10).
- ⏳ **Loose ends (low priority):** Counsel docs 4-8 bodies (Refund Policy, AUP, Cookies, DPA, EULA — Buyer Terms load-bearing); manual click-through of OAuth callback redirect (PR #149 carry); stale `magic-link-form.tsx:20` + `super-admin/kyc.ts:51` TODO audit.

## Where things live (quick map — Day 37 additions)

- **Decision surface:** `decisions.md` 2026-05-31 Day 37 entry (this commit) — operator overnight review.
- **Critical path tracking surface:** this file's diagram at top.
- **V5 schema PR (this session):** `apps/api/src/infra/eps/eps-wire-protocol.ts` V5VerifyResponseSchema extension.
- **Audit document:** "Pending Work to Ship EventPulse" — workflow `wq9vfxuf4`, output at `/private/tmp/claude-501/.../tasks/wq9vfxuf4.output` (local-only; transcript dir).

## Standing invariants (still enforcing — 9-day runway protection)

- **`STAGING_PAYMENT_BLOCK=1`** in `.env.staging` + pm2 env id=1. Truth-gate three-lock bypass remains harness-scoped; operator-app traffic still blocked. Re-verified live Day 38 Phase 0 invariants check. **Only authorized lift: BDT-100 production smoke on its own gated session per `docs/runbooks/production-smoke.md` (PR #230) + decisions.md §11.0; re-enable immediately after.** Non-negotiable through June 10.
- **v1.0 single-method launch — bKash-only enforcement (NEW Day 38):** Server-side via Phase 2a Verify-guard in settle.ts (PR #228): non-bKash `FinancialEntity` → `disputed` status, no QR/delivery, redirect to `/orders/return/wrong-method`. UI-side via Phase 3 honest copy (PR #229): pre-checkout notice + button label `Continue with bKash`. v1.0 launch posture is server-side-enforced, not honour-system; deviation cohort goes through manual refund queue. Post-launch evolution: each new method requires its own production rate-confirmation smoke per `docs/runbooks/production-smoke.md`.
- **HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts`** — LIFTED Day 38 per Option 3 decision entry's "What stays unchanged" section + Phase 1 PR #227 shipping with operator approval. The calculator architecture itself remained untouched this session (no code changes inside fee-calculator.ts); only the caller's default constant in services/orders/index.ts changed. Future fee-math changes are still STOP-ASK gates per CLAUDE.md §1.4; the HARD STOP carries forward as single-PR-at-a-time discipline rather than a blanket lock.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. No fee arithmetic elsewhere.
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (Day 37):** track `origin/prod` SHA every session; if it diverges from `main` by more than a sprint, document as pre-cutover requirement (current: `origin/prod` at `21dad2c`; `main` at `79177d7` post-PR-#229; divergence now ~85 commits; ff-merge or cherry-pick onto `prod` required before any production deploy — critical-path step [14] sub-task).
- **Method-agnostic-calculator discipline (Day 38 codified):** Day 21 author's decision to make `epsFeeBps` a calculator input (not a hardcoded constant) is what made Phase 1's Option 3 implementation a 1-line caller-default change instead of a calculator surgery. Future per-method work should respect the same architecture: the method-to-bps mapping lives in the CALLER, not in fee-calculator.ts.
