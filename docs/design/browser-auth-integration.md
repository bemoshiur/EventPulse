# Browser-auth integration — scope + TDD plan

> **Status:** SCOPING (Day 45, 2026-06-02). Discovered while bootstrapping the first
> super-admin for the BDT-100 prod smoke. **This is a launch blocker for any logged-in
> surface.** The smoke was re-deferred (operator) because the "full UI flow" it needs
> can't run until this lands.
>
> **One-line:** the API is sound and the portal UIs exist, but the **authenticated
> browser flow was never wired end-to-end** — there is no working browser sign-in to the
> tenant, admin, or attendee portals on prod (or anywhere).

---

## 1. What works vs. what doesn't (all verified in-tree on `main`)

| Surface                                        | State                        | Evidence                                                                                              |
| ---------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| API (Bearer-authenticated)                     | ✅ works, integration-tested | `apps/api/src/auth/middleware.ts:40` reads `Authorization: Bearer`; PR #267 audience-grant tests pass |
| Marketing / public pages                       | ✅ works (no auth)           | `(public)` route group, server-rendered                                                               |
| **Guest checkout** (buy a ticket)              | ✅ works (no login)          | `POST /api/v1/public/orders`; §2.1 guest buyer                                                        |
| Browser sign-in → tenant/admin/attendee portal | ❌ **non-functional**        | four independent gaps, §2 below                                                                       |

The integration tests pass because they call the API **directly with a Bearer token**
(`app.request(...)` in `auth.test.ts`), bypassing the browser cookie layer entirely. No
test, and no human, ever exercised a real browser login. The gap was invisible until now.

---

## 2. The four gaps (root-caused)

**Gap 1 — No CORS on the API.**
`apps/api/src/app.ts` / `index.ts` register **zero** CORS middleware (`rg -n cors` → no
match). The web portals call `https://api.eventpulse.com.bd` cross-origin
(`NEXT_PUBLIC_API_BASE_URL`, confirmed on prod) with `credentials: 'include'`
(`use-admin-fee-config.ts:51`, `use-admin-revenue.ts:53`, `use-tenant-payouts.ts:46`). The
browser blocks every authenticated portal→API call at preflight — no
`Access-Control-Allow-Origin` / `-Allow-Credentials` is ever returned.

**Gap 2 — Cookie ↔ Bearer mismatch.**
Web hooks send **cookies** (`fetchWithCreds` = `fetch(..., {credentials:'include'})`); the
API auth middleware reads **only** `Authorization: Bearer` (`middleware.ts:41`) and ignores
cookies. **Nothing in the web app attaches a Bearer header** (`rg -n Authorization apps/web/src`
→ no match). The two halves were never connected — `middleware.ts:55-56` literally says
_"accept any valid JWT … tighten in Day 9-10 when we wire the cookie → hash lookup."_ That
never happened.

**Gap 3 — No session cookie is ever set.**
`POST /api/v1/auth/magic-link/consume` and `/password/login` return tokens in a **JSON body**
(`auth.ts:135,247`). There is no consume page, no cookie-setter, no server route that
persists a session into the browser. The only `apps/web/src/app/api/` route handler is
`revalidate-trust`.

**Gap 4 — Magic-link is doubly broken.**
`EVENTPULSE_BASE_URL` is **unset on prod** → the link falls back to the hardcoded
`https://staging.eventpulse.com.bd/auth/magic?...` (`auth.ts:159`) — wrong environment. And
`/auth/magic` **does not exist** in the web app (only `(auth)/sign-in/page.tsx`), so the
link 404s even on the right host.

**Also surfaced (related, will matter):** there is **no `/refresh` endpoint** — `signTokens`
issues an access + refresh JWT but nothing consumes the refresh token to rotate. The
sessions table is the real session store (7-day expiry, `resolveSession` by token-hash).

---

## 3. Target design

### 3.1 Credential-transport options

**Option A — JS-readable token + Bearer.** Consume page stores access/refresh tokens in
JS-reachable storage; a fetch wrapper attaches `Authorization: Bearer`. API unchanged.
❌ **Rejected** — token in JS = XSS-exfiltration risk on a money/PII surface; violates the
§5.3 HttpOnly intent.

