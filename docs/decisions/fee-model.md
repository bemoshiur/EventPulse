# Fee-Model Structural Decision — Surface for Operator Review

> **Status:** PENDING OPERATOR DECISION (Day 38 AM, 2026-06-01).
> **Audience:** Moshiur (operator).
> **Purpose:** Surface the four candidate fee-model options identified in `decisions.md` 2026-05-30 with empirical context, mechanical implications, and risk framing so the operator can decide with a fresh head. **This document does NOT make the decision.**
> **Decision recording:** once chosen, append a new top entry to `.claude/memory/decisions.md` referencing this document. Then HARD STOP lifts on `apps/api/src/domain/payments/fee-calculator.ts`.

---

## 1. Why this decision exists

The Phase 1.4 EPS sandbox truth-gate run (2026-05-30) revealed an empirical gap between what `apps/api/src/domain/payments/fee-calculator.ts` predicts and what EPS Bangladesh actually charges:

- **Calculator models 2.5% (card-rate)** as a single `epsFeeBps` parameter, applied uniformly to every transaction at order-creation time.
- **EPS empirically charges ≈1.700% of `TotalAmount`** on MFS (mobile-financial-service) payment methods. Card-rate is not yet empirically confirmed (no card transactions in the truth-gate run).
- **The mismatch is real**: ~800 paisa over-prediction per BDT 1000 face value on MFS transactions. Direction of risk depends on the absorb/pass-through mode the organiser chose for the event.

This is a **structural** decision because no single-value `epsFeeBps` parameter can correctly model EPS's actual payment-method-dependent rate card. Patching the rate from 2.5% to some-other-percentage doesn't solve it; it just moves the over-prediction to a different payment method.

---

## 2. Empirical data state — what we have, what we don't

### Data we HAVE (truth-gate run, 2026-05-30)

|    Mode    | EPS Status  | FinancialEntity | TotalAmount paisa | StoreAmount paisa | observed eps_fee | EPS rate on Total |                         Data trust                         |
| :--------: | :---------: | :-------------: | ----------------: | ----------------: | ---------------: | :---------------: | :--------------------------------------------------------: |
| A (PT, PT) | **Success** |      bKash      |           102 756 |           101 009 |            1 747 |      1.6997%      |                         **CLEAN**                          |
| B (AB, AB) |   Success   |      bKash      |           100 000 |            98 300 |            1 700 |      1.7000%      | clean (AB mode — buyer pays only face; least informative)  |
| C (AB, PT) |  **Fail**   |      bKash      |           102 500 |           100 757 |            1 743 |      1.7005%      | **PARTIAL** — EPS populated fee fields but txn marked Fail |
| D (PT, AB) |  **Fail**   |      Nagad      |           100 250 |            98 546 |            1 704 |      1.7000%      |                 **PARTIAL** — same caveat                  |

§14.10 Invariant-1 PASS across all 4. **The only fully clean fee-rate data point is Mode A bKash at 1.747% MFS rate** (Mode A is the most informative — pass-through-both means the buyer sees the EPS fee line directly).

### Data we DO NOT have

- **No card-rate observation** (no buyer paid via card in the truth-gate run). The 2.5% the calculator models is the documented card rate but is not empirically confirmed.
- **No bank-transfer (BEFTN-inbound) observation** — if EPS supports any such path.
- **No Rocket / Upay observation** — both MFS methods listed in `tenant_payout_accounts.account_type` enum but neither has run as a _payment_ method through EPS in the truth-gate.
- **No multi-transaction rate-consistency observation** — single-transaction-per-method sample size means we don't know if EPS's rate varies by amount tier, transaction velocity, time-of-day, or merchant volume.
- **No production-environment observation** — sandbox vs production rate cards could differ (rare but possible; production smoke per critical-path step [6] confirms).

### Implication for option-weighting

The decision is being made on **one fully clean data point** (Mode A bKash 1.747%) + three partial data points (Modes B/C/D, all MFS, mostly bKash). Options 1 and 3 are sensitive to data scarcity (need more data to populate honestly OR need to restrict the launch surface). Options 2 and 4 are more robust to scarcity — Option 2 by accepting a known-imperfect single rate, Option 4 by deferring rate-questions to EPS itself on every transaction.

