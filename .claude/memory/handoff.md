# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 4 Day 32 SHIPPED — Attendee CRM end-to-end: list + search/filter + CSV export with PII audit. **Decision N truth gate REMAINS THE blocker for priced money work.**)
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 32; **next session opens Day 33.**

## ⚠️ CRITICAL: where we are right now

**Sprint 4 Day 32 SHIPPED.** Second §26.1 Sprint 4 deliverable done (Attendee CRM — §26.1 Day 1-2). 3 PRs merged + 1 hotfix (server endpoint + UI + CSV export with audit). Pairs with Day 31's QR scanner — organisers can now see who's registered AND who's already through the door, with audited bulk-PII extraction for ops reports. **STAGING_PAYMENT_BLOCK=1 held all session; zero EPS calls fired.**

**Decision N truth gate REMAINS THE gating milestone for priced money work.** Three pending-Moshiur items unchanged (deferred ~12 days):

1. **EPS sandbox credentials confirmed** OR authorized controlled STAGING_PAYMENT_BLOCK lift + new `decisions.md` entry per §11.0 (4 × small real charges)
2. **§29 #9 (AIT withholding) tax opinion** — calculator math is pre-withholding per file header
3. **SES out-of-sandbox approval** — without it, real ticket emails won't deliver to non-verified addresses

**Sprint 4 Day-32 work was purely payment-independent** (attendee read + CSV extraction). The rest of Sprint 4's buildable-in-parallel work (sales dashboard, marketing, buyer form for free events) remains available; anything touching priced money is still gated.

## Day 32 deliverables (all merged today, all green on staging)

**PR #184 (Phase 1) — tenant attendee list service + endpoint (`4d9a2b3`):**

- `apps/api/src/services/attendees/list.ts` `listEventAttendees()` — `withTenant` RLS + app-layer `events.tenant_id + events.id` dual defence; same `attendees`-has-no-`event_id` schema gotcha as Day 31 Phase 1; join via `attendees ⋈ order_items ⋈ orders ⋈ ticket_tiers ⋈ events`.
- Cursor pagination keyset `(createdAt DESC, id DESC)` mirroring `super-admin/kyc.ts` encoder/decoder pattern; limit bounded server-side (default 25, max 100).
- `apps/api/src/routes/tenant/attendees.ts` GET `/api/v1/tenant/events/:eventId/attendees` with search + tierId + checkIn + orderStatus + limit + cursor query params; envelope helpers mirror `super-admin/kyc.ts`.
- 11 DB-gated tests pinning auth (401) + shape + **cross-tenant isolation** (the security one — tenant B requesting tenant A's event's attendees → empty result) + search-by-name + search-by-email (ilike, case-insensitive) + tier filter + check-in filter (checked_in/not_checked_in) + order-status filter (paid excludes pending) + cursor pagination (limit=2 across 4 rows; no id overlap) + **no-per-row-audit invariant** (Decision G precedent enforced).

**PR #185 (Phase 2) — attendee list UI (`e41db45`):**

- `apps/web/src/hooks/use-tenant-attendees.ts` — TanStack Query hook with default cache (staleTime 30s, gcTime 5min). NO PII-specific cache override — tenant viewing OWN data, unlike KYC review's third-party PII case (Decision H precedent).
- `apps/web/src/components/tenant/attendee-list.tsx` — plain-`<table>` (mirrors /admin/kyc convention; no TanStack Table dep installed; consistency over abstraction). Filter bar with search input + tier dropdown + check-in select + order-status select. Cursor pagination ("Next page" / "Back to top"). **Loop-closure with Day 31:** live check-in pill column shows the gate + relative time pulled from the same attendees table the scanner updates via Day-31's compare-and-swap.
- `apps/web/src/app/(tenant)/events/[eventId]/attendees/page.tsx` — client-component page. Uses `useTenantTiers` for the tier filter dropdown.
- 10 web tests (loading/empty/happy/voided-badge/filter-refetch with URL params/pagination conditional on hasMore+nextCursor/error-alert/axe-clean).

**PR #186 (Phase 3) — CSV export — audited, UTF-8, RLS-scoped (`2c71520` + hotfix `84ac4ff`):**

