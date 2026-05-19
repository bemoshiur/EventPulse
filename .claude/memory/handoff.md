# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-19 (Sprint 2 closed; `v0.2.0-sprint-2` tagged)
**Driver:** Claude Code (Opus 4.7) — sprint boundary; next session opens Sprint 3 Day 21

## State right now

**Sprint 2 is closed. The platform now has:**

- KYC pipeline end-to-end: tenant submits via wizard (Individual Tier 1 OR Organisation Tier A) → server validates per-tier discriminated-union schemas → S3 presigned uploads with SSE-KMS + signed-into-URL key → submission state machine (`submitted → under_review → approved/rejected`, plus the `rejected → draft` resubmit lane) → audit trail in `audit_logs` table (append-only per §4.2.1.1) → notification stubs fire on every state transition.
- Super admin KYC review queue at `/admin/kyc` — list view (no PII surfaced) → detail view (writes audit row per open per Decision G; signed-GET URLs for inline document preview; reviewer-checklist progress with per-tier required keys; reviewer notes auto-save) → decision (approve gated by checklist completeness; reject gated by typed reason ≥10 chars; both write a transition audit row + a decided audit row; conflict-of-interest guard checks audit_logs composite index).
- Trust Center end-to-end: 18 v0.1 DRAFT-banner placeholder documents seeded (6 contracts + 12 artefacts per §20.2); public Server Components at `/privacy`/`/terms`/`/trust/*` (19 pages including `/trust` landing); super admin Legal & Trust editor at `/admin/legal-trust/` with publish-new-version form (textarea markdown → server-side render-at-publish via `rehype-sanitize` unified pipeline with `defaultSchema` allowlist → stored `body_html` is known-safe); Next.js revalidation hook so public pages bust cache within ~1s of publish.
- Authentication: rolled-our-own (`@noble/hashes` argon2id + `jose` JWT + `arctic` OAuth + custom Postgres session adapter). Email+password + magic link + Google OAuth + Apple OAuth all wired. OAuth button hrefs fixed at Day 20 (Day 11 silent-regression).
- Staging EC2 live: `i-02e4fddeb923c14f9`, Elastic IP `18.141.7.246`, 5 hostnames serving HTTPS via Let's Encrypt SAN cert, Postgres 16 + Redis 8 + Nginx + PM2 + CW Agent; KYC S3 bucket with dedicated CMK; OIDC three-claim trust pattern codified for `eventpulse-deploy-staging`.

**Sprint 2 retro lives in the v0.2.0-sprint-2 git tag annotation + `docs/releases/v0.2.0-sprint-2.md`** (see release notes for the four-question retro answers + three things to do differently in Sprint 3).

```text
v0.2.0-sprint-2   <annotated tag>  <pending> end of sprint 2 closeout
<pending>         memory: Sprint 2 closeout — Day 20 final + retro + sprint boundary
09e1116           feat(api): Day 20 PM Item 16 PR 1 — Porichoy adapter scaffold (#108)
b502d74           docs: Day 20 EPS library investigation note (#105)
325abef           memory: Day 20 AM — EPS in-house wrapper + production-EPS-in-staging guard + OAuth gotcha (#107)
5410b81           chore: Day 20 EPS in-house wrapper plan — bootstrap-staging EPS secret + CLAUDE.md §11 amendment (#106)
5760045           fix(api): Day 20 AM OAuth sign-in — button hrefs hit API vhost; 503 when provider not configured (#104)
…46 more Sprint 2 commits back to ebfacc4 (Sprint 2 Day 11 Item 2)…
4c49e1d           chore: end of sprint 1 (v0.1.0-sprint-1)
```

## Next concrete step

**Sprint 3 Day 21 kick-off session.** First-session work:

1. **Read CLAUDE.md §11 (EPS), §14 (Settlement engine + fee modes), §6 (API patterns), §17 (Infrastructure) end-to-end** before scoping any items. Day 11-18 of Sprint 2 accumulated 9 §-section amendments because front-load reads were skipped; Sprint 3 doesn't repeat that mistake — see the "What single change would have saved the most time" retro answer.
2. **Confirm Sprint 3 pre-flight checklist** (see `progress.md` Sprint 3 pre-flight section):
   - §29 #9 (AIT withholding) + #10 (VAT/Mushak) — tax opinions for fee calculator math (still pending).
   - `eventpulse/staging/eps` Secrets Manager entry — ✅ DONE Day 20 closeout retry.
   - `eventpulse/staging/oauth-google` Secrets Manager entry — ✅ DONE Day 20 closeout.
   - Apple OAuth — DROPPED from MVP per decisions.md 2026-05-19.
   - EPS library decision LOCKED (in-house wrapper) — no re-litigation.
