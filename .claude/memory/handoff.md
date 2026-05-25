# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 25 COMPLETE — ticket tier CRUD live + landing page template live + bootstrap-staging validation; Phase 2 needed mid-PR fix for a pre-existing `<a>` lint catch surfaced by Phase 1's new dynamic route)
**Driver:** Claude Code (Opus 4.7) — Day 25 closeout; **next session opens Sprint 3 Day 26-28 — the order pipeline. LARGEST workstream of the sprint. Do NOT cram. Schedule as focused multi-session work.**

## State right now (2026-05-25 EOD)

**Sprint 3 Day 25 COMPLETE.** All three phases shipped through 3 PRs in clean dependency order (Phase 1 → Phase 3 → Phase 2 after lint fix).

**Branches + PRs:**

- `origin/main` HEAD = `e3ae382` (PR #155 — landing template)
- Staging EC2 deployed code = `e3ae382` (verified below)
- **3 Day 25 PRs MERGED:**
  - PR #153 (Phase 1) `feat(tickets): ticket tier CRUD + RLS + tenant/admin UI` → merged `052e5f8`
  - PR #154 (Phase 3) `fix(infra): validate load-bearing materialised env values in bootstrap-staging.sh` → merged `307a483`
  - PR #155 (Phase 2) `feat(public): single event landing page template + brand slots` → merged e3ae382
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate per decisions.md

**Day 25 deliverables (all merged):**

- ✅ **Migration 0012** `ticket_tiers` per §9.3 verbatim (16 columns + 7 CHECK constraints + standard tenant-scoped RLS per §4.3 + idx_tickets_event + grants per §4.2.1). Not append-only — UPDATEs to `sold` counter are core.
- ✅ **Service layer + audit + routes** at `apps/api/src/services/ticket-tiers/index.ts`, `services/audit/ticket-tiers.ts`, `routes/tenant/ticket-tiers.ts`, `routes/super-admin/ticket-tiers.ts`. 5 service functions (create/get/list/update/archive); event-ownership check via RLS-scoped events read before every mutation (clean 404 path). No money math; no capacity locking (Day 29).
- ✅ **Tenant CRUD UI + super-admin read UI** at `(tenant)/events/[eventId]/tickets/` + `(admin)/admin/events/[eventId]/tickets/`. Form + list + Edit/Archive. BDT-decimal input → paisa-string wire via `Math.round(bdt * 100)`. TanStack Query hooks (`useTenantTiers/useCreateTier/useUpdateTier/useArchiveTier/useAdminEventTiers`).
- ✅ **Public event landing template** at `(public)/[tenant]/[event]/page.tsx` (Server Component, `revalidate: 60`) + `<EventLanding>` component with brand-color CSS vars (overrideable per tenant, §1.5 fallback). Bilingual copy. Disabled "Buy (coming soon)" CTA — buy flow lands Day 26-28. Visibility gate per §9.3: only `(public OR unlisted) AND (published OR on_sale OR sold_out OR live)` resolves; rest → 404 via `notFound()`.
- ✅ **Public event API endpoint** at `GET /api/v1/public/events/:tenantSlug/:eventSlug` (unauthenticated; `cache-control: public, max-age=60, s-maxage=300`).
- ✅ **bootstrap-staging.sh validation** — step 2.1 greps `.env.staging` for `NEXT_PUBLIC_API_BASE_URL` + `EVENTPULSE_API_BASE_URL` + `EVENTPULSE_WEB_BASE_URL`; non-empty + `^https?://` required. Fails loud before deploy.sh consumes broken env. Closes the Day 23 silent-failure carry-forward.
- ✅ **Pre-existing `<a>` lint regression caught + fixed** — `apps/web/src/components/legal/document-page.tsx` had `<a href="/trust">` + `<a href="/contact">` that local `next lint` missed but CI's `next build` lint pass flagged when the Phase 2 `[tenant]/[event]` dynamic route landed. Replaced with `<Link>` from `next/link`. Tests + build green post-fix.

**Tests shipped:**

- 21 ticket-tier service integration tests (DB-gated; covers CRUD + RLS + CHECKs)
- 8 public-event query integration tests (visibility/status/soft-delete gating)
- 15 EventLanding component tests (brand slots + bilingual + tier rendering + axe-clean)
- Existing 436 API tests + 92 web tests pass — no regressions

**Day 25 staging smoke (all GREEN):**

- main HEAD post-Phase-2 deployed; EC2 HEAD matches; zero drift
- PM2: web online + api online
- 5 vhosts `/nginx-health`: all 200 SSL=0
- `/health` (DB-aware): `{db: 'ok', ...}`
- Migration 0012 applied (ticket_tiers table present)
- New routes: `/events/[eventId]/tickets` (tenant), `/admin/events/[eventId]/tickets` (super-admin), `/[tenant]/[event]` (public)
- `STAGING_PAYMENT_BLOCK=1` still enforcing
- Google OAuth `/start` still 302 (Day 24 fix holds)

## Next concrete step — Day 26-28: The Order Pipeline (largest workstream of Sprint 3)

**Schedule as multi-session focused work, NOT a single sitting.** Per the Day 25 brief's explicit warning. Day 26-28 spans:

- EPS in-house wrapper Part 2 (real `getAccessToken` HTTP call + `initialiseOrder` real call + `verifyOrder` real call) — replaces the Day 24 stubs that throw `EpsNotImplementedError`
- Redis token cache adapter swap (replace `inMemoryTokenCache` with `redisTokenCache` at the `defaultTokenCache()` seam; adds `ioredis` dep + Redis provisioning on EC2)
- Order schema migration — `orders` + `order_items` + `attendees` + `order_events` + `refunds` tables (§9.5)
- Order creation endpoint (`POST /api/v1/public/orders`) using fee-calculator at order time
- EPS init flow + redirect handling + Verify-on-return (§1.3 R3 — never trust query params)
- QR generation per attendee (`attendees.qr_code` unique)
- PDF ticket generation
- Email delivery via Day 21 AM bilingual SES templates
- **Decision N truth-gate execution** — 4 real EPS sandbox transactions vs calculator predictions; calculator amends on shift (NOT sandbox observations); §14.2 amendment if Mode C shifts

**Pre-flight reads:**

- CLAUDE.md §11 (EPS in full — flow, env vars, gotchas, reconciliation)
- CLAUDE.md §9.5 (orders schema)
- CLAUDE.md §14 (settlement engine + fee calculator + §14.2 worked examples)
- `apps/api/src/infra/eps/{client,hash,normalise-status,token-cache,staging-payment-block}.ts` (Day 24 Part 1 surface)
- `apps/api/src/infra/eps/truth-gate/{scenarios,harness,run-truth-gate}.ts` (Day 24 truth-gate harness)
- `apps/api/src/domain/payments/fee-calculator.ts` (Day 21)
- decisions.md "EPS library choice locked" (2026-05-19), "Decision N" (2026-05-19), "@noble/hashes deferred" (2026-05-24)
- handoff.md (this file) for Day-25 EOD state

**Day 26-28 STOP-ASK conditions (load-bearing):**

- §29 #9 (AIT withholding) opinion still pending → halt order pipeline; surface to Moshiur. Calculator semantics depend.
- §29 #10 (VAT/Mushak) opinion still pending → same.
- EPS sandbox creds NOT confirmed → halt; truth-gate cannot execute against production creds (STAGING_PAYMENT_BLOCK guards) without an explicit `decisions.md` lift authorisation.
- Truth-gate fails any cell on execution → calculator adjusts (NOT sandbox); §14.2 amends; §24.4 fee-mode tests re-run; harness re-runs. Day 26+ pipeline gates on clean.
- Any actual EPS network call wired BEFORE the truth gate executes clean → halt + surface (Decision N + §11.0 guardrail).
- EPS wrapper finds `STAGING_PAYMENT_BLOCK` doesn't reliably guard against priced orders → halt all EPS work, file critical bug, surface immediately.
- Apple Sign-In re-introduction request → halt + surface; deliberate Phase 2+ decision.
- Any AWS write beyond migration 0013/0014/etc during day-to-day work → halt + surface.

## Pending Moshiur actions (procurement / external) — Day 25 cumulative

**Most urgent (gates Decision N truth-gate execution → gates Day 26+ order pipeline):**

1. **EPS sandbox credentials confirmed** OR explicit STAGING_PAYMENT_BLOCK lift authorisation for 4 truth-gate transactions (4 × ~BDT 1,000 real charges; requires new `decisions.md` entry per §11.0 guardrail). Safest path: separate sandbox set at `eventpulse/staging/eps-sandbox`.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.** Calculator ships PRE-withholding; truth-gate semantics depend on the answer.

**Lower urgency (continued from prior days):**

1. **Phase 2 Google OAuth click-through verification (Day 24 carry).** PR #149 merged + deployed Day 24; tests verify redirect target shape; only live click-through unverified. Click "Continue with Google" on <https://staging.eventpulse.com.bd/sign-in>; confirm (a) redirected to apex with `?signed_in=1`, (b) `eventpulse_session` cookie set, (c) back button goes to Google not callback URL. Revert is `gh pr revert <a8cdb96>` if broken.
2. **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked.
3. **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit only if compromise event arises.
4. **bootstrap-staging.sh validation guard live-trigger.** Per "self-modifying scripts need TWO deploys to verify" — the deploy that shipped #154 ran the OLD bootstrap; new validation runs on the NEXT bootstrap. Trigger a follow-up bootstrap to exercise it live.

## Hard guardrails (carry forward + 3 new from Day 25)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts`.
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1). Owner login = `The-Public-Pulse-Agency`.
- `audit_logs` is APPEND-ONLY (§1.3 R8 + §4.2.1.1). `legal_document_versions` also append-only.
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
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing. Guard now code-shipped (PR #148).
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** Day 20 PR #104 regression-guard test fires loud if anyone reverts.
- **Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC + billing + deploy keys.
- **AWS SDK v3 packages must bump together.** Dependabot grouping config landed.
- **Self-modifying scripts need TWO deploys to verify.**
- **`@noble/hashes` stays at v1.8.0 through Days 24-25 truth gate.** PR #72 deferred.
- **Apple Sign-In dropped from MVP scope.** Re-introducing is a deliberate Phase 2+ PR.
- **`/api/v1/*` paths belong on `api.staging` vhost ONLY.** Frontend uses absolute URLs via `NEXT_PUBLIC_API_BASE_URL`.
- **EPS fee is NOT per-tenant configurable.** Order-time input only.
- **OAuth callback redirect target = apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`** (Day 24 PR #149).
- **EPS wrapper Part 1 ships in-memory token cache; Redis adapter swap at Day 26-28** (Day 24 decision).
- **Three distinct greppable EPS error classes** — `StagingPaymentBlockedError` / `EpsConfigError` / `EpsNotImplementedError`.
- **NEW 2026-05-25 — Ticket tier CRUD ships without money math.** Tier stores `price_paisa` raw; the fee-calculator (Day 21) is the only consumer that turns price into checkout numbers at order time. Phase 1 service-layer + UI deliberately do not compute totals.
- **NEW 2026-05-25 — Ticket tier capacity locking is Day 29 scope.** `sold` counter exists on tiers from migration 0012; the `SELECT … FOR UPDATE` row lock that prevents oversell at paid-order transition lands at Day 29 alongside the idempotency middleware. CRUD does NOT update `sold`.
- **NEW 2026-05-25 — Public event visibility + status gating is application-policy, not RLS.** RLS filters by tenant scope; the public read at `/api/v1/public/events/:tenantSlug/:eventSlug` deliberately crosses tenant boundaries (any tenant's public event is fetchable by URL). Visibility (`public | unlisted`) + status (`published | on_sale | sold_out | live`) are policy filters applied in `fetchPublicEvent()` — not in RLS policies. `withSuperAdmin()` (BYPASSRLS) is the correct context here.

## Useful runbook fragments

```bash
# Shell into staging EC2
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger staging deploy
gh workflow run deploy-staging.yml --ref main

# Re-run bootstrap-staging.sh to exercise the new Day 25 validation step
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo /home/eventpulse/app/infra/scripts/bootstrap-staging.sh"]' \
  --region ap-southeast-1 --profile eventpulse --query 'Command.CommandId' --output text

# Run ticket-tier integration tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/services/ticket-tiers/

# Run public-event query tests (DB-gated)
pnpm --filter @eventpulse/api exec vitest run src/domain/public-events/

# Run EventLanding component tests
pnpm --filter @eventpulse/web test src/components/public/

# Smoke a public event landing page (replace with real tenant/event slugs)
curl -s https://staging.eventpulse.com.bd/publicpulse/summer-sounds-2026 | head -50
```
