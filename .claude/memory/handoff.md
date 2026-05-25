# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25/26 (Sprint 4 Day 33 SHIPPED — tenant sales dashboard + payouts view. **Mid-session staging-EC2 incident recovered.** **Decision N truth gate REMAINS THE blocker for priced money.**)
**Driver:** Claude Code (Opus 4.7) — Sprint 4 Day 33; **next session opens Day 34.**

## ⚠️ FIRST THING DAY 34 — staging EC2 capacity decision

**Mid-Day-33-Phase-4-EOD-smoke, the staging EC2 went unreachable** under the full stack (web + api + Postgres + Redis + BullMQ delivery worker, all on a 2 GB / no-swap t3.small). Classic in-VM hang signature: TCP 443 + SSM agent both dead, hypervisor `running` + reachability `passed`. First console "Reboot" didn't fire (graceful reboot stuck on the hung OS); **Stop + Start** recovered the VM. Post-recovery web crashloop on missing `.next` self-healed once the Phase 3 deploy rebuilt it. Full smoke now GREEN at `f501298`.

**Decision Moshiur owes Day 34 (load-bearing for the rest of Sprint 4):**

1. **Add a 2 GB swapfile NOW (free, today-able):** `sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`. Costs zero; adds memory headroom for build spikes. **Recommended as the immediate mitigation, regardless of (2).**
2. **Upgrade staging to t3.medium (4 GB RAM, ~+$15/mo):** durable fix. Eight days remaining in Sprint 4 + several more deploys + the truth-gate run all want more headroom.
3. **Wire CloudWatch memory alarm at >85% sustained 5min** → alert before the next OOM. CW Agent already ships the metric; just need the alarm.

**My recommendation: swap NOW + alarm NOW + t3.medium decision before Sprint 5.** The swap is 2 minutes of work and eliminates the immediate risk; the upgrade is a Moshiur call that can wait a few days but not weeks.

Full incident details in [`gotchas.md` "Staging EC2 (t3.small, 2GB, no swap) went unreachable mid-session"](gotchas.md).

## ⚠️ CRITICAL: where we are right now

**Sprint 4 Day 33 SHIPPED + INCIDENT RECOVERED.** Third §26.1 Sprint 4 deliverable done (tenant sales dashboard + payouts view — §26.1 Day 5). 3 PRs merged + 2 hotfixes (sales metrics service + dashboard UI + payouts view). Tenant home (`/dashboard`) + payouts (`/payouts`) both live on staging at `f501298`. **STAGING_PAYMENT_BLOCK=1 re-verified post-recovery + still enforcing**; zero EPS calls fired all day.

**Decision N truth gate REMAINS THE gating milestone.** Three pending-Moshiur items unchanged:

1. **EPS sandbox credentials confirmed** OR authorized controlled STAGING_PAYMENT_BLOCK lift + new `decisions.md` entry per §11.0 (4 × small real charges)
2. **§29 #9 (AIT withholding) tax opinion** — calculator math is pre-withholding
3. **SES out-of-sandbox approval**

**Sprint 4 Day-33 work was purely payment-independent** (dashboard reads snapshotted data). The sales dashboard + payouts view RENDER correctly; PRICED-revenue display is unverified until the truth gate runs real paid orders (same caveat as the §14.10 ledger invariant verifier).

## Day 33 deliverables (all merged today, all green on staging)

**PR #188 (Phase 1) — tenant sales metrics service + endpoint (`9b7b662`) + hotfix (`3b99fad`):**

