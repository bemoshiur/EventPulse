# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-31 — Sprint 4 Day 37; **SES production access GRANTED (AWS case 177899559700777, ap-southeast-1) — launch gate now 1 active blocker (EPS fee-model decision + production smoke).**
**Driver:** Claude Code (Opus 4.7).

## 🆕 LAUNCH-GATE MOVE TODAY (2026-05-31)

**SES out-of-sandbox APPROVED in ap-southeast-1.** AWS Support case **177899559700777**. Send-to-full-audience capability now available. **The launch gate dropped 2 → 1.** Full entry in `decisions.md` 2026-05-31 (top).

- ~~SES out-of-sandbox approval~~ ✅ **RESOLVED 2026-05-31** (this move).
- **EPS fee-model structural decision + production smoke** — the active launch-gate item now (Options 1/2/3/4 in decisions.md 2026-05-30; operator-only decision).

**Loose ends (low priority, NOT gating launch):** Counsel docs 4-8 bodies — Buyer Terms remains the load-bearing one for unblocking the buyer-form checkout-consent UI per the Day-34 link-footer pattern; rest of counsel follow-ups are forward-progress not gating.

## 🚨 NEW PRE-LAUNCH COMMITMENT (gates the env flip, NOT the SES blocker)

**SNS bounce/complaint → suppression-list wiring MUST exist BEFORE flipping `MAIL_DRY_RUN=0`.** Promised verbatim to AWS in the case reply ("will be fully active before we begin production sending"). The SES blocker is resolved; **the env flip has a separate gate of our own making**. Required scope before flip:

1. SES bounce + complaint SNS topics (separate per type, per AWS pattern).
2. Webhook handlers at `apps/api/src/routes/webhooks/ses-bounce.ts` + `ses-complaint.ts` (CLAUDE.md §10.5 already lists these as planned). Signature-verify → SQS enqueue → worker process (per R9).
3. Global suppression list (Postgres) — bounce/complaint → permanent suppression for hard bounces + complaints; exponential-backoff retry cap → promotion to hard for soft bounces.
4. Outbound email service checks suppression list BEFORE attempting send. Suppressed → noop + audit log (no SES API call). Notification log status: `bounced`/`failed` per AWS-classified reason.

**Why non-negotiable:** AWS revokes SES access on bounce rate >5% or complaint rate >0.1%; we promised a working pipeline before producing real volume.

## ⚠️ TL;DR — Phase 1.4 truth-gate context (carries from 2026-05-30)

- **The truth-gate work that has been carried since Day 24-25 is essentially DONE on the sandbox side.** All 4 §14.2 scenarios paid on EPS sandbox; pure eps_fee derived per mode via the StoreAmount-based mode-agnostic rule; §14.10 Invariant-1 PASS across all 4. Full empirical table is in `decisions.md` 2026-05-30 entry.
- **Fee-model structural decision PENDING.** EPS empirically charges ≈1.7000% on TotalAmount across both MFS providers tested (bKash + Nagad). Calculator models 2.5% (card-rate). The mismatch is real — Options 1/2/3/4 in decisions.md await operator decision NEXT SESSION. Do NOT touch `apps/api/src/domain/payments/fee-calculator.ts` until that decision lands.
- **One small follow-up PR ready to ship** (offered, awaiting approval): V5 production response schema extension for the 3 additive fields per EPS V5 integration guide — `EpsTransactionId` (string, optional), `PaymentReferance` (string, optional; NOTE the EPS typo — verbatim spelling), `StoreAmount` (string, optional with fallback to `TotalAmount − subtotal` derivation + clear runtime log line indicating which path is active). This is the final wire-shape work before production smoke; it does not touch fee-calculator.ts.

## ⚠️ Major state change (2026-05-30)

