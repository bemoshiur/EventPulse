# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 29 COMPLETE — Idempotency-Key middleware + FOR UPDATE capacity lock, **pipeline is now FEATURE-COMPLETE** behind STAGING_PAYMENT_BLOCK)
**Driver:** Claude Code (Opus 4.7) — Day 29 closeout; **next session opens Sprint 3 Day 30 — end-to-end buyer-journey smoke + §14.10 ledger invariants + `v0.3.0-sprint-3` tag + Sprint 3 retro.**

## ⚠️ CRITICAL handoff pivot — read this first

After Day 30 ships, **Sprint 3's buildable feature work is DONE**. The pipeline is feature-complete and the **Decision N truth gate becomes the gating milestone** — and it's blocked on the pending-Moshiur items that have been deferred for over a week:

1. **EPS sandbox credentials confirmed** OR authorized controlled STAGING_PAYMENT_BLOCK lift + new `decisions.md` entry per §11.0 guardrail.
2. **§29 #9 (AIT withholding) tax opinion** — calculator math is pre-withholding per file header; lift gates the truth gate's reconciliation accuracy.
3. **SES out-of-sandbox approval** — without it, real ticket emails won't deliver to non-verified addresses.

These items stop being "deferred" and start being **the thing blocking progress** after Day 30. The controlled-truth-gate protocol stays unchanged:

- 4 §14.2-mode transactions (PT/PT, AB/AB, AB/PT, PT/AB)
- Smallest viable amounts (probably BDT 100 each = ~$1)
- **Moshiur approves amounts first** (no agent-initiated real-money fires)
- STAGING_PAYMENT_BLOCK lifted ONLY for that run; re-enabled immediately after
- New decisions.md entry MUST land alongside the lift recording the rationale + amounts + Moshiur sign-off

## State right now (2026-05-25 EOD)

**Sprint 3 Day 29 COMPLETE.** 5 PRs shipped (2 phases + 2 hotfixes + memory); pipeline feature-complete behind block.

**Branches + PRs:**

