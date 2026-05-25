# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 28 COMPLETE — QR + PDF + BullMQ background-worker delivery, end-to-end behind STAGING_PAYMENT_BLOCK, staging worker boot signal verified live)
**Driver:** Claude Code (Opus 4.7) — Day 28 closeout; **next session opens Sprint 3 Day 29 — `Idempotency-Key` middleware + FOR UPDATE capacity lock on `ticket_tiers`.**

## State right now (2026-05-25 EOD)

**Sprint 3 Day 28 COMPLETE.** All 4 phases shipped through 3 PRs in dependency order; Phase 4 verification done on staging with the new `tickets.delivery_worker.started` boot signal confirmed live.

**Branches + PRs:**

- `origin/main` HEAD = `f4ef282` (PR #168 — BullMQ delivery worker)
- Staging EC2 deployed code = `f4ef282` (verified below)
- **3 Day 28 PRs MERGED:**
  - PR #166 (Phase 1) `feat(tickets): per-attendee QR token + attendee row generation` → merged `4392307`
  - PR #167 (Phase 2) `feat(tickets): PDF ticket generation with embedded QR` → merged `64e13dd`
  - PR #168 (Phase 3) `feat(tickets): BullMQ delivery worker — QR + PDF + email on paid` → merged `f4ef282`
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate.

**Day 28 deliverables (all merged):**

- ✅ **QR token mint** at `apps/api/src/services/attendees/qr-token.ts` (9 unit tests, 4ms). 256-bit cryptographically-random opaque token, base64url-encoded (43 chars), stored in `attendees.qr_code` (UNIQUE constraint from migration 0013). Forgery-resistance: brute force at 1B/sec takes ~3.7×10^60 years. Mirror of `mintMerchantTransactionId` pure-inner + thin wrapper pattern.
- ✅ **Attendee row generation** at `apps/api/src/services/attendees/generate.ts` — one row per `(order_item × quantity)` under withSuperAdmin (same trust-boundary pattern as settle.ts). Idempotent via `order.attendees_generated` append-only marker in order_events. New `writeAttendeesGenerated` one-per-domain audit helper at `services/audit/attendees.ts`. MVP naming: buyerName verbatim for quantity=1, "buyerName (Ticket N of M)" suffix for quantity>1 (per-attendee form capture is Phase 2 scope).
- ✅ **PDF ticket render** at `apps/api/src/services/tickets/{qr-image,render-ticket-pdf}.ts`. QR encodes `${API_BASE}/scan/{token}` URL so phone cameras scan + open natively (no custom scanner app for MVP). pdfkit (vanilla, ~500KB) over @react-pdf/renderer (React tax). Bilingual via locale param; bn labels rendered as "Bangla / English" so English half remains scannable when Bangla glyphs fall through Helvetica (NotoSansBengali bundling is future improvement). Defence-in-depth brand colour sanitisation (regex `/^#[0-9A-Fa-f]{6}$/`). **PDF travels as email attachment, NO S3 bucket** — avoids the AWS-write surface STOP-ASK.
- ✅ **SES raw-MIME path** at `apps/api/src/infra/ses/raw-email.ts` — `sendEmailRaw()` via Content.Raw; `buildMimeMessage` pure helper assembles multipart/mixed → multipart/alternative → application/pdf. RFC 5322 CRLF + RFC 2047 B-encoding for non-ASCII subjects. Honours `MAIL_DRY_RUN=1`.
- ✅ **Two bilingual SES templates** at `apps/api/src/infra/ses/templates/{order-confirmed,attendee-ticket}.ts` per §16.3. Order confirmed = buyer summary (no PDF). Attendee ticket = per-attendee with PDF attached + "don't share this ticket" warning.
- ✅ **BullMQ queue + worker** at `apps/api/src/workers/{delivery-queue,delivery-worker}.ts`. Job name `deliver-order` on queue `tickets-delivery`. Job id `delivery:${orderId}` dedupes at enqueue. 5 attempts, exponential backoff (5s..52m, ~63min before DLQ). **DEDICATED Redis connection** (`getBullRedis()`) because BullMQ requires `maxRetriesPerRequest: null` (blocking commands); the singleton at `infra/redis/client.ts` stays bounded for the EPS token cache hot path. Worker concurrency=2 (env-tunable). Graceful shutdown on SIGTERM in `index.ts`.
- ✅ **Settle.ts on-paid hook** — `if (target === 'paid') await enqueueOrderDelivery({ orderId })` inside the paid-transition branch AFTER tx commits. `enqueueOrderDelivery` NEVER throws (settlement reliability invariant): Redis blip returns `{enqueued: false}` + logs.
- ✅ **Delivery orchestration** at `apps/api/src/services/tickets/deliver-order.ts` — end-to-end deliver: load order → generateAttendeesForOrder (Phase 1) → render PDFs (Phase 2) → send buyer + per-attendee emails → mark delivered. Two markers in sequence (`attendees_generated` + `delivery_sent`) so the worker can retry delivery-half without re-generating attendees. Throws on infra failures so BullMQ retries; discriminated union for business outcomes. New `writeOrderDelivered` audit helper.

**Tests shipped:**

- 9 QR token pure unit tests
- 11 DB-gated attendee-generation integration tests
- 9 QR image unit tests + 19 PDF render property-based tests
- 8 raw-MIME builder unit tests + 4 queue no-Redis unit tests
- 10 DB-gated deliverOrder integration tests
- Plus `vi.useFakeTimers()` flake fix on 12 pre-existing webhook rate-limit tests
- Final API suite: **739 pass (+49 net new on Day 28), 277 skipped (+21 DB-gated added; CI runs them)**

**Day 28 staging smoke (all GREEN):**

- main HEAD post-Phase-3 deployed; EC2 HEAD matches `f4ef282`; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in pm2 env (process id=1, the API) + `/home/eventpulse/.env.staging`
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok, 11ms ping
- Google OAuth `/start`: 302 (Day 24 regression guard holds)
- API log shows: `{"msg":"eps.token_cache.backed_by=redis"}` then `{"queue":"tickets-delivery","concurrency":2,"msg":"tickets.delivery_worker.started"}` then `{"msg":"eventpulse api listening"}` — **clean boot, worker started, no crash**
- **Day 27 fraud-prevention smoke STILL holds** (regression guard): POST webhook with spoofed `{"status":"SUCCESS"}` for `TXN-day28-spoofed-paid-99999` → 200 + `kind:unknown_transaction` (claim ignored)
- **Day 27 redirect non-authority smoke STILL holds**: GET /eps-return/success unknown-txn → 302 to /orders/return/error (no orderId leakage)
- `MAIL_DRY_RUN=1` set; deliveries dry-run (logic exercises end-to-end; real sends gate on SES out-of-sandbox)

## Next concrete step — Day 29: Idempotency middleware + FOR UPDATE capacity lock

The two remaining cross-cutting concerns on the order-creation surface before Sprint 3 closeout.

**Idempotency middleware (per §1.3 R6 + §6.4):**

- Read `Idempotency-Key` header on money-moving endpoints (`POST /api/v1/public/orders`, future refund/disbursement routes).
- Check Redis cache for `idempotency:${tenantId}:${key}` (24-hour TTL per §6.4) → if hit, return cached response.
- Check DB partial unique index `idx_orders_idempotency_key` (already in migration 0013) for replay detection.
- On first call: cache key+response after the route handler returns success.
- Discriminated outcome: idempotent-replay (return cached body) | new-request (continue) | partial-result (return 202 with retry-after if cached result was an error).
- Middleware lives in `apps/api/src/middleware/idempotency.ts`.

**FOR UPDATE capacity lock (per gotchas.md "Day 29 scope" carry):**

- Inside the order-creation tx in `services/orders/index.ts createOrder()`, before insert:
  ```typescript
  SELECT id, sold, capacity FROM ticket_tiers
    WHERE id IN (...selected tier ids) FOR UPDATE
  ```
- For each selected tier: verify `sold + requestedQuantity <= capacity`. If not, reject with `TIER_SOLD_OUT` error.
- Update `ticket_tiers.sold = sold + requestedQuantity` in the same tx.
- The FOR UPDATE serialises concurrent requests against the same tier — no oversell race.
- The `sold` column already exists in migration 0012.

**Pre-flight reads:**

- CLAUDE.md §1.3 R6 (idempotency), §6.4 (idempotency-header convention), §9.3 (`ticket_tiers.sold` column)
- `apps/api/src/services/orders/index.ts` — the trust-boundary handler for the FOR UPDATE addition
- `apps/api/src/db/migrations/0013_orders.sql` — confirm `idx_orders_idempotency_key` partial unique index is in place
- `apps/api/src/db/migrations/0012_ticket_tiers.sql` — confirm `sold` column
- handoff.md (this file) + decisions.md "Day 28 architectural choices" (next memory PR)

**Day 29 STOP-ASK conditions:**

- Any pull-forward of Day 30 work (E2E smoke + §14.10 invariant verification + Sprint 3 tag) → STOP.
- Cache key shape ambiguity (tenant-scoped vs global) — surface tradeoffs (lean: tenant-scoped per §6.4 + per-tenant Redis namespace).
- Capacity overcommit semantics for multi-item carts — surface before assuming all-or-nothing rollback.
- Any AWS write beyond the existing Redis/DB.
- STAGING_PAYMENT_BLOCK observed not =1 → critical flag.

## Day 30 — End-to-end smoke + §14.10 invariants + Sprint 3 closeout

- Full E2E buyer journey smoke (against staging, gated by STAGING_PAYMENT_BLOCK — free-event shape only).
- Verify all four §14.2 fee modes work + accounting reconciles (§14.10 invariants).
- `/sprint` retro + tag `v0.3.0-sprint-3` + release notes + Sprint 4 kick-off issue.

## Decision N truth gate — pipeline now end-to-end (post-Day 28)

After Day 28 ships:

- ✅ Init step ready (Day 26 Phase 1; currently block-refused)
- ✅ Verify step ready (Day 26 Phase 1)
- ✅ State machine ready (Day 27 Phase 1)
- ✅ Settlement ready (Day 27 Phase 2 + Phase 3 paths)
- ✅ **Post-paid delivery ready (Day 28)** — QR + PDF + email worker, gated on MAIL_DRY_RUN for staging

After Day 29 ships (idempotency + capacity), the pipeline is feature-complete and the Decision N truth gate becomes the gating milestone. The truth gate then executes as a SEPARATE controlled real-money run: 4 §14.2-mode transactions, smallest viable amounts, **Moshiur approves amounts first**, STAGING_PAYMENT_BLOCK lifted ONLY for that run then re-enabled. Pre-reqs unchanged:

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; requires new `decisions.md` entry per §11.0 guardrail).
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**

