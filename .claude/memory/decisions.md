# Event Pulse — Decisions Log

Append-only. Most recent at the top. If a decision is superseded, add a new entry on top with `Supersedes: <date of old decision>` and add a note to the old one with `Superseded by: <date of new decision>`.

---

## 2026-05-19 · Decision O — Day 22 architectural choices: staging cert moves to wildcard + tenants.preferred_locale column

**Context:** Sprint 3 Day 22 pre-flight surfaced two STOP-ASKs against the brief's assumptions: (1) staging cert is 5-SAN, not wildcard — per-tenant subdomain provisioning would require certbot extend per approve; (2) `tenants.preferred_locale` column was referenced by the SES-templates workstream but doesn't exist in the schema. Both are upstream-of-feature-code architectural choices; resolving them before any feature PR lands keeps the dependency chain clean.

### O.1 — Staging cert moves to wildcard (`*.staging.eventpulse.com.bd` SAN added)

**Decision (Moshiur 2026-05-19):** Issue an expanded Let's Encrypt cert including `*.staging.eventpulse.com.bd` alongside the existing 5 explicit SANs. Add a wildcard A record to the Route 53 staging hosted zone pointing at the same Elastic IP. Tenant subdomain provisioning is then **pure-Nginx** with no certbot in the hot path — DNS resolves via wildcard, cert covers via wildcard SAN; the provisioning task writes a vhost file, symlinks it, runs `nginx -t`, and reloads.

**Why this reverses the v2.2 §17.6 "staging deliberately does NOT use a wildcard" stance:**

Original Sprint 1 rationale: explicit 5-SAN enumeration is auditable; wildcard introduces "no surprises from an over-broad wildcard during dev." That rationale held while the 5 hostnames were the entire staging surface — pre-Item-13 there was no per-tenant subdomain provisioning. Now that provisioning becomes per-approve dynamic (Sprint 3 Day 22), the per-tenant certbot-extend path becomes operationally costly: slow (15-60s per certificate re-issue), Let's Encrypt rate-limited (50 certs/week per hostname; we'd burn the budget on staging integration tests alone), fragile (the 3-system SSM + Nginx + certbot chain has more failure modes than pure-Nginx), and divergent from production where the wildcard already covers all tenant subdomains. The cost of one-time wildcard issuance + wildcard A record + §17.6 amendment is small (~15 min); the cost of NOT doing it is paid per-tenant-per-deploy forever.

Auditability concern from the original Sprint 1 stance is preserved through DNS records and vhost configs, which are stronger audit surfaces than cert SAN lists. Every tenant subdomain generates a Route 53 record (implicit via wildcard catch-all) AND a Nginx vhost file checked into the repo template; the cert SAN list was never the load-bearing audit record.

**Consequences:**

- Existing 5 explicit Route 53 A records stay in place. Wildcard ADDS to the routing tree; explicit records take precedence for the 5 known hostnames; wildcard catches everything else.
- Certbot expansion is one-time + idempotent (`certbot certonly --expand`); the previous 5-SAN cert remains valid until expansion completes (atomic swap on disk).
- `provisionTenantSubdomain()` task is pure-Nginx — no certbot library, no certbot CLI shell-out, no `--dns-route53` plugin coupling. Per-tenant flow: write vhost from template → symlink into `sites-enabled/` → `nginx -t` (rollback file write on failure) → `systemctl reload nginx` → audit row + `tenants.subdomain_provisioned_at` bump.
- §17.6 amends as a v2.4 candidate (post-sprint memory PR): "staging deliberately uses wildcard `*.staging.eventpulse.com.bd` matching the production target shape; tenant subdomain provisioning is pure-Nginx; auditability preserved via Route 53 + vhost configs."
- The Sprint 1 Day 3-4 cert (5 SANs, expires Aug 15 2026) gets superseded by the expanded cert (5 SANs + 1 wildcard, same expiry from `--expand`).

### O.2 — `tenants.preferred_locale` column added (migration 0009)

**Decision (Moshiur 2026-05-19):** Add `tenants.preferred_locale text NOT NULL DEFAULT 'bn' CHECK (preferred_locale IN ('en','bn'))` via migration 0009. Notification helper for tenant-targeted emails (KYC events) reads from `tenants.preferred_locale`; helper for user-targeted emails (magic link, OAuth account linked) reads from `users.locale`. Helper signature uses a discriminated union (`{tenantId} | {userId}`) so callers cannot confuse the two.

**Why tenant-level vs owner-individual:**

Tenant-organisation communications locale is a tenant-level decision, not an owner-individual decision. Using `users.locale` via `tenants.owner_user_id` as a proxy creates wrong-by-design coupling that surfaces as user-facing bugs at scale:

- Owner changes their UI locale → all org notifications flip locale silently
- Personal-tenant owner whose UI locale is 'en' (e.g. expat) is the wrong source for org's customer-facing comms
- Multi-owner tenant (Sprint 6 RBAC scope) has no canonical owner to read from

Migration 0009 prevents the debt now; the alternative is paying it down with a more disruptive backfill once real tenants exist.

**Why default 'bn':**

Per §1.3 R12 ("tenant portal UI English, public event pages bilingual Bangla+English") + §16.2 (Bangla SMS supported; "Masked sender ID EVENTPULSE"; Bangla Unicode billing acknowledged) + market reality: BD-domiciled tenants overwhelmingly prefer Bangla customer comms. The 'en' value is for tenants that explicitly opt out — most personal tenants from `my.eventpulse.com.bd` self-service hosting (Phase 2 §26.2) will want 'bn' by default. The CHECK constraint pins the two-value enum at the DB layer so a future "let's add Hindi/Urdu" decision lands as a deliberate migration, not a stringly-typed surprise.

**Pre-migration backfill check:** count tenants on staging before applying. If > 0, surface to Moshiur to decide whether existing rows need an explicit `UPDATE tenants SET preferred_locale = 'en'` (English-default-assumption preserves backwards-compat for any test tenants created before this migration). On a fresh schema with no real tenants, the default 'bn' applies cleanly.

**Notification helper shape:**

```typescript
type LocaleTarget = { tenantId: string } | { userId: string }
async function selectLocale(target: LocaleTarget): Promise<'en' | 'bn'>
```

Discriminated union prevents the caller from passing a `userId` when they mean a `tenantId` (the most common bug class for this kind of lookup). The function reads from the right table based on the discriminator, returns the validated locale, and falls back to 'en' only on truly-missing data (which should be impossible under the CHECK + NOT NULL constraints, but defensive defaults beat thrown errors in a notification-send hot path).

**Consequences:**

- Migration 0009 ships as a focused PR before any SES template code lands.
- Drizzle schema gains `preferredLocale: text('preferred_locale').notNull().default('bn')` on the `tenants` pgTable.
- One integration test asserting the CHECK rejects unknown values (e.g. `'es'` → 23514 check_violation).
- Notification helper at `apps/api/src/services/notifications/locale.ts` is the single source for locale selection across all 5 SES templates (and future SMS templates per §16.2).
- The Phase 2 v2.4 playbook bump candidates list (`progress.md` cross-sprint carries) gains a §9.1 amendment: `tenants.preferred_locale text NOT NULL DEFAULT 'bn'` extension.

### Combined sequencing for Day 22

