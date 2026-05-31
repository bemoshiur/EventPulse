# Production smoke — BDT 100 bKash confirmation

> **Status:** runbook. Created Day 38 Phase 4 (2026-05-31). The BDT-100 production smoke transaction is critical-path step [6] for the June 10 launch. **Until this smoke confirms bKash production rate matches the calculator's 175 bps assumption, no first paying tenant onboards.**
>
> **Purpose (load-bearing post-Option-3):** confirm the EPS production gateway charges bKash at the same rate the sandbox truth-gate observed (1.747% on face → 175 bps rounded). The Phase 1 PR (`8afb079`) shipped `DEFAULT_EPS_FEE_BPS_ESTIMATE = 175`; if production charges differently for bKash, the calculator value MUST be updated before first paying tenant onboards.

## Cross-references

- `.claude/memory/decisions.md` 2026-05-31 "EPS fee-model structural decision — Option 3 (single-method launch, bKash-only for v1.0) CHOSEN" — the canonical decision this smoke confirms
- `.claude/memory/decisions.md` 2026-05-30 Phase 1.4 truth-gate empirical findings — sandbox Mode A bKash observation table
- `.claude/memory/decisions.md` 2026-05-19 "Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate" — the calculator-vs-empirical pattern this smoke follows
- CLAUDE.md §11.0 — `STAGING_PAYMENT_BLOCK=1` enforcement + the lift discipline this smoke uses
- CLAUDE.md §14.2 — fee-mode worked examples (Mode A = both pass-through, the smoke transaction's mode)
- PR #227 — Phase 1 (`DEFAULT_EPS_FEE_BPS_ESTIMATE` 250 → 175)
- PR #228 — Phase 2a (Verify-guard rejection of non-bKash methods)

## Hard preconditions (gate before running)

The smoke session does NOT start until ALL of the following are true:

1. **EPS production credentials received from EPS** — full set: `merchant_id`, `store_id`, `username`, `password`, `hash_key`. Operator-action #1 from Day 37 handoff (queued today; clock pending).
2. **Production credentials loaded into AWS Secrets Manager** at `eventpulse/prod/eps` — JSON-shaped per CLAUDE.md §11.3.
3. **Production EC2 + Nginx + DNS + wildcard cert** in place. Critical-path step [14] sub-tasks complete.
4. **`prod` branch ff-merged from `main`** to the current production-ready SHA (Day 37 Gap 4: prod branch at `21dad2c`; main at the to-be-merged SHA when smoke session starts).
5. **EPS_MODE=production** confirmed on the production EC2's pm2 api process env.
6. **Operator on-call** for the entire smoke session (sub-30-min window) — this is the highest-risk operation in the launch runway.
7. **A reversal path is pre-arranged** — operator has the EPS merchant dashboard open, refund authority confirmed, and a one-step path to refund the BDT 100 if the smoke confirms the rate but reveals any other issue.

If ANY of the preconditions is FALSE, the smoke session does NOT start. Document the missing precondition in `decisions.md` as a deferred-smoke entry; the session reschedules.

## The smoke transaction

A single BDT 100 face-value real-money transaction through the production EPS gateway using bKash as the payment method. The buyer is the operator (or an authorised tester); the order is for an internal "smoke event" not visible to public discovery; payment is real money real bKash. The settlement is captured + immediately refunded via the EPS merchant dashboard.

### Smoke transaction parameters

| Parameter                     | Value                                                                          | Why                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subtotal                      | BDT 100.00 (10,000 paisa)                                                      | Smallest credible non-trivial amount; predicted EPS fee at 175 bps on capture base is BDT 1.79 (179 paisa, see Calculator prediction row) — close to the integer-paisa floor where the rate matters most                                                                                                                   |
| Fee mode                      | (PT, PT) — both pass-through (Mode A)                                          | Most informative for organiser-facing rate display per §14.2; matches the Phase 1.4 sandbox truth-gate's only fully-clean observation                                                                                                                                                                                      |
| Payment method                | **bKash only** — operator's personal bKash account                             | The whole point. Any other method invalidates the smoke (and now also triggers the Phase 2a Verify-guard, sending the order to disputed)                                                                                                                                                                                   |
| Internal "smoke event" tenant | A dedicated `eventpulse-smoke` tenant or the operator's personal tenant        | Order rows persist; not surfaced to discovery; cleanly auditable                                                                                                                                                                                                                                                           |
| `STAGING_PAYMENT_BLOCK` lift  | **Yes — production only, session-scoped**                                      | Per CLAUDE.md §11.0: the only authorised lift; re-enabled immediately after smoke completes                                                                                                                                                                                                                                |
| Calculator prediction         | EPS fee BDT 1.79 (179 paisa); buyer total BDT 102.04; organiser net BDT 100.00 | At Mode A (both PT): subtotal 10,000 paisa + platform fee 25 paisa (0.25% × 10,000) = capture base 10,250 paisa. EPS fee at 175 bps on capture base: 175 × 10,250 / 10,000 = 179.375 → floor 179 paisa = BDT 1.79. Buyer total = 10,000 + 25 + 179 = 10,204 paisa = BDT 102.04. Organiser net = 10,000 paisa = BDT 100.00. |

### Expected EPS Verify response shape

Captured for diff against the Phase 1.4 sandbox observation (`decisions.md` 2026-05-30 empirical findings table). The smoke confirms whether production behaves identically:

```json
{
  "Status": "SUCCESS",
  "FinancialEntity": "bKash",
  "TotalAmount": "102.04",
  "StoreAmount": "<production-reported>",
  "EPSTransactionId": "<eps-internal>"
}
```

**The TWO numbers that matter:**

1. **`TotalAmount`** — what EPS captured from the buyer. Must equal the calculator's predicted buyer total (BDT 102.04). A divergence here means the calculator's bps applies to a different capture base than we model; revisit §14.2.

2. **`StoreAmount`** — what EPS will settle to merchant (= `TotalAmount` − EPS gateway fee). The DERIVED value `(TotalAmount − StoreAmount)` is the actual EPS fee. Compare to the calculator's predicted EPS fee (BDT 1.79).

### Derived rate calculation

```
observed_eps_fee_paisa = parse(TotalAmount) − parse(StoreAmount)
observed_rate_on_face_pct = observed_eps_fee_paisa × 100 / 10_000   (i.e., divided by face)
observed_rate_on_capture_pct = observed_eps_fee_paisa × 100 / parse(TotalAmount)
```

**Sandbox Phase 1.4 Mode A bKash observed:** 1.747% on face. If production observes within ± 0.05% of this (i.e. observed_rate_on_face_pct ∈ [1.697%, 1.797%]), the calculator's 175 bps assumption is confirmed.

### Decision rules at the smoke

| Observation                                                                     | Action                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observed_rate_on_face_pct` ∈ [1.697%, 1.797%] AND `FinancialEntity` == "bKash" | **CONFIRMED.** Document in `decisions.md` as a smoke-confirmation entry. Refund the smoke transaction via EPS dashboard. Re-enable `STAGING_PAYMENT_BLOCK=1`. First paying tenant onboarding clear to proceed.                                                                                                                                                                                 |
| `observed_rate_on_face_pct` outside the band but within ± 0.50%                 | **CALCULATOR UPDATE REQUIRED.** Update `DEFAULT_EPS_FEE_BPS_ESTIMATE` to the new closest-bps value (e.g. 170 / 175 / 180). Document in `decisions.md`. Refund the smoke. **Re-smoke after the calculator change ships** (cannot ship the change against the existing smoke observation; a new smoke is required to confirm the new value). Re-enable `STAGING_PAYMENT_BLOCK=1` between smokes. |
| `observed_rate_on_face_pct` differs by > 0.50% from sandbox                     | **STOP. INVESTIGATE.** Something structural differs between sandbox and production. Do not update the calculator until the root cause is understood (could be different fee tier for the operator's bKash account, different gateway routing in production, etc.). Refund the smoke. Re-enable `STAGING_PAYMENT_BLOCK=1`. **No first paying tenant onboards until resolved.**                  |
| `FinancialEntity` is anything other than "bKash"                                | **CRITICAL FAILURE.** The operator's payment method on the EPS hosted page did not register as bKash. The Phase 2a Verify-guard will divert the smoke order to `disputed`. Refund the smoke. Re-run with explicit attention to which method is selected on EPS's hosted page. Phase 2a guard is working as intended; the smoke procedure needs adjustment.                                     |
| HTTP error / EPS Verify schema-validation fails / EPS returns Failed            | **STOP. INVESTIGATE.** Could be network, credential, schema, or production-EPS-bug. Do not proceed to first paying tenant onboarding. Document the failure mode in `gotchas.md`. Refund any captured amount via EPS dashboard. Re-enable `STAGING_PAYMENT_BLOCK=1`.                                                                                                                            |

## Step-by-step procedure

### 1. Lift `STAGING_PAYMENT_BLOCK` for the smoke session

Operator records the lift in `decisions.md` BEFORE flipping the env:

```markdown
## YYYY-MM-DD · STAGING_PAYMENT_BLOCK lifted for production bKash smoke (session ID: <UUID>)

**Context:** BDT-100 production bKash smoke session per docs/runbooks/production-smoke.md.
Critical-path step [6] for the June 10 launch.

**Decision:** Lift STAGING_PAYMENT_BLOCK from production EC2 pm2 api env for the smoke
session duration. Re-enabled immediately after smoke completes per CLAUDE.md §11.0.

**Consequences:**

- Production EPS Initialise calls will fire for any order created during the lift window.
- Operator MUST NOT create any other order on the platform during this window.
- Re-enablement is the final step of the smoke procedure; not optional.
```

Then flip the env on the production EC2:

```bash
aws ssm send-command --profile eventpulse \
  --instance-ids <PROD-INSTANCE-ID> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u eventpulse pm2 set STAGING_PAYMENT_BLOCK 0 && sudo -u eventpulse pm2 reload api"]'
```

Verify: `sudo -u eventpulse pm2 env <api-id> | grep STAGING_PAYMENT_BLOCK` returns `STAGING_PAYMENT_BLOCK: 0`.

### 2. Create the smoke event + tier

On the production tenant portal (operator-authenticated as the smoke tenant):

- Create event "Production smoke — DO NOT BUY" (or similar; visibility=private)
- Add one ticket tier: name "Smoke", price BDT 100.00 (= 10,000 paisa)
- Capacity 1
- Mode: organiser portal sets event-level `platform_fee_handling: pass_through` + `eps_fee_handling: pass_through` (Mode A)
- Publish

### 3. Create the order + initiate EPS

Via the smoke event's public URL (operator browsing as buyer):

- Add tier qty = 1
- Buyer info: operator's name + email + phone
- Click "Continue with bKash" (Phase 3 honest copy)
- Expect: redirect to EPS hosted checkout

### 4. Complete the bKash payment on EPS's hosted page

- On EPS's hosted page, **explicitly select bKash** (do not let any other method auto-select).
- Use the operator's personal bKash to pay BDT 102.04.
- After payment, EPS redirects to `/api/v1/public/orders/eps-return/success` on the production API which calls `settleOrderFromEps` which Verifies + transitions the order.
- Expect: redirect to `/orders/return/success` (paid path).

### 5. Capture the production Verify response

The settle service logs the verify response at `eps.verify.ok` per `verify-order.ts`. Pull the structured log:

```bash
aws ssm send-command --profile eventpulse \
  --instance-ids <PROD-INSTANCE-ID> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u eventpulse tail -200 /home/eventpulse/logs/api.log | grep eps.verify.ok | tail -3"]'
```

Or query CloudWatch Logs at `/eventpulse/prod/api` with filter `eps.verify.ok`.

Extract the verify response body. Record:

- `Status`
- `FinancialEntity` (must be "bKash")
- `TotalAmount` (parsed paisa)
- `StoreAmount` (parsed paisa)
- `observed_eps_fee_paisa` = TotalAmount − StoreAmount
- `observed_rate_on_face_pct` = observed_eps_fee_paisa × 100 / 10000

### 6. Apply the decision rules from the table above

Pick the matching row. Execute the prescribed action.

### 7. Refund the BDT 100 + 1.79

Via the EPS merchant dashboard:

- Locate the smoke transaction by `merchantTransactionId`
- Initiate a full refund (BDT 102.04 — the buyer's captured amount)
- Confirm refund processing (typically 5 business days)

Operator's personal bKash receives the refund.

### 8. Re-enable `STAGING_PAYMENT_BLOCK=1`

```bash
aws ssm send-command --profile eventpulse \
  --instance-ids <PROD-INSTANCE-ID> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u eventpulse pm2 set STAGING_PAYMENT_BLOCK 1 && sudo -u eventpulse pm2 reload api"]'
```

Verify: `sudo -u eventpulse pm2 env <api-id> | grep STAGING_PAYMENT_BLOCK` returns `STAGING_PAYMENT_BLOCK: 1`.

### 9. Record the smoke result in `decisions.md`

```markdown
## YYYY-MM-DD · Production bKash smoke COMPLETE — rate <CONFIRMED|UPDATED|REJECTED>

**Context:** BDT-100 production bKash smoke per docs/runbooks/production-smoke.md.
Critical-path step [6] for the June 10 launch.

**Observations:**

- merchantTransactionId: <id>
- FinancialEntity: bKash
- TotalAmount: <paisa>
- StoreAmount: <paisa>
- observed_eps_fee: <paisa> (BDT <decimal>)
- observed_rate_on_face: <%>
- sandbox reference (Phase 1.4 Mode A bKash): 1.747% on face / 175 bps

**Decision:**

- [CONFIRMED case] Calculator's DEFAULT_EPS_FEE_BPS_ESTIMATE (175 bps) honored. First paying tenant onboarding cleared.
- [UPDATED case] Calculator update required: 175 → <new>. Re-smoke after the calculator-change PR ships.
- [REJECTED case] Production rate divergence > 0.50% vs sandbox. Investigation required before first paying tenant onboarding.

**Consequences:**

- STAGING_PAYMENT_BLOCK=1 re-enabled at <timestamp>.
- Smoke transaction refunded via EPS merchant dashboard at <timestamp> (refund settles ~5 business days).
- [next-action — varies by decision row above]

**Cross-references:**

- docs/runbooks/production-smoke.md (this runbook).
- decisions.md 2026-05-31 "EPS fee-model structural decision — Option 3 CHOSEN".
- decisions.md 2026-05-30 Phase 1.4 truth-gate empirical findings.
```

## Post-smoke gates (before first paying tenant)

If the smoke confirmed (CONFIRMED case in step 6):

1. `STAGING_PAYMENT_BLOCK=1` re-enabled on production (verified)
2. Smoke decision recorded in `decisions.md`
3. First paying tenant's onboarding can proceed:
   - Tenant onboarding flow → KYC → publish event → real buyer purchase
   - Phase 2a Verify-guard active throughout (any non-bKash buyer goes to `disputed`)
   - Phase 3 honest UI copy active throughout (buyers see bKash-only framing before checkout)
4. Operator stays on-call for the first paying tenant's first sale window

If the smoke required CALCULATOR UPDATE (step 6):

1. Calculator-update PR opens with the new bps value
2. PR title: `fix(fees): default EPS bps 175 → <new> after production bKash smoke confirmation`
3. CI green → merge → deploy
4. Re-run smoke per this runbook from step 1
5. Repeat until CONFIRMED case

If the smoke STOPPED for investigation (step 6):

1. `STAGING_PAYMENT_BLOCK=1` re-enabled (verified)
2. Refund completed (verified — buyer's bKash account refunded)
3. Investigation captured in `gotchas.md` with full Verify response + observed-vs-predicted detail
4. NO first paying tenant onboarding until root cause is understood
5. Re-smoke after fix lands

## Post-launch evolution

Each new payment method (card / Nagad / Rocket / Upay / bank-transfer) joining the catalogue post-launch requires its OWN smoke against the same procedure with the new method substituted for bKash. The calculator's per-method rate (whether stored in a catalogue per Option 1, derived from StoreAmount per Option 4, or kept as a single-rate-with-absorbed-variance per Option 2) lands AFTER that method's smoke confirms its production rate. Same discipline as v1.0 bKash; per `decisions.md` 2026-05-31 Option 3 entry's implication (d).

## Document but do NOT run this session

Per Day 38 Phase 4 prompt: this runbook is documentation only. The smoke is its own gated session (Day 39+, subject to EPS prod-credential arrival per operator-action #1).

The runbook MUST be reviewed by the operator before the smoke session opens; any precondition or step that needs adjustment should land as a follow-up doc PR before the smoke runs.