3. **AM PR — bilingual SES templates** (Day 20 carry-forward). 5 templates × 2 locales; SES create-template idempotent; notification stubs wired to live `SendTemplatedEmail`.
4. **First PR — tenant subdomain provisioning** (Day 20 carry-forward, load-bearing for Item 13 approve flow). SSM SendCommand against EC2 → Nginx vhost template → certbot wildcard → audit trail. **Staging integration test REQUIRED before merge** — this was the Day 20 STOP-ASK.
5. **Main work — fee calculator** (§14.3). Pure function. 12+ unit tests covering every fee-mode combination. Single source of truth for all subsequent money math.

**Sprint 3 sprint plan** in full at `progress.md` "In flight" section; mirrors §26.1.

## STOP-ASK conditions for Sprint 3 (pre-flight)

- §29 #9 / #10 tax opinions still pending by Day 22 → halt fee calculator work, surface to Moshiur.
- OAuth credentials still missing by Day 23 → document as Sprint 4 pending; no further verification work this sprint.
- ~~`eventpulse/staging/eps` Secrets Manager entry still missing by Day 26 → halt EPS in-house wrapper integration test, surface.~~ **RESOLVED Day 20 closeout** — secret populated; Sprint 3 EPS work unblocked.
- Subdomain provisioning staging integration test fails in ways that suggest the SSM + Nginx + certbot chain is fragile → halt subdomain work, build something else, defer to Sprint 4.
- EPS wrapper finds `STAGING_PAYMENT_BLOCK` doesn't reliably guard against priced orders → halt all EPS work, file critical bug, surface immediately.
- Counsel returns Trust Center v1.0 drafts mid-sprint → in-scope addition only if drafts arrive before Day 25; later than that, defer to Sprint 4 + consent_records work alongside.

## Sprint 2 deliverable summary (locked in release notes — see docs/releases/v0.2.0-sprint-2.md)

Days 11-20 shipped:

- Day 11 — CLAUDE.md v2.2 bump + pre-push hook fix + RLS migration 0003 + OAuth callback routes + 8 staging-deploy attempts (5 fix PRs) (Sprint 2 kickoff)
- Day 12 — KYC bucket + dedicated CMK (Item 6)
- Day 13 — KYC schema + S3 client + upload-URL endpoint + OIDC infra closeout (Items 7+8)
- Day 14 — KYC state machine + submit endpoint + audit_logs table + notification stubs (Item 9)
- Day 15 — Post-login Account-Type modal + tenant.type nullable + frontend test rig (Item 11)
- Day 16 — KYC wizard backend + TanStack Query infra + Individual Tier 1 wizard frontend (Item 12 Part 1)
- Day 17 — Organisation Tier A wizard + polish + e2e Playwright infrastructure (Item 12 Part 2)
- Day 18 — Platform-wide manual-verification policy + v2.3 playbook bump + super admin KYC review queue (Item 13)
- Day 19 — Trust Center scaffolding + super admin Legal & Trust editor (Items 14+15)
- Day 20 — Item 16 truncated (Porichoy scaffold shipped; subdomain provisioning + SES templates deferred to Sprint 3 Day 21) + OAuth bug fix + EPS library investigation + closeout

## Hard guardrails (carry forward into Sprint 3 unchanged)

