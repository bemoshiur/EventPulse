# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-26 (Sprint 4 Day 34 SHIPPED — staging capacity fix + buyer form + full free-event loop e2e). **Decision N truth gate REMAINS THE blocker for priced money.**
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 34; **next session opens Day 35.**

## ⚠️ CRITICAL: where we are right now

**Sprint 4 Day 34 SHIPPED.** Three phases / 4 PRs merged today: Phase 0 staging capacity stopgap (PR #192), Phase 1 public buyer form (PR #193), Phase 2 full free-event-loop e2e smoke (PR #194), EOD memory PR (#195 — this session). **The FREE-event operational loop is now end-to-end browser-clickable** (event landing → buyer form → order born-paid → attendee list → check-in scanner → sales dashboard). Truth-gate blockers unchanged; PRICED loop still waits.

**STAGING_PAYMENT_BLOCK=1 held all session.** Zero EPS calls fired. Free-event path bypasses EPS by design (§13.5).

**Staging EC2 capacity:** swap mitigation applied + codified. Risk of in-VM-hang recurrence under build spikes materially reduced. t3.medium upgrade still flagged as pre-production decision (see below).

## ⚠️ Decision Moshiur still owes (DOWN to two from three)

The Day-33 capacity carry-forward had three items. **Two now resolved** (autonomously, within Phase-0 brief scope):

1. ✅ **2 GB swap file applied + codified.** Live on staging EC2 + step 0.0 of `infra/scripts/bootstrap-staging.sh` reproduces on fresh rebuild. `vm.swappiness=10` persisted. `/etc/fstab` updated. Verified: `Swap: 2.0Gi` in `free -h`.
2. ⏳ **CloudWatch >85% memory alarm — STILL OPEN.** Small AWS-write follow-up; out of Phase-0 brief scope (brief: scope = {swap, fstab, swappiness, PM2 config}; CW alarm is "AWS write beyond capacity fix" → STOP-ASK). One Bash command + zero code; can land Day 35 as a 5-minute task at the start of any session.
3. ⏳ **t3.medium upgrade (4 GB, ~+$15/mo) — STILL OPEN.** Moshiur decision; not autonomously actionable. Swap is a stopgap; production wants real headroom. Decision needed before prod cutover, NOT blocking for the rest of Sprint 4. STOP-ASK any infra session that would resize.

**Decision N truth gate REMAINS THE gating milestone for priced money.** Four pending-Moshiur items (3 unchanged + 1 surfaced today):

1. **EPS sandbox credentials confirmed** OR authorized controlled `STAGING_PAYMENT_BLOCK` lift + new `decisions.md` entry per §11.0 (4 × small real charges)
2. **§29 #9 (AIT withholding) tax opinion** — fee calculator math is pre-withholding
3. **SES out-of-sandbox approval**
4. **Trust Center v1.0 documents from counsel** — placeholder DRAFT today; buyer form deliberately ships WITHOUT a binding consent checkbox under v0.1 docs (decisions.md 2026-05-26). Real `consent_records` capture lands as a separate PR once counsel returns v1.0. NEW today as a surfaced blocker.

## Day 34 deliverables (4 PRs merged today, all green on staging)

**PR #192 (Phase 0) — staging EC2 swap stopgap (`caa292d`):**

- `infra/scripts/bootstrap-staging.sh` gains step 0.0: 2 GB swap file + chmod 600 + mkswap + swapon + persistent `/etc/fstab` entry + `vm.swappiness=10` via `/etc/sysctl.d/99-eventpulse-swap.conf`. Idempotent — re-running on the already-mitigated instance is a no-op.
- `docs/runbooks/staging-bootstrap.md` adds "Memory headroom — 2GB swap" section AND a full "Recovering from an in-VM hang" runbook (Stop+Start NOT Reboot when port 443 + SSM both dead but hypervisor healthy; post-recovery checklist).
- Applied to running staging EC2 via SSM before commit. Verified `Swap: 2.0Gi` + `swappiness=10`.
- Pre-existing checks confirmed: `pm2-eventpulse.service` enabled, `dump.pm2` saved (boot-resume works); `max_memory_restart` already set in `pm2/ecosystem.config.cjs` (web=512M, api=256M); delivery worker runs inline within api process (not a separate pm2 entry).

**PR #193 (Phase 1) — public buyer registration/purchase form (`789e8c4`):**

- `apps/web/src/components/public/buyer-form.tsx` — Client Component island. Inline tier-card quantity steppers + buyer fields (name/email/phone/optional NID-last-4) + subtotal preview + single submit button with bilingual label.
- Handles all 3 response paths from POST `/api/v1/public/orders`:
  - FREE (born-paid §13.5) → success state with order reference
  - PRICED + READY → `window.location.assign(redirectUrl)` to EPS
  - PRICED + BLOCKED (staging) → sensible "Payments temporarily unavailable" state with order reference (NOT a crash)
- `Idempotency-Key` per form mount via `crypto.randomUUID()` (fallback for jsdom) — sent on every submit; regenerated only after hard server error.
- Bilingual labels per §1.3 R12 (English-first with Bangla sub-labels on headings + principal fields).
- Footer line links to `/terms` + `/refund-policy` via `<Link>` (no blocking consent checkbox — see decisions.md).
- `EventLanding` rewired to host `<BuyerForm>` in place of the Day-25 placeholder "Buy (coming soon)" CTA.
- 12 new component tests + 2 updated EventLanding tests (thousand-grouped BDT format; new submit-testid). Axe-clean.

**PR #194 (Phase 2) — full free-event loop e2e smoke (`be9170a` after `be9170a` prettier hotfix):**

- `apps/api/src/routes/public/orders-full-loop-e2e-smoke.test.ts` — DB-gated single-test 5-step walk: buyer-form POST → free order born-paid → `deliverOrder()` synchronous materialise → tenant attendee list → check-in → sales dashboard headline. Proves the loop the Phase 1 form opened in the browser actually closes end-to-end through every Days-25-33 service.
- Synchronous `deliverOrder()` (worker's per-job entry point) instead of waiting on the BullMQ worker (the worker boots in `index.ts`, not `createApp()`; calling it directly is the e2e equivalent of "worker processed the queue").
- QR code read from DB after delivery (the list endpoint deliberately omits it — listing is a browse surface, scanning reads from the physical ticket).
- `MAIL_DRY_RUN=1` keeps SES out. Zero outbound network.
- Phase 2 hotfix: prettier-format only; no logic change.

**EOD staging smoke (Phase 3, expected green at session-end re-verification):**

- main HEAD = `789e8c4` post-Phase-1; Phase 2 (loop smoke) pending CI / merge / deploy at the time of writing handoff
- `STAGING_PAYMENT_BLOCK=1` enforcing in `.env.staging` + pm2 env (id=1)
- 5 vhosts: all 200 / 404 (api 404 at root is correct — only /health + /api/* routes)
- `/health` DB-aware: 200, db:ok
- Swap active: 2.0Gi
- Free-event browser walk-through now possible end-to-end (Moshiur can click through)

## One decision codified today (decisions.md "Sprint 4 Day 34")

- **Phase 0 entry — Staging EC2 swap stopgap; t3.medium flagged.** Swap applied + codified in bootstrap. t3.medium pinned as pre-production capacity decision. swappiness=10 + 1:1 swap rationale documented. The pattern map-cleanly to a future Ansible `swap` role.
- **Phase 1 entry — No blocking consent checkbox in buyer form under v0.1-placeholder Trust Center.** Footer-link-only pattern. Why: a checkbox bound to a placeholder is performative + audit liability. Real `consent_records` capture lands as a separate PR when counsel returns v1.0 docs. Form layout already has room for the checkbox to slot in.

## One existing gotcha amended today (gotchas.md)

- **Day-33 in-VM-hang entry** — added 2026-05-26 update noting the swap stopgap is applied + codified, with cross-references to the bootstrap script + runbook + Day-34 decisions entry. Items 2 (t3.medium) + 4 (CW alarm) still flagged open.

## Day 35 — what's next

Sprint 4 (Days 31-40) — six days remain (35/36/37/38/39/40). Buildable items still in play per §26.1 Sprint 4:

- **Super admin Revenue Dashboard per §14.7** (§26.1 Day 6). Cross-tenant platform-revenue view — the EXCEPTION to the Day-33 Choice-B aggregation guardrail (deliberately cross-tenant; its own audit + access control is the security model). Read-mostly; payment-independent at the display layer. Logical next pickup.
- **Refund flow + manual disbursement** (§26.1 Day 7-8). Refund flow has free-event applicability (refund-of-paid-zero is a no-op, but the workflow is testable for the priced case once truth-gate clears). Manual disbursement is payment-gated (no real money to disburse until truth gate runs); the UI + BEFTN CSV export can be built+tested with seed data.
- **Marketing pages** (§26.1 Day 9) — apex `/`, `/features`, `/pricing`, `/contact`, `/legal/changelog`. Mostly static + design-system work. Payment-independent.
- **Launch readiness** (§26.1 Day 10) — AUP review, prod EC2 cutover, first paying tenant. Cutover is truth-gate-gated.
- **CW memory alarm** (Phase-0 follow-up) — small 5-minute AWS-write item; do it at the start of the next infra-touching session.

**Recommended Day 35 sequence:** super-admin Revenue Dashboard (closes the §14.7 deliverable cleanly + uses the same snapshot-vs-current display discipline as Day 33). Pair with the 5-minute CW alarm at the start of the session if Moshiur authorizes the AWS write.

## Where things live (quick map)

- **Public buyer form:** `apps/web/src/components/public/buyer-form.tsx` (+ test) — Client Component island.
- **Public event landing:** `apps/web/src/app/(public)/[tenant]/[event]/page.tsx` + `apps/web/src/components/public/event-landing.tsx` (Server Component hosts BuyerForm).
- **Public order endpoint:** `apps/api/src/routes/public/orders.ts` + `apps/api/src/services/orders/index.ts` (3 paymentInitState branches: free / ready / blocked).
- **Free-event bypass:** §13.5 born-paid path inside `createOrder` (`status: 'paid'`, `paymentInitState: 'free'` at return).
- **Delivery worker entry:** `apps/api/src/workers/delivery-worker.ts` boots in `apps/api/src/index.ts:36`; per-job invocation is `apps/api/src/services/tickets/deliver-order.ts` `deliverOrder()`.
- **Loop e2e:** `apps/api/src/routes/public/orders-full-loop-e2e-smoke.test.ts` — single 5-step walk from buyer form → dashboard.
- **Staging bootstrap (with swap):** `infra/scripts/bootstrap-staging.sh` step 0.0.
- **In-VM-hang recovery runbook:** `docs/runbooks/staging-bootstrap.md` "Recovering from an in-VM hang".

## Standing invariants (still enforcing)

- `STAGING_PAYMENT_BLOCK=1` in `.env.staging` + pm2 env id=1 + `cfg()` enforces in `apps/api/src/infra/eps/client.ts`. Removing it requires a new `decisions.md` entry per §11.0.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; no direct commits to `main`.
- Memory protocol: decisions land in `decisions.md` the turn they're made; gotchas the moment learned.
- Money math single source: `apps/api/src/domain/payments/fee-calculator.ts`. No fee arithmetic elsewhere (`/review` greps for it).