- `apps/api/src/services/reports/sales.ts` — `getTenantSalesMetrics()` with `withTenant` RLS + explicit `WHERE tenant_id =` dual defence; single-query FILTER aggregates for headline KPIs (gross/net/platform-fee/eps-fee/paidOrderCount); day-bucketed time-series in `Asia/Dhaka` (sale at 11:30 PM BDT Monday lands in Monday's bucket, not Tuesday's UTC); per-event + per-tier breakdowns.
- Status enum collapsed to 4 dashboard buckets: **revenue** (paid+completed), **pending** (pending+awaiting_payment), **dropped** (cancelled+failed), **refunded** (refund_*, chargeback, reversed).
- `apps/api/src/routes/tenant/reports.ts` `GET /api/v1/tenant/reports/sales` with `eventId/fromDate/toDate` query params.
- 7 DB-gated tests including **cross-tenant aggregate isolation** (seed 10M paisa under tenant B → tenant A's gross stays under 10M) + **fees-from-snapshot-not-recomputed** (mutate tenant_fee_config to 999 bps → dashboard still shows snapshotted 25 bps).
- Phase 1 hotfix: `seedOrder` test helper hardcoded `eventId: fx.eventId` so the eventId-filter test silently landed orders on the wrong event; added `eventIdOverride` param. Service code unchanged.

**PR #189 (Phase 2) — sales dashboard UI (`f428050`):**

- `apps/web/src/hooks/use-tenant-sales.ts` — TanStack Query hook + `formatBdt`/`formatNumber` helpers (BigInt-safe; thousands grouping).
- `apps/web/src/components/tenant/sales-dashboard.tsx` — KPI cards (gross/net/tickets/AOV) + status bucket pills + Recharts LineChart (sales over time, 30 days, BDT) + per-event/per-tier tables + empty-state banner.
- **`recharts ^3.8.1` dep added** (~50KB gzipped; named in §1.2 tech stack).
- `apps/web/src/app/(tenant)/dashboard/page.tsx` replaces the Day-15 placeholder card.
- 6 unit tests including chart-renders + axe-clean; ResizeObserver stub for Recharts under jsdom.

**PR #190 (Phase 3) — payouts view (`f501298`) + hotfix (`a572c8e`):**

- `apps/api/src/services/reports/payouts.ts` — `getTenantPayoutsView()` reads snapshotted `netToOrganiserPaisa` + sibling fees + `getEffectiveFees()` for the current-fees panel. Refund-leak orders counted separately.
- `apps/api/src/routes/tenant/reports.ts` adds `GET /api/v1/tenant/reports/payouts`.
- `apps/web/src/hooks/use-tenant-payouts.ts` — TanStack Query hook + `formatBps` (always 2 decimals for consistency).
- `apps/web/src/components/tenant/payouts-view.tsx` — big "Pending payout" hero card + snapshot-breakdown rows + refund-leak amber card (conditional) + current-fee-terms panel.
- `apps/web/src/app/(tenant)/payouts/page.tsx`.
- 6 DB-gated integration + 7 UI unit tests pinning **snapshot-vs-current decoupling** (mutate tenant_fee_config → payable total unchanged, current-fee panel updates) + cross-tenant isolation + refund-leak separation.
- Phase 3 hotfix: `react/no-unescaped-entities` on two `you're` apostrophes → `&apos;`.

**Phase 4 EOD staging smoke (all GREEN post-incident-recovery):**

- main HEAD = `f501298` post-Phase-3 merge; staging EC2 HEAD matches; zero drift
- `STAGING_PAYMENT_BLOCK=1` enforcing in `.env.staging` + pm2 env (id=1) — **re-verified post-recovery**
- 5 vhosts `/nginx-health`: all 200
- `/health` DB-aware: 200, db:ok, checkedMs:10
- Google OAuth `/start`: 302 (regression guard holds)
- Day 27 fraud-prevention regression: spoofed webhook → `unknown_transaction`
- Day 29 idempotency missing-key 400 (fail-closed)
- Day 31 check-in 401; Day 32 attendees + export 401; **Day 33 reports/sales + reports/payouts 401 (new guards)**

**Tests at Day 33 close: 1108 api + 161 web (+7 from Day 33 UI; 13 new DB-gated integration tests run on CI).**

## Two decisions codified today (decisions.md "Sprint 4 Day 33")

- **Choice A — Snapshot-vs-current display policy.** Money dashboards read snapshotted fee fields on each order (`platformFeePaisa`, `netToOrganiserPaisa`, etc.) — NEVER recompute via the calculator from current `tenant_fee_config`. Current fee config shown SEPARATELY as forward-looking. Why: per-tenant fee terms can change; recomputing would lie about what was actually charged. The order row's snapshot IS the ledger; the dashboard reflects the ledger. Sprint 7 super-admin Revenue Dashboard (§14.7) must follow the same rule one level up.
- **Choice B — Dashboard aggregation under `withTenant()` + explicit `WHERE tenant_id` dual defence.** The classic dashboard footgun is an unscoped `SUM(...)` that crosses tenants — a SUM carrying a leak is silent. RLS is the primary guard; the explicit predicate is the redundant second that catches a future "performance" refactor that mistakenly switches to `withSuperAdmin`. The Sprint 7 super-admin Revenue Dashboard is the EXCEPTION — it deliberately cross-tenant-aggregates; its own audit + access control is the security model.

## Two new gotchas codified today (gotchas.md)

- **Staging EC2 (t3.small, 2GB, no swap) in-VM hang under full stack** — TCP 443 + SSM agent both dead, hypervisor healthy. Recovery: **Stop + Start, not Reboot** (graceful reboot stuck on hung OS). Web pm2 crashloop on missing `.next` afterward — Phase 3 deploy regenerated it. Carry: swapfile + CW memory alarm; t3.medium upgrade decision.
- **`react/no-unescaped-entities` blocks bare apostrophes in JSX text** — Next.js default ESLint rule. Day 33 Phase 3 first hit this because earlier surfaces avoided contractions. Fix: `&apos;` (or rewrite). `next build` + `next lint` both fail on this; CI caught.

## Next concrete step — Sprint 4 Day 34

**Mandatory first (per FIRST THING block):** Day 34 starts with the staging-capacity decision — swap-now + CW alarm + t3.medium-call. Don't ship more code on top of the capacity risk.

Then Moshiur picks scope. Logical first picks per §26.1 Sprint 4 plan:

- **Day 34 Option A: Buyer form UI** (Sprint 3 carry — the last buildable-in-parallel surface that exercises end-to-end). With Days 31+32+33 shipped (scanner, attendees, dashboard), the buyer form would CLOSE THE LOOP: someone can register for a free event → land in the attendee list → check in via QR → show up in the dashboard's "tickets sold" count, all on staging, all browser-clickable, all free.
- **Day 34 Option B: Refund flow + manual disbursement** (§26.1 Day 7-8). Backend paint-by-numbers; UI needs the sales dashboard (have). Note: ACTUAL disbursement is truth-gate-gated, but the REFUND-INITIATION + admin-approval workflow can ship.
- **Day 34 Option C: Marketing pages** (§26.1 Day 9). `/features`, `/pricing` (two-fee-mode calculator), `/contact`. Pure marketing surface for early outreach. Independent of the tenant/buyer trio.
- **Day 34 Option D: Truth-gate progress** — only if Moshiur cleared a pending item.

**Recommendation: capacity decision first, then Option A.** The buyer form closes the operational loop; everything we've built since Day 28 funnels into it.

## Pending Moshiur actions — Day 33 closeout state

**TRUTH-GATE BLOCKERS (restate every session until cleared):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions**
3. **SES out-of-sandbox approval**

**NEW from Day 33 incident:**

1. **Staging capacity decision** (swap + CW alarm = today-able; t3.medium upgrade = ~$15/mo, this week)
2. **CW memory alarm wiring** (CW Agent already reports memory; alarm not set)

**Lower urgency (carried, unchanged from Day 32):**

1. Phase 2 Google OAuth click-through verification (Day 24 carry)
2. Counsel engagement for Trust Center v1.0 drafts
3. EPS_WEBHOOK_SECRET / signature mechanism
4. bootstrap-staging.sh validation guard live-trigger
5. NotoSansBengali font bundling for PDF tickets
6. `sold` decrement on cancel/fail/chargeback

## Hard guardrails (carry forward + 4 new from Day 33)

(Carrying forward all Day 32 guardrails; adding 4 Day 33 ones at the end.)

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
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column.**
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
- **Ticket tier CRUD ships without money math.** Tier stores `price_paisa` raw; calculator is sole consumer at order time.
- **Capacity locking uses FOR UPDATE row lock with ORDER BY id for multi-tier deadlock avoidance.**
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
- **Idempotency body hash = SHA-256 of RAW request bytes** (NOT canonicalised JSON).
- **Hono middleware that hashes request body MUST use `c.req.raw.clone().text()`**, NOT `c.req.text()`.
- **Redis singleton needs explicit `await redis.connect()` at boot.**
- **§13.5 free-event auto-settle: events where every tier price_paisa = 0 go pending → paid immediately, NO EPS call.**
- **Mixed paid+free tier order takes the PAID path.**
- **`apps/api/src/domain/ledger/invariants.ts` is the §14.10 source of truth.** Pure functions over row arrays. Bit-exact bigint.
- **Sprint-section spec without a dedicated test = future surprise.**
- **Check-in admission is atomic compare-and-swap (UPDATE WHERE checked_in_at IS NULL RETURNING) inside `withTenant` tx** (Day 31 A).
- **Optimistic-admit offline door policy: scans admitted with "(tentative — offline)" banner, queued to IndexedDB, server's CAS is FINAL authority** (Day 31 B).
- **Frontend offline-storage modules expose `factory: IDBFactory` parameter** (Day 31 C).
- **Bulk PII extraction audit policy:** list endpoints do NOT audit per-row; export endpoints write ONE audit row per request including row_count=0 cross-tenant probes; audit captures actor+filter+row_count, NEVER row content (Day 32 A).
- **Phase boundary ≠ scope boundary.** A logical change is one whose value can't be measured without all its parts (Day 32 B).
- **WHATWG `Response.text()` strips leading UTF-8 BOM during decoding.** For byte-level assertions, read via `arrayBuffer()` (Day 32 hotfix).
- **NEW 2026-05-25 (Day 33 Choice A) — Snapshot-vs-current display policy for money dashboards.** Read snapshotted fee fields on each order; NEVER recompute via the calculator from current tenant_fee_config. Current fee config shown SEPARATELY as forward-looking. The snapshot IS the ledger; the dashboard reflects the ledger. Sprint 7 super-admin Revenue Dashboard (§14.7) must follow the same rule one level up.
- **NEW 2026-05-25 (Day 33 Choice B) — Dashboard aggregation under `withTenant()` + explicit `WHERE tenant_id` dual defence.** Unscoped SUM crosses tenants silently. RLS is primary; the explicit predicate is the redundant second that catches a future "performance" refactor switching to `withSuperAdmin`. Sprint 7 super-admin Revenue Dashboard is the EXCEPTION (deliberately cross-tenant; its own audit + access control is the security model).
- **NEW 2026-05-25 (Day 33 incident) — When staging port 443 + SSM agent are BOTH dead but hypervisor healthy = in-VM hang.** Recovery: **Stop + Start, not Reboot** (graceful reboot stuck on hung OS). Verify via `aws ec2 describe-instances` (LaunchTime updates on Start) + `aws ssm describe-instance-information` (PingStatus: Online, LastPingDateTime advances) + 3 consecutive successful TCP 443 responses (boot can flap on first attempt). If web pm2 crashloops on missing `.next` afterward, the next deploy regenerates it.
- **NEW 2026-05-25 (Day 33 Phase 3 hotfix) — `react/no-unescaped-entities` blocks bare apostrophes in JSX text.** Next.js default ESLint rule + `next build` enforcement. Fix: `&apos;` (or rewrite). Earlier surfaces avoided contractions and missed this; will recur with future copy.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Add 2 GB swapfile to staging EC2 (Day 34 first thing — run via SSM)
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h  # confirm swap line shows 2.0Gi

# Run Day 33 sales metrics tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/routes/tenant/reports-sales.test.ts

# Run Day 33 payouts tests (DB-gated + unit)
pnpm --filter @eventpulse/api exec vitest run src/routes/tenant/reports-payouts.test.ts
pnpm --filter @eventpulse/web exec vitest run src/components/tenant/payouts-view.test.tsx
pnpm --filter @eventpulse/web exec vitest run src/components/tenant/sales-dashboard.test.tsx

# Recovery from in-VM hang — DO NOT use Reboot, use Stop + Start
# (via AWS console; or via API once authorised)
aws ec2 stop-instances --instance-ids i-02e4fddeb923c14f9 --profile eventpulse
# wait for state = stopped (poll: aws ec2 describe-instances --instance-ids ... --query 'Reservations[0].Instances[0].State.Name')
aws ec2 start-instances --instance-ids i-02e4fddeb923c14f9 --profile eventpulse
# wait ~90s for SSM agent reconnect:
aws ssm describe-instance-information --filters Key=InstanceIds,Values=i-02e4fddeb923c14f9 --query 'InstanceInformationList[0].PingStatus' --output text

# Live regression smokes (Day 27+29+31+32+33) — should hold after Day 34 work
curl -s -X POST -H "content-type: application/json" \
  -d '{"merchant_transaction_id":"TXN-spoofed-day34","status":"SUCCESS"}' \
  https://api.staging.eventpulse.com.bd/api/v1/webhooks/eps/callback
# Expected: 200 + {"data":{"ok":true,"kind":"unknown_transaction",...}}

for path in checkin attendees attendees/export; do
  curl -s -o /dev/null -w "${path}: %{http_code}\n" -X POST -H "content-type: application/json" \
    "https://api.staging.eventpulse.com.bd/api/v1/tenant/events/00000000-0000-0000-0000-000000000000/${path}"
done
# Expected: all 401 (auth gates hold)

for path in reports/sales reports/payouts; do
  curl -s -o /dev/null -w "${path}: %{http_code}\n" \
    "https://api.staging.eventpulse.com.bd/api/v1/tenant/${path}"
done
# Expected: both 401 (Day 33 auth gates)

# Verify STAGING_PAYMENT_BLOCK still enforcing
sudo grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE)=" /home/eventpulse/.env.staging
sudo -u eventpulse pm2 env 1 | grep -E "^(STAGING_PAYMENT_BLOCK|EPS_MODE):"
# Expected both: STAGING_PAYMENT_BLOCK=1 + EPS_MODE=production
```

## Current URL map (refreshed for Moshiur's browser click-through)

**🔑 States:** 🌐 open · 🔒 needs auth · ⚠️ blocked-by-design · 🛑 broken/not-built

### Apex — `https://staging.eventpulse.com.bd`