---

## 3. Option 1 — Per-method rate catalogue in the fee calculator

### Mechanism

Replace `epsFeeBps: number` with `epsFeeBps: Record<FinancialEntity, number>` in the calculator's `FeeCalcInput`. At order-creation time, the caller looks up the rate keyed on the chosen `FinancialEntity` (bKash / Nagad / Rocket / Upay / Card / BEFTN). Calculator applies that rate; `orders.eps_fee_paisa` snapshots both the bps value AND the financial entity for post-mortem traceability.

### What changes

- `apps/api/src/domain/payments/fee-calculator.ts`: `FeeCalcInput.epsFeeBps` becomes a Record; `calculateFees()` reads the per-method bps; calculator unit tests get ~5× more cases (4 modes × N methods).
- `apps/api/src/domain/payments/order-creation.ts` (or wherever the calculator is invoked): caller must know the buyer's chosen `FinancialEntity` BEFORE calling the calculator. Today the buyer chooses on the EPS hosted checkout page AFTER our order is created. So either:
  - Order is created with a placeholder rate (e.g., highest-of-all-methods) and corrected post-Verify; OR
  - Order creation is split — pending row created up-front, financial entity recorded post-redirect-but-pre-Verify (~1 hop change in the flow).
- `events.eps_fee_handling` semantics: pass-through Mode A's buyer fee line would now be method-dependent — the buyer sees "Payment fee: BDT 17.47 (bKash rate)" instead of a flat "BDT 25.06". Disclosure timing matters — buyers picking method on EPS's page won't see the fee line in our checkout UI.
- Organiser-facing fee display in `/admin/revenue` + `/tenant/payouts`: must surface that the rate varies by method; per-event averages don't tell the whole story.
- New table OR new config block: a maintained catalogue of method → bps that admins can update without redeploy (`tenant_fee_config.eps_method_rates` jsonb? Or a separate `eps_method_rate_card` table with effective-from timestamps?).

### Risks

- **Catalogue accuracy & freshness.** Whoever maintains the catalogue must keep it in sync with EPS's actual rates. EPS can change rates without notice; if our catalogue drifts, we mis-charge buyers (over- or under-bill) and the §14.10 invariant breaks for any order spanning a rate change.
- **Data scarcity blocks accurate catalogue.** Today we have one bKash data point. To populate the catalogue honestly we need at least one clean observation per method × at least one second-data-point per method for verification. That's a ~5-method × 2-observation = 10-transaction production smoke campaign, gated on EPS prod credentials.
- **Order-creation flow change.** Moving FinancialEntity into order creation requires a multi-step rework of the checkout flow OR a placeholder-and-correct pattern that complicates §14.10 invariant verification.
- **Operational ongoing burden.** First payment platform to charge organisers fees correctly across all methods — every new method EPS adds requires a catalogue update.

### Suitability for June 10 launch

**Low.** Catalogue can't be honestly populated by June 10; flow change is a multi-day rework. Realistic landing: post-launch hardening (Phase 2 Sprint 6+).

---

## 4. Option 2 — Single-rate calculator, platform absorbs variance

### Mechanism

Keep the calculator's `epsFeeBps` as a single number. **Tune it conservatively** — somewhere between the observed 1.7% MFS and the (unconfirmed) 2.5% card. Platform absorbs the difference between what we charged (single rate) and what EPS actually took (real rate per method) at settlement time. `disbursement_batch.eps_fee_paisa` is what we charged; the EPS settlement-report import (Phase 2 Sprint 7) reconciles to actual and the difference becomes platform revenue (positive — buyer paid MFS rate; we billed at card rate) or platform cost (negative — buyer paid card rate; we billed at MFS rate).

### What changes

- `apps/api/src/domain/payments/fee-calculator.ts`: ~1-line change — update the `epsFeeBps` default (and document the conservative-choice rationale). Existing unit tests remain valid with one numeric update.
- Settlement engine (§14.5, Phase 2 Sprint 7) gains a "variance reconciliation" step: actual EPS-charged vs platform-charged → platform revenue line OR platform cost line.
- Organiser-facing fee display: shows the single rate everywhere. Honest framing in /pricing marketing page: "Payment processing fee — typically X%, varies by buyer's payment method; Event Pulse absorbs the variance so organisers see a predictable rate."
- `events.eps_fee_handling` semantics unchanged.

