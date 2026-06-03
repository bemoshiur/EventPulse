# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-03 — **Day 46.** **🎉 PRODUCTION PAYMENTS WORK + EPS RATE CONFIRMED.** A real BDT-102 bKash charge went through on production EPS; verify works; the actual EPS bKash rate is **~2.0% (200 bps)**, not the 175 bps the calculator assumes. Also shipped browser-auth + super-admin login earlier the same day.
**LAUNCH TARGET: 2026-06-10 (7 days out).** Remaining pre-launch: calculator fee update (175→~200), one EPS redirect bug, tenant browser login.
**Driver:** Claude Code (Opus 4.8). **🛑 $30/mo AWS ceiling.**

## ✅ EPS production — payment + verify + rate all confirmed (Day 46)

- **Protocol fix #279** (paths `/v1/Auth`+`/v1/EPSEngine`, full mandatory init body, verify GET) — TDD, deployed.
- **Real payment SUCCESS:** operator paid BDT 102.00 via bKash; EPS charged it.
- **Verify GET WORKS** (confirmed via a read-only diagnostic: `Status:Success, FinancialEntity:BKash, TotalAmount:102.00, StoreAmount:99.96`; POST→405). The earlier post-payment 404 was EPS not having the txn queryable yet (timing) — NOT a bug.
- **RATE:** EPS fee = 102.00 − 99.96 = **2.04 BDT on a 102.00 capture ≈ 2.0% (200 bps)**. The calculator's `DEFAULT_EPS_FEE_BPS_ESTIMATE = 175` is too low → platform/organiser eats ~0.29 BDT/txn.

## 🎯 Pre-launch must-dos (the first paying tenant is gated on these)

1. **Update the EPS fee estimate** `175 → ~200 bps` (money math ONLY via `apps/api/src/domain/payments/fee-calculator.ts`; `DEFAULT_EPS_FEE_BPS_ESTIMATE` lives in `infra/eps/initialise-order.ts`). Also decide the §14.2 base (EPS charges on the FULL capture incl. pass-through → recursive). **Operator decision + a re-smoke to confirm the new value** (runbook rule). HARD-STOP before the money-math PR.
2. **Fix the EPS redirect-return param bug** (`orders-eps-return.ts`): EPS's browser redirect doesn't carry `merchantTransactionId` under that name → `no_txn_id` → buyer hits `/orders/return/error`. Need EPS's actual return param names (likely `TransactionId`/`EPSTransactionId`). The verify/settle logic itself works.
3. **Tenant browser login** (multi-tenant context §4.2) — the full self-serve gap (super-admin login already works).

## Smaller follow-ups
- Thread real buyer name/email/phone into the EPS init body (placeholders shipped in #279).
- Codify `EPS_SUCCESS/FAIL/CANCEL_URL` into `bootstrap-prod.sh` (added live to `.env.production`).
- Step 7 layout auth-gate, `/refresh`, decommission staging at launch.
- **Refund NOT needed** (operator's call) — the BDT-102 smoke txn `TXN-mpxzcmt4-epsmoke1-i776iw93` stays in EPS.

## State + invariants

- **Prod safe + pristine:** `STAGING_PAYMENT_BLOCK=1` re-locked + verified; seeded smoke data cleaned (0 tenants/events/orders); ~1 user (the operator, a super-admin). `EPS_MODE=production`, `MAIL_DRY_RUN=0`.
- Prod box `i-0c41fae1286527654` @ EIP `52.76.69.96`; API `https://api.eventpulse.com.bd`. Super-admin self-serve login at `app.eventpulse.com.bd/admin-sign-in`.
- Money math only via fee-calculator.ts. RLS via the exact 3-role model. Memory commits via PRs separate from feature commits. **Prod deploys + lifting STAGING_PAYMENT_BLOCK + real payments + privilege grants are harness-gated → explicit per-step operator authorization** (enforced repeatedly today). Day-45 auth-bypass stays closed.