- `apps/api/src/services/attendees/export-csv.ts` — `exportEventAttendees()` with **UTF-8 BOM** (so Excel-on-Windows opens Bangla attendee names correctly) + **RFC 4180 escaping** (comma/newline/quote get quoted; embedded quotes doubled) + **CRLF line endings** (Excel preference) + **ISO-8601 timestamps** + **50k HARD_CAP** (a hostile caller can't bring the server down with one giant export).
- `apps/api/src/services/audit/attendees.ts` — new `writeAttendeesExported` sibling helper (one-per-domain pattern). Audit row written INSIDE the `withTenant(tenantId)` tx so cross-tenant probes ALSO get audited with the CALLER's tenant_id + `row_count=0` (operationally interesting — ops can surface "tenant X has been probing other tenants" as anomaly signal).
- `apps/api/src/routes/tenant/attendees.ts` — adds GET `/api/v1/tenant/events/:eventId/attendees/export` with `text/csv; charset=utf-8` content-type + `Content-Disposition: attachment; filename="..."` + `x-row-count` header.
- `apps/web/src/components/tenant/attendee-list.tsx` — Export CSV anchor in the filter bar; plain `<a download>` (no JS download dance needed); href reflects active search + filter via URL params.
- 11 pure unit tests for `csvEscape` + `csvRow` helpers (null/empty handling, comma quoting, double-quote doubling, mixed comma+quote, Bangla unicode preservation, Bangla with commas).
- 6 DB-gated integration tests (auth, happy path with audit row + UTF-8 BOM via arrayBuffer + CRLF, RFC 4180 escaping through the route, Bangla round-trip, tier filter respect, **cross-tenant export → 0 rows + audit row recording the attempt**).
- 3 UI tests for the export anchor (renders + reflects tier filter + reflects search input).

**Phase 3 hotfix:** the first push failed CI Integration on the BOM assertion. Root cause: WHATWG `Response.text()` strips leading UTF-8 BOM during decoding (spec behaviour — BOM treated as encoding marker, not content). Fix: read response via `arrayBuffer()` and assert `EF BB BF` bytes directly. Service code unchanged.

**Phase 4 EOD staging smoke (all GREEN):**

- main HEAD = `2c71520` post-Phase-3 merge; staging EC2 HEAD matches; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in `.env.staging` + pm2 env (id=1)
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok, checkedMs:12
- Google OAuth `/start`: 302 (regression guard holds)
- Day 27 fraud-prevention regression guard: spoofed webhook → `unknown_transaction`
- Day 29 idempotency missing-key 400 (fail-closed)
- Day 31 check-in route 401 missing-token (auth gate holds)
- **Day 32 NEW: attendees list + export both 401 missing-token (new regression guards)**

**Tests at Day 32 close: 1108+148 pass (+14 api unit from Day 32; 13 DB-gated integration run on CI), 321+ skipped.**

## Two decisions codified today (decisions.md "Sprint 4 Day 32")

- **Choice A — Bulk PII extraction audit policy (list ≠ export).** The list endpoint does NOT write per-row audit (Decision G precedent — tenant viewing OWN data is operational, N rows per page load would drown out interesting state-changing events). The CSV export DOES write ONE audit row per request, regardless of row count (including row_count=0 cross-tenant probes). Audit captures actor + event + row_count + filter snapshot + IP + user-agent. Never captures row content (per §1.3 R5 PII spreading). Cross-tenant probes are audited with the CALLER's tenant_id, so "tenant X probed tenant Y" surfaces in ops dashboards.
- **Choice B — Phase boundary ≠ scope boundary.** Phases are PR-shape boundaries (one focused PR per logical change), NOT scope splits. Phase 3 bundled the CSV export backend + frontend in one PR because they're one logical change (the value can't be measured without both). Counter-example where splits ARE right: Days 27-29 idempotency middleware + capacity lock — each independently shippable + testable.

## One new gotcha codified today (gotchas.md)

- **WHATWG `Response.text()` strips a leading UTF-8 BOM during decoding** (spec behaviour — BOM treated as encoding marker, not content). For tests asserting on encoding markers, read via `arrayBuffer()` and assert byte sequences directly. Caught in Day 32 Phase 3 CI; hotfixed in `84ac4ff`.

## Next concrete step — Sprint 4 Day 33

Moshiur picks scope. Logical first picks per §26.1 Sprint 4 plan:

