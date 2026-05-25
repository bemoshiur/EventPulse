# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 CLOSED at `v0.3.0-sprint-3`. Pipeline feature-complete behind STAGING_PAYMENT_BLOCK. **Decision N truth gate is THE blocker for priced money.**)
**Driver:** Claude Code (Opus 4.7) — Sprint 3 closeout (Day 30); **next session opens Sprint 4 Day 31.**

## ⚠️ CRITICAL: where we are right now

**Sprint 3 buildable work is DONE.** Tag `v0.3.0-sprint-3` cut. The pipeline is feature-complete behind block:

- Order creation (Day 26) → Settlement (Day 27) → Delivery (Day 28) → Idempotency middleware (Day 29 Phase 1) → Capacity lock (Day 29 Phase 2) → §13.5 free-event bypass (Day 30 Phase 1a) → §14.10 ledger invariant verifier (Day 30 Phase 2).

**Decision N truth gate is now THE gating milestone.** It's blocked on pending-Moshiur items deferred for over a week:

1. **EPS sandbox credentials confirmed** OR authorized controlled STAGING_PAYMENT_BLOCK lift + new `decisions.md` entry per §11.0 (4 × small real charges)
2. **§29 #9 (AIT withholding) tax opinion** — calculator math is pre-withholding per file header
3. **SES out-of-sandbox approval** — without it, real ticket emails won't deliver to non-verified addresses

**Sprint 4 has buildable work that CAN proceed in parallel** while truth-gate blockers resolve (attendee list + QR scanner + dashboards + marketing). The project isn't fully blocked, but **anything touching real money** (refunds, payouts, first paying tenant) **is gated on the truth gate.**

## Controlled truth-gate protocol (restated for next session)

- 4 §14.2-mode transactions (PT/PT, AB/AB, AB/PT, PT/AB)
- Smallest viable amounts (probably BDT 100 each = ~$1)
- **Moshiur approves amounts FIRST** (no agent-initiated real-money fires)
- STAGING_PAYMENT_BLOCK lifted ONLY for that run; re-enabled immediately after
- New `decisions.md` entry MUST land alongside the lift recording rationale + amounts + Moshiur sign-off
- §14.10 Invariant 1 verified against the 4 priced rows (verifier is shipped + ready)
- Post-mortem entry capturing actual vs calculated fees

## State right now (2026-05-25 EOD)

**Sprint 3 CLOSED.** 5 PRs shipped Day 30 (free-event bypass + E2E smoke + ledger invariants + closeout + memory).

**Branches + PRs Day 30:**

- `origin/main` HEAD = `<closeout-sha>` (Sprint 3 closeout commit; v0.3.0-sprint-3 tag pinned here)
- Staging EC2 deployed code = matches main
- **4 Day 30 PRs MERGED:**
  - PR #175 (Phase 1a) `fix(orders): §13.5 free-event bypass — born-paid, no EPS call` → merged `aeb006b`
  - PR #176 (Phase 1b) `test(e2e): free-event buyer-journey smoke — HTTP through full stack` → merged `2c6f36f`
  - PR #177 (Phase 2) `feat(ledger): §14.10 invariant verifier — money split sums to total` → merged `2cba41d`
  - PR #178 (Phase 3) — this PR (closeout + retro + tag + Sprint 4 issue)
- **Sprint 4 kickoff issue:** #178 (truth-gate prominently surfaced as gating)
- **Sprint 3 tracker issue #110:** CLOSED against shipped work
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-truth-gate

**Day 30 deliverables (all merged):**

