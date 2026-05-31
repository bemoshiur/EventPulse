# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-31 EOD (late) — Day 37 of 47-day Phase 1 MVP runway, fee-model decision **RESOLVED**.
**LAUNCH TARGET: 2026-06-10** (10 calendar days from today; operator set 2026-05-31).
**Driver:** Claude Code (Opus 4.7).
**Fee-model decision (this commit):** **Option 3 — single-method launch, bKash-only for v1.0** chosen tonight. Operator product principle: buyers see the exact fee at checkout, no "estimate." See `decisions.md` 2026-05-31 "EPS fee-model structural decision — Option 3 CHOSEN" entry (top of file). HARD STOP on `fee-calculator.ts` lifts for Phase 6 (Day 38) money-math PR.
**Audit:** "Pending Work to Ship EventPulse" — 137 findings across 5 lenses + completeness critic; verdict good-with-minor-gaps; the 17-step critical path is the tracking surface.

## 🎯 The 17-step critical path (audit-derived; replaces §26.1 day-by-day plan)

```text
[1] OPERATOR: EPS fee-model decision (Options 1/2/3/4)   ✅ RESOLVED 2026-05-31 EOD
     │                                                      → Option 3 chosen
     ├──────────┬──────────┬──────────┐                     (single-method launch,
     │          │          │          │                      bKash-only for v1.0)
[2] Update    [3] V5-     [7] Refund  [8] SNS bounce/         Day 38 AM
    fee-calc      tolerant     flow +     complaint           STOP-ASK before
    per Option    schema PR    manual     suppression         money-math PR.
    3 — bKash     (Day 37)     disburse-  pipeline            Set epsFeeBps to
    @175 bps      ✅ shipped   ment       (gates step 9       bKash 175 bps per
    + buyer-      PR #223      (note:     MAIL_DRY_RUN=0)     truth-gate Mode A.
    method                     Option 3
    restriction +              decouples
    honest copy.               refund-flow
                               from fee-
                               model — was
                               §6 Risk 4
                               concern;
                               no longer.)
     │                            │
[4] Operator + EPS: prod
    credential procurement        │      ← Operator-action #1 today
     │                            │
[5] STAGING_PAYMENT_BLOCK
    lift (decisions.md entry)     │
     │                            │
[6] BDT-100 prod smoke ←──────────┘      ← Its own gated session;
    via bKash specifically                 STAGING_PAYMENT_BLOCK=1 every
    — confirms bKash rate                  other session.
    matches 175 bps. If                    NEW purpose: rate-confirmation
    rate ≠ 175 bps → STOP,                 load-bearing.
    adjust calculator,
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

- **First-thing-tomorrow (Day 38 AM) is now Phase 6 — Option 3 implementation:**
  - **Phase 1** — Fee-calculator: set `epsFeeBps = 175` (bKash rate, truth-gate Mode A). Update §14.2 worked examples + unit tests. **STOP-ASK before the money-math diff merges** — operator reviews old → new bps + §14.2 deltas + test updates.
  - **Phase 2** — Buyer-facing payment-method restriction. Investigate EPS V5 InitializeEPS support for method allow-list (e.g. `RestrictedFinancialEntities` or similar). Three plausible mechanisms in preference order: (a) EPS init-time method restriction; (b) availability check + UI guidance; (c) UI-side enforcement only. STOP-ASK after investigation to confirm chosen mechanism.
  - **Phase 3** — Honest UI copy: marketing `/features` + `/pricing` ("Currently accepting bKash. More payment methods coming soon."), tenant-onboarding flow (visible BEFORE Organiser Agreement signing), buyer-facing event page + checkout, email templates. Bilingual per R12 (Bengali first). **STOP-ASK on any copy touching Organiser Agreement language** — counsel-owned (Salehin); flag for follow-up if current draft implies multi-method support.
  - **Phase 4** — Production smoke prompt rewritten for rate-confirmation purpose. The smoke is its own gated session — document only, don't run.
- **Then Phase 7 (Day 39-40):** SNS bounce/complaint suppression-list wiring per the scope captured in `decisions.md` 2026-05-31 SES entry (2 SNS topics + sig-verified webhook handlers + global Postgres suppression list + outbound-send guard). Gates `MAIL_DRY_RUN=0` per the AWS commitment in case 177899559700777 reply.
- **Then (Day 39+, subject to EPS prod-credential arrival):** BDT-100 production bKash smoke per critical-path step [6] — **rate-confirmation purpose load-bearing now** (confirms production charges bKash at the same 175 bps observed in sandbox; if rate differs → STOP, adjust calculator, re-smoke, no launch until confirmed). Own gated session with the staging-only STAGING_PAYMENT_BLOCK lift recorded in decisions.md per §11.0; **re-enable block immediately after.**
- **Sprint 4 buildables — refund-flow coupling SIMPLIFIED by Option 3 choice:** Day 7-8 refund flow + manual disbursement can now be authored INDEPENDENTLY of the fee-model decision. The §6 Risk 4 concern (refund = actual EPS fee not estimate) applied to Option 4 only; under Option 3 the calculator's predicted fee IS the actual fee (single method → exact match), so refund-flow returns the calculator-predicted EPS fee cleanly. Day 9 marketing pages with **single-method honest pricing display** (no two-mode calculator surface — single method has a single fee composition). Day 10 launch readiness ceremony (multi-task; critical-path step [17]).
- **Post-launch roadmap explicit (per decisions.md 2026-05-31 Option 3 entry):** **Card-method addition is the immediate next addition** — target **week 1 post-launch**. Production smoke against card → populate per-method rate → ship. Each new method requires its own production rate-confirmation smoke before going live (same discipline as v1.0 bKash). Catalogue-driven Option 1 evolution becomes a future option once 2+ methods are empirically populated; Option 4 remains a future option for rate-change robustness; neither committed at v1.0.

## ⚠️ Today's deliverables (Day 37 EOD — 5 PRs)

- **PR #222 memory** `ef6dcee` — Day 37 audit reconciliation + June 10 launch target SET + 17-step critical-path adopted as tracking surface + four reconciliation gaps captured (Modes C+D Fail reframing / §29 #9 AIT drift / §29 #10 NBR-VAT external clock surfaced / prod-branch divergence). Merged.
- **PR #223 feat(eps)** `f3d2a30` — V5 production additive-field schema tolerance (`EpsTransactionId` camelCase + `PaymentReferance` verbatim EPS typo + `StoreAmount` + `TotalAmount` all optional in V5 schema; V5 parseVerifyResponse surfaces both amount fields when present); 349 EPS tests; 5 new V5 test cases including the verbatim-typo regression guard (negative case pins that `PaymentReference` corrected spelling does NOT populate the typed field). No fee-calculator.ts touch. Production V5 schema now ready for the BDT-100 smoke per critical-path step [6]. Merged (CI re-ran after a 109→89-char title fix to clear the conventional-commits 100-char-subject check — see gotchas.md).
- **PR #224 docs(decisions)** `3c36abb` — `docs/decisions/fee-model.md` (227 lines, 9 sections + decision-recording template). Structured Options 1/2/3/4 comparison surface for operator overnight review. Three operator sharpenings applied before commit: §6 Risk 2 stranded-investment naming, §6 Risk 4 refund-flow critical-path coupling, §8 hybrid Sprint-7-committed-deliverable framing. §7 decision matrix expanded to distinguish "Implementation effort (one-time)" from "Operational complexity (ongoing burden)" as named dimensions. Merged.
- **PR #225 memory** `8568dea` — Day 37 EOD closeout (Phase 5) + tomorrow's-first-action sequencing + Phase 6/7 plan. Merged.
- **PR #_pending_ memory (this commit)** — **Option 3 (bKash-only single-method launch) DECISION LOCKED** + handoff updated (fee-model RESOLVED, step [6] carries rate-confirmation purpose, post-launch card-method roadmap explicit) + 100-char PR-title gotcha logged. **Operator decided EOD-late (after PR #225 closeout) — overrode the "decide tomorrow with a fresh head" sequence because the operator product principle (exact-fee-not-estimate) made the call clean.**

**No code touched in `apps/api/src/domain/payments/fee-calculator.ts` in this session** — Phase 6 implementation happens tomorrow (Day 38). HARD STOP lifts for that focused PR per the decision entry's "What stays unchanged" section; STOP-ASK before the money-math diff merges.

## ⚠️ The launch gate state — 0 active blockers (decision resolved this commit)

1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26.
2. ~~SES out-of-sandbox~~ ✅ RESOLVED 2026-05-31 (case 177899559700777, ap-southeast-1).
3. ~~EPS fee-model structural decision~~ ✅ **RESOLVED 2026-05-31 EOD — Option 3 (single-method launch, bKash-only)** chosen tonight (decisions.md entry top). **Production bKash smoke remains** — now load-bearing for rate confirmation, not a structural-decision gate.

**Pre-launch commitments (gate env flips, not launch itself):**
- **SNS bounce/complaint suppression-list wiring** (decisions.md 2026-05-31) — gates `MAIL_DRY_RUN=0`. AWS commitment (case 177899559700777 reply). Sequenceable parallel with fee-model + V5 schema.
- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session; re-enable immediately after.
- **Buyer Terms body** — gates real `consent_records` capture on buyer-form (replaces Day-34 link-footer pattern).

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

## Standing invariants (still enforcing — 10-day runway protection)

- **`STAGING_PAYMENT_BLOCK=1`** in `.env.staging` + pm2 env id=1. Truth-gate three-lock bypass remains harness-scoped; operator-app traffic still blocked. **Only authorized lift: BDT-100 production smoke on its own gated session per decisions.md §11.0; re-enable immediately after.** Non-negotiable through June 10.
- **HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts`** — holds until operator decides fee-model option (Day 38 AM).
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. No fee arithmetic elsewhere.
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (new today):** track `origin/prod` SHA every session; if it diverges from `main` by more than a sprint, document as pre-cutover requirement (current: `21dad2cc` vs `ad0f5fe9`).