- `/` 🌐 200 — marketing home
- `/sign-in` 🌐 200 — **Google "Continue with Google" works end-to-end**
- `/{tenant}/{event}` 🌐 — public event landing page (needs a seeded event)

### Trust Center (apex) — all 🌐 200, DRAFT placeholders per Decision M.2

- `/trust` + 6 contracts (`/privacy` etc.) + 12 trust artefacts (`/trust/*`)

### Tenant portal — `https://app.staging.eventpulse.com.bd` (🔒 sign in via apex first)

- `/dashboard` — **Day 33 NEW — sales KPIs + time-series chart + per-event/per-tier breakdowns**
- `/payouts` — **Day 33 NEW — read-only "what's owed" view with current fee terms**
- `/kyc` — KYC wizard (variant routes by tenant.type)
- `/events/{eventId}/tickets` — ticket tier CRUD (Day 25)
- `/events/{eventId}/checkin` — Day 31 — Web QR scanner
- `/events/{eventId}/attendees` — Day 32 — attendee list + search/filter/export CSV

### Super-admin portal — `https://admin.staging.eventpulse.com.bd` (🔒 super-admin auth)

- `/admin/kyc` + `/admin/kyc/{id}` — KYC review
- `/admin/legal-trust` + `/admin/legal-trust/{slug}` — Legal & Trust editor
- `/admin/tenants/{id}/fees` — per-tenant fee override
- `/admin/events/{eventId}/tickets` — admin ticket view

