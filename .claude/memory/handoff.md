# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-25 (Sprint 3 Day 24 COMPLETE — EPS wrapper Part 1 + STAGING_PAYMENT_BLOCK guard live + OAuth callback redirect fix + Decision N truth-gate harness PREP)
**Driver:** Claude Code (Opus 4.7) — Day 24 closeout; next session opens **Sprint 3 Day 25 — landing page template + ticket tier CRUD**

## State right now (2026-05-25 EOD)

**Sprint 3 Day 24 COMPLETE.** All 4 phases shipped through 4 PRs; staging caught up with zero drift; smoke checks green; STAGING_PAYMENT_BLOCK guard verified live.

**Branches + PRs:**

- `origin/main` HEAD = `a8cdb96` (PR #149 — OAuth redirect)
- Staging EC2 deployed code = `a8cdb960d0245863f6832610f2e2f05e3a6822d6` — **zero drift**
- **4 Day 24 PRs ALL MERGED in dependency-clean sequence:**
  - PR #148 (Phase 1) `feat(eps): STAGING_PAYMENT_BLOCK guard` → merged `db4f807`
  - PR #150 (Phase 3) `feat(eps): in-house wrapper Part 1` → merged `2d8190f`
  - PR #151 (Phase 4) `feat(eps): Decision N truth-gate harness` → merged `888827e`
  - PR #149 (Phase 2) `fix(auth): OAuth callback redirects instead of returning token JSON` → merged `a8cdb96`
- **PR #72 still DEFERRED** — `@noble/hashes` 1→2 awaits post-Days-24-25-EPS-truth-gate per decisions.md

**Day 24 deliverables (all merged):**

- ✅ **STAGING_PAYMENT_BLOCK guard** at `apps/api/src/infra/eps/staging-payment-block.ts`. `assertEpsCallAllowed(totalPaisa)` + `isStagingPaymentBlockEnabled()` + `StagingPaymentBlockedError`. 18 unit tests. Per §11.0: refuses `totalPaisa > 0n` when env=='1'; free events bypass. Side-effect free at import time. Verified live on staging — `STAGING_PAYMENT_BLOCK: 1` propagated to PM2 worker env.
- ✅ **OAuth callback redirect** at `apps/api/src/routes/oauth-routes.ts`. `c.json` → `c.redirect(postSignInUrl(), 302)`. Token leak fixed (no session/access/refresh in response body); back-button trap fixed (single-use code no longer re-runs on browser back); UX fixed (real page instead of JSON dump). Target: apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`. 13 tests (4 new + 9 existing). **Manual Google click-through verification pending from Moshiur** — `curl https://staging.eventpulse.com.bd/sign-in | grep oauth` confirmed renders absolute href (regression check); live click-through is the final empirical verification.
- ✅ **EPS wrapper Part 1** at `apps/api/src/infra/eps/`. 5 modules: `hash.ts` (HMAC-SHA512, 10 tests vs Node crypto + RFC 4231 vectors), `normalise-status.ts` (8 aliases × 6 field locations → canonical EpsStatus, 64 exhaustive tests, failure-closed), `token-cache.ts` (narrow interface + in-memory adapter, 9 tests, Day-26+ TODO for Redis swap), `client.ts` (`cfg()`/`BASE_URLS`/axios `http()` + `initialiseOrder()` STUB that runs STAGING_PAYMENT_BLOCK guard FIRST then throws `EpsNotImplementedError` + `verifyOrder()` STUB (no guard) + `getAccessToken()` cache-hit plumbing fully wired, 30 tests). `axios@^1.16.1` added as new dep per §11.2. 131 unit tests total.
- ✅ **Decision N truth-gate harness PREP** at `apps/api/src/infra/eps/truth-gate/`. `scenarios.ts` pins calculator predictions for all 4 modes (Mode A=2506, B=2500, C=2500, D=2506). `harness.ts` pure orchestration with `EpsObservationProvider` abstraction. `run-truth-gate.ts` entrypoint refuses execution today (noop provider throws prereqs-not-met); Day 24-25 execution will replace noop with wrapper-driven or manual provider. 26 unit tests. **No live EPS calls in this session.**

**Day 24 staging smoke (all GREEN):**

- main HEAD a8cdb96 deployed; EC2 git HEAD matches; zero drift
- PM2: `web online`, `api online`
- 5 vhosts /nginx-health: all 200 SSL=0
- `/health` (DB-aware): `{"status":"ok","service":"@eventpulse/api","db":"ok","checkedMs":10,...}`
- Google OAuth `/start`: 302 → `accounts.google.com/o/oauth2/v2/auth?...` with real client_id + PKCE
- Sign-in page renders absolute href: `https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start` (regression-checked)
- STAGING_PAYMENT_BLOCK literal `1` in `.env.staging`; propagated to PM2 worker env
- EPS dist files all present (client.js, hash.js, normalise-status.js, staging-payment-block.js, token-cache.js + truth-gate/*)
- No Google callback live click-through performed by Claude Code — Moshiur to confirm end-to-end

## Next concrete step

**Sprint 3 Day 25 — Landing page template + ticket tier CRUD.**

Per CLAUDE.md §26.1 Sprint 3 Day 4 (compressed-day Day 25):

- Single landing page template at `apps/web/src/components/public/` (or similar) with brand customisation slots: logo, primary colour, banner image, copy fields (title, description, schedule). Hardcoded React template; the drag-and-drop builder is Phase 2 Sprint 6+. Renders on `(public)/[tenant]/[event]/page.tsx` (route may need adjusting against current §3.1 layout).
- Ticket tier CRUD per §10.2 — `ticket_tiers` schema exists since migration 0001. Service layer + Hono routes at `/api/v1/tenant/events/:id/tickets` + RLS tests + super-admin/tenant UI for create/edit/archive. Audit helper `writeTicketTierCreated/Updated/Archived` per one-per-domain rule.
- Tax-withholding opinion (§29 #9) status check — fed into truth-gate execution semantics. If still pending by Day 25 EOD, surface to Moshiur for direct outreach.

**Pre-flight reads:**

- CLAUDE.md §9.3 (events + ticket_tiers schema)
- CLAUDE.md §10.2 (tenant ticket endpoints)
- CLAUDE.md §14.1 (fee math context for ticket tier price/capacity)
- `apps/api/src/db/schema.ts` (ticket_tiers Drizzle definition)
- Day 23 PR #145 — pattern reference for the events service layer + Hono routes shape
- Day 21 PR #119 — pattern reference for pure-function discipline if ticket-tier validation goes the same way

## Pending Moshiur actions (procurement / external) — Day 24 cumulative

**Most urgent (unblocks Decision N truth-gate execution, which gates Day 26+):**

1. **EPS sandbox credentials confirmed.** Either (a) EPS issues a separate sandbox credential set populated at `eventpulse/staging/eps-sandbox` Secrets Manager entry → harness runs against `EPS_MODE=sandbox` [SAFEST]; OR (b) Moshiur explicitly authorises lifting STAGING_PAYMENT_BLOCK against production credentials for the 4 truth-gate transactions only (4 × ~BDT 1,000 real charges). Lifting requires new `decisions.md` entry per §11.0 guardrail.
2. **§29 #9 (AIT withholding) + #10 (VAT/Mushak) tax opinions.** Calculator currently ships PRE-withholding; truth-gate measures EPS mechanics in isolation but interpreting organiser_net requires the withholding answer.

**Lower urgency (continued from above):**

1. **Phase 2 Google OAuth click-through verification.** PR #149 merged; staging deployed; tests verify redirect target shape; only live click-through unverified. Moshiur: click "Continue with Google" on <https://staging.eventpulse.com.bd/sign-in> + confirm (a) redirected to apex with `?signed_in=1`, (b) `eventpulse_session` cookie set, (c) back button goes to Google not callback URL. If broken: `gh pr revert <a8cdb96>` + redeploy; the other 3 Day 24 PRs are independent.
2. **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked.
3. **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit only if compromise event arises.

## STOP-ASK conditions for Sprint 3 Day 25+ (carry forward)

- §29 #9 / #10 tax opinions still pending by Day 25 EOD → halt Day 26 order-pipeline work, surface to Moshiur (calculator semantics depend on withholding answer).
- Any actual EPS network call wired before Phase 4 truth gate executes clean → halt + surface (Decision N + §11.0 guardrail).
- EPS sandbox truth gate fails (any cell delta) → calculator gets adjusted (not sandbox); §14.2 amended; fee-mode tests re-run; harness re-run. Day 26 sandbox-order work gates on this clearing.
- EPS wrapper finds `STAGING_PAYMENT_BLOCK` doesn't reliably guard against priced orders → halt all EPS work, file critical bug, surface immediately.
- Apple Sign-In re-introduction request → halt + surface; deliberate Phase 2+ decision.
- Any AWS write beyond migration 0012 / etc. during day-to-day work → halt + surface.

## Hard guardrails (carry forward unchanged + 2 new from Day 24)

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
- **Admin route group lives under `/(admin)/admin/...`** to avoid `/kyc` collision with `/(tenant)/kyc`.
- **Markdown sanitization is via `renderLegalMarkdown()` in `apps/api/src/domain/legal/render.ts`** (Decision J).
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K).
- **`consent_records` table is Sprint 3+ scope** (Decision L).
- **EPS library is in-house wrapper** at `apps/api/src/infra/eps/`. NO SDK.
- **`STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing. **Day 24 — guard is now code-shipped + verified live on staging** (PR #148, merged db4f807).
- **OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** Day 20 PR #104 regression-guard test fires loud if anyone reverts.
- **Org migration to `The-Public-Pulse-Agency`** has cascading impact on OIDC trust policies + billing + deploy keys.
- **AWS SDK v3 packages must bump together.** Dependabot grouping config landed in `.github/dependabot.yml`.
- **Self-modifying scripts need TWO deploys to verify.**
- **`@noble/hashes` stays at v1.8.0 through Days 24-25 truth gate.** PR #72 deferred. Do NOT add `.js` suffixes to subpath imports yet.
- **Apple Sign-In dropped from MVP scope.** Re-introducing is a deliberate Phase 2+ PR — NOT piecemeal.
- **`/api/v1/*` paths belong on `api.staging` vhost ONLY.** Frontend uses absolute URLs via `NEXT_PUBLIC_API_BASE_URL`.
- **EPS fee is NOT per-tenant configurable.** `tenant_fee_config.platform_fee_bps` only; EPS fee is order-time input.
- **NEW 2026-05-25 — OAuth callback redirect target is apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`.** Absolute URL required — callback runs on api vhost, must redirect to web vhost. Long-term target `(my)/tickets` lands Sprint 8 (attendee portal). Helper `postSignInUrl()` is exported + regression-tested.
- **NEW 2026-05-25 — EPS wrapper Part 1 ships in-memory token cache; Redis adapter swap is Day 26+.** When the order pipeline lands its first real `getAccessToken` caller, swap `defaultTokenCache()` from `inMemoryTokenCache()` to a `redisTokenCache(redisClient)`. Single-file change at the seam.
- **NEW 2026-05-25 — Three distinct greppable EPS error classes:** `StagingPaymentBlockedError` (deliberate refusal) / `EpsConfigError` (missing env) / `EpsNotImplementedError` (scope gap). Distinctness pinned by test; collapsing two into one fails fast.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only API tests (DB-gated tests skip without DATABASE_URL)
pnpm --filter @eventpulse/api test

# Run EPS wrapper Part 1 tests
pnpm --filter @eventpulse/api exec vitest run src/infra/eps/

# Run truth-gate scenarios + harness tests (no live EPS)
pnpm --filter @eventpulse/api exec vitest run src/infra/eps/truth-gate/

# Execute truth-gate entrypoint (will refuse — noop provider)
pnpm --filter @eventpulse/api exec tsx src/infra/eps/truth-gate/run-truth-gate.ts

# Verify staging EPS wrapper deployed
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["ls /home/eventpulse/app/apps/api/dist/infra/eps/"]' \
  --region ap-southeast-1 --profile eventpulse --query 'Command.CommandId' --output text

# Probe staging health
curl -s https://api.staging.eventpulse.com.bd/health | jq .
curl -s -o /dev/null -w "%{http_code}\n" https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start  # 302 = OAuth wired
curl -s https://staging.eventpulse.com.bd/sign-in | grep -oE 'href="[^"]*oauth[^"]*"'  # absolute href = regression OK
```
