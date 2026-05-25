# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 4 Day 31 SHIPPED — Web QR scanner + Check-In end-to-end. **Decision N truth gate REMAINS THE blocker for priced money work.**)
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 31; **next session opens Day 32 — Moshiur picks scope from §26.1 Sprint 4 plan or carries the truth gate forward.**

## ⚠️ CRITICAL: where we are right now

**Sprint 4 Day 31 SHIPPED.** First §26.1 Sprint 4 deliverable done (Web QR scanner + Check-In, the consumer of Day 28's QR tokens). 3 PRs merged (server check-in service + browser scanner UI + offline-tolerant queue + sync-on-reconnect). Pipeline now ships scan → admit → audit + offline-tolerant fallback. **STAGING_PAYMENT_BLOCK=1 held all session; zero EPS calls fired.**

**Decision N truth gate REMAINS THE gating milestone for priced money work.** Three pending-Moshiur items unchanged (deferred ~11 days):

1. **EPS sandbox credentials confirmed** OR authorized controlled STAGING_PAYMENT_BLOCK lift + new `decisions.md` entry per §11.0 (4 × small real charges)
2. **§29 #9 (AIT withholding) tax opinion** — calculator math is pre-withholding per file header
3. **SES out-of-sandbox approval** — without it, real ticket emails won't deliver to non-verified addresses

**Sprint 4 Day-31 work was purely payment-independent** (check-in surface consumes Day-28 QR tokens, no money state change). The rest of Sprint 4's buildable-in-parallel work (attendee list, dashboards, marketing) remains available; anything touching priced money is still gated.

## Day 31 deliverables (all merged today, all green on staging)

**PR #180 (Phase 1) — server check-in validation + endpoint (`37a2241`):**

- `apps/api/src/services/checkin/checkin.ts` `checkInAttendee()` — atomic compare-and-swap (UPDATE … WHERE checked_in_at IS NULL RETURNING) inside `withTenant` tx; Postgres row-lock serialises concurrent scans; winner gets RETURNING row, loser disambiguates via secondary SELECT for the ALREADY_CHECKED_IN response.
- Schema reality: `attendees` has no `event_id` column; admission scoping via subquery through `ticket_tiers` (`inArray(attendees.ticketTierId, tierIdsForEvent)` for UPDATE, `innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))` for SELECT).
- 3 sibling audit helpers (`writeAttendeeCheckedIn` / `writeAttendeeCheckInAlready` / `writeAttendeeCheckInRejected`) at `services/audit/attendees.ts`, one-per-domain pattern.
- POST `/api/v1/tenant/events/:eventId/checkin` + GET `/stats`; userId via `c.get('auth')!.sub` (AccessClaims has `sub`, not `userId`).
- 11 DB-gated tests pinning door-correctness (concurrent double-scan, cross-tenant RLS, wrong-event no info leak, 50-concurrent-scan race that always admits exactly one).
- CI Integration first push failed `JWT_ACCESS_SECRET is not set` — `signTokens` reads env at call time; test beforeAll ran before env setup. Fixed by setting `process.env.JWT_*_SECRET = 'x'.repeat(64)` in beforeAll matching kyc-drafts.test.ts pattern.

**PR #181 (Phase 2) — browser QR scanner UI (`f4aa8d8`):**

- `apps/web/src/hooks/use-checkin.ts` — `useScan` TanStack mutation + `useCheckInStats` polls /stats every 5s.
- `apps/web/src/components/tenant/checkin-scanner.tsx` — big-result display per outcome, dynamic-imported `qr-scanner` library (MIT, ~21KB) for SSR-safety, camera fallback to manual entry.
- `apps/web/src/app/(tenant)/events/[eventId]/checkin/page.tsx` — server-component shell.
- 16 web tests covering token extraction + all 5 result variants + manual entry + mount smoke (all axe-clean).

**PR #182 (Phase 3) — offline-tolerant queue + sync-on-reconnect (`302a76a`):**

- `apps/web/src/lib/offline-checkin-queue.ts` — IndexedDB persistence (`eventpulse-checkin-v1` / `pending` store). Pure functions over injected `IDBFactory` so tests inject `fake-indexeddb` without global patching (Choice C pattern).
- `apps/web/src/lib/sync-checkin-queue.ts` — sync orchestrator; sequential POSTs; removes row on DEFINITIVE outcome (admitted / duplicate_on_sync / invalid / wrong_event / voided); retains on network_error; returns SyncReport with `duplicateCount` for ops alerting.
- 12 unit tests including the canonical OFFLINE-DOUBLE-ENTRY (two enqueued scans of SAME-QR → first admitted, second duplicate_on_sync, BOTH removed, duplicateCount=1).
- checkin-scanner extended with offline-tentative banner + pending-count banner + duplicate-on-sync banner + on-mount + on-'online' sync trigger.

**Phase 4 EOD staging smoke (all GREEN):**

- main HEAD = `302a76a` post-Phase-3 merge; staging EC2 HEAD matches; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in `.env.staging` + pm2 env (id=1)
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok, checkedMs:11
- Google OAuth `/start`: 302 (regression guard holds)
- Day 27 fraud-prevention regression guard: spoofed webhook → `unknown_transaction` (signature non-authority)
- Day 29 idempotency live: missing key → 400 (fail-closed)

**Tests at Day 31 close: ~1122 pass (+39 from Day 31 across api + web), 294+ skipped (CI runs DB-gated).**

## Three decisions codified today (decisions.md "Sprint 4 Day 31")

- **Choice A — Door-correctness via atomic compare-and-swap.** Conditional UPDATE WHERE checked_in_at IS NULL RETURNING; row-lock collapses concurrent-scan races to "one wins, one returns zero rows + disambiguates." Future refactors that split validate from transition would re-introduce the race; pin atomic-CAS here.
- **Choice B — Optimistic-admit offline door policy (§-spec silent; Auto Mode call).** Offline scans admitted with "(tentative — offline)" banner; queued to IndexedDB; flushed on reconnect; server's CAS is FINAL authority; duplicate_on_sync flag surfaces 2-device-offline conflicts to ops. Why: bad connectivity is the WHOLE reason §26.1 specified offline-tolerant — queue-and-wait would unwork venues. Threat model is honest-mistake double-scan, not coordinated fraud.
- **Choice C — Frontend offline-storage tests via injected IDBFactory.** Pure functions over passed-in `factory: IDBFactory` (default reads `globalThis.indexedDB`); tests inject `fake-indexeddb` without global mutation cascades. Pattern applies to future browser-storage work (localStorage, Cache API, Service Worker).

## Next concrete step — Sprint 4 Day 32

Moshiur picks scope. Logical first picks per §26.1 Sprint 4 plan:

- **Day 32 Option A: Attendee list UI + CSV export** (§26.1 Day 1-2). Builds on Day 28's `attendees` table + Day 31's QR tokens. Tenant portal scope; no truth-gate dependency. Day 31 scanner + Day 32 attendee list = the full attendee-management surface for free events end-to-end.
- **Day 32 Option B: Tenant sales dashboard** (§26.1 Day 5). Consumes Day 26-29 order pipeline + Day 27 paid orders. Renders the existing data; no new write paths; no truth-gate dependency.
- **Day 32 Option C: Buyer form UI** (Sprint 3 carry). Unblocks the Day 30 Phase 1b E2E smoke's "browser path" + gives free events an actual user-facing booking path on staging.
- **Day 32 Option D: Truth-gate progress** — only if Moshiur has cleared one of the three pending items (EPS sandbox creds, AIT opinion, SES out-of-sandbox).

Recommendation: Option A or B — concrete user surface that exercises the shipped pipeline; both are payment-independent.

## Pending Moshiur actions — Day 31 closeout state

**TRUTH-GATE BLOCKERS (restate every session until cleared — gates priced money):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; new `decisions.md` entry required per §11.0)
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions**
3. **SES out-of-sandbox approval**