- `origin/main` HEAD = `1a93740` (PR #173 — Redis warmup hotfix)
- Staging EC2 deployed code = `1a93740` (verified below)
- **5 Day 29 PRs MERGED:**
  - PR #170 (Phase 1) `feat(api): Idempotency-Key middleware on order creation` → merged `85259fb`
  - PR #171 (Phase 2) `feat(orders): FOR UPDATE capacity lock + sold increment in createOrder` → merged `52e306a`
  - PR #172 (Phase 1 hotfix #1) `fix(api): idempotency middleware uses c.req.raw.clone() to preserve body stream` → merged `21b6a39`
  - PR #173 (Phase 1 hotfix #2) `fix(api): warm up Redis at boot to fix first-request-after-pm2-reload race` → merged `1a93740`
  - PR #174 (memory) Day 29 closeout — this PR
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate.

**Day 29 deliverables (all merged):**

- ✅ **Idempotency-Key middleware** at `apps/api/src/middleware/idempotency.ts` — full §6.4 contract: cached replay, in-flight 409, body-hash 422 on key-reuse with different body, missing-key 400, fail-CLOSED on Redis absence (503), 5xx not cached + marker released, 4xx cached.
- ✅ **FOR UPDATE capacity lock** in `apps/api/src/services/orders/index.ts createOrder()` — closes the oversell race; ORDER BY id prevents multi-tier deadlock; new `InsufficientCapacityError` typed exception → 409 TIER_SOLD_OUT.
- ✅ **2 hotfixes from the same root** — unit-tests-vs-production-HTTP gap: body-stream exhaustion (Hono's `c.req.text()` works in `app.request()` tests but consumes the stream in real HTTP) + Redis cold-start (lazy-connect singleton needs explicit warm-up so the first request after pm2 reload doesn't race the connect). Both fixed; staging smoke verified end-to-end.

**Tests shipped:**

- 12 unit tests for Idempotency middleware (against ioredis-mock)
- 7 DB-gated capacity-lock integration tests (incl. the canonical 10-concurrent-buyers-race-for-3-tickets pinned against real Postgres)
- Final API suite: **751 pass (+12 net new on Day 29), 284 skipped (+7 DB-gated added; CI runs them)**

**Day 29 staging smoke (all GREEN, post-both-hotfixes):**

- main HEAD matches `1a93740`; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in pm2 env (id=1) + `/home/eventpulse/.env.staging`
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok
- Google OAuth `/start`: 302
- Boot log shows `eps.token_cache.backed_by=redis` + `tickets.delivery_worker.started` (Day 26 + Day 28 wiring intact)
- **Idempotency live smokes:** missing key → 400; valid key + bogus event → 404 (typed); replay → cached + `x-idempotency-replay: true`; different body same key → 422
- **Day 27 fraud-prevention regression guards still hold** — spoofed webhook → unknown_transaction; redirect /success unknown-txn → error page

## Next concrete step — Day 30: E2E smoke + §14.10 invariants + Sprint 3 tag

**Scope:**

1. **End-to-end Playwright buyer-journey smoke** (against staging, gated by STAGING_PAYMENT_BLOCK → free-event variant). Per §26.1 Sprint 4 plan but trial-run now: landing page → ticket select → buyer form → submit → confirmation page. EPS init is block-refused for priced events; use a free event (0-paisa tier) to exercise the full pipeline without payment.
2. **§14.10 ledger invariants verification** — Invariant 1: `Σ order.total_paisa = Σ (net_to_organiser + platform_fee + eps_fee + withholding_tax)` for every order in test set. Invariant 2: `Σ disbursement_batch.gross − refunds − withholding = Σ disbursement_batch.net` for every batch (disbursement batches are Sprint 7 scope; for Day 30 only Invariant 1 is testable).
3. **`v0.3.0-sprint-3` annotated tag** on the main commit at session start; release notes from CHANGES.md / commit log covering all 10 days (Day 21 — Day 30).
4. **Sprint 3 retro** via `/sprint` skill (the "transitioning between sprints" mode) — summarise §26 acceptance criteria against shipped work; identify shipped-vs-planned deltas; propose Sprint 4 scope; cut release.
5. **Sprint 4 kick-off GitHub issue** opening with proposed scope.

**Pre-flight reads:**

- CLAUDE.md §14.10 (ledger invariants), §26.1 (Sprint 4 plan), §26.2 (Sprint 8+ — attendee accounts + self-service hosting)
- handoff.md (this file)
- progress.md "Sprint 3 scope" section — gap analysis against §26.1
- `apps/api/src/domain/payments/fee-calculator.ts` — the §14.10 source-of-money-math
- `apps/web/e2e/` — existing Playwright tests for pattern; new buyer-journey spec lands here

**Day 30 STOP-ASK conditions:**

- Any attempt to lift STAGING_PAYMENT_BLOCK without a new decisions.md entry + Moshiur sign-off → STOP.
- Any real EPS network call about to fire → STOP.
- E2E buyer-journey requires a paid event → STOP (use free event only).
- Sprint 3 tag → confirm with Moshiur before pushing (tags are publicly visible artefacts).

## After Day 30 — Decision N truth gate is THE blocker

Pipeline state after Day 30:

- ✅ Init step ready (Day 26 Phase 1; currently block-refused for priced)
- ✅ Verify step ready (Day 26 Phase 1)
- ✅ State machine ready (Day 27 Phase 1)
- ✅ Settlement ready (Day 27 Phase 2 + Phase 3 paths)
- ✅ Post-paid delivery ready (Day 28)
- ✅ Idempotency middleware ready (Day 29 Phase 1)
- ✅ Capacity lock ready (Day 29 Phase 2)
- ✅ E2E buyer journey verified for free-events (Day 30)

What's left BEFORE truth gate can run:

1. **Moshiur supplies EPS sandbox creds** OR explicitly authorizes block lift for 4 controlled real charges.
2. **AIT tax opinion** so the calculator can be adjusted (or confirmed pre-withholding-is-correct).
3. **SES out-of-sandbox** so real ticket emails deliver to test accounts.

When all three land, the truth gate executes per the §11.0 protocol (above).

## Pending Moshiur actions — Day 29 carries

**Most urgent (gates Day 30+ truth-gate path):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; requires new `decisions.md` entry per §11.0 guardrail).
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**
3. **SES out-of-sandbox approval.**

**Lower urgency (continued):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — first paying tenant gated.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one, single add-point in webhook handler.
4. **bootstrap-staging.sh validation guard live-trigger** — PR #154 (Day 25) ran on the OLD bootstrap; new validation runs on the NEXT bootstrap.
5. **NotoSansBengali font bundling for PDF tickets** — pure-Bangla strings (future form-builder data) render as squares until the font lands.
6. **`sold` decrement on cancel/fail/chargeback transitions** — Day 29 Phase 2 deliberately scope-limited to the INCREMENT path; abandoned awaiting_payment orders permanently consume capacity. Sprint 4+ scope: cleanup-sweep cron OR settle.ts hook for transitions.

## Hard guardrails (carry forward + 4 new from Day 29)

