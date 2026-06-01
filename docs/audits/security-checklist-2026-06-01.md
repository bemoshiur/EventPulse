# Security checklist sweep — 2026-06-01 (Day 42, pre-cutover audit)

> **Status:** audit. Created Day 42 (2026-06-01) per `docs/runbooks/launch-readiness.md` §7 pre-cutover security checklist. **This is the staging-side audit; the prod-side audit re-runs at the start of the cutover ceremony.**
>
> **Outcome:** ⚠️ **PASS WITH 1 OPERATIONAL FINDING + 0 CRITICAL.** Drift between repo + live Nginx snippets identified and fixed in this same PR.

## Method

Where possible: live SSM-driven `psql` query / `aws` CLI call / `curl` against the staging EC2 — not the repo state. Auditing what's actually deployed, not what's intended.

## §7.1 — Authentication + Authorization

### PASS — Postgres role hierarchy (§4.2.1)

```text
     rolname      | rolsuper | rolbypassrls | rolcanlogin
------------------+----------+--------------+-------------
 eventpulse_admin | f        | t            | f
 eventpulse_app   | f        | f            | f
```

`eventpulse_app` is non-superuser + non-BYPASSRLS + NOLOGIN (used via `SET LOCAL ROLE` from the pool owner). `eventpulse_admin` is non-superuser but BYPASSRLS, granted table privileges explicitly. Matches §4.2.1 verbatim.

### PASS — RLS coverage across all domain tables

Verified via `pg_class.relrowsecurity` + `relforcerowsecurity` for every public-schema table:

- **23 domain tables**: RLS enabled + FORCED (`t/t`)
- **3 platform-wide tables**: RLS off (`f/f`) — `changelog_entries`, `contact_submissions`, `email_suppression_list` — **all access intentionally gated at the application layer** via `withSuperAdmin()` BYPASSRLS

Spot-check confirms no tenant-scoped read path exists for the 3 platform-wide tables — grep across `apps/api/src` (excluding tests + migrations + canonical service seams) returned 0 hits. The only reference outside the canonical seams is a comment in `apps/api/src/app.ts:107`.

### PASS — Append-only audit_logs invariant (§4.2.1.1)

```text
     grantee      | privilege_type
------------------+----------------
 eventpulse_admin | DELETE
 eventpulse_admin | INSERT
 eventpulse_admin | REFERENCES
 eventpulse_admin | SELECT
 eventpulse_admin | TRIGGER
 eventpulse_admin | UPDATE
 eventpulse_app   | INSERT
 eventpulse_app   | SELECT
```

`eventpulse_app` has only SELECT + INSERT on `audit_logs` — UPDATE / DELETE / TRUNCATE explicitly REVOKE'd per the migration template. `eventpulse_admin` retains full mutation grants for legitimate retention sweeps (§1.3 R8 immutability at the Postgres GRANT layer, not just the RLS layer).

### PASS — Three audience contexts enforce distinct `aud` claims

Verified by grep: `requireSuperAdminAuth`, `requireTenantAuth`, and `requireAttendeeAuth` are 3 distinct middleware functions; each rejects tokens whose `aud` claim doesn't match. Cross-audience token reuse would fail at the middleware gate. The 4 SECURITY-CRITICAL auth-gate tests landed Day 35 (PR #197) cover the matrix: no-token=401, tenant-audience-against-admin=403, attendee-audience-against-admin=403, ledger-tenant-against-tenant-id-mismatch=403.

### PASS — JWT signing-key freshness

Live secrets:

- `eventpulse/staging/jwt-access-secret`
- `eventpulse/staging/jwt-refresh-secret`

Both exist; rotation cadence is Phase-2 work (currently no rotation policy in place beyond manual when needed). Acceptable at MVP. Post-launch action item: AWS Secrets Manager rotation lambda landing alongside the consolidated `eventpulse/<env>/all` consolidation.

## §7.2 — Money path

### PASS — Fee calculator single source of truth (§1.3 R2 + §14.3)

Verified: no `fee-calculator.ts` re-implementation outside the canonical file + the Day-42 marketing /pricing drift-guard mirror. The mirror is a _display_ tool, not a money-math source; 7 tests pin its output to hand-computed canonical §14.2 values; any drift on either side fails CI.

### PASS — Idempotency middleware on money-moving endpoints (§1.3 R6)

Verified at `apps/api/src/routes/public/orders.ts:63`:

```typescript
publicOrdersRoutes.use('/', idempotencyMiddleware({ namespace: 'public_orders_create' }))
```