**Option B — Session cookie read by the API (+ CORS-with-credentials).** Consume sets an
**HttpOnly** cookie carrying the opaque **session token** (`Domain=.eventpulse.com.bd`,
`Secure`, `SameSite=Lax`). The browser sends it to `api.eventpulse.com.bd` automatically
(same-site subdomain). API auth middleware reads the cookie and resolves it via the existing
`resolveSession(token)` (a _live_ session-row check — strictly better than today's "accept
any JWT"). API adds CORS echoing the **exact** portal origin + `Allow-Credentials: true`.

- ✅ Reuses `sessions` table + `resolveSession`; no JWT-in-browser; no `/refresh` needed
  (session is the 7-day store).
- ⚠️ Cross-origin credentials + a parent-domain cookie; CORS must echo a specific origin
  (never `*` with credentials).
- **Effort:** medium; touches the security-critical API auth middleware + CORS.

**Option C — Next.js BFF proxy.** Each portal serves `/api/*` via Next route handlers
(server-side). Consume (a server route) calls the API, gets tokens, sets a **same-origin**
HttpOnly cookie (`SameSite=Strict` possible). All hooks call same-origin `/api/*`; the proxy
reads the cookie server-side and forwards `Authorization: Bearer` to the API. **API
untouched; no CORS.**

- ✅ Strongest isolation — token never in the browser, no cross-origin surface, API
  unchanged. Standard Next pattern.
- ⚠️ Most web-side build (a proxy layer per portal + refresh handling server-side).

**Recommendation (for sign-off, not yet locked):** **Option B** for the MVP — least total
work, reuses `resolveSession` + the `sessions` table as designed, sidesteps the missing
`/refresh` endpoint. Document **Option C** as the hardening path if we later want token
isolation + to drop CORS. **This is foundational auth — it needs operator/architect sign-off
before code (CLAUDE.md "ask before modifying auth code").**

### 3.2 Per-portal audience on consume

The consume must derive audience from the **portal it lands on**, never client input
(consistent with PR #267):

- `admin.eventpulse.com.bd/auth/magic` → `super-admin` (requires `super_admins` row).
- `my.eventpulse.com.bd/auth/magic` → `attendee`.
- `app.eventpulse.com.bd/auth/magic` → **attendee session first**, then the §2.3 context
  switcher mints a `tenant` session for a chosen tenant (audience-grant checked). A
  multi-tenant user can't be assigned a tenant at login without picking one; single-tenant /
  personal-tenant users can be auto-switched. **Open decision 4.2.**

### 3.3 Other required pieces

- Set `EVENTPULSE_BASE_URL` per environment (prod → `https://app.eventpulse.com.bd`, or the
  consume host). Fix the magic-link URL builder to target the real consume page.
- Build `/auth/magic` consume page (the missing route).
- Layout auth-gating: `(tenant)`/`(admin)` layouts (server components) read the session →
  redirect to `/sign-in` when absent/invalid (today they don't gate — `(admin)/layout.tsx`
  says "this layout does NOT re-authenticate").
- `logout` clears the cookie.
- OAuth (Google/Apple) is separately unconfigured (`OAUTH_NOT_CONFIGURED`); out of scope
  here (optional for launch) but the consume/cookie mechanism it would share lands here.

---

## 4. Open decisions (need operator/architect before implementation)

1. **Credential transport: Option B (session cookie + CORS) vs C (BFF proxy).** Recommend B
   for MVP speed; C for isolation. Foundational — sign off first.
2. **Tenant audience at login for multi-tenant users.** Auto-switch when the user has exactly
   one (personal) tenant; otherwise land on a context-picker. Confirm the MVP UX.
3. **Cookie scope.** Option B uses `Domain=.eventpulse.com.bd` (shared across subdomains);
   Option C uses per-portal same-origin cookies. Follows from #1.
4. **Launch posture if this slips past June 10.** A **narrow launch** is possible _today_:
   ops/operator publishes events via API/seed, buyers use **guest checkout** (works). Full
   self-serve tenant onboarding requires this integration. Decide whether June 10 is
   guest-checkout-narrow or full-portal.

---

## 5. TDD task breakdown (assumes Option B; adjust if C chosen)

Each step: **write the failing test first, watch it fail, minimal green, refactor.** Auth
code — no production line without a red test first.

1. **CORS preflight (API).** RED: integration test — `OPTIONS /api/v1/tenant/me` with
   `Origin: https://app.eventpulse.com.bd` expects `Access-Control-Allow-Origin` echoed +
   `Allow-Credentials: true` + allowed methods/headers; a non-allowlisted origin gets no ACAO.
   GREEN: add CORS middleware with an explicit origin allowlist (the 3 portal origins, env-driven).
2. **API reads session cookie.** RED: a request with no `Authorization` header but a valid
   session cookie (`ep_session=<token>`) reaches a `requireTenantAuth` route as 200; an
   invalid/expired cookie → 401; a revoked session → 401 (this is the `resolveSession` live
   check the current middleware lacks). GREEN: extend `extractAndVerify` to fall back to the
   cookie → `resolveSession` → claims from the session row.
3. **Consume sets the cookie.** RED: `POST /magic-link/consume` (and `/password/login`)
   responds with `Set-Cookie: ep_session=…; HttpOnly; Secure; SameSite=Lax; Domain=.eventpulse.com.bd`
   on success; no cookie on 401/403. GREEN: set the cookie alongside the JSON body.
4. **Logout clears it.** RED: `POST /logout` returns `Set-Cookie` with an expired
   `ep_session`. GREEN: clear it + keep the existing `revokeSession`.
5. **`/auth/magic` consume page (web).** RED: component test — given `?token=…`, it POSTs to
   the API consume with `credentials:'include'`, on 200 redirects to the portal dashboard, on
   401/403/404 renders a clear error + "request a new link". GREEN: build the page +
   per-portal audience (§3.2).
6. **Magic-link URL builder.** RED: unit test — `requestMagicLink` builds the URL from
   `EVENTPULSE_BASE_URL` and targets the real consume path; no staging fallback when the env
   is set. GREEN: fix `auth.ts:159` + set the env per environment (incl. prod `.env.production`
   - `bootstrap-prod.sh`).
7. **Layout auth gate.** RED: server-component test — `(tenant)`/`(admin)` layout redirects to
   `/sign-in` when no valid session; renders children when valid. GREEN: read + verify the
   cookie in the layout (or a shared server util).
8. **E2E (Playwright) — full browser login.** RED: request magic link (test inbox / debug
   token) → land on `/auth/magic` → cookie set → authenticated portal page renders. GREEN: the
   chain works end-to-end on a staging-like stack.
9. **Tenant context switch** (if multi-tenant UX in scope): RED/GREEN per §3.2 + §2.3
   `/my/contexts/switch`.

Deploy + verify on prod after green. Then the BDT-100 smoke's **full UI flow** is finally
runnable (and the seeded guest-checkout smoke is available at any point in the meantime).

---

## 6. Launch implications

- This blocks **logged-in self-serve** (tenant onboarding/KYC, admin review, attendee
  portal) for the June-10 target.
- It does **not** block the **EPS production rate confirmation** (the biggest external
  unknown), which is doable now via guest checkout — see `docs/runbooks/production-smoke.md`
  - the seeded-smoke pivot discussed Day 45.
- A guest-checkout-narrow launch (operator-published events) is viable independent of this
  work. Decide the posture (open decision 4.4).

## 7. Cross-references

- `.claude/memory/gotchas.md` Day-45 "Browser-auth flow was never wired end-to-end".
- `.claude/memory/decisions.md` Day-45 "Browser-auth integration scoped; smoke re-deferred".
- PR #267 (audience-grant) — the server-resolves-audience rule this design extends.
- CLAUDE.md §5 (auth), §7.5 (subdomain routing — note: `middleware.ts` does not exist yet),
  §17.4 (nginx vhosts), §2.3 (identity contexts), §10.3 (`/my/contexts/switch`).
