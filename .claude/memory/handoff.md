# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 26 COMPLETE — EPS wrapper Part 2 real HTTP + Redis-backed token cache + order schema migration 0013 + public order creation endpoint, all behind STAGING_PAYMENT_BLOCK, verified on staging)
**Driver:** Claude Code (Opus 4.7) — Day 26 closeout; **next session opens Sprint 3 Day 27 — EPS callback/redirect handlers + server-to-server webhook + verifyOrder reconciliation. Order pipeline NOW live-call-capable through the init step (block-refused); verify step lands next session.**

## State right now (2026-05-25 EOD)

**Sprint 3 Day 26 COMPLETE.** All 5 phases shipped through 4 PRs in clean dependency order (Phase 1 → 2 → 3 → 4); Phase 5 verification done on staging.

**Branches + PRs:**

- `origin/main` HEAD = `63d7a2c` (PR #160 — order creation endpoint)
- Staging EC2 deployed code = `63d7a2c` (verified below)
- **4 Day 26 PRs MERGED:**
  - PR #157 (Phase 1) `feat(eps): wrapper Part 2 — real HTTP for GetToken/InitializeEPS/Verify` → merged `6993492`
  - PR #158 (Phase 2) `feat(eps): Redis-backed access-token cache adapter` → merged `f3f8fee`
  - PR #159 (Phase 3) `feat(orders): order pipeline schema (migration 0013) + RLS` → merged `bebde7a`
  - PR #160 (Phase 4) `feat(orders): public order creation endpoint` → merged `63d7a2c`
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate (executes Day 27+).

**Day 26 deliverables (all merged):**

- ✅ **EPS wrapper Part 2 — real HTTP** in `apps/api/src/infra/eps/{core,get-token,initialise-order,verify-order,eps-http-errors,client}.ts`. Per CLAUDE.md §11 + §11.4. **Block-guard ordering invariant preserved**: `assertEpsCallAllowed` is the first line of `initialiseOrderHttp` that can throw; test pins via nock-not-called assertion (zero HTTP fires when block on + priced). 401 refresh-and-retry-once on InitializeEPS + Verify. Two new greppable error classes: `EpsNetworkError` + `EpsResponseError` (now 5 greppable EPS error classes total, all mutually-distinct per the canonical pattern). `core.ts` exists to break what would otherwise be a circular import between client.ts re-exports and the per-endpoint files.
- ✅ **Redis-backed token cache adapter** in `apps/api/src/infra/{eps/redis-token-cache,redis/client}.ts`. Replaces Day-24 in-memory adapter at the `setDefaultTokenCache` seam in core.ts. **Stampede semantic: accept-double-fetch-but-cache-last** (rationale in file header — full Redis NX-lock single-flight is 60+ LOC for marginal benefit at ~2 PM2 workers). Boot wiring in `index.ts` logs `eps.token_cache.backed_by=redis` vs `=in-memory`. REDIS_URL already provisioned (bootstrap-staging.sh line 450).
- ✅ **Order pipeline schema** migration 0013 (5 tables: orders + order_items + attendees + order_events + refunds) per §9.5 verbatim + 4 fee-snapshot extension columns on orders required by §14.4 + Decision N. `order_events` is APPEND-ONLY at the GRANT layer (REVOKE UPDATE/DELETE/TRUNCATE from eventpulse_app; eventpulse_admin retains for redaction). Buyer-write path uses withSuperAdmin (BYPASSRLS) — mirrors the Day 25 public-events read pattern. Partial unique idempotency index `(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL` for Day 29 middleware. **MANDATORY STOP-ASK** explicitly surfaced + approved before apply.
- ✅ **Public order creation endpoint** `POST /api/v1/public/orders`. Service at `services/orders/index.ts` (5 service functions); mint helper at `services/orders/order-id.ts`; audit at `services/audit/orders.ts` (one-per-domain pattern); route at `routes/public/orders.ts` (zod input + §6.3 SCREAMING_SNAKE error mapping). Every paisa on the order row comes from `calculateOrderFees(...)` — NO fee arithmetic anywhere in the new code. Block-guard surfaces as `paymentInitState='blocked'` with order persisted in `awaiting_payment`. 5 error codes wired (NOT_FOUND × 2 / EVENT_NOT_ON_SALE / TIER_SOLD_OUT / INTERNAL_ERROR + 400 VALIDATION_ERROR via @hono/zod-validator).

**Tests shipped:**

- 67 new EPS tests across 4 files (224 total in EPS suite, incl. the CRITICAL `STAGING_PAYMENT_BLOCK=1 → no HTTP fires` test via nock-not-called)
- 20 Redis-token-cache + Redis-client unit tests (cross-worker sharing pinned)
- 12 DB-gated orders RLS isolation + append-only invariant tests
- 32 orders service + mint-helper tests (money-math equality per mode + block + audit trail + validation paths)
- Final API suite: 539 pass (+131 net new on Day 26), 247 skipped (DB-gated run in CI)

**Day 26 staging smoke (all GREEN):**

- main HEAD post-Phase-4 deployed; EC2 HEAD matches `63d7a2c`; zero drift
- PM2: api online (pid 111209, restart-count cumulative); web online
- `STAGING_PAYMENT_BLOCK=1` still enforcing in pm2 env + .env.staging
- Boot log shows `eps.token_cache.backed_by=redis` — Redis adapter live
- 5 vhosts `/nginx-health`: all 200 SSL=0
- `/health` DB-aware: 200
- Google OAuth `/start`: 302 (Day 24 regression-guard holds)
- New `/api/v1/public/orders`: 400 ZodError on empty body, 404 NOT_FOUND with §6.2 envelope on nonexistent event_id — proves request → zod → service → error-mapping wired end-to-end
- Live order creation with a real seeded event skipped per "no AWS writes beyond migration 0013" guardrail; integration tests in CI cover the live behaviour; zero-drift confirms deployed binary IS the CI-tested one

## Next concrete step — Day 27: EPS callback/webhook handlers + verifyOrder reconciliation

**Single focused session.** Smaller scope than Day 26 because the wrapper + schema + endpoint are now in place.

- **Redirect handlers** `/api/v1/public/orders/eps-return/{success,fail,cancel}` per §11.3 env var spec (`EPS_SUCCESS_URL` / `EPS_FAIL_URL` / `EPS_CANCEL_URL` already populated in staging). Per **§1.3 R3 + §11**: NEVER trust query-string status; the redirect handler always calls `verifyOrder()` to get authoritative status from EPS.
- **Server-to-server webhook** `POST /api/v1/webhooks/eps/callback` per §10.5. Same flow: verify signature → call `verifyOrder()` → update order state. Both paths converge on the same state-transition function.
- **Order state machine** as a pure transition function mirroring the `event-state-machine.ts` discipline (separation of validation from side effects). `awaiting_payment` → `paid` / `failed` / `cancelled` via the §9.5 11-state CHECK enum. State transitions write to `order_events` (the append-only trail).
- **Idempotency at the callback layer** — `merchant_transaction_id`-keyed dedup so duplicate redirects / duplicate webhooks reconcile to ONE state transition (not multiple). This is callback-layer idempotency, distinct from the Day 29 `Idempotency-Key`-header middleware on the order CREATION path.
- 401 refresh-and-retry on Verify already wired in Phase 1; the callback path consumes it.

**Pre-flight reads:**

- CLAUDE.md §11 (EPS flow + webhook), §10.5 (webhook routes), §1.3 R3 (never trust redirect query params), §9.5 (orders status enum)
- `apps/api/src/infra/eps/verify-order.ts` (Phase 1 — already callable; just needs callers)
- `apps/api/src/services/orders/index.ts` (Phase 4 — the createOrder service that callbacks complement)
- `apps/api/src/db/migrations/0013_orders.sql` (the schema callbacks update)
- `decisions.md` "EPS wrapper Part 1 ships in-memory token cache; Redis adapter swap is Day 26+" (2026-05-25) + "Day 26 order pipeline schema choices" (2026-05-25)
- handoff.md (this file)

**Day 27 STOP-ASK conditions (load-bearing):**

- Any divergence from "callback/webhook + state machine + verifyOrder reconciliation" scope → STOP. Day 28 = QR/PDF/email; Day 29 = idempotency middleware + FOR UPDATE.
- EPS webhook signature verification mechanism unclear from §11 → STOP-ASK (the wrapper doesn't have webhook-sig primitives yet).
- 'expired' status comes up as a needed transition → reopen migration 0013 with its own STOP-ASK + state-machine coordination.
- §29 #9 (AIT withholding) opinion still pending → can the state machine ship without it? Probably yes (withholding is post-paid settlement, not callback state). Surface the question, don't proceed past it without resolution.
- Any AWS write beyond migrations or seed scripts → STOP-ASK.
- STAGING_PAYMENT_BLOCK observed not =1 → critical flag, halt.

## Day 28 (the day after Day 27) — QR + PDF + email delivery

- QR code generation per attendee row (one row per `(order_item × quantity)`). `qr_code` UNIQUE on attendees.
- PDF ticket generation per attendee.
- Email delivery via the bilingual SES templates from Day 21 AM (`order_confirmed`, `attendee_ticket`). Locale per `tenants.preferred_locale`.

## Day 29 — Idempotency middleware + FOR UPDATE capacity lock

- Idempotency middleware reads `Idempotency-Key` header → checks Redis (24h TTL) + DB (the partial unique index on `orders.idempotency_key` is already in place from migration 0013).
- Capacity lock: `SELECT ... FROM ticket_tiers WHERE id IN (...) FOR UPDATE` inside the order-creation tx prevents oversell at paid-order transition. Schema (`ticket_tier_id` FK on `order_items`) already in place from migration 0013.

## Decision N truth gate — pipeline NOW ready through the init step

After Day 26 Phase 4 shipped, the pipeline is live-call-capable through `initialiseOrder` (currently block-refused). Verify step lands Day 27. **The truth gate executes as a SEPARATE controlled real-money run:** 4 §14.2-mode transactions, smallest viable amounts, **Moshiur approves amounts first**, STAGING_PAYMENT_BLOCK lifted ONLY for that run then re-enabled. Pre-reqs unchanged:

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation for 4 truth-gate transactions (4 × small real charges; requires new `decisions.md` entry per §11.0 guardrail). Safest path: separate sandbox set at `eventpulse/staging/eps-sandbox`.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.** Calculator ships PRE-withholding; truth-gate semantics depend on the answer.

## Pending Moshiur actions (procurement / external) — Day 26 cumulative

**Most urgent (gates Decision N truth-gate execution → blocks Day 30 end-to-end smoke):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation for 4 truth-gate transactions.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.**

**Lower urgency (continued from prior days):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).** PR #149 merged Day 24; only live click-through unverified. Revert is `gh pr revert <a8cdb96>` if broken.
2. **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked.
3. **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit only on compromise event.
4. **bootstrap-staging.sh validation guard live-trigger.** The PR #154 (Day 25) change ran on the OLD bootstrap; new validation runs on the NEXT bootstrap.

## Hard guardrails (carry forward + 5 new from Day 26)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1). Owner login = `The-Public-Pulse-Agency`.
- `audit_logs` is APPEND-ONLY (§1.3 R8 + §4.2.1.1). `legal_document_versions` also append-only. **`order_events` is APPEND-ONLY** (NEW Day 26).
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`.
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()`.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object.**
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory; sessionStorage: opaque IDs only. **Detail-view PII queries override defaults** to `staleTime: 0` + `gcTime: 0`.
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`.**
- **BIN 13-digit fact is reviewer-documentation, NOT server-side enforcement.**
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded.**
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.**
- **Manual-verification policy is load-bearing.** Phase 2 trigger = 50 verified submissions/week sustained.
- **Porichoy adapter scaffold-only shape is canonical** for future automation integrations.
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts.
- **Admin route group lives under `/(admin)/admin/...`** to avoid collisions.
- **Markdown sanitization is via `renderLegalMarkdown()` in `apps/api/src/domain/legal/render.ts`** (Decision J).
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K).
- **`consent_records` table is Sprint 3+ scope** (Decision L).
- **EPS library is in-house wrapper** at `apps/api/src/infra/eps/`. NO SDK.
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing. Guard code-shipped (PR #148, Day 24). Real-HTTP wrapper (PR #157, Day 26) preserves block-guard ordering at the FIRST line of initialiseOrder.
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** Day 20 PR #104 regression-guard test fires loud if anyone reverts.
- **Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC + billing + deploy keys.
- **AWS SDK v3 packages must bump together.** Dependabot grouping config landed.
- **Self-modifying scripts need TWO deploys to verify.**
- **`@noble/hashes` stays at v1.8.0 through Days 24-25 truth gate.** PR #72 deferred. Day 26 EPS wrapper Part 2 + Redis cache use v1 bare specifiers; v2 transition with `.js` suffixes lands post-truth-gate.
- **Apple Sign-In dropped from MVP scope.** Re-introducing is a deliberate Phase 2+ PR.
- **`/api/v1/*` paths belong on `api.staging` vhost ONLY.** Frontend uses absolute URLs via `NEXT_PUBLIC_API_BASE_URL`.
- **EPS fee is NOT per-tenant configurable.** Order-time input only.
- **OAuth callback redirect target = apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`** (Day 24 PR #149).
- **EPS wrapper Part 1 shipped in-memory token cache; Redis adapter swapped at Day 26 Phase 2** (Day 24 → Day 26 deferral resolved).
- **Five distinct greppable EPS error classes** (Day 26 extends three-error pattern) — `StagingPaymentBlockedError` / `EpsConfigError` / `EpsNotImplementedError` / `EpsNetworkError` / `EpsResponseError`. All mutually `instanceof`-distinct.
- **Ticket tier CRUD ships without money math.** Tier stores `price_paisa` raw; the fee-calculator is the only consumer at order time.
- **Ticket tier capacity locking is Day 29 scope.** `sold` counter exists on tiers from migration 0012; the `SELECT … FOR UPDATE` row lock lands at Day 29 alongside the idempotency middleware. CRUD does NOT update `sold`.
- **Public event visibility + status gating is application-policy, not RLS.** RLS filters by tenant scope; visibility (`public | unlisted`) + status (`published | on_sale | sold_out | live`) are policy filters applied in queries — not in RLS policies. `withSuperAdmin()` (BYPASSRLS) is the correct context for any read/write that genuinely crosses tenant scope (no tenant session at write time).
- **NEW 2026-05-25 — Buyer-write order path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary.** Mirrors the Day 25 public-events read pattern (`decisions.md` "Public event reads use withSuperAdmin + path-mode URLs" 2026-05-25). The route resolves event_id → tenant_id, validates the event is sellable, validates tier exists, and sets tenant_id explicitly on the INSERT. Tenant-context reads/updates afterwards are RLS-scoped normally.
- **NEW 2026-05-25 — order_events APPEND-ONLY at GRANT layer.** Same `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` pattern as `audit_logs` (§4.2.1.1). `eventpulse_admin` retains full grants for regulator-required redaction. Test pins both: app-context throws permission-denied, admin-context retains mutation path.
- **NEW 2026-05-25 — order row fee snapshot includes 4 extension columns beyond §9.5 verbatim.** `platform_fee_bps`, `eps_fee_bps`, `platform_fee_handling`, `eps_fee_handling` are written at order-create time alongside the paisa fields per §14.4 + Decision N. Post-mortem reconciliation against EPS settlement reports needs the snapshotted inputs to reconstruct what the calculator was fed.
- **NEW 2026-05-25 — Redis token cache stampede semantic: accept-double-fetch-but-cache-last.** Two PM2 workers both missing the cache simultaneously both fetch + both write; last-write-wins. Trade-off documented in `redis-token-cache.ts` header. Swap to NX-lock single-flight if a future scale point ever surfaces contention as a real problem.
- **NEW 2026-05-25 — Drizzle `ANY()` array-binding via raw `sql\`\`` does NOT work; use `inArray()` helper.** A test failure on Phase 4 surfaced this — Drizzle interpolates the JS array as a single JSON parameter, not a parameterised array. Use `inArray(column, jsArray)` always.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run all EPS unit tests (host machine, no DB)
pnpm --filter @eventpulse/api exec vitest run src/infra/eps/

# Run orders RLS isolation + append-only tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/db/orders-rls.test.ts

# Run orders service integration tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/services/orders/

# Smoke the public order-creation endpoint with a nonexistent event
# (proves route → zod → service → error-mapping wiring)
curl -s -X POST -H "content-type: application/json" \
  -d '{"eventId":"00000000-0000-0000-0000-000000000000","tierSelections":[{"tierId":"00000000-0000-0000-0000-000000000001","quantity":1}],"buyer":{"name":"S","email":"s@t.l","phone":"+8801700000000"}}' \
  https://api.staging.eventpulse.com.bd/api/v1/public/orders

# Inspect orders table on staging
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --parameters '{"commands":["sudo -u postgres psql eventpulse_staging -c \"\\d orders\""]}' \
  --region ap-southeast-1 --profile eventpulse --query 'Command.CommandId' --output text
```