- **Day 33 Option A: Tenant sales dashboard** (§26.1 Day 5). Consumes Day 26-29 order pipeline + Day 27 paid orders. Renders the existing data; no new write paths; no truth-gate dependency. **Natural next step** — completes the tenant-portal trio (events, attendees, sales).
- **Day 33 Option B: Buyer form UI** (Sprint 3 carry). Unblocks the Day 30 Phase 1b E2E smoke's "browser path" + gives free events an actual user-facing booking path on staging. The free-event end-to-end would then be clickable from sign-up to ticket.
- **Day 33 Option C: Refund flow + manual disbursement** (§26.1 Day 7-8). Backend work is paint-by-numbers; UI requires the sales dashboard. Probably wants Option A first.
- **Day 33 Option D: Marketing pages** (§26.1 Day 9). `/features`, `/pricing` (the two-fee-mode calculator), `/contact`. Independent of the tenant/buyer surface; pure marketing surface for early outreach.
- **Day 33 Option E: Truth-gate progress** — only if Moshiur has cleared one of the three pending items (EPS sandbox creds, AIT opinion, SES out-of-sandbox).

Recommendation: **Option A** — sales dashboard closes the operational tenant-portal loop (events → tickets → attendees → sales) and consumes Sprint 3's pipeline most concretely.

## Pending Moshiur actions — Day 32 closeout state

**TRUTH-GATE BLOCKERS (restate every session until cleared — gates priced money):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation (4 × small real charges; new `decisions.md` entry required per §11.0)
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions**
3. **SES out-of-sandbox approval**

**Lower urgency (carried, unchanged from Day 31):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).**
2. **Counsel engagement for Trust Center v1.0 drafts** — first paying tenant gated.
3. **EPS_WEBHOOK_SECRET / signature mechanism** — when EPS publishes one.
4. **bootstrap-staging.sh validation guard live-trigger** — runs on the NEXT bootstrap.
5. **NotoSansBengali font bundling for PDF tickets** — pure-Bangla strings render as squares until font lands.
6. **`sold` decrement on cancel/fail/chargeback** — Day 29 Phase 2 scope-limited to increment-only; cleanup sweep is Sprint 4+ scope.

## Hard guardrails (carry forward + 2 new from Day 32)

(Carrying forward all Day 31 guardrails; adding 2 Day 32 ones at the end.)

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
- **Check-in admission is atomic compare-and-swap (UPDATE WHERE checked_in_at IS NULL RETURNING) inside `withTenant` tx** (Day 31 Choice A).
- **Optimistic-admit offline door policy: scans admitted with "(tentative — offline)" banner, queued to IndexedDB, server's CAS is FINAL authority, duplicate_on_sync flag surfaces 2-device-offline conflicts** (Day 31 Choice B).
- **Frontend offline-storage modules expose `factory: IDBFactory` parameter** (Day 31 Choice C).
- **NEW 2026-05-25 (Day 32 Choice A) — Bulk PII extraction audit policy:** list endpoints do NOT audit per-row (Decision G precedent); export endpoints write ONE audit row per request including row_count=0 cross-tenant probes; audit captures actor+filter+row_count, NEVER row content. Future PII-export endpoints (financial-statement export, etc.) inherit this pattern.
- **NEW 2026-05-25 (Day 32 Choice B) — Phase boundary ≠ scope boundary.** "ONE focused PR per logical change" = one PR per atomic shipped feature, NOT one PR per file group / per app / per app-tier. Backend-only PR for a feature with a frontend = unhelpful. The principle: a logical change is one whose value can't be measured without all its parts.
- **NEW 2026-05-25 (Day 32 hotfix) — WHATWG `Response.text()` strips leading UTF-8 BOM during decoding.** For tests asserting on encoding markers, read via `arrayBuffer()` + assert byte sequences directly. `text()` is the wrong tool for byte-level assertions.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Run Day 32 attendee list service tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/routes/tenant/attendees.test.ts

# Run Day 32 CSV export tests (unit + DB-gated integration)
pnpm --filter @eventpulse/api exec vitest run src/services/attendees/export-csv.test.ts src/routes/tenant/attendees-export.test.ts

# Run Day 32 attendee-list UI tests (jsdom + axe)
pnpm --filter @eventpulse/web exec vitest run src/components/tenant/attendee-list.test.tsx

# Live regression smokes (Day 27 + Day 29 + Day 31 + Day 32) — should still hold after Day 33 work
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-day33","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}

curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{}' https://api.staging.eventpulse.com.bd/api/v1/public/orders
# Expected: 400 (idempotency missing-key fail-closed)

curl -s -o /dev/null -w "%{http_code}\n" \
  "https://api.staging.eventpulse.com.bd/api/v1/tenant/events/00000000-0000-0000-0000-000000000000/attendees"