- ✅ **§13.5 free-event bypass** at `apps/api/src/services/orders/index.ts createOrder()`. STOP-ASK surfaced + fixed in same session per brief framing. Free events born-paid; no EPS call; delivery enqueued directly. 7 DB-gated tests pinned the contract.
- ✅ **E2E full-stack smoke** at `apps/api/src/routes/public/orders-e2e-smoke.test.ts`. HTTP through complete pipeline (middleware → route → service → delivery enqueue). 3 DB-gated tests including REPLAY (no double-count) + §14.10 Invariant 1 across all orders. Browser-form happy path deferred to Sprint 4 (UI doesn't exist).
- ✅ **§14.10 ledger invariant verifier** at `apps/api/src/domain/ledger/invariants.ts`. Pure functions over row arrays; bit-exact bigint; typed LedgerInvariantError. **332 tests including 320 PROPERTY tests** proving Invariant 1 holds by construction across (4 §14.2 modes × 5 subtotals × 4 platform_bps × 4 eps_bps) — the fee-calculator's outputs ALWAYS satisfy the invariant.
- ✅ **Sprint 3 closeout** — `v0.3.0-sprint-3` tag pushed on the closeout commit; release notes (in tag message body) summarise Sprint 3 with the explicit note that pipeline is feature-complete but NOT truth-gate-verified and NOT production-ready.

**Day 30 staging smoke (all GREEN):**

- main HEAD post-Phase-2 deployed; EC2 HEAD matches; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in pm2 env (id=1) + `/home/eventpulse/.env.staging`
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok
- Google OAuth `/start`: 302 (regression guard holds)
- Boot log: `eps.token_cache=redis` + `tickets.delivery_worker.started` + `redis.ready` after `eventpulse api listening`
- Day 27 fraud-prevention regression guard still holds (spoofed webhook → unknown_transaction)
- Day 29 idempotency live: missing key → 400; valid key + bogus event → typed 4xx; replay → cached + `x-idempotency-replay: true`

**Tests at sprint close: 1083 pass (+332 ledger from Day 30 Phase 2), 294 skipped (CI runs DB-gated).**

## Days 27-30 retro (the back-half of Sprint 3 in numbers)

- **5 days, 17 PRs, 5 hotfixes** — production hotfix density tracks complexity: Day 29's idempotency middleware ate 2 hotfixes from the unit-tests-vs-production-HTTP gap (body-stream exhaustion + Redis cold-start). Both gotchas captured.
- **Test runner growth: 690 → 1083** (+393 pass, all green).
- **DB-gated tests: 256 → 294** (+38; CI runs them).
- **4 architectural decisions per day codified in decisions.md** (Day 27 webhook auth + redirect non-authority; Day 28 QR + PDF + BullMQ; Day 29 idempotency + capacity lock; Day 30 free-event bypass + ledger).
- **STAGING_PAYMENT_BLOCK held every hour** of every session. Zero real EPS calls fired.

### What worked

- **Front-loading playbook reads on each phase.** Phase 0's read of §14.10 caught the latent §13.5 free-event bypass bug BEFORE Phase 1b's E2E smoke would have failed on it. Days 27-30 all opened with deep playbook reads that prevented downstream surprises.
- **Codifying decisions in `decisions.md` PER day.** When the Day 29 body-stream gotcha hit production, the existing decision pattern (each PR's architectural choice committed with rationale) made the post-mortem mechanical.
- **Fail-closed vs fail-open asymmetry** (Day 29 vs Day 28). Different layers need different failure modes: source-of-truth gates fail closed (idempotency); downstream consequences fail open (delivery). The pattern is now codified.
- **DB-gated tests against real Postgres.** The Day 29 capacity-lock 10-concurrent-buyers-race test only proves anything against real Postgres lock semantics — ioredis-mock can't model that. The test infrastructure handled this cleanly.

### What didn't

- **The unit-tests-vs-production-HTTP gap (twice in one day).** Day 29 Phase 1's middleware tested green against `app.request()` but failed twice in production: body-stream exhaustion (Hono shortcuts caching in `app.request()`; real HTTP doesn't) + Redis cold-start (mocked client doesn't exercise lazy-connect race). Both fixed, both captured in gotchas. Future practice: any HTTP-touching middleware change needs a post-deploy live curl smoke as part of the merge gate.
- **The §13.5 free-event bypass was latent for ~6 months.** Spec'd since playbook v1.0; never implemented; no test caught it (no test used `pricePaisa: 0n`). Caught only at Day 30 Phase 0 by reading the createOrder flow in detail ahead of the E2E smoke. **Lesson: spec sections specifying behavior without a corresponding test = future surprise.** Sprint 4+ should audit other "spec'd behavior without dedicated test" sections.
- **GitHub Actions org spending limit hit mid-day-30.** Same root cause as the Day 20 org-migration cascade. Required Moshiur intervention to raise the limit. Lesson: monitor org Actions billing more proactively as CI run density increases.
- **The Day 30 brief asked for a Playwright browser smoke that couldn't exist** because the buyer-form UI was never built (it's Sprint 4 scope). Caught at Phase 0; reframed as a full-stack integration test. Brief-vs-reality mismatch is the kind of thing the Day-30 closeout naturally surfaces.

### Three things to do differently next sprint

1. **HTTP smoke ≠ unit test.** When shipping a middleware that runs on every request, the merge gate must include a post-deploy live curl that exercises the production HTTP path (not just `app.request()`). Add this as a Sprint 4 CI/CD checklist item OR as a manual gate.
2. **Spec-to-test audit at sprint kick-off.** At Sprint 4 Day 1, grep the playbook for §-numbered spec sections without corresponding `it('§X.Y …')` tests. The §13.5 free-event case took ~6 months to surface; that's not acceptable for spec-sensitive behavior.
3. **Cost-pessimistic CI quota planning.** Day 30's 4+ CI runs hit the org Actions cap mid-day. Sprint 4 is dashboard + scanner heavy (lots of E2E surface). Plan quota upfront; pre-confirm the limit covers the expected run density.

## Next concrete step — Sprint 4 Day 31

The brief for Day 31 is Moshiur's call. Logical first picks per §26.1 Sprint 4 plan:

- **Day 31 Option A: Attendee list UI + CSV export** (§26.1 Day 1-2). Builds on Day 28's `attendees` table. Tenant portal scope; no truth-gate dependency. Good first day for parallel-with-truth-gate work.
- **Day 31 Option B: Buyer form UI** (Sprint 3 carry). Unblocks the Day 30 Phase 1b E2E smoke's "browser path" — and gives free events an actual user-facing path on staging.
- **Day 31 Option C: Web QR scanner** (§26.1 Day 3-4). Builds on Day 28's QR tokens. Camera-based; offline-tolerant; would let us test the full Day-28 ticket delivery + check-in loop end-to-end (free events only until truth gate).

All three are buildable in parallel; pick based on user priority. Recommendation: Option A or C — concrete user surface that exercises Sprint 3's shipped pipeline.

## Pending Moshiur actions — Sprint 3 closeout state

**TRUTH-GATE BLOCKERS (gate Day 30+ priced work — restate every session until cleared):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; new `decisions.md` entry required per §11.0)
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions**
3. **SES out-of-sandbox approval**