### Risks

- **Buyer over-charge in pass-through Mode A/C.** If single rate is set above the actual rate (e.g., 2.2% chosen, buyer pays via bKash at 1.7%), the buyer is charged 50bp more than EPS took. Platform pockets the difference. Legal/optics risk: the §22 marketing pricing transparency promise becomes harder to defend if regulators ask "what did EPS actually charge."
- **Organiser under-payment in absorb Mode B/D.** If single rate is set below actual (e.g., 2.2% chosen, buyer pays via card at 2.5%), platform absorbs the 30bp difference per transaction. At BDT 1000 face × 1000 transactions = BDT 3,000 platform cost. Bearable at MVP scale; meaningful at scale.
- **Rate choice is a one-way door for snapshotted orders.** Per Day-33 Choice A, orders snapshot `platform_fee_bps` + `eps_fee_paisa` at creation. Changing the single rate later only affects future orders; existing orders carry the old rate snapshot. Trade-off: predictable post-launch behaviour OR a coordinated migration to a different model later.
- **No live data informs the rate choice.** We pick a value based on the one bKash observation + the published 2.5% card rate (which we have not empirically confirmed).

### Suitability for June 10 launch

**HIGH.** ~30 minutes of code. Existing flow unchanged. Most code-conservative. The variance-reconciliation can land post-launch in Sprint 7. The pricing-page transparency claim has to be honest about variance — but that's defensible.

---

## 5. Option 3 — Single-method launch (bKash only, or card only)

### Mechanism

Restrict the EPS payment-method options offered to buyers to a single method for the launch period. Calculator's single `epsFeeBps` is then _exactly_ that method's rate (empirically confirmed for bKash via the truth-gate; for card the rate is unconfirmed and a card-only launch requires its own truth-gate). All buyers transact via the chosen method; rate prediction matches reality exactly.

### What changes

- `apps/api/src/infra/eps/initialise-order.ts`: pass an EPS init parameter restricting the buyer's selectable methods (EPS supports this per the V5 integration guide's `RestrictedFinancialEntities` field or similar — confirm wire support before committing).
- Calculator unchanged at the code level; the chosen rate becomes the only rate.
- Marketing /pricing page: explicit single-method statement ("We accept bKash payments at launch; cards and other methods coming soon").
- Buyer-form UI: no payment-method picker (EPS hosted checkout still owns the flow but the restricted-method list is single-value).
- Phase 2 work item: lift the restriction by adopting Option 1 or Option 4 once a per-method catalogue or StoreAmount-source-of-truth model lands.

### Risks

- **Commercial restriction.** Card buyers cannot transact. For Bangladesh ticketing, card may be a non-trivial share — wedding tickets, corporate conferences, premium events skew higher-card. If first paying tenant's audience is card-heavy, launch revenue is lower than it could be.
- **Marketing positioning.** "We launched with one payment method" is a defensible-but-not-ideal first impression. Pricing page transparency is genuine ("we wanted to be right before being broad") — but competitor benchmarks (Eventbrite, Sajek-bd) accept all methods.
- **Wire-level support unverified.** Need to confirm EPS supports restricted-method initialization in V5; if it does not, this option requires a manual policy enforcement at the buyer-UI level which is weaker (someone could still pay via the EPS page's other options).
- **Single-method choice itself is a sub-decision.** bKash (empirically confirmed rate, broad consumer reach, MFS-heavy BD audience) vs card (unconfirmed rate but covers corporate buyers + diaspora) — different commercial profiles.

### Suitability for June 10 launch

**MEDIUM.** Technically the simplest commercially — but the commercial restriction may not fit the first paying tenant's audience. **Cannot decide without knowing who the first paying tenant is** (operator-action #4 from today's queue).

---

## 6. Option 4 — StoreAmount-as-source-of-truth (operator-recommended in Day 37 prompt)

### Mechanism