- Single EC2 only. ~$23/mo total. $40/mo canary.
- No SSH, no port 22. Shell via `aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse`.
- No direct pushes to `main`/`prod`. PR + squash-merge.
- Never write fee math anywhere except `apps/api/src/domain/payments/fee-calculator.ts` (Sprint 3 Day 21 deliverable).
- §21.3 host-liability clause is load-bearing — don't weaken via code defaults or UX.
- KYC bucket policy: never `StringNotEqualsIfExists` on encryption-key enforcement.
- GitHub Actions OIDC trust policies: canonical three-claim shape only (§17.9.1).
- `audit_logs` is APPEND-ONLY (§1.3 R8 + §4.2.1.1). No UPDATE/DELETE from application code. **`legal_document_versions` is also append-only** (Day 19 second-such-table); same invariant.
- Idempotent inserts under RLS must handle zero-rows-after-collision as cross-tenant ownership (409).
- **Audit helpers are one-per-domain** — never a generic `writeAudit()`. Multiple helpers in the same domain file are fine (4 KYC reviewer helpers + 2 KYC draft helpers in `services/audit/kyc.ts`; `services/audit/tenant.ts`; `services/audit/legal.ts`).
- **`tenants.type` is set-once for MVP** — change requires support intervention.
- **`requireTenantType` middleware caching is request-scoped only** — Hono `c.set('tenantType')`, never closure/module-level.
- **Frontend test rig precedent** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()` via vitest-axe. Modal-open state needs its own axe scan.
- **jsonb `||` shallow merge with `{step:{}}` SILENTLY wipes the step's sub-object** — Day 16 PR 3 BLOCKER.
- **No client-side PII persistence** — react-hook-form: component memory only; TanStack Query: in-memory; sessionStorage holds only opaque IDs. **Detail-view queries on PII surfaces MUST override the default TanStack Query cache** to `staleTime: 0` + `gcTime: 0` + `refetchOnWindowFocus: false` + `refetchOnReconnect: false` so PII evaporates on navigation away (Decision H, Day 18).
- **ESM-typed workspace packages with `.js` re-exports need `extensionAlias` in `next.config.mjs`** — Day 16 PR 3 gotcha; deferred from v2.3 playbook bump to v2.4.
- **BIN 13-digit fact (NBR 2019-11-30) is reviewer-documentation, NOT server-side enforcement.** Day 17 PR 1 BLOCKER fix grandfathered as the one exception.
- **Wizard step→jsonb-key mapping for Tier A** — verbose step names (`org_info`, `signatory_identity`) shorten to jsonb keys (`fields.org`, `fields.signatory`).
- **Document-only wizard steps MUST disable the CTA until all required step docs are uploaded** — Day 17 PR 2 BLOCKER.
- **Item 13 review queue: NO validation badges, NO `kyc_submissions.flags` jsonb column, NO auto-flag UI affordances.** Per the 2026-05-19 platform-wide manual-verification policy.
- **Manual-verification policy is load-bearing.** Any temptation to add automated checks → halt, surface. Phase 2 trigger = 50 verified submissions/week sustained, 4-week trailing average.
- **Porichoy adapter scaffold-only shape is canonical** for all future automation integrations. Interface + env + Secrets Manager entry + TODO stub. `PorichoyNotImplementedError` throw is load-bearing — never silently downgrade to `{verified: false}`.
- **Trust Center v0.1 is skeleton-only.** No AI-generated full-text legal drafts. DRAFT banner non-dismissable until counsel publishes v1.0.0 (Decision L).
- **`legal_document_versions` second append-only table.** Explicit `REVOKE UPDATE, DELETE, TRUNCATE FROM eventpulse_app` per §4.2.1.1.
- **Admin route group lives under `/(admin)/admin/...`** to avoid `/kyc` collision with `/(tenant)/kyc`.
- **Markdown sanitization is via `renderLegalMarkdown()` in `apps/api/src/domain/legal/render.ts`** (Decision J). Single source of truth. `defaultSchema` allowlist unchanged. Widening requires its own decisions.md entry.
- **Public Trust Center pages are Server Components fetching over HTTP** (Decision K — §3.2-clean via `lib/legal.ts` HTTP wrapper). `revalidate: 3600` + `revalidatePath()` on publish.
- **`consent_records` table is Sprint 3+ scope** (Decision L). Scope-creep red flags: any "click to acknowledge" button, IP/UA capture on Trust Center views, sign-up consent checkbox.
- **Document set is §20.2 verbatim** (Decision M.1). 6 contracts + 12 artefacts.
- **Flat database slugs + `canonical_url_path text NOT NULL UNIQUE`** column (Decision M.3). Routing is data-driven.
- **Sub-processors uses single-paragraph DRAFT placeholder in v0.1** (Decision M.2). Structured `<SubprocessorsEditor />` UI deferred to Sprint 3+.
- **NEW for Sprint 3 — EPS library is in-house wrapper** at `apps/api/src/infra/eps/` (Day 20 decisions.md). NO SDK dependency. Wrapper composes axios + `@noble/hashes` HMACSHA512 + zod-validated responses + `normaliseStatus()` shim for §11.4 alias gotcha. Never `import { EpsGateway } from 'eps-gateway-nodejs'` — that decision is locked.
- **NEW for Sprint 3 — `STAGING_PAYMENT_BLOCK=1` is mandatory in staging.** Production EPS credentials in staging is intentional per Day 20 Moshiur decision; the gate is load-bearing. `initialiseOrder()` MUST throw if `STAGING_PAYMENT_BLOCK === '1'` AND `total_paisa > 0`. Removal requires explicit decisions.md MVP-cutover entry.
- **NEW for Sprint 3 — OAuth button hrefs MUST use absolute URL via `NEXT_PUBLIC_API_BASE_URL`.** The Day 20 PR #104 regression-guard test fires loud if anyone reverts. "Manual verification is a fallback for what tests can't cover, not a substitute for what they can."

## Pending user actions

- **`eventpulse/staging/eps` Secrets Manager entry** — ✅ DONE 2026-05-19 (Day 20 closeout retry). EPS production credentials written via the same `mktemp` + `--secret-string file://` pattern that worked for Google OAuth. Tags: `env=staging`, `eps-mode=production`, `sensitivity=payments`. Next staging deploy materialises into `.env.staging` via bootstrap-staging.sh extension shipped in PR #106. **STAGING_PAYMENT_BLOCK=1 still mandatory** to prevent priced orders from charging real cards — guard enforced in Sprint 3 Day 26+ in-house wrapper at `apps/api/src/infra/eps/client.ts`.
- **Google OAuth credentials** — ✅ DONE 2026-05-19. `eventpulse/staging/oauth-google` Secrets Manager entry created with Moshiur-supplied Client ID + Client Secret. Manual happy-path verification gated on next staging deploy materialising the secret into `.env.staging` via bootstrap-staging.sh.
- **Apple OAuth credentials** — DROPPED from MVP scope per Moshiur 2026-05-19. See `.claude/memory/decisions.md` "Apple Sign-In dropped from MVP scope — Google OAuth only". Scaffolding stays in code (cost-neutral); 503 OAUTH_NOT_CONFIGURED handles missing-credentials state. v2.4 playbook bump candidate: amend §1.2 + §5.2 + §19.2 references to "all four auth methods" → "three at MVP launch".
- **Counsel engagement for Trust Center v1.0 drafts** — cross-sprint carry; first paying tenant blocked until counsel returns drafts.
- **§29 #9 (AIT withholding) + #10 (VAT/Mushak)** — legal-consult email status; needed by Sprint 3 Day 22 for fee calculator math.
- **EPS production credential rotation** — explicitly waived by Moshiur Day 20; revisit if compromise event arises.