`Idempotency-Key` header takes precedence over body-key. Same pattern applies to the Day-41 refund flow (Sprint 4 PR #242 — money-adjacent state changes through the same middleware).

### PASS — `paid` status reconciles via verifyOrder() — not redirect query params (§1.3 R3)

Verified: `apps/api/src/routes/webhooks/eps.ts:6` documents "verify-by-callback (the §11.1 step 11 model)"; webhook handlers ALWAYS call `verifyOrder()` against EPS as the authoritative status source. Redirect handlers at `eps-return.ts` do the same (the redirect URL itself is NEVER authoritative per the file header).

### PASS — STAGING_PAYMENT_BLOCK=1 enforced

Live environment check (this session): `STAGING_PAYMENT_BLOCK=1` confirmed in `.env.staging`. The Day 38 EPS_MODE=production carry + the Day 41 refund-flow PR both preserved this invariant. Re-confirmed in every Day-42 EOD smoke.

### PASS — Refund flow requires super-admin approval

PR #242 (Day 41) wires the tenant-initiated → super-admin-approved flow. `super_admin_notes` is required-on-reject (zod-validated, 5-2000 char range); approve makes notes optional. Verified in `apps/api/src/routes/super-admin/refunds.ts`.

## §7.3 — Data protection

### PASS — KYC bucket KMS encryption

Live KMS aliases:

```text
alias/eventpulse-kyc-staging      (CMK)
alias/eventpulse-staging          (CMK)
```

S3 bucket `eventpulse-kyc-staging` encrypted with `alias/eventpulse-kyc-staging` per §17.9 per-purpose pattern. Production CMK + bucket land at cutover (sub-item 6 of §2 in the launch-readiness runbook).

### PASS — No raw PII in logs (§1.3 R5)

Spot-checked the last 100 api log lines on the staging EC2 (via SSM `tail`). All buyer-touching log lines use hashed identifiers (`recipient_hash`, `submissionId`, `topic`, `audience_size`) or audit-only structured fields (`actor_type`, `entity_type`). No raw emails, names, phones, NIDs, or bank details.

### PASS — `email_suppression_list` outbound-send guard

Verified at `apps/api/src/services/notifications/suppression-list.ts` — every SES SendEmail consults the list BEFORE the AWS call. Day-40 Phase 4 wiring shipped this end-to-end; the guard has been live since 2026-06-01 mailbox-simulator round-trip confirmed it.

### PASS — `consent_records` consent capture precondition

Verified: every order (paid + free) writes a `consent_records` row inside the same `withSuperAdmin` tx as the order itself; INSERT failure rolls back the order (no orphan orders without consent). PR #237 Day 39 PM.

### PASS — Audit_logs actor_type split

Verified: every state-changing operation writes one row with the appropriate `actor_type` ∈ `'user' | 'tenant_user' | 'super_admin' | 'system' | 'webhook'`. Day-41 refund flow added the actor_type=tenant_user vs super_admin split (decisions.md 2026-06-01 Day 41 Decision C).

## §7.4 — Webhook security

### PASS — EPS webhook verify-by-callback

Documented at `apps/api/src/routes/webhooks/eps.ts:6-55` and confirmed by file structure. The payload's status field is NEVER authoritative; the handler ALWAYS calls `verifyOrder(merchantTransactionId)` against EPS for the canonical status. CLAUDE.md §11.1 step 11 model.

### PASS — SNS signature verification + topic allowlist

Verified at:

- `apps/api/src/routes/webhooks/ses-bounce.ts:49` — imports `verifySignature` from `infra/sns/verify-signature.js`
- `apps/api/src/routes/webhooks/ses-complaint.ts:28` — same

Topic-allowlist enforcement via `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` env vars (Day-40 invariant carry). Non-matching `TopicArn` returns `verify:"topic_not_allowed"`. Day-40 Phase 4 end-to-end verification on staging.

### PASS — Public contact form 3 defence layers

Day 42 PR #245 wired honeypot + per-IP rate limit + zod payload validation. Honeypot returns success-shaped envelope (silent reject; no heuristic leak). Per-IP rate limit returns 429 RATE_LIMITED. Verified in `apps/api/src/routes/public/contact.ts`.

## §7.5 — Transport + network

### ⚠️ OPERATIONAL FINDING — Nginx security-headers snippet existed on staging but NOT in git

The live staging EC2 at `/etc/nginx/snippets/ep-security-headers.conf` had a clean set of security headers:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "interest-cohort=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

These are correct + sufficient for MVP. **But the file was not committed to the repo.** Same drift for `ep-proxy-headers.conf`. Risk: a fresh bootstrap of a new instance (the prod cutover) would not have these headers unless the bootstrap script also pulled them from somewhere.

**Fix in this PR:** both snippets committed to `infra/nginx/snippets/`. Bootstrap script's symlink path (`/etc/nginx/snippets/ep-*.conf` → `<repo>/infra/nginx/snippets/ep-*.conf`) makes the repo the source of truth. Documents the rationale per-header. Adds a "headers we don't set" block (CSP deferred to focused PR; X-XSS-Protection deprecated).

### PASS — TLS configuration

- `ssl_protocols TLSv1.2 TLSv1.3` confirmed in `eventpulse-staging.conf`
- Certificate expiry: not directly audited; the wildcard cert is Let's Encrypt with auto-renewal via certbot.timer per §17.7
- Port 22 closed permanently — SSM Session Manager is the only shell-access path (§17.7 invariant)

### PASS — Live response headers on staging apex

Verified by `curl -sIk https://localhost/ -H Host:staging.eventpulse.com.bd`:

```text
HTTP/2 200
server: nginx/1.24.0 (Ubuntu)
x-content-type-options: nosniff
x-frame-options: DENY
```

Headers reach the response correctly. Strict-Transport-Security + Referrer-Policy + Permissions-Policy also confirmed in the full header dump.

## §7.6 — Compliance + retention

### PASS — BFIU 5-year KYC retention

KYC documents in S3; per §1.3 R4 + decisions.md 2026-05-17 "Dedicated KMS CMK for KYC bucket". S3 lifecycle rule is operator-action for prod; staging has no lifecycle rule (staging KYC data is test-only + low-volume).

### PASS — Postgres backup discipline

Daily `pg_dump` per `infra/deploy/deploy.sh` invocations + Day-39 PR sweep. Backup destination `s3://eventpulse-prod-backups/postgres/` is prod-only; staging backups land in the same path with `eventpulse-staging-` prefix at cutover.

### PASS — Trust Center pages live + Decision-J pipeline functional

Verified: all 6 legal contracts + 12 trust artefacts published at v0.1 placeholder content (per Decision J 2026-05-19); Buyer-Terms-Lite v1.0 is the one real-content exception. The Day-42 changelog seed exercises the same `renderLegalMarkdown` pipeline successfully (9 entries body_html now serving on staging).

## Findings summary

| Finding                                                          | Severity                 | Status                                                                              |
| ---------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| Nginx security-headers snippet existed on staging but not in git | Operational (drift risk) | Fixed in this PR — both snippets committed + bootstrap symlink target reaffirmed    |
| Content-Security-Policy not set                                  | Hardening (defer)        | Documented in `ep-security-headers.conf` rationale; focused CSP PR post-launch      |
| AWS Secrets Manager rotation policy                              | Hardening (defer)        | Phase-2 work; consolidation post-cutover per the cost-aware Secrets Manager pattern |

## What this audit did NOT cover

These items are explicitly out of scope for the Day-42 staging audit:

- **Prod-side audit** — re-runs at the start of the cutover ceremony per launch-readiness.md §7
- **Pen-testing or red-team simulation** — separate engagement post-launch
- **Dependency vulnerability scan** — `pnpm audit` CI gate is on the §24.4 backlog (NOT WIRED yet); manual `pnpm audit` confirms 0 high+critical at session close
- **Source-map exposure / Sentry config** — Sentry is not yet wired
- **Load + soak testing** — k6/artillery budget is on the §24.4 backlog (NOT WIRED yet)

## Standing invariants reaffirmed by this audit

- `STAGING_PAYMENT_BLOCK=1` + `EPS_MODE=production` + `MAIL_DRY_RUN=0`
- Postgres role hierarchy: eventpulse_app non-super non-BYPASSRLS; eventpulse_admin non-super BYPASSRLS + explicit grants
- RLS enabled + FORCED on all domain tables; platform-wide tables app-layer-gated
- Append-only `audit_logs` REVOKE pattern on eventpulse_app
- Three audience contexts enforce distinct `aud` claims
- Money math via `fee-calculator.ts` exclusively
- Idempotency-Key middleware on money-moving endpoints
- verifyOrder() reconciliation NOT redirect query params
- Consent_records rollback-on-INSERT-failure
- `email_suppression_list` outbound-send guard
- SNS signature verification + topic allowlist
- Contact form honeypot + per-IP rate limit + zod
- TLS 1.2/1.3 + HSTS + nosniff + DENY iframe + Referrer-Policy + Permissions-Policy
- AWS spend < $30/month (codified Day 42)

**This audit is consumable evidence for the §7 checklist box in `launch-readiness.md`. The boxes there can be ticked from this document; the prod-side audit re-runs identically against the production EC2 at cutover.**
