# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-03 — **Day 46.** **🎉 PRODUCTION PAYMENTS WORK.** The launch-critical unknown is resolved: a real BDT-102 bKash charge went through on production EPS. Shipped browser-auth + super-admin login earlier the same day.
**LAUNCH TARGET: 2026-06-10 (7 days out).** Remaining: 2 EPS post-payment bugs (auto-settlement) + tenant browser login.
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling.**

## ✅ Today's headline — EPS production payment VALIDATED (#279)

The operator provided the **EPS V5 Integration Guide**, which fixed the prod-EPS-404. PR #279 (TDD, CI green, deployed) corrected 3 protocol divergences: paths (`/v1/Auth/GetToken` + `/v1/EPSEngine/*`), the InitializeEPS body (added mandatory customer fields + CustomerOrderId + productName — **placeholders for now**), verify POST→GET. Then: no-charge Initialize test returned a real EPS RedirectURL; the operator paid **BDT 102.00 via bKash** and **EPS charged it successfully.**

## 🔴 2 EPS post-payment bugs — orders don't auto-settle (launch blockers, lower-severity than payment)

1. **Verify 404.** `GET /v1/EPSEngine/CheckMerchantTransactionStatus` → 404 (Initialize on the same prefix works). Guide says GET; the **original code used POST**. **Hypothesis: revert V5 verify to POST.** Read-only + not block-guarded → testable WITHOUT money: change → deploy → `POST /api/v1/webhooks/eps/callback {"merchantTransactionId":"…"}` re-triggers verify+settle.
2. **Redirect-return param mismatch.** EPS's redirect to `successUrl` doesn't carry `merchantTransactionId` (our handler `orders-eps-return.ts` expects it) → `no_txn_id` → buyer lands on `/orders/return/error`. **Need EPS's actual return param names** (capture from a real redirect or ask EPS — likely `TransactionId`/`EPSTransactionId`).

Both must land for orders to settle automatically. gotchas.md + decisions.md Day-46 EPS entries have the detail.

## ⏳ Pending on the operator (from the smoke)

- **Refund** the BDT 102.00: EPS merchant dashboard, txn **`TXN-mpxzcmt4-epsmoke1-i776iw93`** (the verify 404 means our code didn't settle/refund it; it's a normal EPS transaction to refund manually).
- **Report the rate:** from that txn's dashboard row, `Total (102.00) − Store/Settled = EPS fee`; compare to the **175 bps** calculator assumption. (Verify 404 blocked reading StoreAmount in-code.)

## State + invariants

- **Prod safe + pristine:** `STAGING_PAYMENT_BLOCK=1` re-locked + verified; seeded smoke data cleaned (0 tenants/events/orders); ~1 user (the operator, a super-admin). 
- `EPS_MODE=production`, `MAIL_DRY_RUN=0`. `EPS_SUCCESS/FAIL/CANCEL_URL` added live to `.env.production` (→ `api.eventpulse.com.bd/.../eps-return/{success,fail,cancel}`) — **codify in `bootstrap-prod.sh`** (follow-up).
- Prod box `i-0c41fae1286527654` @ EIP `52.76.69.96`; API `https://api.eventpulse.com.bd`.

## 🎯 Next session

1. **Fix the 2 EPS post-payment bugs** (verify method + redirect params) → re-validate the full round-trip (GetToken→Init→pay→return→verify→settle). The verify fix is testable with no money (webhook re-trigger).
2. **Thread real buyer info** into the EPS init body (placeholders shipped) + **codify EPS return URLs** in `bootstrap-prod.sh`.
3. **Tenant browser login** (multi-tenant context §4.2) — the full-self-serve gap (super-admin login already works).
4. Smaller: Step 7 layout gate, `/refresh`, decommission staging at launch.

## Standing invariants

- Money math only via fee-calculator.ts. RLS via the exact 3-role model. Memory commits via PRs separate from feature commits. Branch protection on main. **Prod deploys + lifting STAGING_PAYMENT_BLOCK + real payments are harness-gated → explicit per-step operator authorization** (the classifier enforces this — seen repeatedly today). Privilege grants on prod DB need explicit operator auth. The Day-45 auth-bypass stays closed.