## Useful runbook fragments

```bash
# Shell into staging EC2 (SSM, no SSH)
aws ssm start-session --target i-02e4fddeb923c14f9 --profile eventpulse

# Trigger a staging deploy manually
gh workflow run deploy-staging.yml --ref main

# Run only frontend tests (jsdom rig)
pnpm --filter @eventpulse/web test

# Run Playwright e2e locally (boots both apps/api + apps/web via webServer)
pnpm --filter @eventpulse/web exec playwright install --with-deps chromium
pnpm --filter @eventpulse/web test:e2e

# Populate `eventpulse/staging/eps` Secrets Manager entry (Day 20 user-action pending)
# Run from a workstation with the `eventpulse` AWS profile configured.
TMP=$(mktemp -t eps-creds) && chmod 600 "$TMP"
cat > "$TMP" <<JSON
{ "merchant_id": "...", "store_id": "...", "username": "...",
  "password": "...", "hash_key": "...", "mode": "production" }
JSON
aws secretsmanager create-secret --name eventpulse/staging/eps \
  --secret-string "file://${TMP}" \
  --description "Event Pulse staging EPS credentials (production-mode per Moshiur 2026-05-19)" \
  --tags 'Key=env,Value=staging' 'Key=eps-mode,Value=production' \
  --region ap-southeast-1 --profile eventpulse --query 'ARN' --output text
shred -uvz "$TMP" 2>/dev/null || rm -f "$TMP"

# Re-run KYC bucket setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh

# Re-run OIDC setup (idempotent)
ENVIRONMENT=staging AWS_PROFILE=eventpulse GITHUB_REPO=publicpulseagency/EventPulse \
  BRANCH=main INSTANCE_ID=i-02e4fddeb923c14f9 \
  ./infra/scripts/setup-github-oidc.sh
```
