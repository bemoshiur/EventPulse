# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 27 COMPLETE — order state machine + authenticated webhook + browser redirects, all behind STAGING_PAYMENT_BLOCK, verified end-to-end on staging with a live fraud-prevention smoke)
**Driver:** Claude Code (Opus 4.7) — Day 27 closeout; **next session opens Sprint 3 Day 28 — QR generation per attendee + PDF ticket + email delivery via the bilingual SES templates from Day 21 AM (`order_confirmed`, `attendee_ticket`).**

## State right now (2026-05-25 EOD)

**Sprint 3 Day 27 COMPLETE.** All 4 phases shipped through 3 PRs in clean dependency order; Phase 4 verification done on staging with a live spoofed-webhook smoke proving the verify-by-callback authority model.

**Branches + PRs:**

- `origin/main` HEAD = `de0faed` (PR #164 — browser redirect handlers)
- Staging EC2 deployed code = `de0faed` (verified below)
- **3 Day 27 PRs MERGED:**
  - PR #162 (Phase 1) `feat(orders): pure order state machine + transition validation` → merged `46a2575`
  - PR #163 (Phase 2) `feat(eps): authenticated webhook + verifyOrder reconciliation` → merged `bcfb89c`
  - PR #164 (Phase 3) `feat(eps): browser redirect handlers (success/fail/cancel) — display-only` → merged `de0faed`
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate.

**Day 27 deliverables (all merged):**

- ✅ **Pure order state machine** at `apps/api/src/domain/order-state-machine.ts` (113 unit tests, 6ms). 11 states matching the live `orders_status_chk` constraint verified Phase 0. Encodes §2.5 + §11.1 transitions. 5 terminal states. Self-transitions rejected (idempotency is a service-layer concern). Companion `mapEpsStatusToOrderTransition()` is the EPS↔order seam; pairs with `normaliseStatus` from `infra/eps/normalise-status.ts`.
- ✅ **Authenticated webhook + verifyOrder reconciliation + idempotent settlement.** Service at `apps/api/src/services/orders/settle.ts settleOrderFromEps()`; route at `apps/api/src/routes/webhooks/eps.ts` (mounted at `/api/v1/webhooks/eps/callback`). **Auth model: verify-by-callback as the AUTHORITY** — user-approved Day 27 Phase 0 STOP-ASK (§11.1 step 11 design; §11 does NOT specify a webhook signature mechanism). Handler does NOT trust any payload field — only consumes `merchant_transaction_id` as a DB lookup key + ALWAYS calls `verifyOrder()` against EPS. Defense-in-depth: zod body validation + per-IP rate-limit (100/min) + per-txn-id rate-limit (20/min) + always-200-OK + idempotent fast-path on already-settled orders. Discriminated-union `SettlementResult` with 5 outcome kinds. **Live fraud-prevention smoke confirmed Phase 4:** POST webhook with claimed `status:SUCCESS` for unknown txn → 200 + `kind:unknown_transaction` (claim completely ignored). New `apps/api/src/lib/rate-limit.ts` primitive (in-memory; Redis swap is a future single-call-site change).
- ✅ **Browser redirect handlers (display-only, non-authoritative).** Routes at `/api/v1/public/orders/eps-return/{success,fail,cancel}` (GET). **CRITICAL invariant pinned by 3 tests:** the inbound `/eps-return/*` URL is NEVER authoritative — outbound redirect target computed from the RESOLVED order status (from `settleOrderFromEps`'s verify response), NOT from which path EPS sent the buyer to. Both webhook + redirects call the same settle service — uniform verify-by-callback authority. Outbound targets: `${EVENTPULSE_WEB_BASE_URL}/orders/return/{success,fail,cancel,pending,error}?orderId=...` (frontend pages at these URLs are Day 28+ scope). No-PII: only `orderId` echoed in outbound query.

**Tests shipped:**

- 113 pure-unit state machine tests
- 19 webhook unit tests (settle service vi.mock'd) + 10 DB-gated settle integration tests
- 19 redirect handler unit tests (settle service vi.mock'd)
- 7 rate-limit primitive unit tests
- Final API suite: **690 pass (+168 net new on Day 27), 256 skipped (DB-gated tests run in CI)**

**Day 27 staging smoke (all GREEN):**

- main HEAD post-Phase-3 deployed; EC2 HEAD matches `de0faed`; zero drift
- `STAGING_PAYMENT_BLOCK=1` still enforcing in pm2 env + .env.staging
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200
- Google OAuth `/start`: 302 (Day 24 regression-guard holds)
- Boot log shows `eps.token_cache.backed_by=redis` (Day 26 Phase 2 still wired)
- **Webhook malformed payload** → 200 OK + `ignored:malformed`
- **Webhook spoofed-claim-paid for unknown txn** → 200 OK + `kind:unknown_transaction` (the "SUCCESS" status claim was IGNORED — live fraud-prevention proof)
- **Redirect /success unknown-txn** → 302 to `${WEB_BASE}/orders/return/error` (no orderId leakage)
- **Redirect missing txn-id** → 302 to error page

## Next concrete step — Day 28: QR + PDF + email post-paid delivery

Wire the order-paid transition (from Day 27 settle service) to the post-paid delivery surface. Smaller-scope session than Day 26 + 27 because the foundation is in place.

- **QR code generation per attendee row.** The `attendees` table from migration 0013 has a `qr_code` UNIQUE column. On `order.paid` transition (in `settleOrderFromEps`'s success branch — or as a subsequent background step), insert one attendee row per `(order_item × quantity)` with a generated unique qr_code.
  - QR encoding: cryptographically-random opaque token (mirror the `mintMerchantTransactionId` pattern but for a different namespace). The QR itself encodes a URL like `https://<tenant>.staging.eventpulse.com.bd/scan/${qr_code}` so a future scanner app can hit a single endpoint.
- **PDF ticket generation per attendee.** One PDF per attendee row. Wraps event title, attendee name, ticket tier name, QR code (rendered as image), event date/venue, tenant brand. Library options: `pdfkit` (well-established Node lib) or `@react-pdf/renderer` (JSX-based — mirrors existing React frontend conventions but heavier).
- **Email delivery via Day 21 AM bilingual SES templates.** Templates `order_confirmed` (to buyer) + `attendee_ticket` (to attendee, possibly buyer if same person, with PDF attached). Locale per `tenants.preferred_locale` (en/bn).
- **Wiring options:**
  - (a) Inline in `settleOrderFromEps`'s success branch — simplest, single-tx delivery + DB writes.
  - (b) Background worker (BullMQ + Redis — Redis already provisioned) — better for retry semantics + slow PDF generation + email send latency.
  - **(b) is the right choice for production reliability.** The settle service writes attendee rows + enqueues a "deliver-tickets" job; the worker generates PDFs + sends email. Failure of the worker doesn't break order settlement.

**Pre-flight reads:**

- CLAUDE.md §16 (notifications + SES templates), §1.3 R12 (bilingual UI), §17 (single EC2 — BullMQ runs in-process there)
- CLAUDE.md §9.5 (attendees table — already migrated in 0013)
- `apps/api/src/infra/ses/templates/` for the bilingual templates landed Day 21 AM
- `apps/api/src/services/orders/settle.ts` — the Day 27 success branch is the trigger point
- `apps/api/src/db/schema/index.ts` — the `attendees` table shape
- handoff.md (this file) + decisions.md "Day 27 webhook auth model" (next memory PR)

**Day 28 STOP-ASK conditions:**

- Any pull-forward of Day 29 work (idempotency middleware, FOR UPDATE) → STOP.
- PDF library choice — `pdfkit` vs `@react-pdf/renderer` vs other — surface tradeoffs before committing the dep.
- Background-worker infrastructure choice — BullMQ vs inline-async vs other — should be settled with a brief design surface, not assumed.
- §29 #9 (AIT) opinion still pending → does post-paid delivery surface need a withholding-info line in the PDF? Probably no (the PDF is buyer-facing; AIT is organiser-side). Worth surfacing.
- Any AWS write beyond migrations + SES template re-create.
- STAGING_PAYMENT_BLOCK observed not =1 → critical flag.

## Day 29 — Idempotency middleware + FOR UPDATE capacity lock

- Idempotency middleware reads `Idempotency-Key` header → checks Redis (24h TTL) + DB (the partial unique index on `orders.idempotency_key` from migration 0013 is already in place).
- Capacity lock: `SELECT ... FROM ticket_tiers WHERE id IN (...) FOR UPDATE` inside the order-creation tx prevents oversell. Schema (ticket_tier_id FK on order_items) already in place.

## Decision N truth gate — pipeline now ready THROUGH verify

After Day 27 ships:

- ✅ Init step ready (Day 26 Phase 1; currently block-refused)
- ✅ Verify step ready (Day 26 Phase 1)
- ✅ State machine ready (Day 27 Phase 1)
- ✅ Settlement ready (Day 27 Phase 2 + Phase 3 paths)
- ⏳ Post-paid delivery (Day 28)

After Day 28 ships, the pipeline is end-to-end. The truth gate then executes as a SEPARATE controlled real-money run: 4 §14.2-mode transactions, smallest viable amounts, **Moshiur approves amounts first**, STAGING_PAYMENT_BLOCK lifted ONLY for that run then re-enabled. Pre-reqs unchanged:

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; requires new `decisions.md` entry per §11.0 guardrail).
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**

## Pending Moshiur actions (procurement / external) — cumulative through Day 27

**Most urgent (gates Decision N truth-gate → blocks Day 30 end-to-end smoke):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**

**Lower urgency (continued):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one, single add-point in `apps/api/src/routes/webhooks/eps.ts` (additive defense-in-depth on top of the existing verify-by-callback authority model).
4. **bootstrap-staging.sh validation guard live-trigger.** PR #154 (Day 25) ran on the OLD bootstrap; new validation runs on the NEXT bootstrap.

## Hard guardrails (carry forward + 4 new from Day 27)

(Carrying forward all Day 26 guardrails; adding the 4 Day 27 ones at the end.)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only.
- `audit_logs`, `legal_document_versions`, `order_events` are APPEND-ONLY at the GRANT layer (REVOKE UPDATE/DELETE/TRUNCATE from eventpulse_app; eventpulse_admin retains for regulator redaction).
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
- **Ticket tier capacity locking is Day 29 scope** (FOR UPDATE row lock at paid-order transition).
- **Public event visibility + status gating is application-policy, not RLS.** `withSuperAdmin()` is the correct context for public-side reads/writes (the buyer-write order path mirrors this).
- **Buyer-write order path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary.** Settle service (Day 27) follows the same pattern.
- **Order row fee snapshot includes 4 extension columns beyond §9.5 verbatim** (`platform_fee_bps`, `eps_fee_bps`, `platform_fee_handling`, `eps_fee_handling`) per §14.4 + Decision N.
- **Redis token cache stampede semantic: accept-double-fetch-but-cache-last.**
- **Drizzle `ANY()` array-binding via raw `sql\`\`` does NOT work; use `inArray()` helper.**
- **NEW 2026-05-25 — EPS webhook auth model is verify-by-callback (§11.1 step 11), NOT signature verification.** §11 does not specify a signature mechanism; the handler treats payload as notification only + always calls `verifyOrder()` against EPS for authoritative status. Fraud-impossibility proven (spoofed claims cannot fabricate paid status). Signature mechanism is the single add-point when EPS publishes one — `EPS_WEBHOOK_SECRET`-gated check fires BEFORE the verify-by-callback model (additive defense, not replacement).
- **NEW 2026-05-25 — Browser redirect URLs are NEVER authoritative for payment status (§1.3 R3).** The `/eps-return/{success,fail,cancel}` inbound path is just a notification; outbound redirect target is computed from the RESOLVED order status from `settleOrderFromEps`. Pinned by tests "lands on /success but verify says PENDING → /pending" + "lands on /fail but verify says SUCCESS → /success".
- **NEW 2026-05-25 — Settlement uses `withSuperAdmin` (BYPASSRLS) — same pattern as the buyer-write order path.** Webhook + redirect both lack tenant session; the service is the trust boundary, setting `tenant_id` from the looked-up order row, never from the trigger payload.
- **NEW 2026-05-25 — Webhook + redirect handlers ALWAYS return 200 OK on business outcomes** (only generic 500 on uncaught errors). Avoids leaking which txn ids exist + suppresses EPS retry storms on benign conditions like unknown-txn or malformed-payload.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run Day 27 state machine tests (pure, no DB)
pnpm --filter @eventpulse/api exec vitest run src/domain/order-state-machine.test.ts

# Run webhook + redirect unit tests (settle service vi.mock'd)
pnpm --filter @eventpulse/api exec vitest run src/routes/webhooks/ src/routes/public/orders-eps-return.test.ts

# Run settle service integration tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/services/orders/settle.test.ts

# Live smoke: webhook ignores spoofed payload
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-12345","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}

# Live smoke: redirect rejects unknown txn safely
curl -s -o /dev/null -w "HTTP=%{http_code}\nLocation=%{redirect_url}\n" \
  "https://api.staging.eventpulse.com.bd/api/v1/public/orders/eps-return/success?merchantTransactionId=TXN-unknown-12345"
# Expected: 302 + Location=https://staging.eventpulse.com.bd/orders/return/error
```