# Expected: 401 (Day 32 attendee list — auth gate)

curl -s -o /dev/null -w "%{http_code}\n" \
  "https://api.staging.eventpulse.com.bd/api/v1/tenant/events/00000000-0000-0000-0000-000000000000/attendees/export"
# Expected: 401 (Day 32 CSV export — auth gate)

# Verify STAGING_PAYMENT_BLOCK still enforcing (run via SSM SendCommand)
sudo grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE)=" /home/eventpulse/.env.staging
sudo -u eventpulse pm2 env 1 | grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE):"
# Expected both: STAGING_PAYMENT_BLOCK=1 and EPS_MODE=production
```

## Current URL map (refreshed for Moshiur's browser click-through)

**🔑 States:** 🌐 open · 🔒 needs auth · ⚠️ blocked-by-design · 🛑 broken/not-built

### Apex — `https://staging.eventpulse.com.bd`

- `/` 🌐 200 — marketing home
- `/sign-in` 🌐 200 — **Google "Continue with Google" works end-to-end**
- `/{tenant}/{event}` 🌐 — public event landing page (needs a seeded event to view; 404 otherwise)

### Trust Center (apex) — all 🌐 200, DRAFT placeholders per Day 19 Decision M.2

- `/trust` — Trust Center landing grid
- `/privacy` `/terms` `/eula` `/dpa` `/cookies` `/refund-policy` — 6 legal contracts
- `/trust/security` `/trust/sub-processors` `/trust/security/disclosure` `/trust/sla` `/trust/acceptable-use` `/trust/anti-bribery` `/trust/ai-policy` `/trust/bangladesh-compliance` `/trust/gdpr` `/trust/accessibility` `/trust/transparency` `/trust/retention` — 12 trust artefacts

### Tenant portal — `https://app.staging.eventpulse.com.bd` (🔒 sign in via apex first)

- `/dashboard` — tenant dashboard (post-Account-Type modal)
- `/kyc` — KYC wizard (variant routes by tenant.type)
- `/events/{eventId}/tickets` — ticket tier CRUD (Day 25)
- `/events/{eventId}/checkin` — **Day 31 — Web QR scanner (camera + manual entry + offline-tolerant queue)**
- `/events/{eventId}/attendees` — **Day 32 NEW — attendee list (search/filter/export CSV)**

### Super-admin portal — `https://admin.staging.eventpulse.com.bd` (🔒 super-admin auth)

- `/admin/kyc` — KYC review queue
- `/admin/kyc/{id}` — KYC detail
- `/admin/legal-trust` + `/admin/legal-trust/{slug}` — Legal & Trust editor
- `/admin/tenants/{id}/fees` — per-tenant fee override
- `/admin/events/{eventId}/tickets` — admin ticket view

### Attendee portal — `https://my.staging.eventpulse.com.bd`

- `/` 🌐 200 — scope-deferred to Sprint 8 per §26.2 v2.1; thin shell

### API — `https://api.staging.eventpulse.com.bd` (API routes ONLY on this vhost)

- `/health` 🌐 200 db:ok | `/nginx-health` 🌐 200
- `/api/v1/auth/oauth/google/start` 🌐 302 | `/api/v1/auth/oauth/apple/start` 🛑 404 (Apple dropped from MVP per guardrail)
- `/api/v1/public/legal/landing` 🌐 200 | `/api/v1/public/events/*` 🌐
- `/api/v1/public/orders` 🌐 400 missing-idempotency-key — **free events complete fully; priced orders hit STAGING_PAYMENT_BLOCK**
- `/api/v1/public/orders/eps-return/*` 🌐 | `/api/v1/webhooks/eps/callback` 🌐 200 (signature-non-authority)
- `/api/v1/tenant/*` 🔒 401 unauth — me/account-type/kyc/kyc-drafts/events/tickets/**checkin (Day 31)**/**attendees (Day 32)**/**attendees/export (Day 32)**
- `/api/v1/admin/*` 🔒 401 unauth — kyc/legal/tenants/:id/fees/events/:id/tickets

### Blocked-by-design (the truth-gate gap, visible)

- ✅ Free event end-to-end works fully (§13.5 free-event bypass, Day 30 Phase 1a; no EPS call)
- ⚠️ Paid event order: `StagingPaymentBlockedError` (STAGING_PAYMENT_BLOCK=1 standing policy)
- ⚠️ Real attendee email delivery: dry-run via `MAIL_DRY_RUN=1` (SES still in sandbox)