(Carrying forward all Day 28 guardrails; adding 4 Day 29 ones at the end.)

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
- **No client-side PII persistence** — react-hook-form / TanStack Query / sessionStorage rules per Day 17.
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
- **Five distinct greppable EPS error classes** — `StagingPaymentBlockedError` / `EpsConfigError` / `EpsNotImplementedError` / `EpsNetworkError` / `EpsResponseError`. All mutually `instanceof`-distinct.
- **Ticket tier CRUD ships without money math.** Tier stores `price_paisa` raw; the fee-calculator is the only consumer at order time.
- **Ticket tier capacity locking shipped Day 29 Phase 2** (FOR UPDATE row lock with ORDER BY id for deadlock avoidance).
- **Public event visibility + status gating is application-policy, not RLS.** `withSuperAdmin()` is the correct context for public-side reads/writes.
- **Buyer-write order path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary.** Settle service (Day 27) + Delivery service (Day 28) follow the same pattern.
- **Order row fee snapshot includes 4 extension columns beyond §9.5 verbatim** per §14.4 + Decision N.
- **Redis token cache stampede semantic: accept-double-fetch-but-cache-last.**
- **Drizzle `ANY()` array-binding via raw `sql\`\`` does NOT work; use `inArray()` helper.**
- **EPS webhook auth model is verify-by-callback (§11.1 step 11), NOT signature verification.**
- **Browser redirect URLs are NEVER authoritative for payment status (§1.3 R3).**
- **Webhook + redirect handlers ALWAYS return 200 OK on business outcomes** (only generic 500 on uncaught errors).
- **QR token is 256-bit cryptographically-random opaque base64url.**
- **PDF tickets travel as email attachments, NO S3 bucket.**
- **Delivery is DECOUPLED from settlement.** `enqueueOrderDelivery()` NEVER throws.
- **`order.delivery_sent` is the append-only delivery marker** (paired with `order.attendees_generated`).
- **BullMQ requires a DEDICATED Redis connection with `maxRetriesPerRequest: null`.**
- **NEW 2026-05-25 — `Idempotency-Key` middleware fails CLOSED on Redis absence (503 IDEMPOTENCY_INFRA_UNAVAILABLE).** Differs from Day 28's `enqueueOrderDelivery` fail-open because idempotency gates the source-of-truth path; passing through would defeat R6's at-most-once guarantee.
- **NEW 2026-05-25 — Idempotency body hash = SHA-256 of RAW request bytes** (NOT canonicalised JSON). Two requests with the same serialised bytes are truly identical; semantically-equivalent-but-textually-different payloads are TREATED AS DIFFERENT. Strict policy prevents "client retried with a tiny field reorder and we returned the wrong cached response."
- **NEW 2026-05-25 — FOR UPDATE capacity lock uses ORDER BY id for multi-tier deadlock avoidance.** Without it, two concurrent orders touching {A,B} and {B,A} can deadlock. ORDER BY id makes scan order canonical so both orders acquire locks in the same order.
- **NEW 2026-05-25 — Hono middleware that hashes request body MUST use `c.req.raw.clone().text()`, NOT `c.req.text()`.** The latter consumes the underlying stream so downstream zValidator's `c.req.json()` fails in real HTTP traffic. Unit tests with `app.request()` shortcut Hono's internal caching and miss the gap.
- **NEW 2026-05-25 — Redis singleton needs explicit `await redis.connect()` at boot** to avoid first-request-after-pm2-reload race. The `lazyConnect: true` + `enableOfflineQueue: false` combination (Day 26 design for EPS token cache fail-fast) requires warm-up at boot for the idempotency middleware to work on the first request. Warm-up errors are swallowed; consumers handle absence themselves.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run Day 29 idempotency unit tests
pnpm --filter @eventpulse/api exec vitest run src/middleware/idempotency.test.ts

# Run Day 29 capacity lock DB-gated tests (needs DATABASE_URL)
pnpm --filter @eventpulse/api exec vitest run src/services/orders/capacity-lock.test.ts

# Live Idempotency smoke
curl -s -X POST -H "content-type: application/json" \
  -H "idempotency-key: smoke-12345-12345" \
  -d '{"eventId":"00000000-0000-0000-0000-000000000000","tierSelections":[{"tierId":"00000000-0000-0000-0000-000000000000","quantity":1}],"buyer":{"name":"x","email":"x@example.com","phone":"+88017"}}' \
  https://api.staging.eventpulse.com.bd/api/v1/public/orders
# Expected: 404 NOT_FOUND (typed) on first call; cached replay with x-idempotency-replay: true on second

# Replay smoke (same key + same body → cached)
curl -s -i [...same payload...] | grep -i x-idempotency-replay
# Expected: x-idempotency-replay: true on the second call
```