1. This memory PR (Decision O) lands first — both decisions in writing before any feature code.
2. SSM SendCommand for cert expansion + Route 53 wildcard A record (await explicit go from Moshiur per the brief's "STOP-ASK before step 2" rule).
3. Migration 0009 + Drizzle schema PR.
4. Workstream 1 (bilingual SES templates + locale helper PR) — consumes O.2.
5. Workstream 2 (tenant subdomain provisioning PR) — consumes O.1; pure-Nginx; staging integration test required before merge.
6. Workstream 3 (Fix 6b deploy.sh Nginx reload) if time permits.

---

## 2026-05-19 · Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate

**Context:** Sprint 3 Day 21 fee calculator (`apps/api/src/domain/payments/fee-calculator.ts`, PR #119) review checkpoint. Implementation produced 16/16 internally-consistent cells but only 14/16 matched §14.2's verbatim primary numbers — Mode C (platform absorb, EPS pass-through) `buyer_total` + `eps_fee` matched §14.2's parenthetical alternative ("or 25.00 depending on which side") not the primary line (1,025.06 / 25.06). Investigation revealed §14.2's Mode C primary numbers are arithmetically inconsistent with the stated 2.5% EPS rate: a capture of 1,025.06 at 2.5% yields 25.6265 BDT, not 25.06. The spec author wrote Mode C's narrative to make `organiser_net` resolve cleanly to 997.50, working backward from that target rather than from EPS's actual rate. No single arithmetic rule across all 4 modes can match all 4 §14.2 primary `eps_fee` numbers because Mode B explicitly uses `eps_base = subtotal = 1,000` while Mode C primary would require `eps_base = subtotal + platform_fee = 1,002.50` — these are incompatible.

The choice is between two unverified models of EPS's actual fee-computation base, both written before real EPS sandbox transactions have been run.

**Decision (Moshiur 2026-05-19):** Accept the calculator's current internally-consistent rule. Ship Day 21 work as PR #119. Amend §14.2 with a clarifying implementation note. Gate Day 24-25 EPS sandbox work with a mandatory truth-verification step.

**The rule the calculator implements (single rule, mode-independent):**

```text
eps_capture_base = subtotal + platform_fee   if platform pass_through
                 = subtotal                  if platform absorb
eps_fee          = floor(eps_capture_base × eps_bps / 10000)
```

This produces:

- Mode A (PT, PT):  eps_fee=2506 ✓ §14.2 verbatim
- Mode B (AB, AB):  eps_fee=2500 ✓ §14.2 verbatim
- Mode C (AB, PT):  eps_fee=2500 ⚠ matches §14.2 parenthetical ("or 25.00"); §14.2 primary shows 2506
- Mode D (PT, AB):  eps_fee=2506 ✓ §14.2 verbatim (incl. "EPS fee on larger captured amount" footnote)

Mode C delta = 6 paisa (calc 2500 vs §14.2 primary 2506); 14/16 spec cells exact match.

**Why this rule (vs. alternatives that match Mode C primary):**

1. **Internally consistent.** A single arithmetic rule applies across all 4 modes. Alternatives that match Mode C primary (e.g. "always include platform fee in eps base regardless of handling") break Mode B's verbatim "their 2.5% on 1,000 = 25.00" line, trading one cell match for another.
2. **Conservative for the platform.** When EPS actually charges on the gross-up (Mode A-like): calculator predicts 2506, platform collects 2506 from buyer, EPS keeps 2506, platform absorbs the 0 delta. When EPS actually charges on subtotal-only (Mode B-like): calculator predicts 2500, platform collects 2500 from buyer, EPS keeps 2500, platform absorbs the 0 delta. Mode C is the only ambiguous case; calc picks the lower (2500) pass-through amount, so any 6-paisa delta is absorbed by platform (cheaper for buyer trust) rather than charged to organiser without justification.
3. **The empirically correct answer is unknown until Day 24-25.** Adjusting the calculator before sandbox testing risks shipping a wrong rule twice (once now, once after empirical data). The 6-paisa Mode C delta is operationally tiny pre-launch — zero production tenants.

**Mandatory Day 24-25 EPS sandbox truth gate (non-negotiable):**

When Day 24-25 EPS integration work runs real sandbox transactions, the gate fires:

1. Capture EPS's actual fee on the test order (subtotal 1,000 BDT, platform 0.25% = 25 bps, EPS 2.5% = 250 bps) in each of the 4 handling modes — 4 real sandbox transactions minimum.
2. Compare to the calculator's predictions (Mode A 2506, B 2500, C 2500, D 2506).
3. Any delta in any cell is a calculator bug. The calculator is the variable to change, **not** the sandbox observations.
4. If sandbox data shows EPS uses a different base than the calculator models, both the calculator AND the §14.2 amendment are amended at that time. Re-run the §24.4 fee-mode tests against the new rule.
5. Day 26 first-sandbox-order-verification cannot pass without this gate clearing.

**Consequences:**

- PR #119 ships as-is. Calculator + 33 unit tests merged to main.
- §14.2 of CLAUDE.md gets a small clarification line in a separate playbook PR (memory-protocol: spec changes are memory commits). The clarification names the calculator's rule, references this Decision N, and flags the Day 24-25 truth gate.
- `progress.md` Sprint 3 plan extended with the explicit Day 24-25 truth-gate step (gates Day 26 sandbox-order work).
- `handoff.md` mentions the gate so any new session reading the handoff sees the open obligation.
- `gotchas.md` gets a "spec source-of-truth limits" entry: written worked examples are authoritative for intent but not always for arithmetic; for money math, empirical verification against the actual external system is the final arbiter.
- The §14.2 Mode C primary numbers (1,025.06 / 25.06) become "the parenthetical alternative" by amendment; the calculator's numbers (1,025.00 / 25.00) become the canonical interpretation pending sandbox truth.

**Why a 6-paisa delta matters even though it's tiny:** the calculator is the platform's single source of money truth (§14.3). Regulators, accountants, and tenants reconcile against §14.2 primaries. A "platform math doesn't match documented contract" issue erodes trust if it surfaces externally. The amendment + Day 24-25 gate together prevent this by (a) making the calculator's rule the documented rule going forward and (b) committing to empirical verification before any production money moves.

---

## 2026-05-19 · Apple Sign-In dropped from MVP scope — Google OAuth only

**Context:** Sprint 2 Day 20 closeout. After PR #104 shipped the OAuth bug fix + bootstrap-staging.sh extension for both Google + Apple OAuth secrets, Moshiur populated the Google OAuth credentials (Client ID + Client Secret → `eventpulse/staging/oauth-google` Secrets Manager entry, created 2026-05-19) and then directed "login with apple is not necesssary, update the memory" — Apple OAuth credentials never provided + explicitly dropped from MVP scope.

**Decision (Moshiur 2026-05-19):** Apple Sign-In dropped from MVP. Sign-in surface ships with Google OAuth + email/password + magic link (3 of the originally-planned 4 auth methods). Per CLAUDE.md §5.2 the four-method list was "Email/password, Email magic link, Google OAuth 2.0, Apple Sign-In"; this decision reduces to three.

**What stays in code (cost-neutral):**

- Apple OAuth scaffolding (Apple arctic client, `/api/v1/auth/oauth/apple/start` + callback routes, Apple-private-key auto-decode helper) remains in place. Removing it now would be a much larger scope of work than the value of removal.
- The 503 OAUTH_NOT_CONFIGURED guard from PR #104 handles the missing-Apple-credentials state gracefully: clicking the Apple button hits the start endpoint, gets a clean 503 + structured error, frontend can surface a friendly message.
- `bootstrap-staging.sh` block reading `eventpulse/staging/oauth-apple` Secrets Manager entry remains; missing secret falls through to the 503 path.
- Apple's `<a data-testid="oauth-apple-button">` button stays in `OAuthButtonGroup`. Clicking shows the 503 OAUTH_NOT_CONFIGURED response.

**Sprint 3+ candidate (not in this PR):** hide the Apple button in `OAuthButtonGroup` when `isOAuthProviderConfigured('apple')` would return false. Requires either a client-side env-flag check (`NEXT_PUBLIC_OAUTH_APPLE_ENABLED`) or a SSR-time check on the sign-in page. Cleaner UX than showing a button that 503s on click; minimal frontend change (~30 min). Queue as Sprint 3 polish.

**Sprint 4+ candidate:** decide whether to re-enable Apple Sign-In before MVP launch or drop the scaffolding code entirely. The decision pivots on: (a) whether attendee-side market research surfaces an iOS-tier user who refuses email/password + Google, (b) whether Apple Developer account procurement cost ($99/year) is worth the marginal user acquisition. No action required for MVP launch — Google + email is sufficient.

**Consequences:**

- CLAUDE.md §1.2 + §5.2 + §19.2 references to "all four available from day one" become inaccurate for MVP. Queue as v2.4 playbook bump candidate: amend to "three auth methods at MVP launch — Email/password, Email magic link, Google OAuth 2.0. Apple Sign-In scaffolded but not configured per `decisions.md` 'Apple Sign-In dropped from MVP scope' (2026-05-19)."
- Sprint 1 Day 7-8 OAuth foundation work effectively scopes down from 4 providers to 3 at the provisioning layer. The implementation code (arctic Apple client, JWT-based client_secret minting, the `decodeApplePrivateKey()` helper) is preserved but inert — zero runtime cost.
- Sprint 3 Day 21 first-session pre-flight checklist updates: "OAuth credentials (Google ✅ + Apple — dropped from MVP)" instead of the prior "OAuth credentials still missing" entry.

**Cross-references:**

- CLAUDE.md §1.2 Auth providers row (v2.4 amendment candidate)
- CLAUDE.md §5.2 Sign-Up and Sign-In — Four Methods, One Funnel (v2.4 amendment: "Three Methods" for MVP)
- CLAUDE.md §19.2 Sign-In / Sign-Up UI (v2.4 amendment: drop Apple button from mockup)
- `decisions.md` "Auth foundation library choice: roll our own (not Lucia)" (2026-05-17) — the precedent decision that scoped the foundation library before the four-method choice
- `apps/api/src/auth/oauth.ts isOAuthProviderConfigured('apple')` — the 503 guard from PR #104 that handles the missing-Apple-credentials state

---

## 2026-05-19 · Sprint 2 Day 20 PM scope reduction — subdomain provisioning + SES templates deferred to Sprint 3 Day 21

**Context:** Day 20 brief offered two PM Block scope choices for Item 16:

- **Default (~7-9h):** Porichoy scaffold + tenant subdomain provisioning + bilingual SES templates.
- **Reduced (~4-5h):** Keep Porichoy + subdomain provisioning; defer SES templates.

I picked the reduced scope at PM start. Mid-PM, after surfacing the EPS credentials incident (production credentials provided directly in chat, auto-classifier blocking the Secrets Manager write) consumed material session bandwidth, I further truncated to **Porichoy scaffold only**. Subdomain provisioning + SES templates both deferred to Sprint 3 Day 21 first PR.

**Decision:** truncate Item 16 to Porichoy scaffold; defer subdomain provisioning + bilingual SES templates to Sprint 3 Day 21.

**Why each piece deferred:**

1. **Subdomain provisioning** — the brief explicitly listed this as load-bearing for Item 13's approve flow but ALSO surfaced a STOP-ASK condition: "Subdomain provisioning fails its first staging integration test in ways that suggest the SSM + Nginx + certbot chain is more fragile than expected → halt subdomain provisioning work, defer to a dedicated Sprint 3 PR." I cannot run the staging integration test from the sandbox (no live SSM SendCommand exercise against the EC2 from here). Building speculative code that I cannot validate against the real chain is technical debt, not progress. Pre-empting the STOP-ASK proactively was the disciplined call. Item 13's approve action continues TODO-stubbing the provisioning step — fine for another week because there are no approved tenants in staging yet.

2. **Bilingual SES templates** — the brief's reduced-scope rationale already applied: "no paying tenant exists yet; notification stubs continue to log structured events for another week without breaking anything." Plus session bandwidth was bounded by the EOD closeout discipline.

**Consequences:**

- Sprint 3 Day 21 first PR opens with **subdomain provisioning** (SSM SendCommand + Nginx vhost template generation + certbot wildcard extension OR existing-wildcard reuse + audit_log + idempotency + tenant.subdomain_provisioned_at column migration + Item 13 wire-up replacing the TODO-stub + staging integration test run).
- Sprint 3 Day 21 AM PR opens with **bilingual SES templates** (5 templates × 2 locales; SES create-template resources; notification helper migration from stub-logs to live SES SendTemplatedEmail; tenant.preferred_locale-aware variant selection).
- Item 13's approve flow continues to `[STUB] subdomain provisioning` logged + no actual vhost generated; tenant manually receives the subdomain at MVP launch.
- The `eventpulse/staging/porichoy` Secrets Manager entry was NOT created today; the scaffold stub throws regardless of env state, so the secret being absent is the expected configuration. Phase 2 wiring (live Porichoy + secret populated) is a focused PR when credentials arrive + Phase 2 trigger fires.

**Anti-pattern proactively avoided:** building subdomain provisioning code with mocked unit tests but no live integration verification, then claiming "shipped" while the actual SSM chain might fail differently in production. The Day 11 OAuth gotcha (button hrefs broken for 9 days because manual verification was a deferred carry) is the exact precedent for why speculative-untestable code is a hazard.

**Cross-references:**

- `.claude/memory/gotchas.md` "OAuth sign-in button hrefs pointed at web vhost instead of API vhost" — precedent for why testable-end-to-end matters
- Day 20 brief STOP-ASK conditions verbatim
- `apps/api/src/services/audit/kyc.ts writeKycTransition()` Item 13 approve action — the consumer site for the deferred provisioning function

---

## 2026-05-19 · EPS production credentials intentionally used in staging — STAGING_PAYMENT_BLOCK guard

**Context:** Sprint 2 Day 20 closeout. Moshiur provided EPS payment-gateway credentials directly in chat (merchant_id, store_id, username, password, hash_key — production-tier per the merchant_id UUID shape and the absence of any sandbox markers). EPS did not issue a separate sandbox credential set for the staging environment.

Two paths considered:

- **A. Refuse to use production credentials in staging; defer EPS wiring to Sprint 3 + obtain a sandbox set.** Safest but blocks Sprint 3 Day 21+ integration work for the duration of the sandbox-procurement back-and-forth (timeline unknown; EPS's `integration@eps.com.bd` response cadence is multi-day historically).
- **B. Use production credentials in staging, gated by a hard `STAGING_PAYMENT_BLOCK=1` env flag.** Sprint 3 Day 21+ in-house wrapper refuses any `initialiseOrder()` call with `total_paisa > 0` while the flag is set. Free events pass the gate; priced orders error out. Integration tests can exercise the full hash + token + Verify pipeline against EPS production endpoints without ever charging real cards.

**Decision (Moshiur 2026-05-19):** Path B. Production credentials stored at `eventpulse/staging/eps` in Secrets Manager. `STAGING_PAYMENT_BLOCK=1` materialised into `.env.staging` by `bootstrap-staging.sh`. Sprint 3 Day 21+ in-house wrapper (`apps/api/src/infra/eps/client.ts`) enforces the gate.

**The gate is load-bearing.** Removing it requires:

1. A new `.claude/memory/decisions.md` entry explicitly authorising MVP production cutover.
2. The cutover event itself (staging EC2 retired or repurposed).
3. The `STAGING_PAYMENT_BLOCK` env var deleted from `bootstrap-staging.sh` in the same PR.

Any earlier removal — including "just for this test" — is a STOP-ASK and surfaces to Moshiur.

**Rationale:**

- The in-house wrapper architecture (decision below this entry) needs real EPS endpoints to validate the HMACSHA512 signing flow against. A sandbox would be ideal but isn't available without procurement delay.
- The §1.3 R2 "money never lies" rule is upheld through the gate, not through credential separation. Real-money risk is contained at the application layer rather than the credential layer.
- The same pattern is used by other payment-integrated platforms where sandbox availability lags production — Stripe Test Mode, Square Sandbox both exist precisely because Stripe/Square saw this exact procurement gap with EPS-tier payment providers globally.

**Consequences:**

- `apps/api/src/infra/eps/client.ts` (Sprint 3 Day 21+ deliverable) MUST check `STAGING_PAYMENT_BLOCK === '1'` early in `initialiseOrder()` and throw if any tier's price > 0.
- Integration tests against staging EPS endpoints CAN exercise free-event-shape orders (price_paisa = 0) which short-circuit the gate cleanly.
- `bootstrap-staging.sh` materialises `STAGING_PAYMENT_BLOCK=1` unconditionally for the `staging` environment. Production cutover removes it.
- `.claude/memory/handoff.md` "Hard guardrails" section absorbs `STAGING_PAYMENT_BLOCK=1 is mandatory in staging` as a load-bearing rule.

**Credentials shared in plaintext chat — operational follow-up:** Moshiur explicitly directed "no need to rotate, it final production, use it". Recorded as the user's decision; standing chat-credential hygiene policy carries to Sprint 3 retro for review. Future EPS credential rotation, if ever needed, follows the same out-of-band path (workstation `aws secretsmanager put-secret-value`).

**Cross-references:**

- `docs/investigations/eps-library-comparison.md` — the comparison that justified the in-house wrapper choice (see next entry below)
- CLAUDE.md §11.0 (Day 20 amendment) — status block surfacing this decision in the playbook
- `apps/api/src/infra/eps/client.ts` — Sprint 3 Day 21+ implementation site for the gate

---

## 2026-05-19 · EPS library choice locked for Sprint 3 — in-house wrapper (no SDK)

**Context:** Sprint 3 Day 21 needs the EPS integration library locked before any payment-related code lands (CLAUDE.md §1.2 referenced `eps-gateway-nodejs` as an open question since v1.0; the alternative `EPS-PG/EPS_Nodejs` surfaced from Moshiur during Day 20). Background research at Day 20 AM Block 2 produced the comparison in `docs/investigations/eps-library-comparison.md`.

**Critical finding from the comparison:** the EPS-PG/EPS_Nodejs repo is a byte-for-byte clone of Imtiaz Najim's community `eps-gateway-nodejs` (including the original repo URL still in `package.json`). Both candidates are effectively the same code — single-author, single test file (only the HMACSHA512 hash helper has any test coverage), status-alias gotcha (CLAUDE.md §11.4) unhandled, zero adoption signals (no stars, no issues, ~135 npm downloads/month mostly bots).

**Decision (Moshiur 2026-05-19):** Build a thin in-house wrapper at `apps/api/src/infra/eps/`. No SDK dependency. Sprint 3 Day 21+ deliverable.

Top three reasons (from the investigation note):

1. **Both libraries are the same code, single-author, effectively unmaintained.** EPS-PG's "official" repo is a 2-commit bulk upload of the community SDK without re-authorship. There is no team behind either; there is no release cadence; there is no semver story.
2. **The status-alias gotcha (CLAUDE.md §11.4) is not handled.** The SDK exposes raw `Status: 'Success' | 'Failed' | 'Pending'` and never mentions `COMPLETED`, `CANCEL`, `CANCELLED`, `CANCELED`. We would have to wrap `verifyPayment()` with our own `normaliseStatus()` anyway — at which point the SDK provides only an axios wrapper and a 6-line HMACSHA512 helper.
3. **Single-author + zero adoption + payment-critical = unacceptable supply-chain risk.** Per immutable rule R2 ("money never lies") and the §5.3 Lucia precedent (Lucia maintenance mode → we composed our own auth foundation), we already have project precedent for rejecting unmaintained dependencies on the most security-critical surfaces. EPS is in the same tier as auth.

**Proposed shape** (Sprint 3 Day 21+ scope):

- `apps/api/src/infra/eps/client.ts` — axios instance, base-URL switch (`pgapi.eps.com.bd` vs sandbox), `getToken()` with Redis TTL cache (15-min token expiry), HMACSHA512 via `@noble/hashes` (already a dep per §5.3 — zero new deps).
- `apps/api/src/infra/eps/init.ts` + `verify.ts` — typed wrappers around `InitializeEPS` + `CheckMerchantTransactionStatus`, returning zod-validated responses.
- `apps/api/src/infra/eps/normalise-status.ts` — the alias-collapsing shim §11.4 demands, with explicit unit tests for all 8 alias variants (SUCCESS, COMPLETED, FAILED, FAILURE, CANCEL, CANCELLED, CANCELED, Pending across `Status` / `transactionStatus` / `status` / nested `data.*` field locations).
- `apps/api/src/infra/eps/types.ts` — hand-written from the EPS V5 docs (the SDK's types are hand-written too; we copy the shape, drop the SDK).
- ~400 LOC total. Estimated 1.5 days focused work.

**Mirrors §5.3 Lucia decision** (2026-05-17). Same rationale class, same outcome.

**Consequences:**

- CLAUDE.md §1.2 + §11.0 + §11.2 + §11.3 amended in the Day 20 chore PR (`feat/api-day-20-eps-bootstrap-and-claude-md`) to reflect the in-house pattern. v2.4 playbook bump candidates absorb the §11 amendments alongside.
- Sprint 3 Day 21 kick-off issue references `apps/api/src/infra/eps/` as the implementation site.
- `STAGING_PAYMENT_BLOCK` guard (above entry) lives inside `client.ts` `initialiseOrder()`.
- No new runtime dependencies. The wrapper composes existing project deps (`@noble/hashes` from §5.3, `axios` is a transitively-present small footprint via potential adoption — or `fetch` natively; Sprint 3 PR locks the HTTP-client choice).

**Cross-references:**

- `docs/investigations/eps-library-comparison.md` (PR #105, 2026-05-19) — full comparison + recommendation
- `.claude/memory/decisions.md` "Auth foundation library choice: roll our own (not Lucia)" (2026-05-17) — the precedent decision
- `.claude/memory/decisions.md` "EPS production credentials intentionally used in staging" (2026-05-19, entry above) — the credential-handling decision that pairs with this library decision

---

## 2026-05-19 · Items 14+15 Trust Center scaffolding + super admin Legal & Trust editor — pre-code architecture (Decisions J, K, L, M)

**Context:** Day 19 ships Items 14 + 15 **bundled** — Trust Center public routes (6 legal contracts + 12 trust artefacts, all at v0.1 skeleton placeholders per §20) + super admin Legal & Trust editor for version-tracked markdown publishing. Per `Trust Center v0.1 placeholders — skeleton-only, no AI-generated full text` (2026-05-17, load-bearing): zero AI-generated full-text legal drafts; counsel produces v1.0 before the first paying tenant onboards. The Day 19 infrastructure is the substrate counsel writes onto, the rendering pipeline tenants will eventually consent against, and the URL surface that gets crawled, linked-to, and tested against between now and v1.0.

Four architecture decisions need to land before Item 14+15 code starts so backend + frontend are built against a single shared shape. All four were proposed in Moshiur's Day 19 brief and confirmed in the kick-off response; this entry codifies them as canonical project decisions.

---

### Decision J — Markdown sanitization pipeline: `rehype-sanitize` (unified family), `defaultSchema` allowlist

The super admin Legal & Trust editor accepts markdown (`body_md`) and pre-renders it to sanitized HTML (`body_html`) **server-side at publish time**, not at render time. The pipeline is the unified ecosystem standard:

```typescript
// apps/api/src/domain/legal/render.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

const pipeline = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, defaultSchema)
  .use(rehypeStringify)

export async function renderLegalMarkdown(markdown: string): Promise<string> {
  const file = await pipeline.process(markdown)
  return String(file)
}
```

**Five new runtime deps** added to `apps/api/package.json` (deliberately all in one ecosystem to minimise dependency surface area and ensure cohesive maintenance): `unified`, `remark-parse`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`. All MIT-licensed, all by the same author (Titus Wormer), all widely-deployed across Next.js / Astro / Gatsby / MDX. The combined surface is ~120 KB of unpacked JS, all server-side (never shipped to the browser since rendering happens server-side at publish).

**Why this pipeline over alternatives:**

- **`marked` + `dompurify`** (2 deps) would be smaller on paper, but `dompurify` requires `jsdom` for server-side use (a ~10 MB transitive). Net: bigger install, more attack surface.
- **In-house regex-based sanitizer.** Rejected outright. Markdown-to-HTML sanitization is an attack-surface domain where reinvention is the wrong move; the unified ecosystem has had ~10 years of community security review against XSS payloads (e.g. nested `<svg>` exploits, `data:` URI tricks, malformed `<a href="javascript:">` variants).
- **MDX.** Out of scope. MDX lets authors embed React components inline — by design the opposite of what we want for legal text. Authors are super admins typing prose; they don't need React.

**Allowlist scope — `defaultSchema` unchanged:** rehype-sanitize ships `defaultSchema` which mirrors the GitHub-flavored-Markdown safe set: headings (`h1`-`h6`), paragraphs, lists (`ul`, `ol`, `li`), blockquotes, code blocks (`pre`/`code`), inline emphasis (`em`, `strong`), `<a>` with `href` constrained to `http(s)`/`mailto`, `<hr>`, `<br>`. Stripped: `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, all event-handler attributes, all inline `style` attributes, `<img>` with non-https sources. **`<img>` is allowed only when `src` is `https://`** — preserves the option for counsel to embed Trust Center diagrams later, blocks `data:`/`javascript:` URI trickery.

**Widening the allowlist requires an explicit decisions.md entry.** If counsel returns v1.0 drafts requiring callout boxes, definition lists, footnotes, tables, or any HTML construct outside `defaultSchema`, that's a Sprint 3+ decision documented separately. The Day 19 baseline is "the allowlist is the contract."

**Rendering happens at publish, not at request:**

- Editor submits `body_md` → server runs the pipeline → stores `body_md` (canonical) AND `body_html` (cached render) on the new `legal_document_versions` row. Both columns are NOT NULL.
- Public pages serve `body_html` directly, bypassing the pipeline at request time. Per §20.5: "Public pages are rendered server-side from `body_html` and cached at the edge."
- Re-render path: a maintenance script (`pnpm legal:rerender`) can re-process all current versions if the allowlist changes — emits a `legal.version.rerendered` audit row per version (sibling helper to the existing audit-per-domain pattern). Not Day 19 scope; queued as Sprint 3+ candidate for the moment the allowlist widens.

**Why pre-render and store HTML rather than render-on-request:** (a) edge cache hit rate of a static HTML string is higher than a dynamic render; (b) the sanitization step is a defensive boundary — sanitizing at publish means the stored `body_html` is *known-safe-at-store-time*, and a stored-HTML XSS would require both a sanitizer bypass at publish AND a compromise of the editor flow. Render-on-request would re-run the sanitizer per page load — wasted CPU and an attack surface that re-opens with every request.

**Cross-references:**

- `Trust Center v0.1 placeholders — skeleton-only, no AI-generated full text` (2026-05-17, load-bearing) — what the pipeline renders (placeholder text) vs what it will render once counsel returns (v1.0 drafts).
- §20.3 + §20.5 — page anatomy + storage contract that this pipeline implements.
- Audit helper pattern (`audit_logs scope at Item 9 — KYC transitions only; auth events + S3 issuance backfill deferred` 2026-05-17, reaffirmed 2026-05-18). When the Legal & Trust editor publishes a new version, the audit row is written by a new domain helper `writeLegalVersionPublished` in `apps/api/src/services/audit/legal.ts` — new domain (legal), new file, one helper for now. Sibling helpers (`writeLegalVersionEdited` for in-progress drafts, `writeLegalVersionRerendered` for the allowlist-widening maintenance flow) can join later; never collapse into a generic `writeAudit()`.

**Consequences:**

- Five new deps land in `apps/api/package.json`. Lockfile commit included in the backend PR.
- New file `apps/api/src/domain/legal/render.ts` exports `renderLegalMarkdown(md: string): Promise<string>`. Single source of truth — no other module re-implements sanitization.
- The editor's create-new-version endpoint (`POST /api/v1/admin/legal/documents/:slug/versions`) **must** call `renderLegalMarkdown()` and persist `body_html` from its output. Storing client-supplied HTML is forbidden — the endpoint only accepts `{ version, body_md, summary_of_changes, material_change, effective_at }` and computes `body_html` server-side.
- Unit tests: (a) round-trip a known-safe markdown sample and assert HTML output; (b) sanitization tests confirming `<script>alert(1)</script>`, `<a href="javascript:alert(1)">`, `<img src="data:..." onerror="...">`, `<iframe>`, `<style>` are all stripped or escaped; (c) a "boring markdown" snapshot test (placeholder body_md → known HTML output) that catches accidental allowlist changes.

---

### Decision K — Public Trust Center pages render via Server Components with direct service-layer DB read; no client-side hydration

Each of the 18 public Trust Center paths (`/privacy`, `/terms`, `/eula`, `/dpa`, `/cookies`, `/refund-policy`, plus 12 `/trust/...` paths per §20.1) is a Next.js **Server Component** under `apps/web/src/app/(public)/`. It fetches the document + its current version directly via the service-layer function and renders the pre-rendered `body_html` plus version metadata + a non-dismissable DRAFT banner (per `Trust Center v0.1 placeholders — skeleton-only`).

```typescript
// apps/web/src/app/(public)/privacy/page.tsx (illustrative)
import { fetchLegalDocumentByUrlPath } from '@/lib/legal'
import { LegalDocumentPage } from '@/components/legal/document-page'

export const revalidate = 3600  // edge cache 1h; busted by editor on publish via revalidatePath()

export default async function PrivacyPage() {
  const doc = await fetchLegalDocumentByUrlPath('/privacy')
  return <LegalDocumentPage doc={doc} />
}
```

**No client-side hydration of legal content.** The legal page is static HTML at request time. No `'use client'`, no TanStack Query, no useEffect, no client-fetched JSON. The DRAFT banner is a server-rendered `<div role="alert">` — not a dismissable client component.

**Why server-rendered, not client-fetched:**

1. **Edge cache friendliness.** A pure server-rendered page with `revalidate: 3600` caches as a single HTML string. Client-fetched pages would shell-render then hydrate then fetch — three network round trips for content that hasn't changed since the last publish.
2. **No user-state shape.** Trust Center pages are identical for every visitor — no per-tenant scope, no per-user state, no personalisation, no A/B tests. The natural shape is "render once, serve everywhere."
3. **SEO + crawler friendliness.** Legal pages must be crawler-readable. Server-rendered HTML is always crawler-readable; client-hydrated content can fail if the crawler doesn't run JS (most respect-policy crawlers do, but search-engine fallback indexing relies on initial HTML).
4. **No PII surface.** Per Decision H (Item 13, 2026-05-19), the project's only per-query cache override (`staleTime: 0` + `gcTime: 0`) exists for PII surfaces. Trust Center pages have no PII whatsoever — they're the opposite extreme. Default Next.js edge caching applies cleanly.

**Cache invalidation:** the Legal & Trust editor's "publish new version" action calls Next.js `revalidatePath()` for the document's `canonical_url_path` (per Decision M) immediately after persisting the new version row. Within ~1s the public page reflects the new content. Background re-render attempts fall through `revalidate: 3600` if invalidation fails for any reason. No manual cache flush UI in v0.1.

**Direct service-layer DB read — bypasses the HTTP API:** `fetchLegalDocumentByUrlPath()` lives in `apps/web/src/lib/legal.ts` and calls into a service-layer function exported from `apps/api/src/domain/legal/queries.ts`. Per §3.2 the web app can directly import from `apps/api`'s service layer (it does already for tenant context). This avoids a same-server HTTP hop and keeps the public-page render path as one Postgres SELECT. The query runs as `eventpulse_admin` (BYPASSRLS) since legal documents are platform-global, not tenant-scoped.

**Data shape returned:**

```typescript
interface LegalDocumentRender {
  slug: string                    // 'privacy', 'security-disclosure', ...
  category: 'legal_contract' | 'trust_artefact'
  title: string                   // 'Privacy Policy', 'Vulnerability Disclosure', ...
  oneLiner: string                // for SEO meta + Trust Center landing card
  canonicalUrlPath: string        // '/privacy', '/trust/security/disclosure', ...
  currentVersion: {
    version: string               // 'v0.1'
    effectiveAt: string           // ISO timestamp
    bodyHtml: string              // pre-rendered, sanitized
    materialChange: boolean       // false for v0.1 placeholders
    isDraft: boolean              // true when version matches /^v0\./
  }
  requiresSignature: boolean      // true for the 6 contracts, false for the 12 artefacts
}
```

The `isDraft` boolean is derived server-side from the version string (any `v0.x` is draft). The DRAFT banner is rendered conditionally on `isDraft === true`. Once counsel publishes `v1.0.0`, the banner stops rendering automatically — no code change required.

**Trust Center landing page (`/trust`):** separate Server Component that fetches all documents via a single `listLegalDocumentsForTrustCenterLanding()` query, renders the two card grids per §20.2 (6 contracts + 12 artefacts). Same `revalidate: 3600`.

**Cross-references:**

- §20.5 — "Public pages are rendered server-side from `body_html` and cached at the edge. Cache invalidation on new version publication is automatic." Decision K is the implementation contract for that line.
- §3.2 module boundaries — web app can import service-layer functions from `apps/api`, not routes. This is exactly that pattern.
- Decision H (2026-05-19, Item 13) — explicitly *non*-PII surface, so the cache-zero override does not apply. Default Next.js `revalidate` is correct.

**Consequences:**

- 19 server-component page files land in `apps/web/src/app/(public)/`: 18 individual document pages + `/trust/page.tsx` (landing).
- One shared `<LegalDocumentPage>` component renders the document + DRAFT banner. Same shape for all 18 — only the data differs.
- One shared `<TrustCenterLandingGrid>` for the `/trust` landing page.
- Service-layer functions `fetchLegalDocumentByUrlPath`, `fetchLegalDocumentBySlug`, `listLegalDocumentsForTrustCenterLanding`, `fetchVersionHistoryForDocument` in `apps/api/src/domain/legal/queries.ts` — Decision M codifies the URL-path-keyed lookup pattern.
- Test coverage: (a) each of the 18 pages returns a 200 with the correct title via Playwright smoke (lighter than e2e — just confirms route resolution + render); (b) the DRAFT banner is in the DOM for v0.1; (c) the Trust Center landing lists all 18 with correct categories; (d) cache header asserts (server returns a sensible `Cache-Control` for edge caching).

---

### Decision L — Re-consent enforcement gate deferred to Sprint 3 alongside counsel-produced v1.0 documents

The §20.4 material-change re-consent flow (cron sets `requires_reconsent = true` → interstitial at next login → `consent_records` row written) **is not in Day 19 scope**. Day 19 ships only the document-storage substrate (`legal_documents` + `legal_document_versions` tables + admin editor + public pages). The `consent_records` table, the interstitial UI, the cron job, and the registration-flow consent gate all defer to **Sprint 3** alongside the first counsel-produced v1.0 publishes.

**Why deferred:**

1. **Consent against a v0.1 DRAFT placeholder is harmful.** Capturing a `consent_records` row for `terms@v0.1` legally implies the user agreed to the v0.1 text, when in fact v0.1 explicitly says "PLACEHOLDER — to be drafted by counsel." Either the consent is meaningless (in which case why capture it) or it's misleading (in which case it's worse than not capturing it). The right shape is: no consent flow at all until v1.0 exists.
2. **The infrastructure landing in Day 19 is already enough to support Sprint 3.** `legal_documents.requires_signature` is in the schema. `legal_document_versions.material_change` is in the schema. Sprint 3 adds `consent_records(user_id, document_id, version_id, consented_at, ip, user_agent, withdrawn_at)` per §9.11 plus the interstitial + the gate. No re-migration of Day 19's tables needed.
3. **Onboarding flow is not yet blocked anyway.** Per `Trust Center v0.1 placeholders — skeleton-only` (2026-05-17): "Onboarding flow gates on consent → consent gates on v1.0 documents → first paying tenant blocked until counsel returns drafts." First paying tenant is end-of-Sprint-2 / Sprint-4. Sprint 3 lands consent in time.

**What this means for Day 19's deliverables:**

- **No new tables beyond `legal_documents` + `legal_document_versions`.** Specifically: no `consent_records`. The §9.11 DDL for `consent_records` stays unpicked-up until Sprint 3.
- **No consent prompt UI.** Sign-up flow renders nothing about Trust Center documents.
- **No re-consent interstitial.** `/legal/reconsent` route is not added; the route lands with the Sprint 3 consent work.
- **No cron job.** No `requires_reconsent` flag is set anywhere. The publish endpoint does NOT trigger a re-consent broadcast.
- **Public pages link from a footer-level "Trust" link** so they're reachable, but there's no enforcement to read them before sign-up. Tenants can complete onboarding without ever clicking through.

**What Day 19 DOES do that Sprint 3 benefits from:**

- Tables, columns, indexes for legal_documents + legal_document_versions are *correct for the final flow* — Sprint 3 only adds `consent_records` + the UI/cron layer.
- `requires_signature` boolean is populated correctly per §20.2 (true for the 6 contracts, false for the 12 artefacts). Sprint 3's gate reads this directly.
- `canonical_url_path` (per Decision M) is in place — Sprint 3's interstitial can deep-link to the document being re-consented.
- `material_change` boolean is in the schema — Sprint 3's cron reads this to decide whether to broadcast a re-consent prompt vs. silently update.

**Scope-creep red flags to halt at:** if Day 19 implementation tempts toward (a) a "click to acknowledge" button on any page, (b) capturing IP / user-agent on any Trust Center view, (c) adding a footer-acceptance checkbox to sign-up, (d) a "preview consent flow" toggle for super admins, (e) any column on `users` or `tenants` referencing consent state — halt and surface. All of those are Sprint 3 scope.

**Cross-references:**

- `Trust Center v0.1 placeholders — skeleton-only, no AI-generated full text` (2026-05-17) — the load-bearing companion. Day 19 + Decision L together codify "infrastructure in v0.1, enforcement in Sprint 3."
- §9.11 — `consent_records` DDL stays unbuilt until Sprint 3.
- §20.4 — Re-consent flow specification; describes the Sprint 3 surface, not the Day 19 surface.

**Consequences:**

- Sprint 3 sprint plan acquires a new line item: "Items 14+15 extension — consent_records table + onboarding gate + reconsent interstitial + cron." Owner TBD; sized after counsel returns v1.0 drafts.
- Day 19 PRs (backend + frontend) are smaller than they'd otherwise be, by deliberate choice. Estimate: ~1500 lines + tests vs ~3000 if consent were bundled.
- Public footer rendering on tenant + attendee portals links to `/trust` but does NOT pop a consent banner; the link is for discoverability only.

---

### Decision M — Defer to §20 verbatim on document set; flat database slugs + `canonical_url_path` column for data-driven URL routing

Two interlocking choices about the document data model.

**M.1 — Document set: defer to §20.2 verbatim (6 legal contracts + 12 trust artefacts).** No additions, no slug renames, no category re-mappings. The canonical inventory is:

**Legal contracts (`category = 'legal_contract'`, `requires_signature = true`):**

| slug | canonical_url_path | title | one_liner (from §20.2) |
| --- | --- | --- | --- |
| `privacy` | `/privacy` | Privacy Policy | How we handle your data, what your 9 rights are, who our sub-processors are. |
| `terms` | `/terms` | Terms of Service | The deal between you and Event Pulse, written plainly. Pro-user framing throughout. |
| `eula` | `/eula` | EULA | Your licence to use Event Pulse — and confirmation you own every output, every page, every form. |
| `dpa` | `/dpa` | Data Processing Addendum | GDPR-compliant DPA for B2B customers handling controller-to-processor obligations. |
| `cookies` | `/cookies` | Cookie Policy | Every cookie we set, its purpose, and how to opt out. |
| `refund-policy` | `/refund-policy` | Refund Policy | When buyers can get their money back, the SLA-credit schedule, the EPS chargeback path. |

**Trust artefacts (`category = 'trust_artefact'`, `requires_signature = false`):**

| slug | canonical_url_path | title | one_liner (from §20.2) |
| --- | --- | --- | --- |
| `security` | `/trust/security` | Security & Infrastructure | Cloud architecture, encryption, KMS, ISO 27001 alignment, pen-test cadence. |
| `sub-processors` | `/trust/sub-processors` | Sub-processors | Live list of every third party that touches your data, with purpose, location, and DPA link. |
| `security-disclosure` | `/trust/security/disclosure` | Vulnerability Disclosure | Safe-harbour policy for security researchers. We respond within 72 hours. |
| `sla` | `/trust/sla` | Service Level Agreement | Our 99.5% monthly uptime commitment and the credit schedule when we fall short. |
| `acceptable-use` | `/trust/acceptable-use` | Acceptable Use Policy | What you can and can't do with Event Pulse. The suspension + appeal path. |
| `anti-bribery` | `/trust/anti-bribery` | Anti-Bribery & Anti-Corruption | Our procurement-grade integrity policy. UK Bribery Act, FCPA, BD ACC Act 2004. |
| `ai-policy` | `/trust/ai-policy` | Responsible AI Policy | Which models we use, how, what we don't allow, and our no-training-on-customer-data guarantee. |
| `bangladesh-compliance` | `/trust/bangladesh-compliance` | Bangladesh Compliance | Per-clause mapping to DSA 2018 §29–§32, BTRC notice handling, ICT Act 2006. |
| `gdpr` | `/trust/gdpr` | GDPR Compliance | Per-Article walk-through, SCCs + UK IDTA, EU representative info. |
| `accessibility` | `/trust/accessibility` | Accessibility Statement | Our WCAG 2.1 AA conformance status, known issues, remediation timeline. |
| `transparency` | `/trust/transparency` | Transparency Report | Government requests received in the year, refusal rate, our gag-order disclosure approach. |
| `retention` | `/trust/retention` | Data Retention Schedule | Per-data-type retention windows. KYC docs: 5 years. Invoices: 7 years. Event logs: 1 year. |

**Sub-processors entry is IN `legal_documents`.** §20.6 describes a separate `docs/sub-processors.json` flow with a daily diff job. Decision M consolidates this: the sub-processors document lives in `legal_documents` like every other artefact, with version-tracked publishes through the same Legal & Trust editor. For v0.1 the body is a single-paragraph DRAFT placeholder (per the skeleton structure below); the structured-table editor (form-based JSON edit + auto-format to a sortable HTML table at render) **defers to Sprint 3**. Until then, super-admin updates to sub-processors flow through the standard markdown editor (a maintainer can paste a markdown table once counsel returns v1.0 with the canonical sub-processor list). Sprint 3 picks up the `<SubprocessorsEditor />` UI + the daily diff job per §20.6.

**M.2 — Skeleton structure: single-section DRAFT placeholder per document.** Every seeded v0.1 body uses this exact template:

```markdown
# {{Document Title}}

> **DRAFT — not yet legally reviewed**
>
> This document is a placeholder. Final legal content will be drafted by counsel before MVP launch. The structure shown here represents a starting frame; actual section headings and content will be determined by counsel based on Bangladesh law and the platform's specific operations.

## Status

This document is currently at version v0.1 — a structural placeholder published to establish the URL, rendering pipeline, and consent capture infrastructure. **No legal effect is intended or implied.** Tenants are not bound by this version; consent capture is explicitly blocked on documents at v0.x versions (see registration flow §20.4).

## What this document will cover (provisional)

{{Generated from §20.2's one-liner: "<title>" will cover <one_liner_paragraph>.}}

## Contact

For questions about this {{document type}}, contact legal@eventpulse.com.bd.
```

The seed script generates the "What this document will cover" paragraph from §20.2's per-document one-liner. The placeholder text intentionally **does not** speculate beyond the one-liner — no AI-generated full text, no transcribed open-source templates. Counsel produces v1.0 from this skeleton; v0.1 is just a structural and infrastructural fixture.

**M.3 — Database slugs are flat; URL routing is data-driven via `canonical_url_path` column.**

```sql
-- migration 0008 amendment to the §9.11 DDL:
CREATE TABLE legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,                  -- 'privacy', 'security-disclosure', 'sub-processors'
  canonical_url_path text NOT NULL UNIQUE,    -- '/privacy', '/trust/security/disclosure'
  category text NOT NULL CHECK (category IN ('legal_contract','trust_artefact')),
  title text NOT NULL,
  one_liner text NOT NULL,
  current_version_id uuid,
  requires_signature boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_legal_documents_url ON legal_documents(canonical_url_path);
```

The `canonical_url_path` column extends §9.11's published DDL (which only had `slug`). The motivation: §20.1 has nested URLs (`/trust/security/disclosure`) but the schema must accept flat unique slugs (`security-disclosure`) so the editor's UI / API never has to encode `/` in URL params. Sprint 4's sitemap generator + the Decision K public-page lookup both read `canonical_url_path` — single source of truth for "where does this document live on the public web."

**Routing is purely data-driven, not pattern-based.** The Decision K Server Component pages each declare their own URL path (`/privacy/page.tsx`, `/trust/security/disclosure/page.tsx`, etc.) and call `fetchLegalDocumentByUrlPath(<path>)`. There is no central middleware mapping; no regex; no glob. Adding a new document is: insert a row with the right `canonical_url_path` + add the matching Next.js route file. The seed migration's data is the contract.

**Cross-references:**

- §9.11 — published DDL extended (not replaced) by Decision M. v2.4 playbook bump (Sprint 2 closeout candidate) carries the `canonical_url_path` column into §9.11 verbatim.
- §20.1 — URL structure that `canonical_url_path` mirrors.
- §20.2 — document set (6 contracts + 12 artefacts) that Decision M.1 codifies.
- §20.6 — sub-processors daily-diff job + structured-JSON editor, both deferred to Sprint 3.
- v2.4 playbook bump candidates list (in `progress.md` Done section for Day 18, will absorb the `canonical_url_path` column extension at Sprint 2 closeout).

**Consequences:**

- Migration 0008 creates `legal_documents` + `legal_document_versions` per §9.11, with the `canonical_url_path` column extension on `legal_documents`. `legal_document_versions` is the **second append-only table** after `audit_logs` — explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` per §4.2.1.1.
- Seed migration 0009 (or seed-script-on-first-boot) inserts 18 `legal_documents` rows + 18 `legal_document_versions` rows for v0.1 placeholders, computed from the table above. Idempotent — re-runnable.
- Sub-processors document seeds as a single-paragraph DRAFT placeholder per M.2 (NOT a JSON table); the structured editor is Sprint 3 scope.
- Adding a new legal document later: (a) DB row insert with correct `canonical_url_path`, (b) Next.js route file at that path. The two are paired; the editor cannot create a route, only a row.
- Sub-processors `<SubprocessorsEditor />` UI + the daily diff job per §20.6 land as a Sprint 3 candidate. Logged in `progress.md` Sprint-3 carries.
- Sprint 2 closeout v2.4 playbook bump candidates absorb: §9.11 amendment (add `canonical_url_path` to `legal_documents` DDL).

---

## 2026-05-19 · Item 13 super admin KYC review queue — pre-code architecture (Decisions G, H, I)

**Context:** Day 18 PM ships Item 13 — the super admin KYC review queue + decision API + reviewer checklist. This is the **highest-PII-sensitivity UI in the entire project**: super admin sees NID images, NID numbers, DOB, full names, addresses, bank accounts, eTINs, selfies, BINs, RJSC certificates for every tenant going through KYC. Per the platform-wide manual-verification policy (`Platform-wide policy — manual verification only for MVP`, 2026-05-19) this is also the **operational engine** of the policy — every check the platform doesn't automate, the reviewer does here.

Three architecture decisions need to land before Item 13 code starts so the backend + frontend are built against a single shared shape. All three were proposed in Moshiur's Day 18 brief §2.1 and are accepted verbatim here as canonical project decisions.

---

### Decision G — Audit every read of a submission detail, not just decisions

Every super admin view of a `kyc_submissions` row's detail page writes an `audit_log` row. The audit shape:

```typescript
{
  actor_type: 'super_admin',
  actor_id: reviewerUserId,
  action: 'kyc.submission.viewed',
  entity_type: 'kyc_submission',
  entity_id: submissionId,
  metadata: { reviewer_user_id, viewed_at },
  // diff: null  — pure read, no state change
  tenant_id: submissionTenantId,  // denormalised from the submission row for the audit row's RLS scope
}
```

**Triggered by:** the detail-view GET endpoint (`GET /api/v1/admin/kyc/submissions/:id`). Every call writes an audit row. No deduplication — two consecutive detail-view opens by the same reviewer write two audit rows. Tracking "how many times did reviewer X look at submission Y" is part of the regulatory audit trail.

**The asymmetric calibration: list view does NOT audit per row.** The queue list (`GET /api/v1/admin/kyc/submissions`) surfaces tenant names + submission IDs + tier + status + submitted_at + checklist progress count — **no PII fields**. A super admin scanning the queue to triage work is fundamentally different from opening a specific tenant's detail page with full NID images surfacing. The list view writes one operational audit row per request at most (e.g. for SLA telemetry) but does **not** write per-row "viewed" rows for each submission in the response.

**Rationale:**

- **Regulatory review of "who looked at this tenant's NID" must be answerable.** BFIU + Bangladesh PDPA (forthcoming) + GDPR (for any EU tenant) all require demonstrable access audit trails for PII surfaces. Without per-detail-view auditing, the answer is "we don't know" — which is the wrong answer.
- **Cost is one DB write per detail-view page load — trivial.** Even if a reviewer opens 200 submissions in a day, that's 200 audit rows added to a table that already grows with every state transition. The audit_logs table is partition-ready when volume requires (Sprint 4+ candidate).
- **The list-view exception is a calibrated reduction**, not a gap. Per `Platform-wide policy — manual verification only for MVP` (2026-05-19) the queue exposes tenant names + statuses + ages — operational metadata, not PII. Auditing each list-row-row would 50× the audit_log volume (one detail view = 50 list views during a day's triage) while adding zero regulatory value. The audit story remains complete because every PII-exposing surface (detail view) still writes its row.

**Cross-references:**

- `audit_logs` schema: §9.10 / `.claude/memory/decisions.md` "audit_logs scope at Item 9 — KYC transitions only; auth events + S3 issuance backfill deferred" (2026-05-17, reaffirmed 2026-05-18).
- One-per-domain audit helper pattern: same entry above + 2026-05-18 reaffirmation. Item 13's view-audit writer is `writeKycSubmissionViewed` in `apps/api/src/services/audit/kyc.ts` (sibling to the existing `writeKycTransition` + `writeKycDraftCreated` + `writeKycDraftUpdated` helpers — same domain, same file).
- Item 13 surface scope: `Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)` (2026-05-19) — defines what Item 13 surfaces (raw data + reviewer notes) and what it does NOT (validation badges, flags column, auto-flag UI).

**Consequences:**

- Backend writes a new helper `writeKycSubmissionViewed(tx, {actorId, submissionId, tenantId})` next to the existing audit helpers. Helper writes inside the `withSuperAdmin()` transaction since super-admin context is required (BYPASSRLS to read the submission row + INSERT to audit_logs with the denormalised tenant_id).
- Audit-row payload contains NO PII. `metadata.reviewer_user_id` is the actor (already in `actor_id`); `viewed_at` defaults to `now()`. The diff column stays NULL — there's nothing changing.
- Tenant-side queries against `audit_logs` (`GET /api/v1/tenant/kyc/submissions/:id/audit-trail` — Phase 3 candidate, not Item 13 scope) will surface reviewer access events to the tenant per BFIU/PDPA transparency requirements. The audit data is already correctly tenant-scoped via `tenant_id` denormalisation.
- Tests required: (a) two consecutive detail-view GETs write two audit rows (no dedup); (b) detail view audit row has `actor_type: 'super_admin'` (NOT `tenant_user`); (c) list view does NOT write per-row audit rows.

---

### Decision H — No client-side caching of PII fields beyond the current detail view

TanStack Query defaults (`staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`) are wrong for super admin KYC detail views. The hook that fetches a submission's full detail row **overrides** these defaults per-query:

```typescript
useQuery({
  queryKey: ['admin', 'kyc', 'submissions', submissionId, 'detail'],
  queryFn: () => fetchSubmissionDetail(submissionId),
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
})
```

**The behaviour this produces:** when the reviewer navigates away from the detail view, the data evaporates from client state immediately (gcTime: 0). The next time the reviewer opens any detail page, a fresh fetch hits the server — which also re-triggers Decision G's audit write. The client never carries stale PII between sessions, and the audit trail captures every access.

**Trade-off accepted:** re-fetch on every navigation back to a detail page. At ~50 KYC submissions/day per reviewer per the platform-wide policy's volume model, the per-fetch overhead is operationally invisible. The benefit — PII evaporating from client state immediately — is worth far more than the milliseconds saved by client cache.

**The list view CAN use default caching.** Per Decision G's asymmetric calibration, list-view data is lower-sensitivity (tenant names + status + age + checklist progress count — no PII). The list-view hook uses the project default `staleTime: 30s` so rapid filter/sort interactions feel snappy.

**Why `refetchOnWindowFocus: false` + `refetchOnReconnect: false`:** the defaults would refetch the detail row when the reviewer switches tabs or briefly loses network. Each refetch writes another audit row per Decision G. The reviewer's intent (focus this tab again after answering a Slack message) isn't a "I want to re-verify this submission" intent and shouldn't trigger an audit event. Explicit reviewer navigation back to the detail page DOES trigger a fresh fetch (and audit row) because that's a deliberate access; tab focus is not.

**Rationale:**

- **PII discipline carries to the client.** §1.3 R5 ("no PII in logs") + the §1.3 R4 KYC encryption rule together imply PII should not persist beyond the moment the user is actively viewing it. Server-side this is enforced by RLS + role-switching; client-side this is enforced by cache TTL = 0.
- **Decision G + H are reinforcing.** Each detail-view open writes an audit row AND re-fetches fresh data. The two together make "who looked at what when" trivially answerable.
- **Per-query override is the right granularity, not a global cache config change.** Other tenant-portal queries (e.g. `useTenantType`, event lists) benefit from the default 30s staleTime. Only super admin PII-surface queries override.

**Cross-references:**

- TanStack Query landing decision: `.claude/memory/decisions.md` "TanStack Query lands at Item 12; `useTenantType` migrated for consistency" (2026-05-18). Per-query override pattern foreshadowed in that entry.
- §5.3 documents the per-query override convention.
- §1.3 R5 + R4 (no PII in logs + KYC docs encrypted) — Decision H extends the discipline to client-side cache lifetimes.

**Consequences:**

- New hook `useKycSubmissionDetail(submissionId)` in `apps/web/src/hooks/use-admin-kyc.ts` carries the four-key override above.
- Decision modal mutations (`useDecideMutation`, `useChecklistMutation`, `useNotesMutation`) **invalidate the detail query on success** so the post-decision state surfaces immediately. Invalidation triggers a fresh fetch + another audit row — by design.
- Tests required: (a) detail-view hook config asserts `staleTime: 0` + `gcTime: 0` (assert via `useQuery`'s `meta` or by inspecting the QueryClient state); (b) navigation-away clears the cached data within one tick (jsdom test); (c) list-view hook does NOT carry the override (default caching applies).

---

### Decision I — Reviewer checklist as structured tracking, not free text

Per-submission checklist with checkboxes for each verifiable item. Schema lives in a new `kyc_submissions.reviewer_checklist jsonb` column (migration 0007). Per-tier required keys are server-enforced via the same Zod discriminated union pattern as Item 12 (Day 16 Decision B).

**Checklist schema:**

```typescript
type ChecklistEntry = {
  checked: boolean
  checked_at: string  // ISO timestamp
  checked_by: string  // user_id (uuid)
}

type ReviewerChecklist = Record<string, ChecklistEntry>
```

**Per-tier required keys** (exported from `apps/api/src/schemas/kyc-reviewer.ts` as canonical const arrays — single source of truth, consumed by both server validation and the frontend's approve-button-disabled gate):

```typescript
export const INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS = [
  'nid_front', 'nid_back', 'selfie',           // documents
  'dob_matches_nid', 'full_name_matches_nid',  // identity cross-checks
  'address', 'address_proof',                  // address
  'bank_account_name_match', 'etin',           // financial
] as const

export const ORGANISATION_TIER_A_REQUIRED_CHECKLIST_KEYS = [
  'trade_license', 'moa', 'aoa',                                  // documents
  'bin_format', 'rjsc_certificate',                               // org identity
  'signatory_nid_front', 'signatory_nid_back', 'signatory_selfie', // signatory
  'signatory_designation', 'board_resolution',                    // authority
  'bank_account_name_match', 'etin',                              // financial
] as const
```

**Approve action server-enforces all required keys are checked.** Returns `409 CHECKLIST_INCOMPLETE` with a list of missing keys if any required-for-tier key has `checked === false` or is absent from the checklist jsonb. **Defence against client-bypass:** the frontend's "approve" button is disabled until all required-for-tier keys are checked (client-side enforcement); the server re-validates on `POST /decide` because the client check is convenience, not security.

**Reject action does NOT require completeness.** A reviewer can reject after seeing one disqualifying item — there's no need to walk through the entire checklist when the answer is "no" early.

**Each check/uncheck writes an audit_log row.** Shape:

```typescript
{
  actor_type: 'super_admin',
  actor_id: reviewerUserId,
  action: 'kyc.submission.checklist_toggled',
  entity_type: 'kyc_submission',
  entity_id: submissionId,
  metadata: { key, checked, prior_state },
  tenant_id: submissionTenantId,
}
```

**Plus free-text reviewer notes — separate column.** `kyc_submissions.reviewer_notes text nullable` for unstructured observations that don't fit the checklist (e.g. "trade license shows registration in 2018 but BIN format is post-2019 — odd; let me verify with NBR"). Notes are **NOT shown to the tenant** — internal review state only. Updates to notes write `kyc.submission.notes_updated` audit rows with diffs truncated to first 500 chars (full text stays in the column).

**Schema choice — why a single `reviewer_checklist` jsonb instead of a separate `reviewer_checklist_items` table:**

- The checklist is **per-submission**, not per-tenant or per-event. It's a 1:1 with `kyc_submissions`. A separate table would add a join for every detail view + invent foreign-key semantics that don't earn their keep.
- The per-tier required-keys list is fixed at the application layer (`INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS` const) — not data. The jsonb stores the runtime state; the schema lives in code where it can be reviewed.
- Audit trail of every check/uncheck lives in `audit_logs` (already partitioned-ready), not in the checklist itself. The checklist captures CURRENT state; the audit_log captures HISTORICAL state. Standard event-sourcing pattern within the KYC domain.

**Storage shape on `kyc_submissions`:**

```sql
ALTER TABLE kyc_submissions
  ADD COLUMN reviewer_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reviewer_notes text;
```

**Schema is intentionally NOT including `kyc_submissions.flags`.** Per `Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)` (2026-05-19): "**No `kyc_submissions.flags` jsonb column** (was speculative for sanctions hits in Item 10's original scope; not needed under this policy — when Phase 3 automation lands, the flag column lands in the same migration as the validator code)." Item 13's reviewer-notes free-text is the entire concern-surfacing surface for MVP.

**Rationale:**

- **Structured tracking gives the regulator + the platform answerable questions.** "Was the NID front verified?" → query `reviewer_checklist->'nid_front'->>'checked'`. With free-text notes alone, the answer is "let me grep through 200 free-text fields hoping the reviewer used consistent vocabulary."
- **Server-enforced approve gate prevents the lazy-reviewer failure mode.** Without server enforcement, a tired reviewer could click "approve" with zero checks ticked. The 409 forces a complete (per-tier) checklist before approval.
- **Per-tier required-keys live in shared-types schema, not in the DB.** Adding a new required key for Tier 2 individual KYC = update the const array + write a backfill migration. No table changes; no data migrations.
- **Free-text notes handle the long-tail observations the checklist can't enumerate.** Reviewer judgment-calls live here. Notes drive future training of any Phase 3 advisory-flag automation by giving the team a corpus of "things that mattered enough to flag" examples.

**Cross-references:**

- Per-tier discriminated union pattern: `.claude/memory/decisions.md` "Per-tier KYC schemas are discriminated unions, exported from `apps/api/src/schemas/kyc.ts` — single source of truth shared between server validation and client form schema" (2026-05-18). The `RequiredChecklistKeys` consts above follow the same single-source-of-truth pattern.
- Schema home: new file `apps/api/src/schemas/kyc-reviewer.ts` (sibling to the existing wizard schemas). Re-exported from `packages/shared-types/src/index.ts` so the frontend approve-button-disabled gate consumes the same canonical list as the server enforcement.
- One-per-domain audit helper pattern: each new action (`viewed`, `checklist_toggled`, `notes_updated`, `decided`) gets its own helper in `apps/api/src/services/audit/kyc.ts` — sibling to existing helpers, NOT a generic `writeAudit()`.

**Consequences:**

- Migration 0007 adds `reviewer_checklist jsonb NOT NULL DEFAULT '{}'::jsonb` + `reviewer_notes text` to `kyc_submissions`. Standard grants block applies (no REVOKE needed — this is mutable per-submission reviewer state, not append-only history).
- `apps/api/src/schemas/kyc-reviewer.ts` exports the per-tier required-keys consts + the `ReviewerChecklistEntrySchema` + `ReviewerDecisionSchema` (discriminated union: `{action: 'approve'}` requires all required keys checked; `{action: 'reject', reason: string}` requires reason).
- POST `/api/v1/admin/kyc/submissions/:id/decide` does the server-side completeness check on approve actions; returns `409 CHECKLIST_INCOMPLETE` with `missingKeys: string[]` in the error envelope if any required key is unchecked.
- Frontend `DecisionActions` component reads the same const arrays to compute `isApproveDisabled` client-side; approve modal shows "Missing: nid_front, address" if attempted before completion.
- Tests required: (a) approve with all required keys checked → 200 + state transition; (b) approve with one missing required key → 409 with the missing key surfaced; (c) reject with reason → 200 regardless of checklist completeness; (d) per-tier required-keys arrays exist + are non-empty + cover the §13.3 KYC requirements; (e) checklist toggle PATCH writes audit row with correct shape.

---

### Cross-cutting consequences for Item 13's blast radius

- **First reviewer-facing surface** = first super-admin authentication path in production. `requireSuperAdmin` middleware must be the correctness gate (NOT the tenant-context middleware). Per §5.1 the super-admin audience is separate. The audit row's `actor_type` is `'super_admin'`, never `'tenant_user'` (Decisions G + I both depend on this).
- **Conflict-of-interest check** per the Day 18 brief §2.3 — approve disabled if `audit_log` shows the same user_id previously acted as the tenant for this submission. Implementation queries `audit_logs WHERE entity_id = submissionId AND actor_type = 'tenant_user' AND actor_id = currentReviewerUserId LIMIT 1`. If any row, frontend disables approve with tooltip + server returns 409 `CONFLICT_OF_INTEREST` on attempt.
- **Subdomain provisioning on approve = TODO-stubbed in Item 13's scope.** The approve action writes the field + fires the notification stub but does NOT call SSM for Nginx vhost generation (Item 16's scope per Day 20 plan).
- **Audit_logs append-only invariant (§4.2.1.1)** — all four new actions (`viewed`, `checklist_toggled`, `notes_updated`, `decided`) write through `eventpulse_admin` via `withSuperAdmin()` since that's the role with INSERT grant on audit_logs (BYPASSRLS lets it write tenant_id-denormalised rows that the requesting reviewer's session role couldn't normally write). `eventpulse_app` cannot UPDATE/DELETE audit rows even from a super-admin's session per the REVOKE pattern.

**STOP-ASK conditions reaffirmed for Item 13:**

- Schema change beyond migration 0007's two columns (e.g. a `flags` jsonb if the reviewer convention proves insufficient) → halt, surface to Moshiur. The platform-wide manual-verification policy is load-bearing.
- Any automated check on submission detail (format regex on a field, sanctions matcher, validator stub) → halt, surface. Same load-bearing policy.
- New dep for the document viewer (e.g. a PDF.js wrapper, image viewer library) → halt, surface. The Day 18 brief says "no third-party image viewer dep" — browser-native zoom only.
- The conflict-of-interest query against audit_logs must be efficient — composite index on `audit_logs(entity_id, actor_user_id)` may already exist from Day 14; if not, migration 0007 adds it alongside the new columns.
- Reviewer-notes free-text containing PII (tenant might paste a name in a note) is tolerated — the column is NOT joined to pino structured logs; PII discipline applies at the log boundary, not the DB column boundary. Notes ARE diffed to audit_log on update with truncation to 500 chars per Decision I — diff lives in `metadata.diff_truncated`, not the structured log.

---

## 2026-05-19 · Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)

**Supersedes:** 2026-05-17 "Sprint 2 Item 10 scope amendment — third-party verification deferred to manual review" + 2026-05-17 "Porichoy deferred — manual NID review for MVP". Both remain in the log for archaeology, each marked `Superseded by` this entry.

**Context:** Through Sprint 2 multiple per-item KYC-verification deferrals accumulated as procurement and operational reality bit: Porichoy unreachable (2026-05-17), eTIN regex + BFIU sanctions matcher deferred (2026-05-17), and Day 17's BIN-format BLOCKER surfaced a third "we have a regex that rejects valid data" near-miss. Each deferral was logged in isolation against its triggering item. The shape they collectively form is a single platform-wide stance, not three separate accommodations. Day 18 is the natural moment to consolidate before Item 13 (super admin review queue) starts — the queue is where every one of these manual checks lives, and Item 13's scope shifts materially depending on whether the platform expects to surface validator-emitted flags or only raw reviewer-facing data.

The KYC + onboarding pipeline involves many fields that could be partially or fully automated: NID validation via Porichoy; eTIN format checks; BIN format checks; RJSC certificate lookups; BFIU sanctions matching; name-match algorithms across NID / bank statement / signatory selfie; MFS account verification; address proof verification; board-resolution authenticity. The accumulated lesson from Sprint 2's three near-misses (Porichoy, eTIN/sanctions, BIN-format BLOCKER): validators that occasionally reject valid data — because the regex is wrong, the third-party API is stale, the sanctions list is outdated, the format mandate shifted (NBR's 2019-11-30 BIN-format change is exactly this shape) — are operationally worse than no validator. They create false confidence and silently reject legitimate tenants, which is the failure mode the §21 hosting-space doctrine is least equipped to recover from at MVP scale.

**Decision:** At MVP, the platform performs **zero automated verification of any submitted KYC data**. All data — every field, every document, every claim — is reviewed by a human super admin via the KYC review queue (Item 13, Day 18). Server-side schema validation continues unchanged (Zod schemas enforce field types, required fields, structural shapes, max lengths, no embedded null bytes — that's input validation / injection protection, not data verification). Anything semantic — does this NID number correspond to a real person; is this BIN format current; is this eTIN active; is this RJSC certificate real; is this signatory authorised; does this bank account holder name match the NID; etc. — is reviewer judgment, not code.

This explicitly extends to: BIN format validation, RJSC certificate validation, eTIN format validation (full, not just regex), address proof verification, bank account name-match-to-NID, MFS account verification, sanctions matching, NID validation, signatory verification, board resolution authenticity. **Everything.** The platform captures data and surfaces it cleanly to reviewers. Reviewers exercise judgment.

**Rationale:**

- **MVP volume is operationally fine for manual review.** Sub-50 KYC submissions per week realistically through Phase 1-2 (already accepted by the Porichoy deferral; reaffirmed here). At ~10 minutes per submission × ~48 submissions/day per reviewer × 1 super-admin reviewer (per 2026-05-17 "KYC reviewer role for MVP — super-admin-only") = ~48/day cap. We do not approach this cap at MVP scale.
- **Half-built automation is worse than no automation.** Day 17's BIN BLOCKER (regex `^\d{9,13}$` accepted deprecated pre-2019 formats; NBR mandated 13-digit only since 2019-11-30) caught a regression-shaped bug at /review time. A regex shipped as MVP would have silently rejected post-2019 BINs entered with the wrong digit count, or accepted obviously-stale 9-digit pre-2019 BINs without operator awareness. The reviewer reading the actual BIN and cross-checking against NBR's VAT portal in seconds avoids both failure modes.
- **Third-party automation has procurement-risk that does not justify MVP-stage benefit.** Porichoy (credentials unreachable), BIN registry (no public API), RJSC (no public API), sanctions feeds (BFIU's public notice is PDF; commercial feeds require contracts) — each path adds complexity that the MVP queue solves at zero cost.
- **The reviewer queue is already where humans look at every submission.** Surfacing the raw data is more flexible than binding the system to a specific validation algorithm. When automation eventually lands (Phase 3 trigger below), it augments reviewer judgment rather than replacing it.
- **Manual review at MVP means the platform's policies and reviewer training can evolve based on real cases without code changes.** Cheaper iteration loop for a problem space that's still being learned operationally.

**Consequences for Sprint 2 remaining work:**

- **Item 13 (KYC review queue, Day 18 PM):** every PII field, every document, every claim surfaces clearly in the detail view. **No validation badges, no "auto-flagged" indicators** (no automation is happening; nothing to badge). Reviewer sees raw data and exercises judgment. Helper text adjacent to each field describes the expected format as reviewer documentation ("BIN should be 13 digits per NBR 2019-11-30; verify against NBR VAT portal at vat.gov.bd") but does not enforce server-side rejection. **Reviewer notes free-text field per submission** (captured in audit_log on save) for the reviewer to record their verification process — the audit trail of WHY this submission was approved or rejected. **Approve action requires modal confirmation** that the reviewer has reviewed all required fields and documents. **Reject action requires typed reason** that goes to the tenant in the rejection email and persists in audit_log. **No `kyc_submissions.flags` jsonb column** (was speculative for sanctions hits in Item 10's original scope; not needed under this policy — when Phase 3 automation lands, the flag column lands in the same migration as the validator code).
- **Day 17's BIN 13-digit fact:** reframe from "validation rule" to "displayed-format reference." The 13-digit fact remains useful as (a) tenant-facing wizard helper text ("BIN is typically 13 digits"), (b) reviewer documentation showing expected format adjacent to the field, (c) Phase 3 automation if/when BIN validation is added. **Does not enforce server-side rejection.** A separate gotcha entry on the same date reframes this; the Day 17 PR 1 BLOCKER fix remains in code as a passing-test guard against the original specific regression, but the broader principle does not generalise to "add regex for all BD format fields."
- **All eTIN, BIN, NID, RJSC, MFS account fields** captured as plain strings in `kyc_submissions.fields` with no format regex beyond structural sanity (max length, no embedded null bytes — basic injection protection, not format validation).
- **Notification copy for rejected submissions** must surface the human reviewer's reason verbatim, not a templated "automated check failed" message.

**Consequences for already-shipped surfaces:**

- **Item 8 signed-URL upload (Day 13):** no change. File type and size validation continues — that's storage policy, not data verification.
- **Item 9 state machine + submit endpoint (Day 14):** no change. State transitions are workflow, not verification. The Day 14 scope-reduction (no eTIN regex, no BFIU matcher in the submit endpoint) was already a deferral; this entry promotes it from per-item deferral to platform-wide policy.
- **Items 11-12 wizard (Days 15-17):** tenant-facing inline helper text can describe expected formats ("BIN should be 13 digits") as UX guidance, but client-side validation only enforces structural shape (non-empty, reasonable length), not semantic correctness. The Day 17 PR 1 13-digit BIN regex in the schema remains in place as a passing-test guard, but its existence is now an exception (the one BD format check the platform enforces); future format additions explicitly require a §29-style decision before joining it.
- **Items 14-15 Trust Center (Day 19):** no change.
- **Item 16 Porichoy adapter scaffold (Day 20):** no change. The scaffold-only shape was already locked by the 2026-05-17 Porichoy deferral; this entry reframes that scaffold as the **canonical pattern** for all future automation integrations — interface + env + secrets entry + TODO stub, with the live wiring landing as a focused PR alongside the operational decision to flip from manual-only to manual-plus-flag.

**Path to automation — Phase 2 trigger and Phase 3 plan:**

- **Phase 2 trigger (re-evaluation gate):** when verified KYC submission volume crosses 50 per week sustained (calculated as a 4-week trailing average), reassess. **The decision criterion is reviewer capacity, not feature ambition** — the question is "are reviewers spending more than 4 hours per business day on KYC backlog?" not "do we want automation." If the answer to the capacity question is yes, automation gets scoped; if no, the manual-only policy continues regardless of validator availability.
- **Phase 3 plan (when triggered):** add automated checks **alongside manual review** (never replacing it for MVP-pattern tenants). Each automation arrives as an advisory flag the reviewer sees alongside the raw data, never as a hard reject:
  - Porichoy NID API integration once credentials and procurement complete — flag mismatches for reviewer, do not auto-reject
  - eTIN active-status check against NBR e-filing portal if API available — flag inactive eTINs for reviewer, do not auto-reject
  - BIN format + active-status check against NBR VAT portal if API available — flag for reviewer
  - BFIU sanctions matching against canonical list (procurement path established) — flag hits for reviewer
  - RJSC certificate active-status check if API available — flag for reviewer
  - Address geocoding + division/postal-code consistency check — flag inconsistencies
  - Bank account name verification via partner bank APIs if available — flag mismatches
- All automation is augmentation of reviewer judgment, not replacement. Even at Phase 3 volume, every KYC submission still has reviewer attention. Automation reduces per-submission review time by surfacing flags; it does not eliminate the reviewer role. **The `kyc_submissions.flags jsonb` column lands in the same migration as the first validator** — no schema migration to the data the validators validate, only addition of the flag artefacts. Historical manual-only submissions remain `flags=null`, audit-trail clear.

**Consequences for Day 18 plan:**

- **Day 18 AM v2.3 CLAUDE.md playbook bump grows from 8 to 9 §-section amendments.** New amendment: §13.0 replaced by the manual-verification platform-wide policy text (old §13.0 Porichoy-specific deferral block is fully superseded by the new policy block). The other 8 amendments (§17 OIDC, §13.3 draft state, §13.3 Org Tier A decomposition, §9.1 `tenants.type` nullable, §4.2.1 append-only audit, §3.2 extensionAlias) unchanged in scope; only §13.0 expands.
- **Day 18 PM Item 13 scope adjusts as detailed above** — the review queue work is cleaner because the requirements are simpler (no automation surface to design around, no flag-column migration, no auto-flag UI affordances). The scope reduction does not change the day-budget; the saved complexity converts into stronger reviewer UX (per-field helper text + explicit confirm-modal + reviewer-notes free-text field + audit row carrying the reviewer-notes payload).

**Cross-references:**

- Supersedes "Sprint 2 Item 10 scope amendment — third-party verification deferred to manual review" (2026-05-17) — promotes per-item deferral to platform-wide policy.
- Supersedes "Porichoy deferred — manual NID review for MVP" (2026-05-17) — promotes per-vendor deferral to platform-wide policy. Porichoy scaffold-only shape (interface + env + secrets entry + TODO) becomes the **canonical pattern** for all future automation integrations.
- Reframes the Day 17 BIN 13-digit gotcha — see same-date gotchas.md entry "BIN 13-digit fact is reviewer-documentation, not server-side enforcement".
- Reaffirms "KYC reviewer role for MVP — super-admin-only" (2026-05-17) — single reviewer cap stays the operational constraint that drives the Phase 2 trigger.
- Reaffirms §1.3 R5 "no PII in logs" — manual review notes go to audit_log diff column with structural sanitisation, never raw PII into pino structured logs.

---

## 2026-05-19 · Organisation Tier A wizard — 6-step decomposition + reuse Individual Tier 1's financial schema

**Context:** Sprint 2 Day 17 (Item 12 Part 2) ships the Organisation Tier A wizard variant. §13.3 specifies the required documents (trade license, MOA, AOA, authorised-signatory NID + selfie, BIN) and financial details (bank/MFS account + eTIN). Day 16 PR 3 left the page route + drafts router with `501 NOT_IMPLEMENTED` placeholders for organisation tenants. Day 17 wires the real flow.

The question at plan time: how should the 6+ data points decompose into wizard steps?

**Decision:** 6 steps, organised by "who owns this data" rather than "what document is this":

1. **Org info** — text-only: legal name, trade license number, BIN (VAT registration), date of incorporation
2. **Signatory identity** — text-only: signatory full name (as on NID), NID number
3. **Signatory docs** — uploads only: nid_front, nid_back, photograph (signatory's NID images + selfie)
4. **Org docs** — uploads only: trade_license PDF, moa, aoa
5. **Financial** — text-only: account type (bank/MFS), account name, account number, branch name (if bank), eTIN. **Schema-equivalent to Individual Tier 1 Step 3 — see schema-reuse note below.**
6. **Review** — read-only summary, submit

**Why 6 steps (vs 4 or 5):**

- **Splitting Org info from Signatory identity** matches the legal/ops model: the legal entity (trade license, BIN) is distinct from the human who signs on its behalf. Future Phase 2 work where multiple signatories are added (board members, dual-signatory accounts) extends the signatory model without disrupting the org model.
- **Splitting Signatory docs from Org docs** mirrors what the reviewer actually compares: the signatory's face + ID match each other (one decision); the org's docs match the trade license + BIN field (a separate decision). Step boundaries that match the reviewer's mental decomposition reduce reviewer error.
- **Splitting documents from their text fields** (Signatory identity → Signatory docs; Org info → Org docs) gives the user clear progress: they fill the text fields fast, then upload + wait. Combining would have the upload's progress bar competing with the user typing in the same step.
- **Trade-off accepted:** 6 steps is more clicks. The user research consideration (a few extra Save & Continue presses on mobile) is outweighed by the cognitive load reduction of "one thing per step". MVP volume is sub-50/month per §13.0 manual-review status; if Phase 2 traffic shows step-abandonment patterns in the analytics, recombine.

**Schema reuse — Financial step uses `IndividualTier1FinancialSchema` directly:**

The financial fields for organisations (account type, name, number, branch, eTIN) are semantically identical to Individual Tier 1's. Re-defining `OrganisationTierAFinancialSchema` as a separate-but-identical zod object would (a) duplicate code, (b) create drift risk (a future tightening of one wouldn't propagate to the other), (c) confuse the reviewer queue (two near-identical jsonb shapes to handle).

Org Tier A's submission + PATCH schemas import `IndividualTier1FinancialSchema` directly. The naming is mildly awkward (the "Individual Tier 1" prefix lives on shared content) but unblocks Day 17 cleanly; Sprint 3 can rename to `BaseFinancialSchema` or similar if the awkwardness compounds.

**Document type additions to `KYC_DOCUMENT_TYPES`:**

Already present from Day 16 PR 1: `nid_front, nid_back, photograph, address_proof, etin_certificate, bank_statement, trade_license, moa, aoa`. No new document types needed for Tier A; existing enum is sufficient.

**Tier-A submission shape** (`kyc_submissions.fields` jsonb for Org tenants):

```json
{
  "org": { "legalName": "...", "tradeLicenseNumber": "...", "bin": "...", "dateOfIncorporation": "YYYY-MM-DD" },
  "signatory": { "fullName": "...", "nidNumber": "..." },
  "financial": { "accountType": "bank", "accountName": "...", "accountNumber": "...", "branchName": "...", "etinNumber": "..." }
}
```

And `documents` jsonb:

```json
{
  "nid_front": "s3://...",
  "nid_back": "s3://...",
  "photograph": "s3://...",
  "trade_license": "s3://...",
  "moa": "s3://...",
  "aoa": "s3://..."
}
```

Note the step-id → jsonb-key mapping is intentional and lets the PATCH handler's `{[step]: patch.fields}` shallow-merge naturally:

| Wizard step id | `fields[step]` key | Documents added |
|---|---|---|
| `org_info` | `fields.org` | — |
| `signatory_identity` | `fields.signatory` | — |
| `signatory_docs` | (no fields PATCH) | `nid_front, nid_back, photograph` |
| `org_docs` | (no fields PATCH) | `trade_license, moa, aoa` |
| `financial` | `fields.financial` | — |
| `review` | (no PATCH; submit) | — |

Step ids in TypeScript / zod use `snake_case` consistent with the existing `tenant.type` enum convention.

**Consequences:**

- `packages/shared-types/src/kyc-schemas.ts` extends the `KycSubmissionSchema` discriminated union with the org branch. `OrganisationTierA{OrgInfo,Signatory,SubmissionSchema}` + `OrganisationTierAPatchSchema` (a 5-branch discriminated union: `org_info | signatory_identity | signatory_docs | org_docs | financial` — the review step has no PATCH).
- Two of the 5 PATCH branches (`signatory_docs`, `org_docs`) carry only `documents`, no `fields`. The PATCH schema marks `fields` as `z.never().optional()` on these branches and the existing server-side empty-fields-skip logic from Day 16 PR 3 BLOCKER 1 handles them without further change.
- Drafts router removes the `501 NOT_IMPLEMENTED` branches in PATCH + submit handlers. Both now branch on `tenantType` to pick the right tier schema (Individual Tier 1 vs Org Tier A) for validation.
- `wizardVariantForTenantType()` updated to return `{ kind: 'organisation_tier_a' }` for organisation tenants (currently returns `null`).
- New `OrganisationTierAWizard` variant root in `apps/web/src/components/kyc-wizard/organisation-tier-a/index.tsx` orchestrates the 6 steps. Mirror of `IndividualTier1Wizard` shape; both share `WizardFrame` + `ProgressIndicator` + `DocumentUpload`.
- `apps/web/src/app/(tenant)/kyc/page.tsx` removes the "coming Day 17" placeholder; renders `OrganisationTierAWizard` when `tenant.type === 'organisation'`.

**Cross-references:**

- 2026-05-18 "KYC wizard uses server-side drafts" — same draft/PATCH/submit lifecycle applies; the org variant only adds new schemas + step components, not new infrastructure.
- 2026-05-18 "Per-tier KYC schemas are discriminated unions" — this entry extends the discriminated union with the org branch. Single source of truth maintained.
- §13.3 CLAUDE.md — Tier A required artefacts. v2.3 playbook bump (Day 18 AM) will note the 6-step decomposition + financial-schema reuse alongside the existing Tier 1 4-step description.

**Path back if 6 steps proves too many:** Recombine `signatory_identity` + `signatory_docs` (or `org_info` + `org_docs`) into 5 steps via a Phase 2 PR if MVP analytics show step-abandonment between those pairs. The schema reorganisation would need a migration only if `fields` jsonb keys change (currently `fields.signatory` is a single key regardless of step decomposition).

---

## 2026-05-19 · KYC wizard e2e Playwright test ships local-only on Day 17; staging cutover deferred to Day 18 Sprint 2 closeout

**Context:** Day 17 includes an end-to-end happy-path Playwright test for the Individual Tier 1 wizard (was a Day 16 deferral). The test exercises the full lifecycle: sign in → land on /kyc → fill all 4 steps → submit → see success page. The handoff from Day 16 surfaced an open question: does CI's runner have outbound connectivity to `staging.eventpulse.com.bd` + the KYC bucket?

**Decision:** Day 17's Playwright test runs **local-only** — local Postgres (CI service container), Hono API + Next.js web servers spun up by Playwright's `webServer` config, and `KYC_S3_DRY_RUN=1` set on the API so signed-URL issuance returns synthetic URLs without an actual AWS call. This validates the full request/response/state-machine chain without depending on staging connectivity. Staging-real e2e cutover is queued as a **Sprint 2 closeout candidate** (v0.2.0-sprint-2 bundle).

**Rationale:**

- **Connectivity verification is its own piece of work.** Confirming CI outbound to staging needs an IAM trust update (CI's OIDC role may need staging-resource read permissions), Cloudflare for SaaS's edge IP allowlist for the test runner, and a staging fixture tenant. Bundling this with Day 17's feature work risks Day 17 stalling on connectivity yak-shaving.
- **Local-only catches the right bugs.** The Day 16 PR 3 BLOCKER 1 (document PATCH wipes step fields) was a frontend↔backend contract violation that any local e2e would have caught — the bug lived in the data shape passed between components, not in any network-layer behaviour. The race conditions and state-machine transitions the e2e is most valuable for are environment-agnostic.
- **Staging-real adds two things local doesn't catch:** (a) real S3 PUT mechanics (KMS headers, bucket policy enforcement, signed URL TTL), (b) Cloudflare for SaaS routing to a real tenant subdomain. Both are real bugs to hunt; both are isolable into a Sprint 2 closeout PR.
- **Day 17's day-budget already heavy.** Org Tier A wizard variant + 6 step components + polish pass + 2 carry tests + e2e test infra is ambitious; spending half the day on staging connectivity would force one of the four deliverables to slip. Local-only e2e fits the budget; staging-real e2e is a focused 1-2 hour task that lands as its own PR.

**Consequences:**

- New `apps/web/e2e/individual-tier1-happy-path.spec.ts` (or similar) — Playwright test that:
  - Mints a tenant-context JWT via `signTokens()` in setup (no real OAuth flow)
  - Injects the access cookie before navigating to `/kyc`
  - Walks through all 4 Individual Tier 1 steps, uploading 4 dummy files
  - Asserts the "Submission received" success state
- New `apps/web/playwright.config.ts` (or extension of existing) — `webServer` array spinning up apps/api + apps/web. Sets `KYC_S3_DRY_RUN=1`, `DATABASE_URL=...` to the CI Postgres service.
- CI `.github/workflows/ci.yml` E2E job's `if` gate flips from `needs.detect-scope.outputs.has_e2e == 'true'` once the spec file lands (existing gate already detects `apps/web/e2e/**/*.spec.ts`).
- **Sprint 2 closeout PR** picks up: staging-fixture tenant seed, CI IAM/Cloudflare access verification, Playwright `STAGING_URL` env-driven config, real S3 PUT teardown to keep the bucket clean. Estimated 1-2 hours focused work.

**Path back if local e2e proves insufficient:** if a real-S3-only bug ships to staging undetected (e.g. KMS header mismatch, bucket policy regression), the staging-real e2e gets pulled forward into Sprint 3's first session as a P0. The local e2e stays as the fast-feedback layer.

---

## 2026-05-19 · Individual Tier 1 polish scope — inline-on-blur error UX only

**Context:** Day 16 PR 3 shipped Individual Tier 1 with errors rendered only after form-submit (react-hook-form default mode). The handoff from Day 16 listed four polish candidates: (a) inline-on-blur errors, (b) loading/saving indicators near the progress bar, (c) framer-motion step transitions respecting prefers-reduced-motion, (d) mobile responsive audit @ 360px width. Day 17 needs to pick scope.

**Decision:** Day 17 ships polish item (a) only — `mode: 'onBlur'` on each step's `useForm` so per-field validation fires on blur, not just on submit. The other three (loading indicator, step transitions, mobile audit) are deferred to **Sprint 2 closeout** or **Sprint 3 polish PR**.

**Rationale:**

- **Inline-on-blur fixes a real UX failure mode.** A user fills 5 fields, clicks Save & Continue, and gets 5 inline errors at once — they have to scroll back, fix each, click again. Blur-mode shows each error as they leave the field; corrections happen in flow, not after.
- **The fix is small.** One config change per `useForm` call in the 4 step components: `mode: 'onBlur'`. Adds zero bundle weight; existing tests still pass (the validation pipeline is unchanged, only its trigger timing changes).
- **The other three items are real but lower-leverage:**
  - **Loading/saving indicators:** the CTA button already shows "Saving…" with `aria-busy` (Day 16 PR 3). A separate near-the-progress-bar indicator is nicer but not load-bearing.
  - **Step transitions:** ~3 KB framer-motion overhead + meaningful AnimatePresence wiring + a `useReducedMotion` integration. Nice-to-have, not Day-17-critical.
  - **Mobile audit:** a real walkthrough at 360px width. Requires the dev server + actual time spent in a mobile viewport. Best done as its own focused session, not bolted onto a day already shipping a new wizard variant.

**Consequences:**

- Edit 4 files: `step-1-identity.tsx`, `step-2-address.tsx`, `step-3-financial.tsx` (skip step-4-review — no form). Each `useForm({ resolver: zodResolver(...), defaultValues: {...} })` becomes `useForm({ mode: 'onBlur', resolver: zodResolver(...), defaultValues: {...} })`.
- Org Tier A's step components (built today in PR 2) ship with `mode: 'onBlur'` from the start.
- **Sprint 2 closeout candidates** (v0.2.0-sprint-2 bundle) gain:
  - Loading/saving indicator near the progress bar (small)
  - Framer-motion step transitions with prefers-reduced-motion fallback (~3 KB bundle increase)
- **Sprint 3 polish PR** picks up mobile responsive audit @ 360px (own session; needs ground-truth viewport testing).

**Cross-references:**

- 2026-05-18 "KYC wizard uses server-side drafts" — the wizard's UX surface is the highest-trafficked tenant-facing screen for the Phase 1 onboarding flow; polish iterations here have outsized impact.
- §19.4 CLAUDE.md (Loading States, design system) — both deferred items align with the playbook's design discipline; deferral is about timing, not abandoning the principles.

**Path back if blur-only mode proves insufficient:** if MVP analytics show users still submit-without-typing-then-see-errors (i.e. they don't blur, they tab → enter → submit), `mode: 'onTouched'` (validates on blur OR after first valid submit attempt) is a one-line follow-up. Don't over-engineer the first iteration.

---

## 2026-05-18 · KYC wizard uses server-side drafts (activates the `draft` status added in migration 0005) — not localStorage

**Context:** Sprint 2 Day 16-17 Item 12 ships the KYC wizard. Tier 1 Individual decomposes into 4 steps (identity → address → financial → review); the forthcoming Organisation Tier A variant (Day 17) decomposes into ~5–6 steps. With document uploads and form fields measured in dozens per submission, a tenant who closes the tab mid-flow must not lose work — that's a hostile experience for a payment platform where the very gate is verifying who can take money. The question at plan time is **where** the partial state lives: client-side (localStorage) vs server-side (a `kyc_submissions` row that progresses through `draft → submitted`).

**Decision:** Server-side drafts. The wizard creates a `kyc_submissions` row in `status='draft'` on step 1 entry; each subsequent step PATCHes the row's `documents` / `fields` jsonb columns; the final review step transitions the row `draft → submitted` via the Day 14 state machine. No client-side persistence of KYC field values is permitted anywhere in the wizard.

The `draft` status was added to `kyc_submissions.status` CHECK in migration 0005 (Day 14) and added to the state machine's legal-transitions map (`rejected → draft → submitted`) in `apps/api/src/domain/kyc/state-machine.ts`. Until Item 12, only the `rejected → draft` resubmit lane used the `draft` state at the DB layer; the comment in the state machine file ("Row creation (first-write) does NOT route through transition()") was correct for Item 9's direct-submit endpoint but Item 12 introduces a parallel path. Both paths coexist; the wizard creates rows directly in `draft` via a new `createKycDraft()` helper, then transitions them through `transition('draft', 'submitted')` on final submit. The existing `POST /api/v1/tenant/kyc/submissions` endpoint (Item 9, direct-submit, status='submitted' on first write) is **not deprecated** — it remains valid for programmatic clients or any future "I already have all the data" surface (Phase 3 public API), and the two endpoints share validation via the per-tier schema (Decision B below).

**Rationale:**

- **Device portability.** A tenant who starts the wizard on a phone during their commute and finishes on a laptop at the office gets a coherent experience without re-uploading their NID. localStorage cannot deliver this; sessionStorage/IndexedDB are scoped per-browser.
- **Browser-clear / private-mode safety.** A user clearing their browser data — common defensive behaviour, especially on shared devices — must not lose 20 minutes of KYC submission. The wizard's audience includes first-time SaaS users and individual organisers on shared family devices.
- **Audit trail of draft progression.** Each PATCH writes an `audit_logs` row with a diff (see audit-shape note below). Combined with the existing state-transition writes, the audit trail can reconstruct the full submission lifecycle from first draft entry to reviewer decision. Regulatory framing under §15 (BFIU) values this lineage.
- **Server-side validation parity.** The same per-tier zod schemas (Decision B) validate both PATCHes (partial — per-step sub-schemas) and final submit (full — tier-level schema). Client-side localStorage would either duplicate the schema in JS-only form (drift risk) or omit validation (worse).
- **Day 13 upload-url integration cleanly composes.** Document uploads already issue S3 keys via the Day 13 signed-URL flow before the row is finalised; the draft row stores the S3 refs in `documents` jsonb as each upload completes. Without a draft row, document refs would need an ephemeral cross-reference table — strictly more complex.

**Audit shape for `kyc.draft_updated`** (sibling helper to `writeKycTransition`, added in `apps/api/src/services/audit/kyc.ts` — same file because both are KYC-domain, one-per-domain pattern preserved per the 2026-05-18 reaffirmation on the Day 14 audit_logs scope entry):

- `action`: `'kyc_submission.draft_updated'`
- `entity_type`: `'kyc_submission'`, `entity_id`: submission id
- `diff`: `{ fields: { added: [...field paths], updated: [...field paths], removed: [...field paths] } }` — **field paths only, no values**. Storing values would (a) duplicate PII into a second table when §1.3 R5 says hash-or-omit, (b) bloat the audit table with the same NID/eTIN strings already in `kyc_submissions.fields`. The path-only diff reconstructs "what changed when" without re-storing the secret.
- Field paths use jsonb path notation (`'identity.nidFront'`, `'address.line1'`, `'financial.accountNumber'`, etc.) — the same paths the per-step zod schemas validate. Wildcards (`*`) and array indices not needed at this stage.
- `metadata`: `{ actor_role: 'tenant_user', step: 'identity' | 'address' | 'financial' }` — the step the PATCH targeted, captured for forensic queries that want to filter audit rows by wizard step without parsing field paths.
- One audit row per PATCH request, not per field — a single PATCH that updates 6 fields produces one row with all 6 paths in `diff.fields.updated`.

**jsonb merge semantics on PATCH:**

- The PATCH handler computes the diff (added/updated/removed paths) by comparing the incoming partial against the current `documents` / `fields` jsonb columns, then issues a Postgres `jsonb_set` (or `||` shallow merge for top-level keys) to merge field-by-field rather than replacing the whole jsonb document.
- Critical safety invariant: a Step 2 PATCH must NEVER wipe Step 1 fields. The merge is server-enforced; the client is not trusted to send the full state. This is the entire reason the merge logic lives at the server layer.
- For nested keys (e.g. `identity.fullName` inside `fields.identity`), `jsonb_set` is used to target the path; for whole-step replacement (e.g. user revisits Step 1 and re-enters), the handler accepts a `replaceStep: 'identity'` flag in the PATCH body that drops the whole sub-object before merging the new one. Default behaviour is merge.

**Consequences:**

- New endpoints land at `POST/GET/PATCH /api/v1/tenant/kyc/drafts/[:id]` + `POST /api/v1/tenant/kyc/drafts/:id/submit`. All gated by `requireTenantAuth` + `requireTenantType` (the wizard is meaningless before account type is set).
- New helper `createKycDraft()` lives in `apps/api/src/domain/kyc/state-machine.ts` (or a sibling file) — direct insert in `status='draft'`, audit row written via a new `writeKycDraftCreated()` helper. **Updated comment** in state-machine.ts removes the "draft state is only needed by the resubmit lane" framing; now: "draft state is used by both the wizard create path and the resubmit lane".
- The wizard's submit handler routes through `transition('draft', 'submitted')` — an existing legal transition; no state machine change required. The `writeKycTransition` audit writer is reused unchanged (its `fromState='draft'` path is already supported).
- **No client-side persistence anywhere in the wizard.** Verified explicitly for react-hook-form (default behaviour stores in component state only — confirm `persistConfig` is not enabled; no localStorage adapter wired), TanStack Query (cache is in-memory by default — confirm no `persistQueryClient` is installed), and framer-motion (animation state only, no form values touched). The /review pass before PR 3 merge audits all three.
- **Idempotency on draft creation.** The wizard sends a client-generated UUID in the body; the route uses the Item 9 `INSERT … ON CONFLICT DO NOTHING + SELECT-back` pattern so retries don't double-create. Cross-tenant submissionId conflicts return 409 `SubmissionIdInUseError` (existing error class).

**Cross-references:**

- 2026-05-17 "audit_logs scope at Item 9 — KYC transitions only; auth events + S3 issuance backfill deferred" (incl. 2026-05-18 reaffirmation) — sibling helpers within `services/audit/kyc.ts` honour the one-per-domain pattern; per-domain means per-business-area, not per-helper.
- 2026-05-17 "Sprint 2 Item 10 scope amendment" — same operational pattern (the wizard captures eTIN as a plain string per-tier; no regex validation, no automated sanctions match; reviewer eyeballs at Item 13).
- 2026-05-18 "Tenant account_type is set-once for MVP" — the wizard variant choice depends on `tenants.type`; the set-once guarantee means the wizard's variant selection cannot change mid-submission. If a tenant somehow needed to switch (support escalation path), their drafts under the old type would be invalidated by the super admin "change tenant type" action's cascade logic (Phase 2).
- CLAUDE.md §13 + §13.3 + §13.4 — the wizard implements the graduation flow described in §13.4 at the UX layer; the state machine sits behind the wizard, not in front of it.
- `apps/api/src/domain/kyc/state-machine.ts` — existing comment about row creation not routing through `transition()` is correct for Item 9's direct-submit; Item 12 adds a parallel create-as-draft path. The state-machine.ts header comment is updated as part of PR 1 (Day 16).

**Path back to client-side drafts:** Not anticipated. Server-side drafts are the durable choice for any KYC-grade flow. If a future surface needs an "anonymous, no-account preview" path (Phase 4 marketing experiment, perhaps), that surface gets its own non-`kyc_submissions` storage with explicit zero-PII guarantees — never localStorage holding NID strings.

---

## 2026-05-18 · Per-tier KYC schemas are discriminated unions, exported from `apps/api/src/schemas/kyc.ts` — single source of truth shared between server validation and client form schema

**Context:** Item 9 (Day 14) accepted submissions through `POST /api/v1/tenant/kyc/submissions` with discriminated-union validation in the route handler itself — schemas defined inline, never extracted. That was acceptable for a single submit endpoint whose only consumer was the test suite. Item 12's wizard adds (a) per-step PATCH endpoints that need partial-validation against each step's slice of the tier schema, (b) a client-side form layer (react-hook-form) that benefits from sharing the exact same schema as the server resolver, (c) a forthcoming Organisation Tier A variant (Day 17) that must compose with the Individual variant cleanly. Inlining schemas in each route + duplicating them in the frontend is the wrong direction.

**Decision:** Per-tier zod schemas live in `apps/api/src/schemas/kyc.ts`, exported as named TS types + zod schemas, and consumed by both server route handlers (`apps/api/src/routes/tenant/kyc-drafts.ts` + the existing `apps/api/src/routes/tenant/kyc.ts`) and frontend form components (`apps/web/src/components/kyc-wizard/...` via the same package alias).

**Schema shape:**

- Top-level discriminated union `KycSubmissionSchema = z.discriminatedUnion('tenantType', [IndividualTier1SubmissionSchema, OrganisationTierASubmissionSchema, ...])` keyed on `tenants.type`.
- Each tier exports both a **full-tier schema** (used by `POST /kyc/drafts/:id/submit` for final validation) and **per-step sub-schemas** (used by `PATCH /kyc/drafts/:id` for partial validation).
- Step sub-schemas are `.partial()` derivatives where appropriate, but each required field within a given step stays required when that step is being PATCHed (a step PATCH that omits a known-required field is rejected; the user can move on without entering the step, but cannot enter the step and submit it half-filled).

**Tier 1 Individual decomposition (locked Day 16):**

- **Step 1 — Identity** (`IndividualTier1Step1Schema`): NID front image (S3 ref), NID back image (S3 ref), live selfie (S3 ref), date of birth (ISO date string, must be ≥ 18 years ago), full name as on NID (string, 2–120 chars).
- **Step 2 — Address** (`IndividualTier1Step2Schema`): address line 1 (string, 1–200), address line 2 (optional string, 0–200), city (string, 1–80), division (BD enum below), postal code (string, 4-digit BD format), address proof document (S3 ref).
- **Step 3 — Financial** (`IndividualTier1Step3Schema`): account type (enum: `'bank' | 'bkash' | 'nagad' | 'rocket' | 'upay'`), account name (string, 2–120 — must match NID name; soft-validated server-side via case-insensitive equality on normalised whitespace, reviewer makes the hard call), account number (string, 8–32 — format varies by account type), branch name (string, 2–120, required iff account type is `'bank'`), eTIN number (plain string, 10–13 chars, no regex — Item 10 deferred per 2026-05-17 amendment).
- **Step 4 — Review** (`IndividualTier1Step4Schema`): empty — no new fields, just a confirmation that the full `IndividualTier1SubmissionSchema` validates against the accumulated row state.

**Bangladesh division enum (locked Day 16):**

- Eight divisions, lowercase enum values: `dhaka`, `chattogram` (post-2018 official spelling — was Chittagong), `khulna`, `rajshahi`, `sylhet`, `barishal` (post-2018 official — was Barisal), `rangpur`, `mymensingh`.
- Bilingual labels rendered in the frontend select component, NOT in the schema enum: ঢাকা, চট্টগ্রাম, খুলনা, রাজশাহী, সিলেট, বরিশাল, রংপুর, ময়মনসিংহ.
- Defined as `export const BD_DIVISIONS = ['dhaka','chattogram','khulna','rajshahi','sylhet','barishal','rangpur','mymensingh'] as const` + `export type BdDivision = (typeof BD_DIVISIONS)[number]` in `packages/shared-types/src/bd.ts` (new file — first cross-package shared constant; the package already exists from Sprint 1 Day 1-2 scaffold). Both backend zod (`z.enum(BD_DIVISIONS)`) and frontend select options import from the same source.

**Rationale:**

- **Single source of truth eliminates drift.** Server adds a required field → server validation rejects partial submissions → frontend form's resolver picks up the same rejection at next render → user sees the field. No "the server says X but the form thinks Y" class of bug.
- **Per-step sub-schemas enable progressive validation.** PATCH for Step 1 doesn't fail because Step 3 fields are missing — they aren't being PATCHed. Full-tier schema fails on final submit if any required step is incomplete; the wizard navigates the user back to the offending step rather than failing silently.
- **Discriminated union scales to Organisation Tier A in Day 17 + Tier 2/3 + Tier B/C in Phase 2** without restructuring — adding a tier means adding a branch to the union, not modifying existing tier schemas.
- **BD division enum is a shared constant, not a schema-internal detail.** The same eight divisions surface in (a) KYC address forms, (b) tenant profile editing (Sprint 3+), (c) event venue forms (Sprint 3+, public landing pages). Putting them in `packages/shared-types` keeps the canonical list maintainable and prevents the inevitable "wait, is it Chittagong or Chattogram?" question from arising in each new surface. Post-2018 official spellings locked.

**Consequences:**

- New file `apps/api/src/schemas/kyc.ts` houses all tier schemas + per-step sub-schemas. Exported as both zod schemas (`IndividualTier1SubmissionSchema`) and inferred TS types (`type IndividualTier1Submission = z.infer<typeof IndividualTier1SubmissionSchema>`).
- New file `packages/shared-types/src/bd.ts` houses the BD division enum + type. Re-exported from `packages/shared-types/src/index.ts`. Both apps/api and apps/web import from `@eventpulse/shared-types`.
- Existing `apps/api/src/routes/tenant/kyc.ts` submit endpoint's inline schemas are replaced with imports from the new central file. The endpoint's behaviour is unchanged (still validates against the full-tier schema on first-write); only the source of the schema moves. Tests still pass; no migration required.
- Frontend `react-hook-form` instances use `zodResolver(IndividualTier1Step1Schema)` etc. per step. The wizard's final submit step builds the full submission object from the accumulated draft row state and validates against `IndividualTier1SubmissionSchema` before POSTing to `/kyc/drafts/:id/submit`.
- **Eyes on the "account name must match NID name" check at Sprint 2 closeout.** The schema-level soft check (case-insensitive + normalised whitespace) is intentionally lenient — reviewer makes the hard call. If MVP review patterns show frequent rejections at this step, Sprint 3 can revisit whether server should reject at submit-time instead of letting submissions through to the reviewer queue.

**Cross-references:**

- 2026-05-17 "Sprint 2 Item 10 scope amendment" — eTIN captured as plain string (no regex) per the amendment; no automated sanctions match. Schema reflects this: `etinNumber: z.string().min(10).max(13)` without `.regex()`.
- 2026-05-17 "Porichoy deferred — manual NID review for MVP" — schema captures NID number + NID images as plain fields + S3 refs; no automated NID format validation. Reviewer compares submitted NID against the uploaded NID image by eye.
- 2026-05-17 "KYC reviewer role for MVP — super-admin-only" — the reviewer's eyes are the canonical source of truth for soft-validated fields (name match, NID format). Schema does the minimal "reject obvious garbage" pass; reviewer does the hard call.

**Path back if schema sharing breaks:** Server is canonical. If the frontend ever needs to diverge from the server's schema (e.g. richer UX validation like "country code must come from a typed select"), it's a sibling schema that **extends** the server's via `.merge()` or `.refine()`, never a fork. The server schema's shape is the contract.

---

## 2026-05-18 · TanStack Query lands at Item 12; `useTenantType` migrated for consistency

**Context:** Day 15 Item 11 introduced `useTenantType` as a native `fetch` hook with a deliberate note ("TanStack Query deferred to Item 12") because the single read of `tenants.type` was simple enough not to justify the dep. Day 16's wizard work changes the cost-benefit: resumable drafts need cached server state with optimistic updates on PATCH, document uploads need mutation state per file, submission status transitions need cache invalidation. The wizard is the second TanStack-shaped consumer; landing TanStack Query as project infra now (rather than copying native fetch boilerplate across 8+ wizard hooks) is the proportional move.

**Decision:** TanStack Query (`@tanstack/react-query` + `@tanstack/react-query-devtools` dev-only) lands in PR 2 of Day 16. `useTenantType` migrates from native fetch to `useQuery` in the same PR, keeping its interface shape stable so the consumers in `TenantTypeGate` + `AccountTypeModal` don't break. A small invalidation hook (`useInvalidateTenantType()`) is added so the account-type setter can mark the cached value stale on success rather than waiting for the stale time to elapse.

**QueryClient defaults (locked Day 16):**

- `staleTime: 30_000` (30s) — tenant portal data tends to be slowly-changing; aggressive refetch is noise for the operator-style UX.
- `gcTime: 5 * 60_000` (5 min) — keep cache around for typical session lengths.
- `retry: 1` — one silent retry for network blips, surface the second failure to the user.
- `refetchOnWindowFocus: false` — tenant portal is not a real-time surface (no incoming notifications drive refetch); window-focus refetching is unnecessary chatter, especially on mobile where it fires on every app-resume.
- `refetchOnReconnect: true` — if the user loses network mid-wizard and recovers, get fresh state.

**Rationale:**

- **Wizard cannot reasonably ship without it.** The optimistic-update + rollback semantics on PATCH (so a slow network doesn't freeze the UI between keystroke and save-confirmation) are TanStack Query's bread and butter; building them by hand for 8+ wizard fields is a recipe for inconsistency.
- **Consistency across the codebase.** A project that uses TanStack for the wizard but native fetch for everything else is harder to reason about than one that picks one pattern and follows it. `useTenantType` migration is cheap (the hook signature stays identical from the consumer's perspective) and prevents the divergence.
- **Devtools are a real productivity win.** Cache inspection, mutation state, refetch triggers — visible in a dev-only panel that doesn't ship to prod. Worth the dev dep.
- **Server state vs client state separation.** TanStack handles server state; component state (form values, modal open/closed) stays in react-hook-form / local React state. Zustand stays out of the wizard entirely (the locked tech stack at §1.2 mentions Zustand for UI state, but the wizard's UI state is local enough to not need a global store).

**Bundle impact:** `@tanstack/react-query` adds ~12 KB gzipped to the client bundle. Acceptable per the Day 15 /review precedent of measuring production bundle output; PR 2's bundle diff is reported in the PR body.

**Consequences:**

- New dep in `apps/web/package.json` — both `@tanstack/react-query` and `@tanstack/react-query-devtools` (the latter as `devDependency`).
- New file `apps/web/src/lib/query-client.ts` exports a singleton `QueryClient` with the defaults above.
- `apps/web/src/app/(tenant)/layout.tsx` wraps children in `<QueryClientProvider client={queryClient}>` + conditionally renders `<ReactQueryDevtools>` when `process.env.NODE_ENV === 'development'`.
- `useTenantType` rewrites to `useQuery({ queryKey: ['tenant', 'me'], queryFn: ... })`; consumers see the same return shape (`{ type, isLoading, error, refetch }`). New `useInvalidateTenantType()` calls `queryClient.invalidateQueries({ queryKey: ['tenant', 'me'] })`.
- Existing Item 11 tests for `useTenantType` continue to pass; the test rewrite is mechanical (TanStack Query's test utilities + a fresh QueryClient per test). New test added: invalidation hook actually invalidates.
- Tenant portal's existing pages don't need to change; the QueryClientProvider is added at the route-group level so all `(tenant)/*` routes inherit it without per-page wiring.

**Query keys convention (locked Day 16):**

- `['tenant', 'me']` — current tenant context (type, name, slug, etc.).
- `['kyc', 'drafts', 'list']` — list of all draft submissions for the current tenant (probably empty for MVP — one draft at a time — but the list shape is the right abstraction).
- `['kyc', 'drafts', submissionId]` — a specific draft submission row.
- Future: `['kyc', 'submissions', 'list']` for the submitted/under_review/approved/rejected rows; `['kyc', 'submissions', submissionId]` for a specific finalised submission.

This nested-array convention matches TanStack's official recommendation for cache invalidation hierarchies. `invalidateQueries({ queryKey: ['kyc'] })` would invalidate all KYC-related queries; `invalidateQueries({ queryKey: ['kyc', 'drafts'] })` only draft-related; etc.

**Cross-references:**

- 2026-05-18 "KYC wizard uses server-side drafts" — TanStack Query's `useMutation` powers the PATCH-on-blur draft persistence with optimistic update + rollback on failure.
- 2026-05-18 "Per-tier KYC schemas are discriminated unions" — TanStack Query carries the typed response shape from the per-tier schema's TS type inference.
- §1.2 (CLAUDE.md) — "TanStack Query" was always the planned server-state library; this entry codifies the timing.

**Path back if TanStack Query causes problems:** Unlikely (the library is mature, widely-used, and the project already specced it in §1.2). If a future surface needs different defaults (e.g. real-time check-in scanner refreshing every 2s), it gets a query-key-scoped override via the query's options — not a different library.

---

## 2026-05-18 · Tenant account_type is set-once for MVP — change requires support intervention

**Context:** Sprint 2 Day 15 Item 11 introduces the post-login Account-Type modal in the tenant portal (`§1.6`: "Account type chosen on first dashboard load via a friendly modal, not at sign-up"). Once a user picks Individual or Organisation, the rest of the tenant portal unblocks — the KYC wizard variant (Item 12, Days 16-17) renders different required fields per type, the reviewer queue (Item 13, Day 18) surfaces different document checklists, and downstream defaults (fee handling per §14, subdomain provisioning per §2.4, KYC tier eligibility per §13.3) all branch on the type field. The choice is structurally load-bearing; the question is whether tenants should be able to change it themselves.

**Decision:** For MVP, `tenants.type` is **set-once**. Once set, it cannot be changed via tenant UI or tenant API. Changing type after first selection requires support intervention via super admin UI (lands in Phase 2 sprint that includes a 'change tenant type' action with the cascading KYC resubmission + fee re-pin + subdomain re-provision logic).

**Rationale:**

- Changing type after KYC submission would invalidate the wizard variant's required fields. Individual KYC submits NID + photograph + bank statement (+ eTIN at Tier 2); organisation KYC submits trade license + MOA + AOA + authorised signatory NID + BIN. A type change without document change leaves the submission in a structurally inconsistent state that the reviewer queue can't sensibly render.
- The audit_logs diff semantics break clean. `{type: {from: 'individual', to: 'organisation'}}` records the intent fine, but the downstream cascade (KYC re-review trigger, `tenant_fee_config` re-pin per `§14`, tenant subdomain re-provision if branded under `§12`) is complex rollback logic the MVP doesn't yet have the infrastructure to model.
- MVP volume (sub-50 submissions/week through Phase 1, per the Porichoy + Item 10 deferrals) doesn't justify the complexity — most users pick correctly on first encounter; the rest are a support escalation, not a product feature.
- Per-tenant fee config in `tenant_fee_config` was set at tenant creation and is type-correlated (the pass-through default applies regardless, but future per-type overrides surface). Switching type doesn't re-pin the fee. Inconsistency surface widens with each derived setting.

**Consequences:**

- `POST /api/v1/tenant/account-type` returns 409 `TENANT_TYPE_ALREADY_SET` on any attempt to change after first set. Idempotent same-type calls return 200 (no audit duplicate). Only type-change attempts trip the 409.
- Tenant UI: once the modal is dismissed (= type chosen), there's no "change account type" affordance anywhere in the tenant portal. Settings page omits the field entirely; profile edit forms don't surface it.
- Support escalation path: tenant emails support → super admin manually updates `tenants.type` via the (Phase 2) super admin UI + triggers KYC resubmission flow + notifies tenant of the change with rationale.
- Audit trail: every tenant-side type-set writes one `audit_logs` row via `writeTenantTypeSet` (`actor_role='tenant_user'`). Phase 2 super-admin type-change writes a separate audit row with `actor_role='super_admin'` so the forensics trail unambiguously identifies who flipped the bit.

**Cross-references:**

- 2026-05-17 "audit_logs scope at Item 9 — KYC transitions only; auth events + S3 issuance backfill deferred" — same operational pattern (ship the minimum at Item N, queue the related-but-not-strictly-needed work for a dedicated PR rather than expanding scope).
- §13.4 KYC graduation flow (CLAUDE.md) — KYC revocation auto-unpublishes paid events; similar forward-revocation pattern rather than tenant-side rollback.

**Path back to tenant-controllable type change:** Phase 2 sprint adds a super admin "change tenant type" action with KYC resubmission flow, surfaced as a support-triggered workflow rather than a self-service tenant action. If MVP traffic shows > 5 tenants/month requesting type changes, a Phase 3 self-service option with the explicit rollback complexity becomes worth the implementation cost.

---

## 2026-05-17 · audit_logs scope at Item 9 — KYC transitions only; auth events + S3 issuance backfill deferred

**Context:** Sprint 2 Day 14 Item 9 is the first feature to write to `audit_logs` (§9.10). Items 5/7+8 didn't create the table because they didn't need auditable state transitions. During the Day 14 plan review, Moshiur surfaced the question explicitly: is the choice to scope `audit_logs` writes to KYC transitions only — and NOT backfill auth events from Day 11 (sign-in success/fail, sign-out, magic-link issued/consumed, OAuth link created) or S3 signed URL issuance from Day 13 (`getKycUploadUrl` calls) — a deliberate decision or an unnoticed gap?

**Answer:** unnoticed gap. The Item 9 plan scoped `audit_logs` writes to "what Item 9 needs"; auth events and S3 issuance are classic targets for a payment platform's audit trail and should also write rows. Backfilling them is cheap before production data hits the table and expensive after.

**Decision:**

- **Item 9 ships as-planned**: `audit_logs` writes scoped to KYC state transitions only. No scope expansion into Day 14 (that would be scope creep on a single-day item).
- **S3 signed URL issuance backfill** → **Sprint 2 closeout** (v0.2.0-sprint-2 bundle). Single helper call added inside `getKycUploadUrl()` in `apps/api/src/infra/s3/client.ts`. KYC-scoped, so it lands as a natural extension of Items 6+7+8 KYC work. Audit row shape: `actor_type='tenant_user'`, `action='kyc.upload_url_issued'`, `entity_type='kyc_submission'`, `entity_id=submissionId`, `metadata={documentType, contentType, expiresIn}`. No PII in the row (per §1.3 R5).
- **Auth events backfill** (sign-in success/fail, sign-out, magic-link issued/consumed, OAuth link created) → **Sprint 3 dedicated PR**, paired with the session-revocation fix from `progress.md` Sprint 2 closeout candidates list. Both are auth-hardening work; joint /review is cheaper than two separate ones. Some rows will have nullable `tenant_id` (sign-in occurs before context-switch); migration 0005's RLS policy already accommodates the nullable-tenant_id case via the BYPASSRLS write path (system-action audit rows are written under `withSuperAdmin`, never under tenant context).
- Both backfills land before any production data hits `audit_logs` — first paid tenant onboards no earlier than Sprint 4 — so no retroactive-write concern.

**Cross-references:**

- `apps/api/src/services/audit/kyc.ts` — first writer; defines the helper pattern subsequent backfill writers will mirror (one helper per entity, atomic inside the caller's transaction, deterministic shape per §9.10).
- 2026-05-17 "Sprint 2 Item 10 scope amendment" — same operational pattern of "ship the minimum at Item N, queue the related-but-not-strictly-needed work for a dedicated PR rather than expanding scope".
- `.claude/memory/progress.md` Sprint 2 closeout candidates list — gains the S3 issuance backfill bullet; session-revocation bullet picks up the auth-events backfill cross-reference for Sprint 3.

**Consequences:**

- **Day 14 PR stays focused.** /review didn't have to wade through three sets of audit writers in one PR; the KYC transition writer is the only auditable code path under review. Future per-entity audit writers (S3 issuance, auth events, fee changes, payouts) ship as small per-domain PRs that mirror the `services/audit/kyc.ts` shape.
- **One-helper-per-domain pattern** stays consistent. We do NOT introduce a generic `writeAudit()` god-helper that takes all the §9.10 fields as freeform parameters — that loses the per-domain type safety that `writeKycTransition()` provides (e.g. `fromState: KycSubmissionStatus | null`, `toState: KycSubmissionStatus` are typed; a generic helper would accept any strings).
- **Sprint 2 closeout PR shape** (v0.2.0-sprint-2 bundle) now includes:
  - S3 signed URL issuance audit backfill (single helper call in `getKycUploadUrl`)
  - CLAUDE.md §17 OIDC pattern codification (queued Day 13)
  - CLAUDE.md §13.0 + §13.3 update for `draft` state + manual-review language (queued Day 14 morning)
  - Reviewer S4 (KMS key-admin role) + S6 (Glacier_IR vs STANDARD-90d) from Day 12 reviewer
  - audit_logs unset-GUC smoke test (from Day 14 code-reviewer finding #1)
- **Sprint 3 PR shape** for the auth-hardening bundle:
  - Session revocation fix in `apps/api/src/auth/middleware.ts` `extractAndVerify` (existing closeout candidate)
  - Auth events audit backfill — sign-in, sign-out, magic-link issuance + consumption, OAuth link creation. Some rows tenant-scoped, others user-scoped or system-action; the writer per-event-type chooses the right execution context.

**Path-back if either backfill drifts further:** if S3 issuance hasn't landed by end of Sprint 2, this entry becomes a §29 Open Decision asking whether the audit trail's incompleteness is acceptable for the first paying tenant or whether the closeout is gated on backfill completion. Same shape for auth events at Sprint 3 closeout.

**Reaffirmed 2026-05-18 (Day 15 Item 11):** Audit helpers are one-per-domain (`writeKycTransition`, `writeTenantTypeSet`, etc.), **not** a single generic `writeAudit()`. Each helper carries domain-specific TypeScript types on its diff and metadata shapes; a generic helper would lose this type safety. New audit domains create new sibling helpers in `apps/api/src/services/audit/<domain>.ts`. Established Day 14 (Item 9), reaffirmed Day 15 (Item 11) when the tenant-type-set audit writer landed as a sibling rather than a parameterised generic.

---

## 2026-05-17 · Sprint 2 Item 10 scope amendment — third-party verification deferred to manual review

**Superseded by:** 2026-05-19 "Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)". This entry remains for archaeology — it was the second of three per-item deferrals that the platform-wide policy generalises. Specific consequences below (eTIN regex deferred, BFIU matcher deferred, `flags` column deferred, Item 10 residual absorbs into Item 13) all remain accurate; the difference is that they are now policy-driven rather than per-item.

**Context:** Sprint 2's original Item 10 (Day 14, alongside Item 9) shipped two automated local validators inside the submit endpoint: an eTIN format regex and a BFIU sanctions-list matcher (against `infra/compliance/sanctions.json` seeded from BFIU's public notice — Checkpoint #5 in the Sprint 2 kick-off). At Day 14 kick-off, after Day 13's KYC pipeline foundations landed and verified end-to-end (PRs #66, #67, #68), Moshiur reduced Item 10's scope materially — the same operational pattern as the Porichoy deferral two days earlier. Two automated validators that occasionally reject valid eTINs or miss real sanctions are worse than no validator at all (false confidence). MVP submission volume is sub-50/week through Phase 1, the reviewer is already looking at every submission anyway, and binding the system to a specific regex / sanctions-source algorithm at this stage commits us to maintenance cost without a corresponding fraud-prevention payoff.

**Decision:** Item 10's automated validation work is **deferred to Phase 2**. For MVP, eTIN and NID number are captured as plain data fields on the submission (already supported by the loose `kyc_submissions.fields jsonb` column from Items 7+8), surfaced clearly in the reviewer queue UI (Item 13, Day 18), and validated manually by the reviewer against whatever sources they hold operationally.

- **eTIN format check: deferred.** No regex enforcement in the submit endpoint. No `apps/api/src/domain/kyc/validators/etin.ts`. No automated rejection at submit-time. Reviewer compares submitted eTIN against the uploaded eTIN certificate by eye.
- **BFIU sanctions matching: deferred.** No `infra/compliance/sanctions.json` pre-staging required. No matcher code. No automated flag-on-hit at submit-time. Reviewer screens against whatever BFIU sources they hold operationally (BFIU public notice PDFs, EPS-provided lists, ad-hoc news searches).
- **No `kyc_submissions.flags jsonb` column in Sprint 2.** The flag artefacts only make sense alongside automated validators that emit them; until validators land, no flag column ships. When Phase 2 introduces both, one migration adds the column at the same time.
- **Day 14 scope reduces to Item 9 only** — submission state machine + `POST /tenant/kyc/submissions` + audit trail + notification firing scaffolding. Cleaner deliverable, smaller blast radius.
- **Item 10 residual absorbs into Item 13 (Day 18)** — surface eTIN + NID number already captured in `fields` jsonb clearly in the reviewer queue UI, alongside the manual NID image review affordance from the Porichoy deferral. Item 13's day-budget unchanged; the work is presentational not algorithmic.
- **CLAUDE.md §13.0 status block update** queued for the Sprint 2 closeout v2.3 playbook bump bundle — current §13.0 still mentions "eTIN format check: local regex (no external call)" and "BFIU sanctions screening: manual list-check against `infra/compliance/sanctions.json` (seeded from BFIU's public sanctions notice, manual monthly refresh)". Update to align with the manual-review-for-MVP reality alongside the existing Porichoy deferral language. Not blocking Day 14.

**Supersedes / replaces:**

- Sprint 2 Day 14 Item 10 scope from the kick-off plan (eTIN regex + BFIU sanctions matcher in the submit endpoint).
- **Checkpoint #5 from Sprint 2 kick-off** ("`infra/compliance/sanctions.json` MUST be pre-staged by Moshiur from the BFIU public notice before Item 10 begins; if absent at Day 14 `/start`, STOP and surface; do NOT invent a sanctions list from web search"). This checkpoint is **dissolved** — sanctions.json is no longer in Sprint 2 scope at all, so the pre-staging requirement has nothing to gate. Future revival of automated sanctions matching reopens the checkpoint shape under whatever sanctions-source decision the Phase 2 PR makes.

**Cross-references:**

- 2026-05-17 "Porichoy deferred — manual NID review for MVP" — same operational pattern, same rationale (sub-50-submissions/day envelope, manual review already happening, false-confidence risk of half-built automation).
- 2026-05-17 "Sprint 2 kick-off — scope, human-checkpoints, and Porichoy deferral" — the kick-off document that introduced Checkpoint #5 (now dissolved by this amendment).
- 2026-05-17 "KYC reviewer role for MVP — super-admin-only" — defines who does the manual eTIN/sanctions review.

**Consequences:**

- **Day 14 simplified.** One PR landing the state machine, the submit endpoint, the audit trail, and notification stubs. No regex code, no sanctions JSON file, no validator tests, no `flags` column migration. The /review pass focuses on RLS + audit-write completeness + state-machine correctness without the cognitive load of validator algorithm review.
- **Reviewer workload at MVP scale: unchanged.** Same ~10 minutes/submission × ~48 submissions/day per reviewer × 1 super-admin reviewer = ~48/day cap that the Porichoy deferral already accepted. Manual eTIN + sanctions review fits inside this envelope; we'd already committed to the cap. If volume exceeds ~30/day sustained, that's the existing Phase 2 trigger for both Porichoy and validator automation — likely landed together as a single "KYC automation pass" PR.
- **Audit-trail intact.** `kyc_submissions.fields` jsonb already captures eTIN + NID number from Items 7+8; reviewer queue UI (Item 13) surfaces them. When automated validation lands in Phase 2, validators read the same `fields` column and write a new `flags` column — no schema migration to the data they validate, only addition of the flag artefacts. Historical manual submissions remain `flags=null`, audit-trail clear.
- **Path back to automation (Phase 2, single PR shape):** (a) one migration adds `kyc_submissions.flags jsonb default '{}'::jsonb`; (b) `validators/etin.ts` (regex) + `validators/sanctions.ts` (matcher against whatever sanctions source is operational); (c) wire into submit endpoint via **non-blocking advisory flag pattern** — validators flag for reviewer attention, reviewer still makes the final call (never auto-reject); (d) reviewer queue UI surfaces flag chips alongside the existing eTIN/NID display from Item 13. No business-logic refactor needed.
- **§29 trigger if scope-reduction holds past Phase 2:** if eTIN/sanctions automation is still not implemented at Phase 3 kick-off (≈Sprint 13), file a §29 Open Decision asking whether the manual-review pattern is acceptable in perpetuity or whether at-scale automation must land before Phase 4 marketplace volume.

---

## 2026-05-17 · Canonical GitHub Actions → AWS OIDC trust pattern (project standard)

**Context:** Sprint 2 Day 13's first auto-deploy surfaced two gaps in the original Sprint 1 Day 9-10 OIDC plumbing: (a) the AWS-side OIDC provider + assumable role were never actually created — `AWS_OIDC_ROLE_STAGING` was a placeholder secret; (b) the trust shape needed three independent checks to enforce "only `deploy-staging.yml` running from `main` with the staging environment can assume the role." This entry establishes the trust-pattern as the project standard so future deploy roles (prod, future per-env workers, future per-team roles) all conform — and so a single canonical reference exists when a §17 playbook bump captures it.

**Decision:**

All GitHub Actions → AWS role-assumption trust policies in this project follow the **three-claim shape**:

1. `token.actions.githubusercontent.com:aud = sts.amazonaws.com`
2. `token.actions.githubusercontent.com:sub = repo:OWNER/REPO:environment:ENV_NAME`
3. `token.actions.githubusercontent.com:job_workflow_ref = OWNER/REPO/.github/workflows/WORKFLOW_FILE@refs/heads/BRANCH`

All three use `StringEquals` (never `StringLike`, never `StringEqualsIfExists`, never wildcards). Each claim narrows a different dimension:

- `aud` defends against accidental cross-audience token reuse.
- `sub = environment:NAME` pins to a specific GitHub deployment environment in this repo. Environment-format is **mandatory** when the workflow uses `environment:` — GitHub overrides the ref-format `sub` to the environment-format when an environment is declared. See `gotchas.md` "GitHub Environments override the OIDC sub claim".
- `job_workflow_ref` pins to the specific workflow file + branch combination. A malicious PR that copies the workflow file under a different name, or a new workflow declaring the same environment, fails this check cleanly. This is the compensating guardrail that recovers the "only main can deploy" intent when the environment-format `sub` doesn't directly carry branch information.

**Inline policy convention for SSM-based deploys:** the resource list for `ssm:SendCommand` includes BOTH `arn:aws:ec2:REGION:ACCOUNT:instance/i-X` AND `arn:aws:ssm:REGION:ACCOUNT:managed-instance/i-X` ARN forms for the same instance, because AWS evaluates SSM agent-routed instances against the managed-instance ARN form (the EC2 ARN form alone fails the IAM check). See `gotchas.md` "SSM agent-routed instances require both ARN forms".

**Consequences:**

- First application: `eventpulse-deploy-staging` (Sprint 2 Day 13, role ARN `arn:aws:iam::739275468267:role/eventpulse-deploy/eventpulse-deploy-staging`). Verified end-to-end via workflow_dispatch run [25988575225](https://github.com/publicpulseagency/EventPulse/actions/runs/25988575225) — all 10 steps green, EC2-side `deploy.sh` returned exit 0.
- Next application: `eventpulse-deploy-prod` (Sprint 4) follows this exact pattern with `environment:production` and `deploy-prod.yml@refs/heads/prod`. No code review needed beyond confirming the three-claim shape; that's the whole point of the pattern.
- All future per-environment / per-service deploy roles (Phase 3+ — e.g. payouts worker, KYC reviewer assist agent) inherit the same shape. PRs that introduce a new GitHub-OIDC trust policy diverging from this shape (e.g. using `StringLike`, wildcards, ref-format `sub` while the workflow declares an environment, single-ARN-form SSM resource lists) are rejected during `/review`.
- **Codification carry — Sprint 2 closeout (v2.3 CLAUDE.md bump):** add this canonical pattern to §17 of the playbook so it's authoritative beyond the memory file. Annotation logged in `progress.md` Sprint 2 closeout candidates.
- **Cross-reference to GitHub Pro upgrade carry:** once the account upgrades to Pro, configure GitHub Environments → `staging` → deployment branch policy = `main` only. That tightens the protection at the GitHub layer, making `job_workflow_ref` belt-and-braces rather than the primary "only main can deploy" enforcement. Same applies to `prod` env at Sprint 4 with the `prod` branch policy.
- The four debugging lessons that earned this pattern are individually documented in `gotchas.md` (StringNotEquals-IfExists trap is separate, from Day 12 KYC bucket). Future engineers debugging an OIDC trust failure grep one symptom and land directly on the relevant entry; they don't need to read all four sequentially.

**Supersedes / replaces:** what would have been a "Sprint 2 Day 13 carry — GitHub OIDC provider + deploy role created" entry. The carry is rolled into this canonical-pattern statement; the closeout cross-references are preserved above.

---

## 2026-05-17 · Checkpoint #2 confirmed — KYC bucket KMS strategy: dedicated CMK for blast-radius isolation

**Context:** Sprint 2 Day 12 Item 6 creates the staging S3 bucket holding KYC documents (NID images, eTIN certs, bank/MFS evidence). Per the Sprint 2 plan, Checkpoint #2 requires explicit confirmation before any AWS write. Moshiur pre-staged the answer at Day 12 kick-off. This entry locks the answer so the Item 6 PR doesn't re-litigate it.

**Decision:**

- Dedicated `alias/eventpulse-kyc-staging` CMK in `ap-southeast-1` — **NOT** reusing the general `alias/eventpulse-staging` CMK. Per §17.9 per-purpose KMS pattern (same pattern that already separates SSM session logs from EBS).
- Bucket: `eventpulse-kyc-staging`, region `ap-southeast-1`.
- BlockPublicAccess: all four flags enabled. Versioning on. BucketOwnerEnforced.
- Default encryption: SSE-KMS with the dedicated CMK; `BucketKeyEnabled=true` to cap KMS request cost.
- Bucket policy: deny non-TLS (`aws:SecureTransport=false`); deny PUT without `x-amz-server-side-encryption=aws:kms`; deny PUT with any KMS key ID other than the dedicated CMK.
- Prefix structure: `tenants/{tenant_id}/kyc/{submission_id}/{document_type}.{ext}`.
- 5-year retention per BFIU §15.1 — enforced at the app layer (no DELETE call before 5 years) plus the bucket has **no** expiration lifecycle rule on `tenants/*/kyc/*`. Legal-hold capability via Object Lock is **deferred to Phase 2** — staging uses versioning + IAM-deny-delete instead.
- Storage class lifecycle: STANDARD → GLACIER_IR at 30 days (the Checkpoint text says "Glacier transition at 30 days"; GLACIER_IR chosen over GLACIER_DEEP because BFIU/reviewer access patterns may need same-day retrieval during disputes).
- IAM: scoped policy on existing `eventpulse-staging-ec2` role granting `s3:PutObject/GetObject/DeleteObject/ListBucket` ONLY on `arn:aws:s3:::eventpulse-kyc-staging` + `arn:aws:s3:::eventpulse-kyc-staging/tenants/*` (prefix-shape only, never bucket-wide for write); `kms:Encrypt/Decrypt/GenerateDataKey/DescribeKey` ONLY on the dedicated CMK ARN.
- Secrets Manager: bucket name + KMS key ID/ARN land in `eventpulse/staging/kyc` so app reads them at boot via the same bootstrap pipeline as JWT secrets.
- Codification: bucket + CMK creation logic added to `infra/scripts/bootstrap-staging.sh` so a fresh-EC2 bootstrap (or future prod cutover with `-prod` suffix) is one command.

**Consequences:**

- KYC bucket compromise scope is bounded: a key compromise affects KYC documents only, not the EBS volume / SSM session logs / CloudWatch Logs group / Postgres backups. Establishes the per-purpose CMK pattern that planned analogues `alias/eventpulse-payouts-<env>` (Sprint 7+) and `alias/eventpulse-contracts-<env>` (Phase 3) will follow.
- Cost: ~$1/mo per CMK + S3 storage proportional to KYC doc volume (single-digit dollars at MVP scale). Comfortably inside the $40/mo `eventpulse-monthly` AWS Budget.
- Rotation: KMS auto-rotation enabled (default 365-day cycle). KMS handles re-encryption transparently.
- KYC documents that move to Glacier_IR at 30 days incur a small retrieval cost when a reviewer needs to inspect them post-30-days; this is an acceptable trade-off for the long-tail nature of KYC re-review (BFIU/audit access at year 2+).
- The dedicated-CMK pattern is now load-bearing: future KYC code must use the CMK ARN from Secrets Manager, never the general CMK. Code review enforces this.
- Object Lock deferral: revisit in Phase 2 alongside the legal-hold workflow for disputed events; staging's versioning + IAM-deny-delete is adequate for MVP but is **not** WORM compliance.
- `eventpulse-staging-ec2` role gains exactly two scoped statements; no broader S3/KMS permissions. Verify with `aws iam get-role-policy` post-grant — the principle of least privilege is the whole point of the dedicated CMK pattern.
- Prod cutover (Sprint 7+ or Phase 3, when prod EC2 lands) re-runs the same script with `prod` suffix and gets `alias/eventpulse-kyc-prod` + `eventpulse-kyc-prod` bucket. No code duplication; the bootstrap script is environment-parameterised.

---

## 2026-05-17 · Sprint 2 Item 5 — first real staging deploy succeeded (after 8 attempts + 5 fix PRs)

**Context:** Item 5 was the first time `deploy.sh` ran against a built artefact on staging. Eight deploy attempts surfaced layered issues — each fix unblocked the next failure mode. All resolved; tag `4265b5a` through `58c96f6` plus operational fixes via SSM. The real Next.js + Hono apps now serve on all 5 staging vhosts; migration 0003 applied; 11 identity tables live; both PM2 processes online.

**Decision:** The staging deploy pipeline shape is now locked. Future deploys against this EC2 are one-shot via `aws ssm send-command ... deploy.sh main`. The eight-attempt walk-through is documented in gotchas.md so a fresh-EC2 bootstrap doesn't re-traverse the same path.

**Fix PRs landed (in order, all merged):**

- PR #58 — staging bootstrap + Nginx proxy_pass + env-sourcing deploy.sh (Item 5 prep)
- PR #59 — `HUSKY=0` + `--prod=false` on install (first fix attempt; --prod=false didn't engage)
- PR #60 — `NPM_CONFIG_PRODUCTION=false` + `--config.confirm-modules-purge=false` (second fix; the env var also didn't engage but the purge auto-confirm did help unstick the install)
- PR #61 — `NODE_ENV=development` for the install command (the actual fix — only knob in pnpm v9 that works)
- PR #62 — `apps/api/tsconfig.build.json` adds explicit `declarationMap: false` (caught by tsc on first build)

**Operational one-time fixes on the EC2 (NOT yet codified into bootstrap-staging.sh):**

- Pre-created `eventpulse_app` + `eventpulse_admin` Postgres roles as the `postgres` superuser
- `GRANT eventpulse_app TO eventpulse WITH ADMIN OPTION` (and same for eventpulse_admin) — so migration 0001's `GRANT ... TO CURRENT_USER` succeeds
- Granted USAGE + SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER on all public tables + sequences + functions to both roles, plus ALTER DEFAULT PRIVILEGES for the same
- Backfilled `_eventpulse_schema_migrations` with `0001_identity_tables.sql` + `0002_identity_rls_policies.sql` because the tables already existed from a manual setup but the runner had no record of them
- `ALTER TABLE ... OWNER TO eventpulse` for every public-schema table (was `postgres`-owned from manual setup), so `CREATE POLICY` in 0003 worked
- Added IAM Secrets Manager write perms to `eventpulse-staging-ec2` role: `SecretsManagerStagingCreate` + `SecretsManagerStagingPut` (for bootstrap to write JWT secrets directly to Secrets Manager)

**Final verified state (post-deploy):**

```text
✓ staging.eventpulse.com.bd            HTTPS 200 (Next.js root)
✓ app.staging.eventpulse.com.bd        HTTPS 200 (Next.js root)
✓ admin.staging.eventpulse.com.bd      HTTPS 200 (Next.js root)
✓ my.staging.eventpulse.com.bd         HTTPS 200 (Next.js root)
✓ api.staging.eventpulse.com.bd        HTTPS 200 (Nginx /health), 404 on / (Hono has no / route — correct)
✓ Next.js /sign-in serves "<title>Sign in · Event Pulse</title>" + "Continue with Apple/Google" buttons — proves real app, not placeholder
✓ Hono /api/v1/* routes reachable via api.staging.eventpulse.com.bd
✓ pm2 list: web online (pid 14976), api online (pid 14977)
✓ pm2 startup systemd unit installed; pm2 save persisted process list
✓ Migration history: 0001/0002 marked applied, 0003 applied by runner
✓ Secrets Manager: eventpulse/staging/jwt-{access,refresh}-secret both present, tagged managed-by=bootstrap-staging.sh
✓ AWS Budget eventpulse-monthly still at $40/mo, current spend well under
```

**Consequences:**

- The MVP staging deploy loop works end-to-end. CI workflow `deploy-staging.yml` can be enabled (`STAGING_DEPLOY_ENABLED=true`) once we've watched 2-3 manual deploy cycles for stability.
- Future deploys against THIS EC2 are simple: one SSM SendCommand against `deploy.sh main`. The operational fixes above persist in the EC2's Postgres state — no re-application needed.
- A FRESH EC2 bootstrap (replacement instance, or prod cutover) would re-traverse the operational fixes. Sprint 2 Day 12 housekeeping candidate: extend `bootstrap-staging.sh` to handle the Postgres role/grant/ownership setup so fresh-EC2 bootstrap is one command.
- The 7 new gotchas logged in this session (SSM commands-array shell-per-entry, pnpm v9 NODE_ENV trap, modules-purge prompt, TS declarationMap inheritance, Postgres ownership for CREATE POLICY, ADMIN OPTION for GRANT, migration-history backfill) collectively form the cookbook for the next environment bring-up.
- CI does NOT currently run `pnpm --filter @eventpulse/api build` (only typecheck against tsconfig.json). Day 12 candidate: add a "build" job to the CI matrix so production-build-only issues like the declarationMap one are caught pre-deploy.
- Manual OAuth happy-path verification (Sprint 2 Day 20 closeout punch-list) can now proceed against staging once OAuth credentials are added to .env.staging.

**Carries to Sprint 2 Day 12:**

- Codify the Postgres role/grant/ownership setup into `bootstrap-staging.sh` (operational fixes above → code path for fresh-EC2)
- Add `build` job to CI matrix (catches tsconfig.build.json issues pre-deploy)
- Enable `STAGING_DEPLOY_ENABLED=true` as a repo variable so push-to-main triggers `deploy-staging.yml` automatically (after 1-2 more manual cycles to validate)

---

## 2026-05-17 · OAuth callback security model (Sprint 2 Item 4)

**Context:** Sprint 1 Day 7-8 (PR #47) landed the `arctic` Google + Apple clients as lazy constructors but no route handlers — the actual `/oauth/<provider>/{start,callback}` surface carried to Sprint 2 Item 4. Before code landed, Moshiur pre-flagged three security concerns to address: (a) state cookie integrity (HMAC + TTL + single-use) to close the most common OAuth account-takeover vector — attacker forging a callback to link their OAuth identity to someone else's account; (b) code-replay resistance + PKCE; (c) Apple email-relay quirk (relay addresses can be rotated by Apple and must NEVER be used for auto-link). This entry locks the answers as the canonical security model so Item 4 (and future OAuth provider additions) extend a consistent design instead of relitigating each surface.

**Decision:** The full OAuth callback security chain:

**State cookie — `apps/api/src/auth/oauth-state.ts`:**

- HMAC-SHA256 signed using a key DERIVED from `JWT_ACCESS_SECRET` via the domain-separation tag `oauth-state-v1`. Result: a leak of one secret doesn't compromise the other; no new env var to provision/rotate.
- Payload: `{ state, codeVerifier, provider, exp }`. `codeVerifier` (PKCE) ships inside the signed cookie so it survives the redirect round-trip without server-side storage. `provider` field is defence-in-depth: cookie minted for Google won't verify against the Apple callback even if delivered there.
- TTL: 10 minutes (well over a normal OAuth round-trip; tight enough to bound replay window).
- Cookie attributes: `HttpOnly` + `SameSite=Lax` + `Path=/` + `Max-Age=600`. `Secure` flag added only when `NODE_ENV=production` (drops in local dev where HTTPS isn't available).
- Provider-specific cookie names (`oauth_state_google`, `oauth_state_apple`) so two parallel OAuth flows from the same browser don't collide.
- Single-use: callback handler clears the cookie via `Set-Cookie ...; Max-Age=0` **before** any DB write. Replay would require recovering both the cookie AND a fresh IdP code in the 10-minute window — IdP codes are single-use server-side.
- `__Host-` prefix considered, deferred to Phase 2: requires `Secure` always-on which collides with HTTP local dev. Marginal hardening; not worth the env-juggling for MVP.

**PKCE:**

- **Google: ON.** `arctic.generateCodeVerifier()` + `Google.createAuthorizationURL(state, codeVerifier, scopes)`. PKCE-S256 by default in arctic v3.
- **Apple: NOT APPLICABLE.** Apple Sign-In uses a JWT-based `client_secret` minted from the team's private key per call; `Apple.createAuthorizationURL(state, scopes)` signature explicitly does not accept a `codeVerifier`. Apple's request-signature model is the verifier-of-record there.

**ID token verification — `verifyGoogleIdToken` / `verifyAppleIdToken` in `apps/api/src/auth/oauth.ts`:**

- Always via `jose.jwtVerify` against the live JWKS (`createRemoteJWKSet` for Google's `https://www.googleapis.com/oauth2/v3/certs` and Apple's `https://appleid.apple.com/auth/keys`). JWKS is fetched and cached by `jose` on first use.
- Issuer + audience enforced: Google `iss ∈ {accounts.google.com, https://accounts.google.com}`, audience = our client ID. Apple `iss = https://appleid.apple.com`, audience = our Services ID.
- `decodeIdToken` (no verification) is NEVER trusted in this codebase. The presence of an `arctic.decodeIdToken` export is a foot-gun; we use `jose.jwtVerify` exclusively.
- Email normalised to lowercase before any DB comparison.

**Auto-link decision — `decideAutoLink` pure function in `oauth.ts`:**

Match order on every successful callback:

1. **Primary:** look up `oauth_identities` by `(provider, provider_user_id)`. For Apple this is the ONLY stable identifier Apple guarantees; for Google it's the fast path on repeat sign-ins.
2. **Secondary (auto-link):** if no primary match AND IdP says `email_verified=true` AND `is_private_email !== true` (Google: always; Apple: only when user shared their real email) → look up `users` by email; if found, link.
3. **Tertiary:** create a new user with whatever email the IdP provided (including Apple relay addresses for users who chose to hide their real email).

The **`is_private_email` gate** is the load-bearing piece. Without it, Apple could rotate a relay address to a different human; that new human signs in with the same relay later; we auto-link them to the OLD attacker's account → silent account takeover. With the gate, relay addresses always create new accounts; the user gets a settings UI to manually link later if they want (Phase 2 surface).

**Write context:** all auto-link writes happen under `withSuperAdmin` (the user isn't authenticated until the callback completes — `withUser` is impossible to call). The integrity chain that justifies the super-admin write: `HMAC state cookie` → `PKCE round-trip (Google) / JWT client_secret (Apple)` → `signed ID token` → `verified email or stable sub`. Any link breaking → bail to new user or fail closed.

**Response handling:**

- Google callback: `GET` with `code` + `state` query params.
- Apple callback: `POST application/x-www-form-urlencoded` because Apple uses `response_mode=form_post` to deliver the `user` (name) field on first auth. Apple's `user` blob is JSON-encoded `{name: {firstName, lastName}, email}`; captured only on first auth (Apple never sends it again).
- On any failure mode (missing cookie, bad state, expired, IdP error, code-exchange rejection, ID-token verify failure): respond `400` with envelope `{ error: { code: 'OAUTH_CALLBACK_FAILED', message: 'OAuth callback failed; please try signing in again.', _internal_reason: '<detail>' } }`. The `_internal_reason` ends up in logs only; never exposed to the user beyond the generic message. Single-error code from the public surface so probing the failure doesn't leak which gate failed.

**Session cookie set on success:** `eventpulse_session` (existing name used by password/magic-link routes), `HttpOnly` + `Secure` (in prod) + `SameSite=Lax` + `Path=/` + `Max-Age=7 days`. Audience is `attendee` for OAuth-originated sessions; tenant onboarding happens after sign-in.

**Consequences:**

- This is the canonical OAuth security model for Event Pulse. Future provider additions (GitHub for tenant SSO, BTRC eID, etc) follow the same shape: state cookie → ID token verify → auto-link decision → super-admin write.
- The decision matrix in `decideAutoLink` is the only place where "should I link this OAuth identity to an existing user" lives. Future providers extend it; never inline the decision in a route handler.
- ID-token verification via `jose.jwtVerify` + remote JWKS adds a small startup-time JWKS fetch on first OAuth use. Cached automatically. No cold-start mitigation needed.
- `is_private_email`-gated auto-link blocks a very specific Apple takeover vector. If Apple ever changes the relay-rotation policy, the gate stays in place — relay addresses are never linkable on Event Pulse, period.
- `_internal_reason` field in error responses is a logging tag, not a contract. Frontend treats `OAUTH_CALLBACK_FAILED` as a single failure mode; reason field is read only by Sentry / log search.
- Item 4 carry to Sprint 2 closeout: configure OAuth credentials in Secrets Manager (`eventpulse/staging/oauth-google` + `eventpulse/staging/oauth-apple`) and exercise the full happy path manually against the staging EC2 before Sprint 2 wraps.

---

## 2026-05-17 · Sprint 2 plan approved with 5 amendments — see Day 11 kick-off

**Context:** Sprint 2 plan presented after the `/sprint` closeout (Sprint 1 tag `v0.1.0-sprint-1` at `53ae000`, GitHub issue [#52](https://github.com/publicpulseagency/EventPulse/issues/52), closeout PR [#53](https://github.com/publicpulseagency/EventPulse/pull/53) merged at `4c49e1d`). 16 atomic items across Days 11-20 mapped to §26.1 Sprint 2 scope with the Porichoy deferral amendment applied. Moshiur reviewed the plan and approved it with five sharpening amendments + three checkpoint pre-answers that allow the autonomous portions to proceed without round-trips.

**Decision:** Plan approved with the following amendments and pre-answers, locked in as binding for Sprint 2 execution.

**Five amendments to the plan as originally presented:**

1. **Item 1 (v2.2 CLAUDE.md bump) — add a sixth change.** §13 KYC Engine gets a new §13.0 Status block at the top of the section noting Porichoy is deferred per [decisions.md "Porichoy deferred — manual NID review for MVP"](./decisions.md). Prevents future contradictions when readers hit §13's normative text about Porichoy as the primary NID validation source.
2. **Item 3 (RLS migration 0003) — specificity per table.** `sessions` and `oauth_identities` get user-scoped read RLS policies via `app.current_user_id` (enables "sessions on other devices" + "linked accounts" UX). `magic_links` and `handle_history` stay BYPASSRLS-only — these are operational/audit tables, not user-facing surfaces. Rationale documented in the migration comment so future readers see the per-table reasoning.
3. **Item 6 (S3 KYC bucket) — Checkpoint #2 pre-answered.** Create dedicated `alias/eventpulse-kyc-staging` CMK in `ap-southeast-1` (NOT reusing the general `alias/eventpulse-staging` CMK). Per-purpose KMS separation per the §17.9 secrets pattern — blast-radius isolation for highest-PII-sensitivity data. Prefix structure: `tenants/{tenant_id}/kyc/{submission_id}/{document_type}.{ext}`. Bucket region: `ap-southeast-1`. Lifecycle: 5-year retention per BFIU §15.1; Glacier transition at 30 days for cost optimisation.
4. **Item 13 (KYC review queue) — Checkpoint #4 pre-answered.** Super-admin-only for MVP confirmed. `kyc_reviewer` role and multi-reviewer routing deferred to Phase 2 Sprint 6 alongside the team-management UI work. Review queue authorisation gates on `super_admins` membership; no role checks beyond that.
5. **Item 14 (Trust Center placeholders) — content discipline.** v0.1 placeholder content is **skeleton structure only**: real section headings per the Trust Center spec (§20), one-sentence "PLACEHOLDER — to be drafted by counsel covering X" per section. **No AI-generated full-text policy drafts.** Non-dismissable "DRAFT — not yet legally reviewed" banner on every placeholder page. Registration flow blocks consent capture on any required-signature document still at v0.x.

**Three checkpoint pre-answers (durable for the sprint):**

- **Checkpoint #2 (S3 bucket region + prefix + KMS):** answered above (amendment 3).
- **Checkpoint #3 (Trust Center placeholder content policy):** answered above (amendment 5).
- **Checkpoint #4 (KYC reviewer role):** answered above (amendment 4). Logged separately as its own entry below.

**Two checkpoints remaining as gates** (still fire, still require Moshiur's confirmation when the work hits them):

- **Checkpoint #1 (Porichoy procurement status check)** — fires immediately before Item 16 (Day 20). Two paths depending on Moshiur's answer:
  - If unreachable: adapter scaffold only, no live calls; log a gotchas.md entry recording the procurement gap and any communication attempts since this entry.
  - If credentials arrived: scope expands to wire `nidVerify()` + integration tests against a recorded fixture; live calls land in this sprint or hold for next sprint depending on Day 20 timing.
- **Checkpoint #5 (BFIU sanctions list source)** — fires before Item 10 (Day 15). Preliminary answer provided by Moshiur in plan-approval message: seed from BFIU's public sanctions notice (latest available at time of seeding), file at `infra/compliance/sanctions.json` with source URL in header, manual monthly refresh via PR (automated refresh deferred to Phase 2), exact-match flag in submission view (fuzzy matching deferred). Checkpoint still fires to confirm before any matching code runs.

**Execution discipline for Sprint 2:**

- Item 1 (v2.2 CLAUDE.md bump) is Day 11's first PR. After it lands, **pause and show Moshiur the v2.2 diff before Item 2 starts.** He wants to verify the playbook locks accurately reflect Sprint 1 reality before extending the system further.
- `/review` runs before every commit that touches KYC code (PII + §1.3 R4 encrypted-at-rest sensitivity).
- `/end` runs at the end of each working day, not just at sprint closeout.

**Consequences:**

- Day 11 starts immediately with Item 1; no further plan-level approval needed until specific checkpoint moments fire.
- Three of five checkpoints (#2, #3, #4) are answered ahead of time, so the day-of-work for those items can proceed straight through without pausing.
- Two checkpoints (#1, #5) still require explicit ack at the work moment — even with Moshiur's preliminary inputs on #5, the matching-code commit gates on his explicit confirmation.
- The five amendments are durable for Sprint 2; if a Sprint 3 plan ever revisits any of these surfaces (e.g. multi-reviewer routing in Sprint 6), the entry chain shows the original rationale.
- The "skeleton-only Trust Center placeholders, no AI-generated full-text drafts" rule (amendment 5) is **load-bearing for legal-risk posture** — placeholder full-text could be mistaken for legal commitment even with a DRAFT banner. Treat this as an immutable rule for the duration of Sprint 2.

---

## 2026-05-17 · KYC reviewer role for MVP — super-admin-only

**Context:** Sprint 2 Checkpoint #4 required confirmation before building the KYC review queue UI (Item 13). Default proposal in the Sprint 2 kick-off was super-admin-only; alternative was extending to a dedicated `kyc_reviewer` role for delegation. Moshiur confirmed the default ahead of the work.

**Decision:** **Super-admin-only for MVP.** KYC review queue is gated on `super_admins` membership (per §9.1 schema). No `kyc_reviewer` role for Sprint 2.

`kyc_reviewer` role + multi-reviewer routing + per-reviewer SLA + reviewer assignment + reviewer-conflict (assigned-to-different-from-actor) audit all deferred to **Phase 2 Sprint 6**, alongside the team-management UI work where the broader RBAC permissions matrix gets implemented.

**Consequences:**

- KYC review queue (Item 13 of Sprint 2) skips any role-resolution logic — it's a single `requireSuperAdmin` middleware gate.
- All KYC decisions in MVP are made by Moshiur (the only super admin during early days) or whoever holds the super-admin credential at the time. Audit trail captures the actor regardless.
- Volume ceiling: ~10 minutes per manual review (per Porichoy-deferred decision's throughput math) × ~48 submissions/day per reviewer × 1 reviewer = ~48 submissions/day cap. Above that → either accelerate Phase 2 Sprint 6 reviewer-role work, or hire a second super admin (operationally low-risk for a known person, governance-risky for a contractor).
- Phase 2 Sprint 6 trigger for revisiting: > 30 submissions/day sustained, OR before any third party gets KYC-reviewer responsibility, whichever comes first.

---

## 2026-05-17 · Dedicated KMS CMK for KYC bucket — per-purpose blast-radius isolation

**Context:** Sprint 2 Checkpoint #2 required confirmation before creating the S3 KYC bucket. Options: reuse the general `alias/eventpulse-staging` CMK (one key serves all encryption needs), or create a dedicated `alias/eventpulse-kyc-staging` CMK (per-purpose key isolation). The CLAUDE.md §17.9 secrets-manager pattern shows per-purpose separation as the default; KYC documents are the highest-PII-sensitivity data on the platform per §1.3 R4.

**Decision:** **Dedicated `alias/eventpulse-kyc-staging` CMK** in `ap-southeast-1`. Not reusing the general staging CMK.

**Bucket parameters confirmed:**

- Name: `eventpulse-kyc-staging` (MVP) / `eventpulse-kyc-prod` (when prod cuts over)
- Region: `ap-southeast-1` (co-located with EC2 to minimise data transfer)
- Encryption: SSE-KMS with `alias/eventpulse-kyc-staging` CMK (rotation on)
- Public access: BlockPublicAccess: true on bucket + account level
- Bucket policy: deny `s3:PutObject` without `s3:x-amz-server-side-encryption=aws:kms`; deny non-TLS access; deny non-CMK encryption
- Prefix structure: `tenants/{tenant_id}/kyc/{submission_id}/{document_type}.{ext}`
- Lifecycle: 5-year retention per BFIU §15.1 (`tenants/*/kyc/*` glob); Glacier IR transition at 30 days for cost optimisation; permanent deletion only via super-admin tool with audit log (never via lifecycle)
- IAM access: EC2 instance role gets scoped `s3:PutObject` / `s3:GetObject` / `s3:DeleteObject` on `arn:aws:s3:::eventpulse-kyc-staging/*`; KMS `kms:Encrypt` / `kms:Decrypt` / `kms:GenerateDataKey` on the dedicated CMK only
- Versioning: enabled (defence-in-depth against accidental overwrite of KYC evidence)

**Consequences:**

- Blast-radius isolation: a compromise of the general staging CMK does not expose KYC documents. A compromise of the KYC CMK exposes only KYC documents.
- KMS cost: +1 CMK at $1/month for staging, +1 at $1/month when prod cuts. Trivial against the $40/month budget canary.
- Per-purpose pattern reinforced: if a Sprint 3+ surface needs another high-sensitivity data store (payout banking details encrypted-at-rest beyond Postgres RLS, signed contracts as binary blobs, etc), new CMK per surface is the default — never expand an existing CMK's scope.
- Restore drill (§17.10) must include the KYC bucket explicitly going forward; the quarterly restore validates we can decrypt KYC documents from snapshot.

---

## 2026-05-17 · Trust Center v0.1 placeholders — skeleton-only, no AI-generated full text

**Context:** Sprint 2 Checkpoint #3 required confirmation of the placeholder content policy for the 18 Trust Center pages before any seed content lands. Moshiur set the policy ahead of the work moment to prevent any temptation to flesh out placeholders into something that could be mistaken for legal commitment even with a DRAFT banner.

**Decision:** **Skeleton-only placeholders.** Every v0.1 page seeded with:

- Real section headings per the Trust Center spec in §20 (so the editor pipeline and TOC component can be exercised against realistic structure)
- **One sentence per section**: `PLACEHOLDER — to be drafted by counsel covering [topic of this section]`
- Non-dismissable banner at top of every placeholder page: `DRAFT — not yet legally reviewed. This is placeholder text. Do not rely on this document. See [/contact?topic=legal-compliance] for questions.`
- `legal_documents.requires_signature` flag stays at the production value (true for the 6 contracts, false for the 12 trust artefacts) — registration flow checks document version against any required-signature document still at v0.x and blocks consent capture on it. Practically: until lawyer review produces v1.0 of Privacy + Terms + EULA + DPA + Cookies + Refund Policy, tenant onboarding can sign up an account but cannot consent to documents and therefore cannot complete onboarding. KYC submission is gated on consent.

**Explicitly prohibited for v0.1:**

- AI-generated full-text policy drafts (Claude, GPT, Gemini, any model). Even with a DRAFT banner, full-text could be mistaken for legal commitment, accidentally adopted into production, or surface in a court of law as a representation of platform intent.
- Copy-paste from other companies' Trust Centers (TenderPulse, TiCON, anywhere). Same risk profile, plus potential IP issues.
- Fleshing out "good-enough" wording with the intent of "the lawyer will polish it". The risk is the lawyer doesn't polish it, the placeholder gets shipped, and the platform legally adopts whatever the placeholder happened to say.

**Allowed for v0.1:**

- Section headings copy/derived from the Trust Center spec in §20
- One-sentence placeholders naming the topic and naming counsel as the source
- Effective date placeholder: `EFFECTIVE DATE: pending counsel review`
- Version metadata: `v0.1 PLACEHOLDER`

**Consequences:**

- Day 19 work (Items 14 + 15) ships the editor pipeline and rendering harness, not the legal content. The legal content lands in dedicated post-Sprint-2 PRs once counsel returns drafts.
- Onboarding flow gates on consent → consent gates on v1.0 documents → v1.0 documents gate on counsel review. **No tenant can complete onboarding until counsel has reviewed at least the 6 required-signature contracts.** This is a deliberate hard gate; MVP-with-real-tenants timing depends on it.
- If Moshiur needs to demo onboarding to a non-tenant audience before counsel returns, a "demo mode" feature flag could allow skipping consent capture — but that has not been requested and is not built into the plan.
- This decision is **immutable for Sprint 2**. Any proposal to flesh out placeholder content (even with the best of intentions) requires a new decisions.md entry superseding this one + Moshiur's explicit reauthorisation.

---

## 2026-05-17 · Sprint 2 kick-off — scope, human-checkpoints, and Porichoy deferral

**Context:** Sprint 1 closed clean on tag `v0.1.0-sprint-1` (commit `53ae000`). Sprint 2 per CLAUDE.md §26.1 covers KYC submission flow, S3 + KMS doc upload, tenant onboarding UI, super admin KYC review queue, Porichoy + eTIN + bank-name + BFIU automated checks, notification on KYC approval/rejection, tenant subdomain provisioning, and Trust Center scaffolding (legal_documents + 18 pages of versioned content). Moshiur signalled the start with one amendment: Porichoy is unreachable and procurement is unclear, so Sprint 2 ships KYC review as a manual reviewer flow with the Porichoy adapter as scaffolding only. Five human-gated checkpoints declared upfront to prevent autonomous overreach on legally-sensitive surfaces (KYC PII, Trust Center contract drafts, sanctions data).

**Decision:** Sprint 2 ships Days 11-20 in roughly this shape:

- **Days 11-12 — Foundation re-baseline.** CLAUDE.md v2.2 PR (auth-library swap, SSM-only / 30GB-EBS / explicit-staging-DNS clarifications to §17, BYPASSRLS gotcha codified into §4 role-hierarchy guidance). RLS migration 0003 (`app.current_user_id` + `withUser()` helper) unblocks user-scoped tables (`users`, `sessions`, `magic_links`, `oauth_identities`, `handle_history`). OAuth callback routes (start + callback + state cookie + auto-link by verified email) finish the carry-over from Sprint 1 Day 7-8.
- **Days 13-15 — KYC pipeline.** S3 bucket `eventpulse-kyc-staging` in `ap-southeast-1` with KMS CMK, BlockPublicAccess, TLS+KMS bucket policy, per-tenant prefix `tenants/{tenant_id}/kyc/{submission_id}/...` (default — checkpoint #2 confirms before bucket creation). `kyc_submissions` table per §9.2 + RLS. Signed-URL upload API + zod schema covering Tier 1 individual + Tier A org documents. Submission state machine (`submitted` → `under_review` → `approved` | `rejected`) with audit-log entries. eTIN format regex (local validation, ships today). BFIU sanctions list seeded from a static JSON committed to `infra/compliance/sanctions.json` — checkpoint #5 confirms source before any matching code runs.
- **Days 16-18 — Tenant + admin UI for KYC.** Tenant portal: post-login Account-Type modal (organisation | individual), KYC wizard with progress steps, field validation, document re-upload, status banner. Super admin KYC review queue: filter/sort by status + tier + age, drill into submission (NID image displayed inline, reviewer enters NID number from image, eTIN field shows regex pass/fail, bank-name match against NID name as manual entry), approve/reject buttons with mandatory reason on reject, audit-log + notification fire on decision. Reviewer role is super admin only for MVP (checkpoint #4 default).
- **Day 19 — Trust Center scaffolding.** `legal_documents` + `legal_document_versions` tables per §9.11. Seeded with v0.1 PLACEHOLDER content for all 6 legal contracts + 12 trust artefacts; every placeholder page renders a prominent "DRAFT — not yet legally reviewed" banner. Public routing for all 18 pages. Super admin Legal & Trust editor with version control (publish → new version row, never overwrite). Real v1.0 content comes from lawyer review post-Sprint 2 — checkpoint #3 confirms placeholder-vs-final policy before any contract content lands as final.
- **Day 20 — Porichoy adapter scaffold + sprint closeout.** Adapter interface (`PorichoyClient`) + env vars (`POROCHOY_API_KEY`, `POROCHOY_BASE_URL`) + Secrets Manager entry placeholder + TODO-stub for live calls + gotchas.md entry recording the procurement gap. Notification templates `kyc_approved` + `kyc_rejected` ship as bilingual SES transactional templates. Tenant subdomain provisioning logic (write to `tenants.slug` if not already set, register custom Nginx vhost via `/etc/nginx/sites-available/<tenant>.conf` from template, certbot extend wildcard via DNS-01 if needed). Sprint 2 retro + `v0.2.0-sprint-2` tag. Checkpoint #1 happens before this day starts: Porichoy procurement status check — if credentials arrived, Day 20's scope expands to wire live calls; if no, work stays at interface-only with TODO + gotchas.md entry.

**Five human-required checkpoints** (autonomous proceed STOPS at each — no exceptions, including under future autonomy mandates):

1. **Porichoy procurement** — before Day 19-20 (when the adapter scaffold lands), ask Moshiur whether credentials have arrived. If yes, Day 20 expands. If no, scaffold stays interface-only.
2. **S3 bucket region + per-tenant prefix** — confirm before bucket creation. Default proposal: `eventpulse-kyc-staging` in `ap-southeast-1`, per-tenant prefix `tenants/{tenant_id}/kyc/{submission_id}/...`. Moshiur reviews before bucket exists.
3. **First Trust Center document content** — six contracts must be reviewed by Moshiur before any are seeded as final v1.0. Seed v0.1 PLACEHOLDER for all 18 pages in Sprint 2 so the editor and rendering pipeline work; explicit "DRAFT — not yet legally reviewed" banner on every placeholder. Real v1.0 content comes from lawyer review post-Sprint 2.
4. **KYC reviewer role assignment** — confirm before building the review UI: stays super admin only for MVP, or extends to a `kyc_reviewer` role for delegation. Default: super admin only.
5. **BFIU sanctions list source** — confirm where the sanctions JSON comes from before any matching code runs. Default: manually curated initial list seeded from BFIU's public sanctions notice, refreshed monthly.

**Process amendments for Sprint 2:**

- `/review` runs before every commit that touches KYC code (PII + §1.3 R4 encrypted-at-rest sensitivity), not just at end of day.
- `/end` runs at the end of each working day, not just at sprint closeout.
- Procurement check happens at sprint kick-off in addition to per-task checks — this entry is the Sprint 2 instance.

**Consequences:**

- Sprint 2 KYC pipeline ships end-to-end on manual review without Porichoy. Operationally fine at sub-50-submissions-per-day volume, which Phase 1 will not exceed.
- The five checkpoints are non-negotiable; future-Claude must STOP-ASK at each regardless of autonomy state.
- Trust Center pages all visible from Day 19 onward but every contract carries "DRAFT" banner until lawyer-reviewed v1.0 lands. Tenants cannot consent against draft documents (registration flow blocks consent capture if any required-signature document is still at v0.x).
- Sprint 2 carries Sprint 1 closeout items (CLAUDE.md v2.2, OAuth callback routes, RLS migration 0003, real staging app deploy via `deploy.sh`, three SES templates) as Day 11-12 work — small surface, naturally pairs with the new code.
- Sprint 1 closeout commit `53ae000` is the tag base; new branch is `feat/sprint-2-day-11-foundation` once Sprint 2 starts.

---

## 2026-05-17 · Porichoy deferred — manual NID review for MVP

**Superseded by:** 2026-05-19 "Platform-wide policy — manual verification only for MVP (consolidates prior per-item deferrals)". This entry remains for archaeology — it was the first of three per-item deferrals that the platform-wide policy generalises. The Porichoy adapter scaffold-only shape (interface + env vars + Secrets Manager entry + TODO stub) is promoted to the **canonical pattern** for all future automation integrations; the eTIN/sanctions "keep local regex / keep static JSON list" sub-decisions in this entry are themselves now manual-only per the consolidating policy.

**Context:** Porichoy (`api.porichoy.gov.bd`) is the NID validation service that CLAUDE.md §13 treats as the primary automated check in the KYC flow. At Sprint 2 kick-off, Moshiur reports Porichoy is unreachable and the procurement path for API credentials is unclear; service availability itself is uncertain. The playbook's automated NID validation can't ship as designed.

**Decision:** For MVP, ship KYC validation as a **manual reviewer flow** with the Porichoy integration scaffolded but not wired:

- **NID validation: manual.** Super admin review queue displays the uploaded NID image inline; reviewer enters the NID number from the image into a dedicated field; system stores the number for audit but performs no automated validation against Porichoy. Reviewer confirms photo-name-NID consistency by eye.
- **eTIN format check: keep (local regex).** No external call needed, runs in the validation layer next to the zod schema.
- **Bank/MFS name match against NID name: manual.** Reviewer compares the bank account holder name (from the bank statement upload) against the NID name as a yes/no checkbox on the review form.
- **BFIU sanctions screening: manual list-check.** Sanctions list seeded as static JSON at `infra/compliance/sanctions.json`, refreshed monthly. Submission form auto-flags exact-match hits for reviewer attention; no fuzzy matching for MVP.
- **Porichoy adapter: scaffold only.** Interface `PorichoyClient`, env vars `POROCHOY_API_KEY` + `POROCHOY_BASE_URL`, Secrets Manager entry placeholder `eventpulse/staging/porichoy`, TODO-stub for live calls. When credentials arrive, integration becomes one focused PR rather than a refactor — no business logic changes needed because the manual flow already produces the same `kyc_submissions.nid_verified` boolean column that the live integration would write.

**Rationale verbatim:** Porichoy unreachable at Sprint 2 kick-off; procurement timeline unclear. Manual KYC review is operationally fine at sub-50-submissions-per-day, which we won't exceed before Phase 2. Porichoy integration scaffolded but not wired; will land in a dedicated PR once credentials arrive. If Porichoy remains unreachable through Phase 2, surface a §29 Open Decision on alternative NID validation sources before Phase 3.

**Consequences:**

- Day 19-20 scope of Sprint 2 contains the Porichoy scaffold work as one PR (interface + env + secrets entry + TODO + gotchas.md entry recording the procurement gap). Adapter implementation lands when credentials arrive.
- Super admin review queue UI carries dedicated affordances for the three manual checks (NID number entry from image, bank-name match checkbox, sanctions-list manual confirmation). These affordances remain even after Porichoy lands — the human-in-the-loop fallback always stays available for ambiguous cases.
- Reviewer training note added to the queue page: "Until Porichoy automation is live, all NID checks are manual. Verify name, photo, NID number, and DOB against the uploaded image. Flag anomalies via the reject-with-reason flow."
- `kyc_submissions.porichoy_verification_id` column from §9.2 stays nullable; manual submissions leave it null with `nid_verified=true` set by reviewer rather than by API. When Porichoy lands, the column populates automatically going forward; historical manual submissions remain null (and audit-trail clear).
- Throughput ceiling: at ~10 minutes per manual review, a single reviewer handles ~48 submissions/day. Above that, KYC bottlenecks → either scale reviewers (per checkpoint #4 default of "super admin only") or accelerate Porichoy procurement. Sprint 3 trigger: > 30 submissions/day sustained.
- If Porichoy remains unreachable through Phase 2 (Sprint 8 end), a §29 Open Decision is filed asking: "Do we accept manual-only NID validation in perpetuity, integrate Porichoy when finally available, or evaluate alternative NID sources (BTRC SIM-NID API, manual eKYC partners)?"

---

## 2026-05-17 · Workflow automation: seven slash commands installed

**Context:** Sessions vary in rhythm. Early ones are slow and careful; late-day or after-incident ones are fast and tired. The risk is that the playbook rituals (memory writes, decision capture, gotcha logging, sprint hygiene) get skipped first when time pressure builds — exactly when they matter most.

**Decision:** Encodes the project's working rituals (start, work, decide, gotcha, review, end, sprint) as repeatable prompts so memory and quality gates can't be skipped under time pressure. Free maintenance ongoing; commands edited in-repo as the project evolves.

Seven slash-command files installed at `.claude/commands/` (overwriting the placeholder versions from the early-session draft):

- `/start` — session-start protocol + GitHub state + today's likely focus, no action until confirmed
- `/work` — focused execution: confirm + cite §X.Y + TodoWrite + wait-for-go + run-tests-as-you-go + ship-it gate
- `/decide` — three-question intake (Context / Decision / Consequences) → drafted entry → approve gate → append + commit
- `/gotcha` — symptom / why / fix / avoid intake → drafted entry → approve gate → append + commit
- `/review` — ruthless senior-engineer review checklist (Correctness / Multi-tenancy §4 / Money §14 / Security §1.3 / Testability §24 / DoD §25) → green/yellow/red output, no auto-fix
- `/end` — session-end protocol with diff approval before memory commit
- `/sprint` — sprint boundary: retro + release tag + handoff + next-sprint kick-off

**Consequences:**

- The project's working rituals happen consistently because they're invoked by typing, not by remembering. Memory and quality gates can't be skipped under time pressure — they're the literal command body.
- Future-Moshiur (and any teammate) gets the same disciplined session whether the founder is fresh or exhausted. Critical when contractors join.
- These commands are version-controlled with the rest of the project, not user-scoped — teammates get them on clone, not per-machine.
- Editing rule: when a ritual evolves (a new check added, a step refined), edit the relevant `.claude/commands/*.md` file in the same PR as the underlying change so the command body always reflects current practice.

---

## 2026-05-17 · Sprint 1 closeout — SES out-of-sandbox request submitted

**Context:** SES sandbox limits (200 emails/day, send only to verified addresses, 1 email/sec) are fine for development but prevent shipping to the first paying tenant. The out-of-sandbox request is a 1-2 business day AWS Support review.

**Decision:** Submitted SES production-access request via `aws sesv2 put-account-details` with:

- `--mail-type TRANSACTIONAL`
- `--website-url https://eventpulse.com.bd`
- `--contact-language EN`
- `--production-access-enabled`
- `--additional-contact-email-addresses moshiur@publicpulse.com.bd`
- Use-case description: transactional only — ticket confirmations with attached PDFs, attendee event reminders, KYC verification status updates, password reset and magic-link sign-in tokens, platform notifications for tenants. No marketing email. DKIM + SPF + DMARC (`p=quarantine`) all live. Bounce/complaint webhooks will update `notification_log` table and suppress further sends. Initial daily volume <200/day month 1, ramping to <5,000/day over six months. Requested initial limit: 50,000 emails/day, max send rate 14 emails/second (deliberately conservative).

Account state post-submission:

```text
ProductionAccessEnabled: false
MailType:                TRANSACTIONAL
ReviewStatus:            PENDING
CaseId:                  (not exposed by SES API at submission; AWS Support emails it separately)
Website:                 https://eventpulse.com.bd
```

**AWS Support case ID** will be appended to this entry when AWS emails it (usually within minutes). Update path:

```text
aws sesv2 get-account --profile eventpulse --region ap-southeast-1 \
  --query 'Details.ReviewDetails.CaseId' --output text
```

**Consequences:**

- AWS review window: typically 1-2 business days. Outcome (approve / deny / request-more-info) will be appended to this entry with date.
- Until approved, staging continues to send only to verified addresses. Verify `moshiur@publicpulse.com.bd` + a test address before exercising any auth/magic-link flow that needs to deliver.
- If denied / partially approved: re-submit with adjusted use-case description and stricter bounce/complaint commitments. The 50k/day cap is intentionally low; we'll request an increase as we grow.
- The SES setup decision from 2026-05-17 (domain identity + DKIM) was the prerequisite. This decision closes the SES path for Sprint 1.
- Once approved, set the `AWS_SES_FROM` env var on the staging EC2 to the verified sender (e.g. `Event Pulse <hello@eventpulse.com.bd>`) and remove `MAIL_DRY_RUN` from production env.

**AWS response (to be filled in on receipt):** _pending_

---

## 2026-05-17 · Auth foundation library choice: roll our own (not Lucia)

**Context:** Sprint 1 Day 7-8 calls for "Lucia Auth + JWT" per CLAUDE.md §1.2. Lucia v3 was current when the playbook was written; it has since been deprecated as a framework (the author recommends rolling your own with their patterns). Lucia v4 doesn't exist. Alternatives: Better-Auth (newer, opinionated), @auth/core, managed services (Clerk, Auth0).

**Decision:** Roll our own minimal session + JWT layer over the `sessions` / `users` / `magic_links` / `oauth_identities` tables that were already designed for Lucia. Use `arctic` (OAuth helpers, same author) and `jose` (JWT) — small focused libs that aren't going away.

**Consequences:**

- Full control over the multi-audience JWT model the playbook requires (super-admin / tenant / attendee) without fighting a framework's session abstraction.
- No dependency on a maintenance-mode framework. The total auth code is ~600 lines under `apps/api/src/auth/` and is testable as plain functions.
- Password hashing: `@noble/hashes` argon2id (pure JS, no native build step). PHC-encoded so we can later swap to `@node-rs/argon2` (native bindings) without touching stored hashes.
- Session model: opaque random token (256-bit base64url) sent to client; SHA-256 hash is the DB primary key in `sessions`. JWT carries `sessionId = hash(token)` so the access token validates structurally + the live session row can be cross-checked when needed.
- The "Lucia" mentions in the playbook are interpreted as "the auth surface, not the library". §1.2 remains accurate in intent; a future bump should update the wording.

---

## 2026-05-17 · SES domain identity for eventpulse.com.bd verified

**Context:** Sprint 1 Day 9-10 requires SES sending from the apex domain. Domain identity verification + DKIM are prerequisites for any transactional email.

**Decision:**

- Created `eventpulse.com.bd` SES domain identity in `ap-southeast-1` with easyDKIM (RSA 2048).
- Added 3 DKIM CNAMEs (tokens `3vt5rlhpp...`, `fho7jkvq...`, `ibjzoosi...`) + SPF (`v=spf1 include:amazonses.com -all`) + DMARC (`p=quarantine; rua/ruf to dmarc-reports@eventpulse.com.bd; adkim=s; aspf=s`) to Route 53 zone `Z003493917KJX7VCR8ZMR`.
- Verified by SES (status: SUCCESS) within ~15 minutes.
- Account stays in **SES sandbox** for development. Production launch requires an out-of-sandbox request via the AWS support console (1-2 business day turnaround).

**Consequences:**

- Sending is enabled from `eventpulse.com.bd` immediately for emails to verified recipient addresses (sandbox limit). For dev/staging this means we email-verify our own addresses and use them for end-to-end testing.
- Out-of-sandbox request must precede the first paying tenant. Logged as a hard line in `handoff.md` until done.
- DMARC reports route to `dmarc-reports@eventpulse.com.bd` — which doesn't have a mailbox yet. Either set up SES inbound -> S3 -> Lambda forwarder (Sprint 2 work), or change the destination to `moshiur@publicpulse.com.bd` in the meantime. Same applies to `security@eventpulse.com.bd`.
- DKIM keys rotate manually via `aws sesv2 put-email-identity-dkim-signing-attributes`. Annual rotation is the default cadence; document in the operations runbook when written.

---

## 2026-05-17 · 12-hour autonomy mandate + AWS cost ceiling (single staging EC2)

**Context:** Moshiur granted full autonomy for the next 12 hours to push through Sprint 1 Day 3-4 plus as much of Day 5-10 as fits. Explicit reconfirmation requested on one hard constraint: **only one AWS EC2 instance** during development, and the monthly bill must not creep beyond what that single instance plus its strictly-required supporting AWS services costs.

**Decision:**

- **Compute ceiling:** exactly **one EC2 instance** during all development phases. The staging instance `i-02e4fddeb923c14f9` (t3.small, ap-southeast-1b, 30 GB gp3) is it. **No production EC2** is launched during development. **No second staging instance** even for experimentation. Postgres, Redis, BullMQ workers, Nginx, certbot, pm2, and the Node app processes all co-locate on this single box per §17.1.
- **What is allowed (the irreducible-supporting set):** Route 53 (existing hosted zone, billed per zone $0.50/mo), KMS (one CMK `eventpulse-staging-kms`, $1/mo + per-API), S3 (low-traffic buckets — SSM logs, KYC, assets, backups), CloudWatch Logs (low retention), SES (per-email pricing — pennies for dev volume), Secrets Manager (per-secret pricing — a handful of secrets). Total projected: **~$22/month** at idle development load.
- **What is forbidden during development without explicit unlock:** RDS (Postgres is on-box), ElastiCache (Redis is on-box), ALB/NLB, ECS/Fargate, Lambda, Aurora, MSK, DocumentDB, OpenSearch, Kinesis, SageMaker, anything in the "managed but pricey" tier. The §17.12 escalation ladder remains the contract: those services arrive only when their stated trigger fires AND Moshiur explicitly approves.
- **No orphan Elastic IPs.** An EIP that is allocated but not attached bills at $3.60/mo. The `eipalloc-0641d86f38bbf5ef0` allocated this session was attached to the staging EC2 the same minute as allocation. Any future EIP work follows the same rule: allocate-and-attach in the same flow, or release immediately if attach fails.
- **CloudWatch Logs retention capped at 90 days for staging** (already applied to `/eventpulse/staging/ssm-sessions`). Application log groups created later inherit this default.
- **S3 lifecycle rules everywhere by default.** SSM logs bucket already at 90d expiration / 30d noncurrent. Future staging buckets get the same default unless a compliance reason (KYC docs = 5 years per §15.1) overrides.

**Consequences:**

- Production EC2 launch is now blocked-by-default until Moshiur signals "go to prod." When that happens, it's an explicit unlock event with its own decision entry.
- Every AWS API call during the autonomy window is mentally checked against this list. If something proposed-by-the-playbook would create a recurring charge not in the allowed set, work stops and the question lands in handoff.md instead.
- Cost monitoring artifact: a future small task (logged in progress.md) is to enable AWS Budgets at $40/mo so anything that does drift gets caught early. Until then, the discipline is the gate.
- The autonomy window itself is logged in handoff.md so the next session can see what was done unsupervised and review.

---

## 2026-05-16 · Sprint 1 Day 3-4 — SSH access strategy: SSM Session Manager only

**Context:** Phase 1 of Day 3-4 EC2 provisioning was about to launch with the §17.2 default — SSH key pair + port 22 inbound from a bastion/office IP allowlist. The amendment in approval gate 1 reconsidered: SSM Session Manager offers IAM-authenticated shell access without a key pair and without port 22 ever opening on the SG.

**Decision:** Both staging and production EC2 instances use **SSM Session Manager exclusively** for shell access. No SSH key pair is created. No port 22 inbound rule is added to any security group. Three reasons:

1. **No SSH key rotation burden.** IAM policy is the access control surface; revoking access = updating an IAM policy, not rotating a key on every machine + every operator's `~/.ssh/`.
2. **No port 22 attack surface.** Port 22 stays closed at the security group level, eliminating SSH brute-force, key-leak, and `fail2ban`-tuning concerns entirely. The §17.3 `fail2ban` mention remains for application-layer abuse protection but the SSH-brute-force class is closed at the network edge.
3. **Audited session recording per §1.3 R8.** Every interactive session writes to S3 (`eventpulse-staging-ssm-logs` / `eventpulse-prod-ssm-logs`) and CloudWatch Logs (`/eventpulse/staging/ssm-sessions` / `/eventpulse/prod/ssm-sessions`). The "audit everything that changes state" rule was previously interpreted as application-layer; this extends it to operator shell sessions too.

**Consequences:**

- IAM role `eventpulse-staging-ec2` includes the `AmazonSSMManagedInstanceCore` AWS-managed policy. Custom inline policy still covers KMS-decrypt + S3 read/write + SES send + Secrets Manager read for the application.
- SSM Agent is pre-installed on Ubuntu 24.04 LTS AMI; post-launch verification: `aws ssm describe-instance-information --filters Key=InstanceIds,Values=i-XXX --profile eventpulse`.
- S3 bucket `eventpulse-staging-ssm-logs` and CloudWatch Logs group `/eventpulse/staging/ssm-sessions` created in Phase 1 (before EC2 launch — SSM session preferences point at them).
- Operator runbook update: `aws ssm start-session --target i-<id> --profile eventpulse` replaces `ssh ubuntu@<eip>`. Documented in `docs/runbooks/connecting-to-ec2.md` when written.
- CI/CD already uses SSM `RunCommand` per §18.2 — no change needed there.
- **Lockout risk:** if SSM Agent fails or IAM trust breaks, recovery requires console + EC2 Instance Connect (which we'd then have to enable) or restore-from-snapshot. Mitigation: daily EBS snapshots + `pg_dump` to S3 per §17.10 cover the worst case.
- **§17.2 should be updated** at next CLAUDE.md bump to read "security group: inbound 80, 443 from 0.0.0.0/0; **no inbound 22 (SSM Session Manager handles shell access)**" — currently still reads "22 from bastion IP only". Tracked in handoff.md.

---

## 2026-05-16 · Staging EBS volume size: 30 GB (production stays 100 GB)

**Context:** §17.2 specifies 100 GB gp3 EBS root volume on EC2 t3.large. For staging — small dataset, limited test traffic, cost-conscious — 100 GB is overprovisioned. Approval gate 1 amended to 30 GB.

**Decision:** Staging EC2 uses **30 GB gp3** (3000 IOPS baseline, 125 MB/s throughput — gp3 defaults at this size). Production retains **100 GB gp3** per §17.2 unchanged. CloudWatch disk-usage alarm at 80% capacity triggers manual expansion if needed (gp3 can expand online, no downtime).

**Consequences:**

- Staging EBS cost drops from ~$8/mo to ~$2.40/mo at the gp3 base rate. Net annual saving ~$67 on the staging line item.
- Postgres data path + Redis data path live under `/home/eventpulse/data/` on the same volume per §17.1 — fits easily under 30 GB for staging volume of work.
- Backups go to S3 immediately (`s3://eventpulse-staging-backups/postgres/`) so EBS isn't carrying historical pg_dumps. EBS daily snapshot still retained 7 days per §17.10.
- Production §17.2 sizing **unchanged.** If a future amendment changes prod EBS size it gets its own entry.
- **§17.2 prose should be updated** at next CLAUDE.md bump to note "production: 100 GB · staging: 30 GB · either can be expanded online".

---

## 2026-05-16 · Staging DNS: explicit subdomain records, wildcard reserved for production

**Context:** §17.6 specifies a wildcard A record `*.eventpulse.com.bd` to cover tenant subdomains. The Day 3-4 plan initially proposed `*.staging.eventpulse.com.bd` for parity. Staging has no tenants and no need for wildcard expansion — approval gate 1 amended to explicit records only.

**Decision:** Staging uses **explicit A records** for the five known subdomains:

```text
staging.eventpulse.com.bd.          A  300  <EIP>
app.staging.eventpulse.com.bd.      A  300  <EIP>
admin.staging.eventpulse.com.bd.    A  300  <EIP>
api.staging.eventpulse.com.bd.      A  300  <EIP>
my.staging.eventpulse.com.bd.       A  300  <EIP>
```

No `*.staging.eventpulse.com.bd` wildcard. The wildcard pattern in §17.6 is for production only, where tenant-named subdomains (`acme.eventpulse.com.bd`, etc.) land dynamically.

**Consequences:**

- Staging TLS cert request uses a SAN list (5 explicit names) instead of a wildcard. Simpler ACME flow, no DNS-01 wildcard complexity for staging.
- Adding a sixth staging subdomain in the future requires: add A record + re-issue cert with the new SAN. Cost is one `certbot certonly --expand` invocation — fine for the small set of staging names.
- Production §17.6 plan is **unchanged**: `*.eventpulse.com.bd` wildcard cert via DNS-01 remains the production approach for tenant subdomains.
- Apex `eventpulse.com.bd` and production subdomains (`app`, `admin`, `api`, `my`, `customers`) are still explicit records on prod per §17.6; wildcard only covers the dynamic tenant slot.
- Clarification not contradiction — §17.6 prose remains correct for production. A footnote at next CLAUDE.md bump would help: "Wildcard applies to production tenant subdomains. Staging uses explicit records since it has no tenants."

---

## 2026-05-16 · Sprint 1 Day 3-4 — IAM bootstrap

**Context:** AWS setup required for Sprint 1 Day 3-4 EC2 provisioning. Initial state on the founder's Mac had only root credentials configured (`default` profile pointing at `arn:aws:iam::739275468267:root`). Payment-platform work cannot happen under root per the spirit of §1.3 R4 and §17.2 (IAM-role-based access, no overprivileged credentials). The right pattern is a dedicated IAM user / profile combo configured before anything writes to AWS.

**Decision:**

- **IAM user `eventpulse-cli`** created in account `739275468267` with the **`AdministratorAccess`** managed policy attached — **explicitly temporary**. Sprint 1 Day 9-10 will replace this with a custom least-privilege policy derived from the actual CDK plan's resource list. Tracked as a hard line in `handoff.md` until done.
- **Local profile `eventpulse`** configured in `~/.aws/config` and `~/.aws/credentials` for region `ap-southeast-1`. Verified via `aws sts get-caller-identity --profile eventpulse` returning `arn:aws:iam::739275468267:user/eventpulse-cli`.
- **Root access key deleted.** Programmatic root access is no longer possible. Root user has MFA enabled and is sealed behind Console login + MFA, used only for tasks that genuinely require root (account settings, billing, account closure).
- **Local `default` profile removed** from `~/.aws/credentials` and `~/.aws/config`. `aws sts get-caller-identity` without `--profile` now errors with "Unable to locate credentials" — there is no fallback profile that could be ambient-misused.
- **Route 53 hosted zone for `eventpulse.com.bd` already exists** in account `739275468267` (NS records at the external registrar already point at it). Day 3-4 work consumes the existing zone — does NOT create a new one. List + show before any write.
- **KMS strategy: per-environment CMKs** (`eventpulse-staging-kms` + `eventpulse-prod-kms`, both `ap-southeast-1`), per §17.9 — to be created during EC2 provisioning step.

**Consequences:**

- All AWS work for the next 3+ months goes through `eventpulse-cli`. Profile `eventpulse` is the single sanctioned local credential set.
- Root credentials are sealed behind MFA + Console. Used only for tasks that genuinely require root.
- **New operating rule: any future "just this once with root" suggestion must be refused** and trigger this entry as precedent. The pattern was already established once at IAM setup; we don't unlearn it.
- AdminAccess scope is a known-temporary compromise. End-of-Day-9-10 hard requirement: replace with a custom IAM policy listing only the resources Sprint 1 actually touches (Route 53, EC2, EBS, SSM, S3, SES, Secrets Manager, KMS, CloudWatch, ACM if used). Audit logged in `progress.md` Blocked until lifted.
- The Route 53 hosted zone being pre-existing means the standard STOP-ASK gate set is adjusted: we list-and-show before any DNS write rather than create-from-scratch.

**Related:** `.claude/memory/gotchas.md` "AWS credentials accidentally pasted in chat during Day 3-4 bootstrap" — the incident during setup, fully remediated, CloudTrail audit clean.

---

## 2026-05-16 · Playbook bumped to v2.1

**Context:** CLAUDE.md was at v2.0 (3,101 lines). Moshiur delivered v2.1 (3,443 lines) which adds the self-service-hosting / unified-identity / handle-system / event-reports surface. The v2.1 changelog calls it a "minor" version but it materially changes the Sprint 1 Day 5-6 schema and the Phase 2 sprint plan.

**Decision:** Adopt v2.1 as the working playbook. Replace CLAUDE.md wholesale; preserve the v2.0 source file at `Playbook/EventPulse_Claude_Code_Playbook.md` and v2.1 at `Playbook/EventPulse_Claude_Code_Playbook copy.md` for diffability. The §29 "Resolved in v2.1" list folded in by Moshiur in the file is authoritative; the GitHub-free-plan ✓ line was added in this bump.

**Consequences:**

- **Sprint 1 Day 5-6** (identity-tables migration, issue #24) now also delivers `users.handle` / `users.handle_chosen_at`, `tenants.is_personal` / `tenants.owner_user_id`, `events.is_listed_publicly`, and the new tables `reserved_handles`, `handle_history`, `event_reports`. Plus `apps/api/scripts/seed-reserved-handles.ts` to populate the reserved list.
- **RLS test plan** (#27) extends: `event_reports` is tenant-scoped (full §4.3 template); `handle_history` is user-scoped (different policy); `reserved_handles` is global and table-RLS-free (it's a lookup).
- **§29 Open Decisions** is now 10 items shorter (8 resolved in v2.1 + 1 in this bump for GitHub-plan + 2 still open were already there). Remaining open: KYC strictness, bilingual scope, PSP/PSO, EPS reconciliation, refund authority, sub-processor notice, handle-change cooldown, AUP auto-takedown, AIT, VAT.
- **Phase 2 (§26.2)** reshuffles: Sprint 8 becomes "attendee accounts + self-service hosting + AUP triage" instead of the previous content. Phase 3 loses attendee accounts but keeps Wallet passes, mobile check-in, recurring events.
- **New Hono routes** (deferred to Sprint 8): `/my/*` for the attendee portal, `/public/reports` for event reports.
- **`fee-calculator.ts`** unchanged; free events return zero-fee result (subtotal === 0 path already in the test matrix).

---

## 2026-05-16 · Workflow automation — seven slash commands installed

**Context:** Sessions vary in rhythm. Early ones are slow and careful; late-day or after-incident ones are fast and tired. The risk is that the playbook rituals (memory writes, decision capture, gotcha logging, sprint hygiene) get skipped first when time pressure builds — exactly when they matter most. The solution is to make the rituals one-keystroke invocations rather than something that has to be remembered and re-typed each time.

**Decision:** Install seven project-scoped slash commands at `.claude/commands/`:

- `/start` — session-start protocol + GitHub state + today's likely focus
- `/work` — focused execution mode (plan → wait for go → execute → ship)
- `/decide` — three-question intake → `decisions.md` entry + commit
- `/gotcha` — symptom/why/fix/avoid intake → `gotchas.md` entry + commit
- `/review` — ruthless PR review against playbook §4 / §14 / §1.3 / §24 / §25
- `/end` — session-end protocol with diff approval before memory commit
- `/sprint` — sprint boundary: retro + release tag + handoff + next-sprint kick-off

**Consequences:**

- The project's working rituals (start, work, decide, gotcha, review, end, sprint) happen consistently because they're invoked by typing, not by remembering. Memory and quality gates can't be skipped under time pressure — they're the literal command body.
- Free maintenance ongoing; commands are edited in-repo as the project evolves. New commands added with the same `chore: install` pattern.
- Future-Moshiur (and any teammate) gets the same disciplined session whether the founder is fresh or exhausted. Critical when contractors join.
- These commands are version-controlled with the rest of the project, not user-scoped — so the team gets them on clone, not per-machine.

---

## 2026-05-16 · GitHub free plan — branch protection via local hooks + CI

**Context:** STOP-ASK 2 of the GitHub-wiring sub-task surfaced that `gh api -X PUT /branches/{branch}/protection` returns 403 on private repos under GitHub Free. The three options were: pay $4/month for Pro, convert to Org + Team, or move enforcement out of the GitHub UI into tooling. For a solo founder pre-revenue, the third option is the right one.

**Decision:** Stay on GitHub Free. Replace UI branch protection with three tooling-level gates:

- **Local push protection** — `.husky/pre-push` hook refuses pushes from `main` / `prod`; override is `git push --no-verify` followed by a logged entry in `gotchas.md`.
- **CI as merge gate** — `ci.yml` runs typecheck/lint/unit/integration/RLS/Playwright on every PR. The merge bar is **never click "Merge anyway"** with a red CI. Solo-review banner on every PR template reinforces this.
- **Typed-input deploy gate** — `deploy-prod.yml` requires `confirm_target=production` (exact string) and `release_tag` matching `^v\d+\.\d+\.\d+$`, with the tag verified to exist in the repo before AWS credentials are even fetched.

**Consequences:**

- **Cost saved: ~$48/year** (GitHub Pro at $4/month) at the current single-developer headcount. Redirects budget to EPS production fees, AWS run-rate, and legal opinions where it matters more.
- **Risk surface assessment.** Solo founder, no concurrent committers, no contractors yet. The three risks that branch protection guards against (a colleague force-pushing, a colleague merging red CI, a colleague deploying without a second pair of eyes) are not active risks today — they're all "future-second-person" risks. Tooling-level gates close the same windows for one disciplined operator.
- **Fallback plan: upgrade the moment a second developer joins.** Two-minute GitHub UI flip: Settings → Billing → upgrade to Pro → re-run the `gh api` calls already documented in `gotchas.md` to apply `main` and `prod` protection. The day a contractor or teammate gets repo access is the day the discipline assumption stops scaling.
- Three artefacts now codify this: `.husky/pre-push` (blocks main/prod), `.github/pull_request_template.md` (solo-review banner), `.github/workflows/deploy-prod.yml` (typed-input gates).
- Future-self test: "did I git push --no-verify and not log it?" If yes, the discipline contract is breaking; either log it or restore the gate. Tracked in handoff.md "Open questions" only if a bypass actually happens.

---

## 2026-05-16 · GitHub workflow established

**Context:** Repo `publicpulseagency/EventPulse` wired for the team. The shape of how we'll work in GitHub — branches, deploys, secrets, reviews, governance — needs to be settled so neither future-Moshiur nor future-teammates have to re-decide.

**Decision:** Adopt the following as the project's GitHub working agreement.

- **Branch strategy (CLAUDE.md §18.3 enforced).** `main` is integration and auto-deploys to staging (gated on `STAGING_DEPLOY_ENABLED=true`). `prod` is the production cut, manual dispatch only with the `production-approval` environment as the human gate. Feature work uses `feat/<scope>-<short>`, fixes use `fix/<scope>-<short>`, hot-fixes use `hotfix/<short>`. Squash-merge to `main`, merge-commit to `prod`.
- **OIDC, not long-lived keys, for AWS access from CI.** Every deploy workflow assumes its AWS role via `aws-actions/configure-aws-credentials@v4` with `permissions.id-token: write`. The two role ARN secrets (`AWS_OIDC_ROLE_STAGING`, `AWS_OIDC_ROLE_PROD`) carry the trust policy. No static AWS access keys live in GitHub. SSM `RunCommand` is the channel from CI into EC2 — no SSH keys in Actions secrets either.
- **Repository visibility: private.** The playbook, decisions log, money math, and KYC flow constitute proprietary IP for Public Pulse Agency / TiCON System Limited. Flipped from public to private during STOP-ASK 1 before the first push (see also LICENSE: minimal `Copyright © 2026 Event Pulse. All rights reserved.`).
- **Wiki disabled — repo is the single source of truth.** Docs live in `CLAUDE.md` and `docs/`. `.claude/memory/` is the persistent project brain. A wiki is a second place for the same content; we don't want two places to drift apart. CONTRIBUTING.md restates this.
- **Conventional Commits enforced on PR titles** (commitlint.yml). Allowed types: `build, chore, ci, docs, feat, fix, memory, perf, refactor, revert, style, test`. The `memory:` prefix is reserved for `.claude/memory/` updates per the memory protocol.
- **Dependabot is security work, not chores.** Daily npm + Actions, weekly Docker. devDeps and framework families (next-react, tailwind, hono, types) grouped; production deps individual so each upgrade gets its own changelog read. Major bumps require human review against §1.2's locked versions.
- **Branch protection deferred** until a paid GitHub plan exists. GitHub Free cannot apply branch protection to private repos. Logged in `gotchas.md`. Mitigation while unprotected: discipline; treat direct push to `main` as a hard "don't" until the plan flips.
- **CODEOWNERS references a team that doesn't exist yet.** Default owner is `@publicpulseagency/eventpulse-core`; load-bearing paths (`/infra/`, `/.github/workflows/`, `/apps/api/src/domain/payments/`, `/apps/api/src/domain/settlement/`, `CLAUDE.md`, `.claude/`) escalate to `@moshiur-rahman`. The team will be created after `publicpulseagency` is converted from user to organisation; until then CODEOWNERS validates as a warning, not a block.

**Consequences:**

- Every PR titled non-conventionally fails the `commitlint` check. Memory commits use the `memory:` prefix and are made in their own commit (not bundled with feature work).
- Until branch protection lands, the human-discipline contract is: no direct push to `main` or `prod` from a local machine. Every change is a PR. Solo-review ritual lives in CONTRIBUTING.md.
- Until a paid plan + org conversion are done, three "would-be-enforced" gates are advisory only: branch protection on `main`/`prod`, environment reviewers on `production` and `production-approval`, and CODEOWNERS team validation. The workflows reference these features so the day a plan exists, flipping it on takes minutes, not days.
- Repository secrets are currently `REPLACE_ME` placeholders. Deploy workflows are gated off via `vars.STAGING_DEPLOY_ENABLED=false` and `vars.PROD_DEPLOY_ENABLED=false` so they no-op until Day 9-10 wires AWS up.
- The 16 Sprint 1 issues (#19–#34) mirror the Sprint 1 TodoWrite and carry sprint/phase/subsystem/estimate/day labels. #19 + #20 (the Day 1-2 work) are closed pointing at commit `1b45b16`.
- Wiki being disabled means writing-down-something-quickly belongs in a `docs/` PR, not a one-click wiki edit. Forces the small-but-real PR ritual.

---

## 2026-05-16 · Default fee handling mode: pass_through

**Context:** CLAUDE.md §14.1 said both fees default to `pass_through` for new tenants; the schema in §9.12 had `tenant_fee_config.default_fee_mode DEFAULT 'absorb'`. The contradiction surfaced during session-one playbook acknowledgement and was logged to gotchas.md.

**Decision:** Both `platform_fee_handling` and `eps_fee_handling` default to `pass_through` for new tenants. The schema is the side that changes; §9.12 has been updated to match §14.1.

**Consequences:**

- First-time organisers price at round numbers (500/1000/2500 BDT) and net exactly that figure — what-you-see-is-what-you-get prevents the inevitable post-first-payout support ticket.
- Matches the dominant international pattern (Eventbrite, Ti.to, Hopin) so tenants with prior tool experience find Event Pulse intuitive.
- Premium-event organisers (corporate galas, ticketed concerts where total clarity matters) can flip to `absorb` per-event in the event wizard — a deliberate choice rather than a default they fell into.
- Cash-positive for the platform: buyer covers fees up front, no absorb-cost timing gap to carry.
- `fee-calculator.ts` test matrix must cover both modes; default-creation fixtures for new tenants should assert `pass_through`.

---

## 2026-05-16 · Project bootstrap on playbook v2.0

**Context:** Starting fresh. Playbook v2.0 is loaded as CLAUDE.md.

**Decision:** Build to the v2.0 playbook exactly. All §29 items marked ✓ are settled; the remaining open items will be resolved as we hit them.

**Consequences:** Claude Code defers to the playbook on any conflict. Any deviation requires an entry here before being implemented.