### Attendee portal — `https://my.staging.eventpulse.com.bd`

- `/` 🌐 200 — thin shell (Sprint 8+)

### API — `https://api.staging.eventpulse.com.bd` (API routes ONLY on this vhost)

- `/health` 🌐 200 db:ok | `/nginx-health` 🌐 200
- `/api/v1/auth/oauth/google/start` 🌐 302 | `/api/v1/auth/oauth/apple/start` 🛑 404 (Apple dropped from MVP)
- `/api/v1/public/legal/landing` 🌐 200 | `/api/v1/public/events/*` 🌐
- `/api/v1/public/orders` 🌐 400 missing-idempotency-key — **free events complete; priced hit STAGING_PAYMENT_BLOCK**
- `/api/v1/public/orders/eps-return/*` 🌐 | `/api/v1/webhooks/eps/callback` 🌐 200
- `/api/v1/tenant/*` 🔒 401 — me/account-type/kyc/kyc-drafts/events/tickets/checkin/attendees/attendees/export/**reports/sales (NEW)**/**reports/payouts (NEW)**
- `/api/v1/admin/*` 🔒 401 — kyc/legal/tenants/:id/fees/events/:id/tickets

### Blocked-by-design (the truth-gate gap)

- ✅ Free event end-to-end works fully (§13.5 free-event bypass, Day 30)
- ⚠️ Paid event order: `StagingPaymentBlockedError`
- ⚠️ Real attendee email delivery: dry-run via `MAIL_DRY_RUN=1` (SES still in sandbox)