**V5 production wire shape confirmed near-identical to V4 sandbox** per uploaded EPS V5 integration guide. The four "V4-vs-V5 divergences" feared during the wire-protocol abstraction (PR #218) are **not divergent in production**. The pluggable `EpsWireProtocol` pattern remains valuable for schema variance (V4-vs-V5 additive fields), but the body shape + endpoints + hash mechanism + response envelope are essentially V4 in V5 too. Production smoke complexity drops materially.

Single unresolved empirical question for V5 production: **whether V5 publishes `StoreAmount`**. Doc example is minimal (also missing the documented `EpsTransactionId`), so doc-absence is non-determinative. Make schema optional in both V4 + V5; if present → mode-agnostic eps_fee derivation; if absent → fall back to `(TotalAmount − subtotal)` with a runtime log line. Production smoke (BDT 100, one transaction) will empirically confirm.

## ⚠️ FIRST THING NEXT SESSION

1. **Fee-model structural decision** (per decisions.md 2026-05-30 entry — Options 1/2/3/4). Operator-only decision; the data is in memory; no auto-derivation. Surface the options + the empirical table at session start; wait for choice; then execute whatever the choice implies (no code action until then).
2. **Offer the V5-tolerant additive-field follow-up PR** (3 fields, schema-only, ~30 lines + tests). Worth shipping BEFORE the production smoke regardless of which fee-model option lands. Standalone — doesn't depend on the fee-model decision.
3. **Surface the SNS bounce/complaint suppression-list scope as a buildable Sprint 4 work-item** (decisions.md 2026-05-31). Gates the eventual `MAIL_DRY_RUN=0` flip, not the SES blocker itself. Sequenceable in parallel with #1/#2.

## ⚠️ Today's deliverables

- **PR #218** `2882d9c` — V4 sandbox wire-protocol pluggable abstraction. Production V5 byte-shape untouched; sandbox V4 ships CustomerOrderId + 17 mandatory fields + GET Verify + PascalCase response schemas + BDT-decimal string-manipulation parser. 339 EPS tests (was 295).
- **PR #219** `f3eaa92` — V4 Verify accepts null `ErrorMessage`/`ErrorCode` on success (Postman/guide samples were wrong) + adds required `StoreAmount` + rewrites `extractEpsFeePaisa(raw)` for mode-agnostic `(TotalAmount − StoreAmount)` derivation. 345 EPS tests; 1201 total api tests.
- **Phase 1.4 truth-gate Init + Verify run** end-to-end on staging via SSM. Full table archived in decisions.md. mtids: `TXN-TG-A-1780147032693-l18j`, `TXN-TG-B-1780147033108-br29`, `TXN-TG-C-1780147033200-gyng`, `TXN-TG-D-1780147033288-to6r`. SSM invocation IDs for Init: `0bd273b1-e8de-4b97-ab45-513e36a6177f`; Verify: `ffcfacd0-581b-4db5-b17e-d4345c72273a`.
- **Memory commit** — this commit + decisions.md (Phase 1.4 truth-gate entry, V5 confirmation, fee-model options 1-4) + gotchas.md (null Error fields + StoreAmount-publishing + PaymentReferance-typo) + progress.md (Day 36 SHIPPED).

## ⚠️ The launch gate state — 2 → 1 (resolved 2026-05-31)

1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26 + truth-gate run COMPLETE 2026-05-30. **Sub-task remaining:** production credentials for cutover, not sandbox.
2. ~~SES out-of-sandbox approval~~ ✅ **RESOLVED 2026-05-31** (AWS case 177899559700777, ap-southeast-1).
3. **EPS fee-model structural decision + production smoke** — the **ACTIVE LAUNCH-GATE ITEM** (decisions.md 2026-05-30 Options 1/2/3/4; operator-only).

**Pre-launch commitments (gates env flips, not launch itself):**

- **SNS bounce/complaint suppression-list wiring** (decisions.md 2026-05-31) — gates `MAIL_DRY_RUN=0`. AWS commitment.

## ⚠️ Empirical findings table — quick recall

| Mode | Status | FE | TotalAmount | StoreAmount | observedEps | predictedEps | Δ |
|:---:|:---:|:---:|---:|---:|---:|---:|---:|
| A (PT,PT) | Success | bKash | 102756 | 101009 | 1747 | 2506 | −759 |
| B (AB,AB) | Success | bKash | 100000 |  98300 | 1700 | 2500 | −800 |
| C (AB,PT) | **Fail**⚠️ | bKash | 102500 | 100757 | 1743 | 2500 | −757 |
| D (PT,AB) | **Fail**⚠️ | Nagad | 100250 |  98546 | 1704 | 2506 | −802 |

All amounts paisa. §14.10 Invariant-1 PASS across all 4. EPS rate consistently ~1.700% of TotalAmount across both MFS methods. Modes C+D returned `Status: Fail` despite operator confirmation that all 4 checkouts completed — EPS sandbox populated fee fields anyway (informational, not blocking the fee-rate observation).

## ⚠️ Build-track items still in play from prior sessions (UNCHANGED)

- ⏳ **CloudWatch >85% memory alarm — STILL OPEN.** Small AWS-write follow-up; 5-minute task when authorized.
- ⏳ **t3.medium upgrade** (4 GB, ~+$15/mo) — STILL OPEN. Pre-production Moshiur decision.
- ⏳ **AIT memo / Trust Center per-page outlines / EPS prod-credential request memo** — per Day-35 build-track-owns-gate-track-drafts pattern. None new today.
- ⏳ **Sprint 4 remaining buildable** — Refund flow + manual disbursement (§26.1 Day 7-8) + Marketing pages (§26.1 Day 9) + Launch readiness (§26.1 Day 10).

## Where things live (quick map — Day 36 additions)

- **Truth-gate runner:** `apps/api/src/infra/eps/truth-gate/run-truth-gate.ts`. Subcommands: `init` (4 RedirectURLs), `verify <MODE:MTID> ...` (Verify each, print predicted-vs-actual). On staging: `sudo -u eventpulse bash -lc "cd /home/eventpulse/app/apps/api && pnpm tsx src/infra/eps/truth-gate/run-truth-gate.ts <subcommand>"` via SSM.
- **Wire-protocol abstraction:** `apps/api/src/infra/eps/eps-wire-protocol.ts` — `V5_PRODUCTION_PROTOCOL` + `V4_SANDBOX_PROTOCOL` frozen objects + `EpsWireProtocol` interface. V4VerifyResponseSchema accepts null + empty-string for `ErrorCode`/`ErrorMessage`; `StoreAmount` required.
- **BDT-decimal parser:** `apps/api/src/infra/eps/bdt-decimal.ts` — `parseBdtDecimalToPaisa(input: string): bigint`. String manipulation only (no parseFloat); guards the IEEE-754 paisa-loss regression.
- **Pure eps_fee derivation:** `apps/api/src/infra/eps/truth-gate/run-truth-gate.ts:extractEpsFeePaisa(raw)`. Mode-agnostic. Throws on missing `TotalAmount`/`StoreAmount`.

## Standing invariants (still enforcing)

- `STAGING_PAYMENT_BLOCK=1` in `.env.staging` + pm2 env id=1. Truth-gate bypasses via the harness-scoped three-lock token (sandboxPricedCallToken + mode==='sandbox' + isSandboxPricedCallToken); operator app traffic still blocked. Removing the env requires a new `decisions.md` entry per §11.0.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; no direct commits to `main`.
- Memory protocol: decisions land in `decisions.md` the turn they're made; gotchas the moment learned.
- Money math single source: `apps/api/src/domain/payments/fee-calculator.ts`. No fee arithmetic elsewhere. **HARD STOP active until the fee-model structural decision lands next session.**
- Snapshot-vs-current display discipline (Day-33 Choice A): money dashboards read snapshotted fee fields, NEVER recompute from current config.
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently. Load-bearing instrument that surfaced today's null-Error + StoreAmount findings within minutes.
