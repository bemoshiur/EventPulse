# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-24 (Sprint 3 Day 23 COMPLETE — events CRUD + tenant fee-config exposure + Apple Sign-In dropped + URL health pass + 3 staging-vhost-class gotchas)
**Driver:** Claude Code (Opus 4.7) — Day 23 closeout; next session opens **Sprint 3 Day 24 — EPS in-house wrapper Part 1 + EPS sandbox truth-gate prep**

## State right now (2026-05-24 EOD)

**Sprint 3 Day 23 COMPLETE.** Both workstreams shipped, URL pass executed, Apple cleanup landed. PR #145 in flight (CI re-running after first-round fixes); PR #144 merged + deployed.

**Branches + PRs:**

- `origin/main` HEAD = `5234728` (PR #144 — Apple Sign-In removal)
- Staging EC2 deployed code = `5234728` — **zero drift**; Apple endpoints now 404, Google still 503 OAUTH_NOT_CONFIGURED (correct-by-design)
- **PR #145 OPEN** — `feat(day-23): tenant Event CRUD + tenant_fee_config override surface`. 8 commits on `feat/sprint-3-day-23-events-and-fee-config`. CI re-running after `aa1e81b` fixed slug-collision PG-error matcher + `it's` apostrophe lint. Migration 0011 lands when this merges.
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate per decisions.md.

**Day 23 deliverables (all shipped on PR #145):**

- ✅ Migration 0011 events table (27 cols, sans `primary_domain_id` — deferred to Sprint 7) + RLS + grants + updated_at trigger
- ✅ `event-state-machine.ts` PURE validation (mirrors fee-calculator.ts purity) + 65 unit tests (4ms). 12 legal transitions per §2.4 chain; archived terminal; no skips; no rewinds past published.
- ✅ Event service layer (6 functions) + Hono routes (6 endpoints) + 4 audit helpers + integration tests + 3 RLS cross-tenant isolation tests
- ✅ Fixed React form templates per event type — 8 wrappers + base `EventForm` + `per-type-config.ts` (defaults + bilingual copy)
- ✅ `tenant_fee_config` super-admin exposure — service layer (4 functions) + Hono routes + audit helper + super-admin UI + TanStack Query hook + integration tests
- ✅ 4-eyes anomaly UX — warning banner when `|delta| > 10` bps; server records `is_anomalous` on audit row regardless
- ✅ **No money math** added anywhere except via the existing fee calculator. Service stores bps; calculator consumes bps.

**Day 23 adjacent — Apple Sign-In dropped from MVP scope (PR #144 merged at 18:47 UTC, deployed as `5234728`):**

- Frontend Apple button + AppleLogo removed
- Backend `/apple/start` + `/apple/callback` routes removed; `appleClient()` / `verifyAppleIdToken()` / Apple JWKS / Apple state-cookie helpers removed
- Types narrowed (`OAuthProvider` literal narrowed to `'google'`); SES template `oauth-account-linked.ts` narrows + adds exhaustive-guard throw on unknown providers
- Regression guards added: `GET /apple/start` → 404 + `POST /apple/callback` → 404 + frontend Apple-button absence tested
- DB CHECK enum on `oauth_identities.provider` preserved at `('google','apple')` for historical-row readability + forward-compat re-introduction. No migration.
- Re-introducing Apple is a deliberate Phase 2+ decision via dedicated PR — NOT piecemeal.

**Day 23 staging URL health pass:**

- 5 vhosts probed (apex/api/app/admin/my): apex/app/admin/my return 200, api returns 404 on `/` (correct — no root route on Hono)
- 5 nginx-health probes: all 200
- API `/health` (DB-aware): 200
- 9 public web pages + 12 trust artefacts: all 200
- 4 auth-gated tenant + admin endpoints: 401 AUTH_REQUIRED (correct-by-design)
- Apple endpoints: 404 (regression guards proven live)
- Google OAuth start: 503 OAUTH_NOT_CONFIGURED (procurement-gated)
- **Zero genuine breakages on current main.**

**The user's original "OAuth not working" diagnosis — RESOLVED in two parts:**

1. Wrong vhost (user hit `staging.eventpulse.com.bd/api/v1/...` which goes to Next.js, not Hono) → captured as gotchas.md "API routes live ONLY on api.staging vhost".
2. `NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time silently renders relative OAuth href → captured as gotchas.md "`NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time".

The frontend code is correct (uses `NEXT_PUBLIC_API_BASE_URL`); the missing env var at build time is the silent failure. Verified live: `curl https://staging.eventpulse.com.bd/sign-in | grep oauth` returns `href="/api/v1/auth/oauth/google/start"` — relative, confirms env var unset. **Operational fix** (user action) — add `NEXT_PUBLIC_API_BASE_URL=https://api.staging.eventpulse.com.bd` to Secrets Manager + re-run bootstrap-staging.sh + redeploy.

Google OAuth's 503 itself stays correct-by-design until Google Cloud Console OAuth credentials are provisioned (separate user action; do NOT attempt to fix from code).

**Memory captured (1 new decision + 3 new gotchas):**

- decisions.md "Apple Sign-In dropped from MVP scope" (2026-05-24)
- decisions.md "EPS fee is NOT per-tenant configurable" (2026-05-24) — settles the Day 23 pre-flight scope question
- gotchas.md "API routes live ONLY on `api.staging` vhost — hitting them on the web vhost returns Next.js 404 HTML" (2026-05-24)
- gotchas.md "`NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time silently renders relative OAuth href" (2026-05-24)
- gotchas.md "react-hook-form + zod schema with `.pipe(z.coerce.date())` produces unresolvable Resolver type mismatch" (2026-05-24)

## Next concrete step

**Sprint 3 Day 24 — EPS in-house wrapper Part 1 + Decision N truth-gate framing.**

Once #145 merges + migration 0011 applies on staging, Day 24 work opens here.

**Pre-flight reads:**

- CLAUDE.md §11.0 (EPS status — in-house wrapper locked, STAGING_PAYMENT_BLOCK mandatory)
- CLAUDE.md §11.2 (in-house wrapper skeleton — axios + `@noble/hashes` HMACSHA512 + zod-validated responses; v2 `.js`-suffix amendment for post-truth-gate bump)
- CLAUDE.md §11.4 (per-endpoint hash mechanism — `userName` for GetToken, `merchantTransactionId` for InitializeEPS + CheckMerchantTransactionStatus)
- CLAUDE.md §14.2 (fee mode worked examples — Mode C primary `2506` arithmetically inconsistent with EPS's 2.5% rate; sandbox is the empirical arbiter)
- decisions.md "EPS library choice locked for Sprint 3 — in-house wrapper" (2026-05-19)
- decisions.md "Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate" (2026-05-19 = Decision N)
- decisions.md "@noble/hashes 1.8.0 → 2.2.0 deferred to post-Days-24-25-EPS-truth-gate" (2026-05-24)

**Day 24 work:**

- **EPS wrapper skeleton** at `apps/api/src/infra/eps/`:
  - `client.ts` — axios instance + base URL switch (`production` vs `sandbox` per `EPS_MODE`); `STAGING_PAYMENT_BLOCK=1` guard refusing `total_paisa > 0` calls
  - `normalise-status.ts` — collapses `SUCCESS|COMPLETED|FAILED|FAILURE|CANCEL|CANCELLED|CANCELED|Pending` across `Status` / `transactionStatus` / `status` / nested `data.*` aliases (§11.4 gotcha)
  - `hash.ts` — `hmac(sha512, key, value)` from `@noble/hashes/hmac` + `@noble/hashes/sha2` (v1 imports; bare specifiers, no `.js` suffix per the deferred #72)
  - Initial wrapper functions: `getAccessToken()` (caches in Redis, key = hash of credentials), `initialiseOrder()` (with STAGING_PAYMENT_BLOCK guard), `verifyOrder()`
  - Unit tests for `normaliseStatus()` covering all 8 alias permutations + the field-level fallback chain

- **No order pipeline yet** — Day 26-28 work. Day 24 ships the wrapper primitives; Day 25 ships ticket tiers; Day 26 wires order creation onto the wrapper.

**Day 24-25 EPS sandbox truth gate (NON-NEGOTIABLE per Decision N):**

- 4 real EPS sandbox transactions covering all §14.2 modes (subtotal 1,000 BDT, platform 0.25%, EPS 2.5%)
- Capture EPS's actual fee on each transaction
- Compare to calculator predictions: Mode A=2506, B=2500, C=2500, D=2506
- Any delta in any cell is a **calculator bug** — adjust the calculator (NOT the sandbox observations), re-run §24.4 fee-mode tests, amend §14.2 to match
- Mode C (AB,PT) is the most likely-to-shift cell (Decision N picked calc's 2500 over §14.2 primary 2506 because §14.2 primary is arithmetically inconsistent with EPS's 2.5% rate)
- **Day 26 first-sandbox-order-verification cannot pass without this gate clearing**
- Post-truth-gate, reopen PR #72 (`@noble/hashes` 1→2) per its deferral plan

**STAGING_PAYMENT_BLOCK enforcement (load-bearing):**

- `initialiseOrder()` MUST throw if `STAGING_PAYMENT_BLOCK === '1'` AND `total_paisa > 0`
- Production EPS credentials are in staging deliberately (Day 20 Moshiur decision)
- The block is the safety net preventing real cards from being charged during staging tests
- Removing the block requires explicit decisions.md entry + alignment with MVP cutover

## Pending user actions (procurement / external)

- **Google OAuth credentials provisioning** — to make Google sign-in work on staging, Moshiur creates an OAuth 2.0 Client ID in Google Cloud Console (Web application, redirect URI `https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/callback`, JavaScript origin `https://staging.eventpulse.com.bd`), then either runs `aws secretsmanager create-secret --name eventpulse/staging/oauth-google --secret-string '{"client_id":"...","client_secret":"..."}'` themselves OR provides credentials to Claude Code to do the write. Then SSM into staging + re-run `bootstrap-staging.sh` + `pm2 reload api`. Until this lands, OAuth 503 stays.
- **`NEXT_PUBLIC_API_BASE_URL` build-time env** — add to Secrets Manager + bootstrap-staging.sh output so Next.js build picks it up. Without this, the OAuth button renders a relative href that resolves to the wrong vhost. Operational, not code.
- **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked until counsel returns drafts.
- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — tax-opinion email status; needed before Day 24-25 truth gate for calculator math correctness.
- **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit only if compromise event arises.

## STOP-ASK conditions for Sprint 3 Day 24+ (unchanged)

- §29 #9 / #10 tax opinions still pending by Day 24 → halt EPS wrapper, surface to Moshiur (calculator semantics depend on withholding answer).
- OAuth credentials still missing → document as Sprint 4 pending; no further verification work this sprint. Do NOT attempt to provision OAuth credentials from Claude Code — that's user-only.
- EPS sandbox truth gate fails (any cell delta) → calculator gets adjusted (not sandbox), §14.2 gets re-amended, fee-mode tests re-run. Day 26 sandbox-order work gates on this clearing. **The calculator is the variable to change, not the sandbox observations** — Decision N 2026-05-19.
- EPS wrapper finds `STAGING_PAYMENT_BLOCK` doesn't reliably guard against priced orders → halt all EPS work, file critical bug, surface immediately.
- Any AWS write beyond migration 0011 / 0012 / etc. during day-to-day work → halt + surface (matches the Day 23 brief's "no AWS write beyond migration 0011" rule for that day; same shape applies going forward).
- Apple Sign-In re-introduction request → halt + surface; it's a deliberate Phase 2+ decision per decisions.md, not a piecemeal add.

## Hard guardrails (carry forward unchanged + 2 new from Day 23)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts` (Sprint 3 Day 21 deliverable).
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1). Owner login = `The-Public-Pulse-Agency` (post-org-migration).
- `audit_logs` is APPEND-ONLY (§1.3 R8 + §4.2.1.1). `legal_document_versions` also append-only.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Multiple sibling helpers in the same domain file are fine.
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()` via vitest-axe.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — Day 16 PR 3 BLOCKER.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory; sessionStorage holds only opaque IDs. **Detail-view queries on PII surfaces MUST override the default TanStack Query cache** to `staleTime: 0` + `gcTime: 0` + `refetchOnWindowFocus: false` + `refetchOnReconnect: false` (Decision H, Day 18).
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — Day 16 PR 3 gotcha; deferred from v2.3 playbook bump to v2.4.
- **BIN 13-digit fact (NBR 2019-11-30) is reviewer-documentation, NOT server-side enforcement.**
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER.
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.**
- **Manual-verification policy is load-bearing.** Phase 2 trigger = 50 verified submissions/week sustained, 4-week trailing average.
- **Porichoy adapter scaffold-only shape is canonical** for all future automation integrations.
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts.
- **Admin route group lives under `/(admin)/admin/...`** to avoid `/kyc` collision with `/(tenant)/kyc`.
- **Markdown sanitization is via `renderLegalMarkdown()` in `apps/api/src/domain/legal/render.ts`** (Decision J).
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K).
- **`consent_records` table is Sprint 3+ scope** (Decision L).
- **EPS library is in-house wrapper** at `apps/api/src/infra/eps/` (Day 20 decisions.md). NO SDK.
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing.
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** Day 20 PR #104 regression-guard test fires loud if anyone reverts.
- **Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC trust policies + billing + deploy keys.
- **AWS SDK v3 packages must bump together.** Dependabot grouping config landed in `.github/dependabot.yml` (PR #136). Never bump a single `@aws-sdk/*` package independently.
- **Self-modifying scripts need TWO deploys to verify.** When changing `deploy.sh` (or any shell script invoked via SSM), the deploy that ships it runs the OLD copy from bash memory; the NEW copy doesn't exercise until the next deploy.
- **`@noble/hashes` stays at v1.8.0 through Days 24-25 truth gate.** PR #72 deferred per decisions.md. Do NOT add `.js` suffixes to subpath imports yet (would break v1 resolution).
- **NEW 2026-05-24 — Apple Sign-In dropped from MVP scope.** Re-introducing is a deliberate Phase 2+ PR — NOT piecemeal. Regression guards in `oauth-routes.test.ts` ("Apple Sign-In removal guard") + `oauth-button-group.test.tsx` ("does NOT render an Apple button") fire loud if anyone copy-pastes Apple back in.
- **NEW 2026-05-24 — `/api/v1/*` paths belong on `api.staging` vhost ONLY.** Frontend code that hits the API MUST use absolute URLs via `NEXT_PUBLIC_API_BASE_URL`. Relative paths from the web vhost hit Next.js 404 (not Hono). See gotchas.md "API routes live ONLY on api.staging vhost" + "`NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time".
- **NEW 2026-05-24 — EPS fee is NOT per-tenant configurable.** `tenant_fee_config` has `platform_fee_bps` only; EPS fee is pass-through from payment-method metadata, passed to the fee calculator as an order-time input. Never add an `eps_fee_bps` column. See decisions.md "EPS fee is NOT per-tenant configurable" (2026-05-24).

## Net-new Dependabot PRs (none arrived since Day 23 morning)

All Day 23 work was on PR #144 (Apple) + PR #145 (events + fee-config). No new Dependabot PRs in the queue. #72 stays open + deferred.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only API tests (DB-gated tests skip without DATABASE_URL)
pnpm --filter @eventpulse/api test

# Run state-machine unit tests (no DB needed)
pnpm --filter @eventpulse/api exec vitest run src/domain/event-state-machine.test.ts

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Verify migration state on staging
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u postgres psql -d eventpulse_staging -c \"SELECT filename, applied_at FROM _eventpulse_schema_migrations ORDER BY applied_at DESC LIMIT 5;\""]' \
  --region ap-southeast-1 --profile eventpulse --query 'Command.CommandId' --output text

# Probe vhost routing (the Day 23 lesson)
curl -s -o /dev/null -w "%{http_code}\n" https://staging.eventpulse.com.bd/api/v1/auth/oauth/google/start  # 404 = wrong vhost (Next.js)
curl -s -o /dev/null -w "%{http_code}\n" https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start  # 503 = correct vhost (Hono)
```