**Lower urgency (continued):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — first paying tenant gated.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one.
4. **bootstrap-staging.sh validation guard live-trigger** — runs on the NEXT bootstrap.
5. **NotoSansBengali font bundling for PDF tickets** — pure-Bangla strings render as squares until font lands.
6. **`sold` decrement on cancel/fail/chargeback** — Day 29 Phase 2 scope-limited to increment-only; cleanup sweep is Sprint 4+ scope.

## Hard guardrails (carry forward + 4 new from Day 30)

(Carrying forward all Day 29 guardrails; adding 4 Day 30 ones at the end.)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only.
- `audit_logs`, `legal_document_versions`, `order_events` are APPEND-ONLY at the GRANT layer.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`.
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only**.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()`.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object.**
- **No client-side PII persistence**.
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`.**
- **BIN 13-digit fact is reviewer-documentation, NOT server-side enforcement.**
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded.**
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.**
- **Manual-verification policy is load-bearing.** Phase 2 trigger = 50 verified submissions/week sustained.
- **Porichoy adapter scaffold-only shape is canonical** for future automation integrations.
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts.
- **Admin route group lives under `/(admin)/admin/...`** to avoid collisions.
- **Markdown sanitization is via `renderLegalMarkdown()`** (Decision J).
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K).
- **`consent_records` table is Sprint 3+ scope** (Decision L).
- **EPS library is in-house wrapper** at `apps/api/src/infra/eps/`. NO SDK.
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Real-HTTP wrapper preserves block-guard ordering at the FIRST line of `initialiseOrderHttp`.
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.**
- **Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC + billing + deploy keys.
- **AWS SDK v3 packages must bump together.** Dependabot grouping config landed.
- **Self-modifying scripts need TWO deploys to verify.**
- **`@noble/hashes` stays at v1.8.0** through the truth gate.
- **Apple Sign-In dropped from MVP scope.**
- **`/api/v1/*` paths belong on `api.staging` vhost ONLY.**
- **EPS fee is NOT per-tenant configurable.** Order-time input only.
- **OAuth callback redirect target = apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`**.
- **Five distinct greppable EPS error classes** — `StagingPaymentBlockedError` / `EpsConfigError` / `EpsNotImplementedError` / `EpsNetworkError` / `EpsResponseError`.
- **Ticket tier CRUD ships without money math.** Tier stores `price_paisa` raw; the fee-calculator is the only consumer at order time.
- **Ticket tier capacity locking shipped Day 29 Phase 2** (FOR UPDATE row lock with ORDER BY id for deadlock avoidance).
- **Public event visibility + status gating is application-policy, not RLS.**
- **Buyer-write order path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary.**
- **Order row fee snapshot includes 4 extension columns beyond §9.5 verbatim** per §14.4 + Decision N.
- **Redis token cache stampede semantic: accept-double-fetch-but-cache-last.**
- **Drizzle `ANY()` array-binding via raw `sql\`\`` does NOT work; use `inArray()` helper.**
- **EPS webhook auth model is verify-by-callback (§11.1 step 11), NOT signature verification.**
- **Browser redirect URLs are NEVER authoritative for payment status (§1.3 R3).**
- **Webhook + redirect handlers ALWAYS return 200 OK on business outcomes**.
- **QR token is 256-bit cryptographically-random opaque base64url.**
- **PDF tickets travel as email attachments, NO S3 bucket.**
- **Delivery is DECOUPLED from settlement.** `enqueueOrderDelivery()` NEVER throws.
- **`order.delivery_sent` is the append-only delivery marker.**
- **BullMQ requires a DEDICATED Redis connection with `maxRetriesPerRequest: null`.**
- **`Idempotency-Key` middleware fails CLOSED on Redis absence** (503). Source-of-truth gates fail closed; downstream consequences fail open.
- **Idempotency body hash = SHA-256 of RAW request bytes** (NOT canonicalised JSON). Strict policy.
- **FOR UPDATE capacity lock uses ORDER BY id for multi-tier deadlock avoidance.**
- **Hono middleware that hashes request body MUST use `c.req.raw.clone().text()`**, NOT `c.req.text()`.
- **Redis singleton needs explicit `await redis.connect()` at boot** for the idempotency middleware's first request after pm2 reload.
- **NEW 2026-05-25 — §13.5 free-event auto-settle: events where every tier price_paisa = 0 go pending → paid immediately, NO EPS call.** Implemented in createOrder via `if (calc.buyerTotalPaisa === 0n)` branch inside the same withSuperAdmin tx. `paymentInitState: 'free'` discriminant value distinguishes from `'ready'` (paid + EPS init succeeded) + `'blocked'` (paid + STAGING_PAYMENT_BLOCK refused).
- **NEW 2026-05-25 — Mixed paid+free tier order takes the PAID path.** §13.5 rule is "every tier price_paisa = 0", NOT "any tier". A cart with one free + one paid tier has totalPaisa > 0n → EPS init fires (or block-refuses).
- **NEW 2026-05-25 — `apps/api/src/domain/ledger/invariants.ts` is the §14.10 source of truth for money conservation checks.** Pure functions over row arrays. Bit-exact bigint. Single paisa discrepancy = real money bug. Use `assertInvariant1PerOrder` to throw on violation (matches §14.10 "any violation halts new batch creation").
- **NEW 2026-05-25 — Sprint-section spec without a dedicated test = future surprise.** The §13.5 free-event bypass was latent for ~6 months because no test used `pricePaisa: 0n`. Sprint 4 Day 1 should audit other "spec'd behavior without dedicated test" sections.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run Day 30 §14.10 ledger invariant tests (pure, 332 tests, ~10ms)
pnpm --filter @eventpulse/api exec vitest run src/domain/ledger/invariants.test.ts

# Run Day 30 free-event bypass DB-gated tests
pnpm --filter @eventpulse/api exec vitest run src/services/orders/free-event-bypass.test.ts

# Run Day 30 E2E full-stack smoke
pnpm --filter @eventpulse/api exec vitest run src/routes/public/orders-e2e-smoke.test.ts

# Verify v0.3.0-sprint-3 tag
git tag -v v0.3.0-sprint-3 2>&1 | head -5
git show v0.3.0-sprint-3 --stat | head -30

# Live regression smokes (Day 27 + Day 29) — should still hold after Sprint 4 work
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-day31","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}

curl -s -X POST -H "content-type: application/json" \
  -H "idempotency-key: smoke-day31-12345-12345" \
  -d '{"eventId":"00000000-0000-0000-0000-000000000000","tierSelections":[{"tierId":"00000000-0000-0000-0000-000000000000","quantity":1}],"buyer":{"name":"x","email":"x@example.com","phone":"+88017"}}' \
  https://api.staging.eventpulse.com.bd/api/v1/public/orders
# Expected: 404 NOT_FOUND (typed) on first call; cached replay with x-idempotency-replay: true on second
```