## Pending Moshiur actions (procurement / external) — cumulative through Day 28

**Most urgent (gates Decision N truth-gate → blocks Day 30 end-to-end smoke):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**
3. **SES out-of-sandbox approval** — without it, real ticket emails won't deliver to non-verified addresses; staging stays MAIL_DRY_RUN=1; production launch gated on this.

**Lower urgency (continued):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one, single add-point in `apps/api/src/routes/webhooks/eps.ts` (additive defense-in-depth on top of the existing verify-by-callback authority model).
4. **bootstrap-staging.sh validation guard live-trigger.** PR #154 (Day 25) ran on the OLD bootstrap; new validation runs on the NEXT bootstrap.
5. **NotoSansBengali font bundling for PDF tickets** — currently English text + Bangla labels in "bn/en" format render correctly; pure-Bangla strings (e.g. attendee Bangla names from future form-builder data) will render as squares until the font lands. Documented as future improvement in `render-ticket-pdf.ts` header.

## Hard guardrails (carry forward + 5 new from Day 28)

(Carrying forward all Day 27 guardrails; adding 5 Day 28 ones at the end.)

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
- **Buyer-write order path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary.** Settle service (Day 27) follows the same pattern. **Delivery service (Day 28) follows the same pattern** — worker has no tenant session.
- **Order row fee snapshot includes 4 extension columns beyond §9.5 verbatim** (`platform_fee_bps`, `eps_fee_bps`, `platform_fee_handling`, `eps_fee_handling`) per §14.4 + Decision N.
- **Redis token cache stampede semantic: accept-double-fetch-but-cache-last.**
- **Drizzle `ANY()` array-binding via raw `sql\`\`` does NOT work; use `inArray()` helper.**
- **EPS webhook auth model is verify-by-callback (§11.1 step 11), NOT signature verification.** §11 does not specify a signature mechanism; the handler treats payload as notification only + always calls `verifyOrder()` against EPS for authoritative status.
- **Browser redirect URLs are NEVER authoritative for payment status (§1.3 R3).** Outbound redirect target is computed from the RESOLVED order status from `settleOrderFromEps`.
- **Webhook + redirect handlers ALWAYS return 200 OK on business outcomes** (only generic 500 on uncaught errors). Avoids leaking + suppresses EPS retry storms.
- **NEW 2026-05-25 — QR token is 256-bit cryptographically-random opaque base64url.** Forgery-resistance: 256 bits of entropy = effectively unguessable. Revocability via row delete (no shared signing-key compromise surface). The QR image encodes a check-in URL `${API_BASE}/scan/{token}`; the token alone is meaningless without the DB row.
- **NEW 2026-05-25 — PDF tickets travel as email attachments, NO S3 bucket.** Phase 0 chose this to avoid the AWS-write surface STOP-ASK on a new bucket + KMS pair. SES 40MB attachment limit is comfortable. If/when "resend ticket from dashboard" UX lands, that's a separate decision with its own bucket setup.
- **NEW 2026-05-25 — Delivery is DECOUPLED from settlement.** `enqueueOrderDelivery()` NEVER throws (Redis blip returns `{enqueued: false}` + logs); settlement commits paid independently; delivery is a downstream retry surface. A failed delivery does NOT roll back the paid status.
- **NEW 2026-05-25 — `order.delivery_sent` is the append-only delivery marker.** Two markers fire in sequence (`order.attendees_generated` + `order.delivery_sent`) so the worker can retry the delivery half without re-generating attendees. Both live in `order_events` (append-only at GRANT layer per §4.2.1.1).
- **NEW 2026-05-25 — BullMQ requires a DEDICATED Redis connection with `maxRetriesPerRequest: null`.** The singleton at `infra/redis/client.ts` (`maxRetriesPerRequest: 2`) is incompatible because BullMQ uses blocking commands (BRPOPLPUSH). New `getBullRedis()` in delivery-queue.ts mints a separate ioredis instance for BullMQ; the singleton stays bounded for the EPS token cache hot path. Future BullMQ consumers (refunds, disbursements) reuse `getBullRedis()`.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Day 28 worker boot signal
sudo tail -100 /home/eventpulse/logs/api.out.log | grep tickets.delivery_worker
# Expected: {"queue":"tickets-delivery","concurrency":2,"msg":"tickets.delivery_worker.started"}

# Run Day 28 QR token tests (pure, no DB)
pnpm --filter @eventpulse/api exec vitest run src/services/attendees/qr-token.test.ts

# Run Day 28 PDF tests (pure, no DB)
pnpm --filter @eventpulse/api exec vitest run src/services/tickets/

# Run Day 28 queue tests (unit, no Redis)
pnpm --filter @eventpulse/api exec vitest run src/workers/

# Run Day 28 SES raw-MIME tests
pnpm --filter @eventpulse/api exec vitest run src/infra/ses/raw-email.test.ts

# Run Day 28 deliver-order DB-gated integration tests (needs DATABASE_URL)
pnpm --filter @eventpulse/api exec vitest run src/services/tickets/deliver-order.test.ts

# Run Day 28 attendee generation DB-gated tests
pnpm --filter @eventpulse/api exec vitest run src/services/attendees/generate.test.ts

# Live regression smoke (Day 27 fraud-prevention)
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-paid-12345","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}
```