Treat the calculator's `epsFeeBps` as a **display estimate** only — used to render the buyer's "Payment fee: ~X BDT" line up-front during checkout for transparency. At Verify time, the EPS Verify response publishes the actual `StoreAmount` (what EPS will settle to the merchant); the difference `TotalAmount − StoreAmount` is the true EPS fee. The order's `eps_fee_paisa` is updated post-Verify to reflect reality. The settlement engine reads from this corrected post-Verify value, not from the calculator's up-front estimate. `disbursement_batch` honors the actual EPS fee.

This sidesteps having to model per-method rate cards entirely. It matches reality on every single transaction. It is robust to EPS rate changes without code changes — when EPS shifts MFS rates from 1.7% to 1.5%, every transaction post-shift reflects the new rate; no catalogue update; no platform absorb-variance.

### What changes

- `apps/api/src/domain/payments/fee-calculator.ts`: minor — calculator output for `epsFeePaisa` is explicitly labelled "estimate" in the function's contract. The single-rate value is kept as the estimate basis. The unit tests retain their existing assertions but the function's responsibility narrows from "this is the EPS fee" to "this is the EPS fee estimate for display."
- `apps/api/src/domain/payments/verify-order-callback.ts` (or wherever Verify-response handling lives): new step that reads `StoreAmount` from the V4/V5 response (per PR #219 + #223 schema support) and computes `actual_eps_fee_paisa = TotalAmount − StoreAmount`. **Updates the `orders` row** with this actual value, preserving the snapshotted estimate alongside for audit.
- New column required on `orders`: `eps_fee_estimated_paisa bigint NOT NULL` (snapshotted at order creation, what calculator predicted) + `eps_fee_actual_paisa bigint NULL` (filled in post-Verify; null until Verify completes). Migration adds the column; `eps_fee_paisa` either stays as a settlement-time computed view OR becomes the actual value.
- §14.10 Invariant-1 enforcement is per-row using the _actual_ fee post-Verify; the _estimated_ fee value is for display/audit only.
- Buyer-facing checkout: shows the estimate up-front ("Estimated payment fee: BDT 17.47") with a small disclosure ("actual fee determined by your payment method"). On the post-payment confirmation page, shows the actual fee.
- Organiser-facing fee display: real-money columns read from `eps_fee_actual_paisa`; the estimate is shown as a reconciliation column or in a tooltip explaining the variance.
- Settlement engine (Phase 2 Sprint 7) is materially simpler — no variance reconciliation step needed; the actual EPS fee was already recorded at Verify time.
- V5 production fallback path matters here: if V5 production _does not_ publish StoreAmount, the estimate becomes the actual (or a Day-N production-smoke surfaces a different reconciliation strategy). Per PR #223, the V5 schema accepts StoreAmount optionally with documented fallback to `(TotalAmount − subtotal)` derivation; the post-Verify update step must handle both cases gracefully.

### Risks

- **Code change is larger than Option 2.** New `orders` column + migration + post-Verify update path + dashboard column changes. Realistically a 2-day implementation, not a 30-minute one.
- **V5 StoreAmount publishing is unconfirmed — stranded-investment risk if the smoke goes wrong.** If V5 production does not publish StoreAmount, Option 4's mechanism collapses to the calculator's estimate (= Option 2 with extra steps) **AND** the ~2 days of column-migration / Verify-update-path / dashboard-reconciliation work is sunk **AND** the fee-model decision is reopened post-smoke (the chosen mechanism failed empirically; back to Options 1/2/3). The `eps_fee_estimated_paisa` + `eps_fee_actual_paisa` migration is **harder to undo than to defer** — rolling back a shipped migration with live orders is a multi-step process (column rename / drop / data backfill / dashboard column reversion), while rolling forward to Option 2 from no-migration is a ~30-minute change. **Sequencing implication: commit Option 4 only if the production smoke confirms StoreAmount; until then, the safer ordering is smoke-first, decision-second.** This is the dominant practical risk against committing to Option 4 in the Day-38 decision.
- **Buyer UX disclosure of "estimated fee."** Buyers are used to seeing fixed prices at checkout. "Estimated" introduces uncertainty. Phrasing matters; legal/comms input recommended for the on-page copy. (BUT this is also the most honest framing — buyer pays the actual rate EPS charges, not what we model.)
- **Implicit coupling to the §26.1 Day 7-8 refund flow — Option 4 is NOT "fee-model change only."** The refund flow already on the June 10 critical path (tenant initiates → super admin approves → manual EPS dashboard execution) **changes shape under Option 4**: refunds compute against `eps_fee_actual_paisa` not `eps_fee_estimated_paisa`; the refund-amount calculation needs to know whether Verify has run (post-Verify → use actual; pre-Verify → fall back to estimate); the manual-EPS-dashboard step must surface the actual fee to the super admin so the refund amount matches what EPS holds. Plus: EPS's own refund API behaviour with respect to settled-vs-pending captures may matter and needs a spike. Concretely: **the Day 7-8 refund-flow PR cannot be authored independently of the Option 4 decision** — they ship together or in immediate sequence, and the Day-38 decision implicitly commits to a Day-7-8 refund-flow shape. Sequencing matters because Day 7-8 is already on the June 10 critical path; choosing Option 4 means the refund-flow PR's design is gated on the migration column work landing first.
- **§14.10 invariant must be updated** to be "computed against actual fee where Verify has run; against estimate otherwise" — adds a per-row state distinction that complicates the invariant checker.

### Suitability for June 10 launch

**MEDIUM-HIGH** if V5 production publishes StoreAmount (per the V5 integration guide's near-V4-shape framing this is likely). Production smoke (step [6]) is the gate. Implementation is 2-3 buildable workdays + migration + dashboard updates; within the June 10 runway if it starts Day 38. **This is the architecturally cleanest answer.**

---

## 7. Decision matrix — at-a-glance

| Dimension                               |                                           Option 1 Per-method                                           |                                        Option 2 Single-rate-absorb                                        |                                                                Option 3 Single-method                                                                |                                          Option 4 StoreAmount-source                                          |
| --------------------------------------- | :-----------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------: |
| Matches EPS reality                     |                                                   ✅                                                    |                                          ❌ (variance absorbed)                                           |                                                                 ✅ for chosen method                                                                 |                                                      ✅                                                       |
| Honest with buyer                       |                                                   ✅                                                    |                                           ⚠️ (variance hidden)                                            |                                                                          ✅                                                                          |                                                      ✅                                                       |
| Robust to EPS rate changes              |                                          ❌ (catalogue stale)                                           |                                             ⚠️ (must retune)                                              |                                                                   ⚠️ (per method)                                                                    |                                                      ✅                                                       |
| Robust to data scarcity                 |                                        ❌ (needs catalogue data)                                        |                                                    ✅                                                     |                                                             ⚠️ (single method confirmed)                                                             |                                                      ✅                                                       |
| Implementation effort (one-time)        |                                             High (~1 week)                                              |                                             Trivial (~30 min)                                             |                                                                   Low (~half day)                                                                    |                                              Medium (~2-3 days)                                               |
| Operational complexity (ongoing burden) | HIGH — catalogue freshness; every new EPS method/rate change = catalogue update or platform mis-charges | MEDIUM — settlement-batch variance reconciliation each cycle; platform absorbs/captures variance silently | MEDIUM — single-method monitoring; lift-pressure as commercial profile widens; commercial-restriction trade-off lives forever until Option 1/4 lands | LOW — post-Verify update path is fully automated; EPS rate shifts reflect automatically with zero code change |
| Suits June 10 launch                    |                                                 ❌ Low                                                  |                                                  ✅ High                                                  |                                                                 ⚠️ Depends on tenant                                                                 |                                       ✅ Medium-High (subject to smoke)                                       |
| Carries to Phase 2                      |                                                   ✅                                                    |                                           ⚠️ (likely replaces)                                            |                                                                    ❌ (must lift)                                                                    |                                                      ✅                                                       |
| §14.10 invariant complexity             |                                                  High                                                   |                                                    Low                                                    |                                                                         Low                                                                          |                                                    Medium                                                     |

---

## 8. What to decide overnight

The operator should weigh:

1. **Risk tolerance on variance:** Option 2 means the platform absorbs/captures variance silently. Option 4 means the platform reports actual every time. Option 4 is more transparent; Option 2 is simpler.
2. **First paying tenant's payment-method profile:** if known and overwhelmingly bKash → Option 3 viable. If unknown or mixed → Options 2 or 4.
3. **June 10 runway:** Option 2 ships today/tomorrow; Option 4 ships Days 38-40; Option 1 doesn't ship in time; Option 3 ships in a day but requires EPS wire-support confirmation.
4. **Long-term architecture:** Options 1 and 4 are durable; Option 2 likely needs replacement in Phase 2; Option 3 must lift before broad availability.

The operator-recommended Option 4 is the architecturally cleanest answer **if the V5 production smoke confirms StoreAmount publishing**. Production-smoke gate (step [6]) is the prerequisite to commit to Option 4 hardest.

**A hybrid commitment is on the table — Option 2 at launch + Option 4 by Sprint 7 close as a COMMITTED DELIVERABLE, not a "we'll revisit."** Specifically:

- **Launch (Day 38 → June 10):** Option 2 (single-rate-absorb) ships as the calculator's behaviour. ~30 minutes of code; existing flow unchanged; June 10 launch is unblocked the moment this decision lands and Phase 6 executes.
- **Sprint 7 (per §26.2 Phase 2 plan — "Automated T+5 disbursement cron + EPS settlement reconciliation importer + bKash B2C/Nagad/Rocket adapters"):** Option 4 migration is **added as a Sprint 7 acceptance criterion**, not a Sprint 7 wish. The sprint's deliverable list expands to include: (a) `orders.eps_fee_estimated_paisa` + `eps_fee_actual_paisa` schema migration; (b) post-Verify update path reading `StoreAmount` per the V5 schema PR #223; (c) dashboard reconciliation columns surfacing estimate vs actual; (d) refund-flow update to read actual-not-estimate; (e) §14.10 invariant updated for the dual-state per-row distinction. Sprint 7's existing scope (settlement engine + reconciliation importer) **overlaps materially** with the Option 4 mechanism (both read EPS's authoritative settlement number on every transaction) so the marginal cost is lower in Sprint 7 than as a standalone PR.
- **Sprint-7 close acceptance gate:** Option 4 is live in production OR the V5 production smoke (which by Sprint 7 has run multiple times) has empirically shown StoreAmount absence, at which point the hybrid commitment escalates to a fresh Options 1/2/3 re-evaluation. Not "indefinite Option 2."

The June 10 launch is on Option 2 **with FULL knowledge that Option 2 is a transitional choice.** This gets the simplest path to June 10 AND books the cleanest long-term answer with a fixed sprint target — not a `// TODO: revisit fee model` in the calculator that quietly never lands.

---

## 9. Decision recording

When the operator decides, append a new top entry to `.claude/memory/decisions.md` in the standard format:

```markdown
## 2026-06-01 · EPS fee-model structural decision — [Option N name] CHOSEN

**Context:** Resolves the active launch-gate item per `decisions.md` 2026-05-30 (Decision N) + the audit's critical-path step [1].

**Decision:** [Option N — short label]. [3-5 sentence rationale citing this document's section.]

**Consequences:**

- HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts` lifts. Implementation goes through Phase 6 (small focused PR; STOP-ASK before money-math PR lands).
- [Specific implementation steps per the chosen option's "What changes" section.]
- [Risk mitigations adopted from the chosen option's "Risks" section.]

**Cross-references:**

- `docs/decisions/fee-model.md` (this document).
- `decisions.md` 2026-05-30 (Phase 1.4 truth-gate empirical findings).
- `decisions.md` 2026-05-31 Day 37 (audit reconciliation + June 10 target).
```

Then trigger the next session with the operator decision recorded, and Claude Code executes Phase 6 (implement the chosen option) per the handoff.md FIRST-THING-NEXT-SESSION sequence.

---

_Generated 2026-05-31 EOD (Day 37) per Day 37 prompt Phase 4. No decision made in this generation; surface only. STAGING_PAYMENT_BLOCK=1 enforcing throughout._