**Lower urgency (carried, unchanged from Day 30):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — first paying tenant gated.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one.
4. **bootstrap-staging.sh validation guard live-trigger** — runs on the NEXT bootstrap.
5. **NotoSansBengali font bundling for PDF tickets** — pure-Bangla strings render as squares until font lands.
6. **`sold` decrement on cancel/fail/chargeback** — Day 29 Phase 2 scope-limited to increment-only; cleanup sweep is Sprint 4+ scope.

## Hard guardrails (carry forward + 3 new from Day 31)

(Carrying forward all Day 30 guardrails; adding 3 Day 31 ones at the end.)

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
- **§13.5 free-event auto-settle: events where every tier price_paisa = 0 go pending → paid immediately, NO EPS call.**
- **Mixed paid+free tier order takes the PAID path.**
- **`apps/api/src/domain/ledger/invariants.ts` is the §14.10 source of truth for money conservation checks.** Pure functions over row arrays. Bit-exact bigint.
- **Sprint-section spec without a dedicated test = future surprise.**
- **NEW 2026-05-25 (Day 31 Choice A) — Check-in admission is atomic compare-and-swap (UPDATE WHERE checked_in_at IS NULL RETURNING) inside `withTenant` tx.** Postgres row-lock serialises concurrent scans. Future refactors that split validate from transition would re-introduce the race; pin atomic-CAS.
- **NEW 2026-05-25 (Day 31 Choice B) — Optimistic-admit offline door policy: scans admitted with "(tentative — offline)" banner, queued to IndexedDB, server's CAS is FINAL authority, duplicate_on_sync flag surfaces 2-device-offline conflicts.** §-spec was silent on door UX; Auto Mode call; the server-CAS-is-final-authority boundary is the security model. Removing the banner OR switching to queue-and-wait would either treat unsynced admits as definitive OR unwork bad-connectivity venues — both wrong.
- **NEW 2026-05-25 (Day 31 Choice C) — Frontend offline-storage modules expose `factory: IDBFactory` parameter (default reads `globalThis.indexedDB`).** Tests inject `fake-indexeddb` without global mutation. Pattern applies to future browser-storage work (localStorage, Cache API, Service Worker).

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run Day 31 check-in service tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/routes/tenant/checkin.test.ts

# Run Day 31 offline queue + sync tests (pure, fake-indexeddb)
pnpm --filter @eventpulse/web exec vitest run src/lib/offline-checkin-queue.test.ts

# Run Day 31 scanner UI tests (jsdom, axe)
pnpm --filter @eventpulse/web exec vitest run src/components/tenant/checkin-scanner.test.tsx

# Live regression smokes (Day 27 + Day 29 + Day 31) — should still hold after Day 32 work
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-day32","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}

curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{}' https://api.staging.eventpulse.com.bd/api/v1/public/orders
# Expected: 400 (idempotency missing-key fail-closed)

# Verify STAGING_PAYMENT_BLOCK still enforcing (run via SSM SendCommand)
sudo grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE)=" /home/eventpulse/.env.staging
sudo -u eventpulse pm2 env 1 | grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE):"
# Expected both: STAGING_PAYMENT_BLOCK=1 and EPS_MODE=production
```
