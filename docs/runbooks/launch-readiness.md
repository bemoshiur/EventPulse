# Launch readiness — Event Pulse v1.0 (target 2026-06-10)

> **Status:** runbook. Created Day 42 (2026-06-01). The umbrella runbook that ties together every gate, every cutover sub-item, every standing constraint, and every first-paying-tenant obligation for the v1.0 launch. **Read top to bottom before the cutover ceremony starts. Re-read at every cutover sub-item.**
>
> **Purpose.** The §26.1 Day 9 marketing pages closed Day 42. The remaining Sprint-4 surface is Day 10 launch readiness — and "launch readiness" is not a single task but a coordinated set of gates, cutovers, and operator-led handoffs. This runbook is the single canonical surface that surfaces all of them so nothing falls through.

## Cross-references

- CLAUDE.md §26.1 (Sprint-4 Day 10 spec) — "Launch readiness — Acceptable Use Policy reviewed, host-liability clause confirmed by lawyer, security checklist passed, prod EC2 cut over, onboard first paying tenant."
- CLAUDE.md §29 — Open Decisions (9 resolved at Day 42; 0 outstanding launch blockers)
- `.claude/memory/decisions.md` 2026-06-01 "STANDING CONSTRAINT: AWS spend hard ceiling = $30/month" — the cost ceiling that overrides §17.x prod-target spec until v2.4 playbook bump
- `.claude/memory/handoff.md` "Pre-launch tracks — remaining work" table (current state)
- `docs/runbooks/production-smoke.md` — BDT-100 EPS production rate-confirmation smoke (PR #230, Day 38)
- `docs/runbooks/sns-bounce-complaint-aws-wiring.md` — Phase 4 AWS-side wiring procedure (production copy lands as sub-step of prod cutover)
- `docs/runbooks/staging-bootstrap.md` — Ansible + bootstrap-script pattern (template for prod EC2 sub-step)

## Final gate state at Day 42 close

10 launch-gate items ✅ resolved:

| # | Item | Resolved | Pointer |
|---|---|---|---|
| 1 | EPS sandbox credentials | 2026-05-26 | `eventpulse/staging/eps-sandbox` |
| 2 | SES out-of-sandbox approval | 2026-05-31 | AWS case 177899559700777 |
| 3 | EPS fee-model structural decision | 2026-05-31 (Option 3 chosen) | Day 38 PRs #227-#230 |
| 4 | §29 #9 AIT classification | 2026-05-26 | CA Jannatul Maoua opinion |
| 5 | §29 #10 NBR/VAT registration model | 2026-05-31 | CA Jannatul Maoua opinion |
| 6 | Salehin: Buyer Terms framing | 2026-05-31 | Reading (a) primary |
| 7 | Salehin: Incorporation path | 2026-05-31 | Path B LOCKED |
| 8 | Buyer-Terms-Lite v1.0 wire-in | 2026-05-31 (PR #237) | `consent_records` at checkout |
| 9 | Phase 4 SNS bounce/complaint AWS wiring | 2026-06-01 (Day 40) | Staging confirmed end-to-end |
| 10 | §26.1 Day 9 marketing pages | 2026-06-01 (Day 42) | PRs #244-#246 + hotfix #248 |

§29 Open Decisions tracking:

- **#5 Refund authority for MVP** → STRUCTURALLY RESOLVED 2026-06-01 Day 41 (PR #242 codes §29 policy verbatim)

**No legal blockers remain.** Operational gates only.

## Pre-launch operational gates (this runbook tracks each)

| Gate | Owner | Gate type | This runbook section |
|---|---|---|---|
| EPS production credentials arrival | Operator (external clock) | EPS-side | §1 |
| Production EC2 + cutover ceremony | Operator + Claude Code | Multi-session, STOP-ASK | §2 |
| Phase 4 production-side AWS wiring | Operator-authorised | Sub-step of #2 | §3 |
| `MAIL_DRY_RUN=0` prod flip | Operator | Sub-step of #2 | §3 |
| BDT-100 production EPS smoke | Operator + Claude Code | Gated on #1 + #2 | §4 |
| First paying tenant identification + onboarding | Operator-led | Final step | §5 |
| Cost ceiling enforcement | Both | Standing — checked at every AWS-write | §6 |
| Security checklist sweep | Claude Code | Pre-cutover audit | §7 |
| AUP + Terms host-liability spot check | Claude Code + Counsel | Pre-cutover audit | §8 |

## §1 — EPS production credentials arrival (external clock)

**Status:** PENDING. Operator-action #1 from Day 37 handoff.

**Gate.** No production transactions until the full credential set arrives from EPS:

- `merchant_id` (production)
- `store_id` (production)
- `username` + `password` (production)
- `hash_key` (production — separate from sandbox)
- Confirmation that `EPS_MODE=production` URL is `https://pgapi.eps.com.bd` (no sandbox subdomain)

**Operator action on arrival.**

1. Load credentials into AWS Secrets Manager at **a SINGLE consolidated entry** per the Day-42 cost-aware Secrets Manager pattern. Two options:
   - **Option A (recommended at MVP):** `eventpulse/prod/eps` already exists from a prior provisioning (per Day-40 reconciliation `decisions.md` "eventpulse/prod/eps AUTHORISED as canonical prod-cred holder"). Update its JSON payload with the production credential set.
   - **Option B (only if eps gets independent rotation cadence from rest of prod secrets):** keep `eventpulse/prod/eps` standalone; consolidate everything else into `eventpulse/prod/all`.
2. **Do not put the credentials in any environment file or git-tracked location.** Bootstrap script reads from Secrets Manager at instance launch.
3. Stamp arrival date + the operator who received them in `.claude/memory/decisions.md` as a closing entry on Open #1.

**This runbook's §4 (BDT-100 smoke) cannot start until §1 is complete.**

## §2 — Production EC2 + cutover ceremony

**Status:** PENDING. 8 sub-items per Day-37 audit critical-path step [14]. Each sub-item is its own STOP-ASK gated AWS-write session with cost-delta evaluation.

### Cost-aware overrides to §17.x prod-target spec

The decisions.md "STANDING CONSTRAINT: AWS spend hard ceiling = $30/month" entry overrides §17.x defaults. Re-read it before starting cutover. Specifically:

- Prod EC2 = **t3.small NOT t3.large** ($15/mo not $60/mo). Day-34 swap fix keeps t3.small viable.
- Secrets Manager = **consolidated JSON blob** (`eventpulse/prod/all` or update existing `eventpulse/prod/eps`) NOT 11 per-purpose entries.
- KMS CMKs = **3 max for MVP** (general staging + general prod + KYC prod). Skip the planned `eventpulse-payouts-prod` and `eventpulse-contracts-prod` CMKs until features ship + revenue justifies.
- CloudWatch Logs = **14-day retention max** on all log groups.
- §17.11 alarms on prod = **the 7-alarm catalogue** (CPU, memory, disk, error rate, payment success, disbursement batch, reconciliation invariant). Staging keeps only its 2.
- EBS snapshots = **weekly + 4-week retention** NOT daily + 7-day.

### 8 cutover sub-items (each is its own STOP-ASK session)

Each sub-item is a separate operator-authorised session. Do NOT batch.

| # | Sub-item | Est. monthly cost delta | Reference |
|---|---|---|---|
| 1 | Prod EC2 t3.small + Ansible bootstrap | +$15.00 | `docs/runbooks/staging-bootstrap.md` (template) |
| 2 | Prod Route 53 records (8-record set per §17.6 production-target block — apex, www, api, app, admin, my, customers, wildcard) | +$0 (in existing zone) | CLAUDE.md §17.6 |
| 3 | Prod wildcard cert via DNS-01 (`*.eventpulse.com.bd` + `eventpulse.com.bd` SANs) | $0 (Let's Encrypt) | §17.7 |
| 4 | `eventpulse-deploy-prod` GitHub-OIDC role (canonical three-claim trust pattern per §17.9.1) | $0 | `infra/scripts/setup-github-oidc.sh` |
| 5 | Secrets Manager prod entries — **consolidated JSON blob pattern, NOT per-purpose** | +$0.40-0.80 | This runbook §6 |
| 6 | 1 prod KMS CMK (`alias/eventpulse-kyc-prod`) — general prod uses existing `alias/eventpulse-staging` rotated to a new alias `eventpulse-prod` or kept dual-purpose for MVP | +$1-2 | Cost-aware §17.9 amendment |
| 7 | Prod-branch ff-merge (`origin/prod` at `21dad2cc` → current main; ~105+ commits) | $0 | git |
| 8 | §17.11 alarm catalogue copy to prod (7 alarms) | +$0.70 | Day-41 CW CPU alarm as template |

**Total cutover cost delta: ~$17-19/month** (additive to current $26/mo = ~$43-45/mo unless additional trims land — see §6 of this runbook).

### Critical ordering invariants

- **#1 before #2** — instance must exist before DNS points at it
- **#1 before #4** — OIDC trust policy needs the instance ID for the SSM dual-ARN pattern (§17.9.1)
- **#4 before #8** — alarms ship via deploy.sh which needs the OIDC role
- **#7 before #8** — alarms target deploy artefacts that ride on the prod-branch ff-merge
- **#8 before §3 below** — Phase 4 SNS production wiring is sub-step of cutover; runs only after the §17.11 alarm catalogue is up (the bounces/complaints SNS topics in §3 become part of that alarm surface)

## §3 — Phase 4 production-side AWS wiring (sub-step of §2)

**Status:** PENDING. Copy of Day 40's 8-step procedure with `-prod` suffixes + `api.eventpulse.com.bd` host. Lands as sub-step #9 of cutover (after the 8 sub-items above).

**Reference.** `docs/runbooks/sns-bounce-complaint-aws-wiring.md` is the staging procedure. Production version is byte-identical except for:

- SNS topic names: `eventpulse-ses-bounces-prod` + `eventpulse-ses-complaints-prod`
- HTTPS subscription URLs: `https://api.eventpulse.com.bd/api/v1/webhooks/ses-bounce` + `.../ses-complaint`
- SES Configuration Set: `eventpulse-prod`
- All IAM trust policies + topic-policy SourceArn claims rebind to the prod EC2 instance ID

**Critical reminders carried from Day-40 gotchas:**

- SNS topics default to SignatureVersion=1; explicitly set v2 per-topic via `set-topic-attributes`
- SES Configuration Set event destinations publish with `eventType` (not legacy `notificationType`) — webhook handlers accept both via `sesPayloadEventType()` shim
- Both `ec2:instance` and `ssm:managed-instance` ARN forms required in SSM `SendCommand` resource policies (§17.9.1)
- After AWS-side wiring confirmed by mailbox-simulator round-trip: flip `MAIL_DRY_RUN=0` on the prod EC2 (per the Day-41 staging flip pattern — source `.env.prod` + `pm2 reload api --update-env`)

## §4 — BDT-100 production EPS smoke

**Status:** GATED on §1 + §2. Own session per `docs/runbooks/production-smoke.md`. Highest-risk single operation in the launch runway.

**Pre-conditions (all must be TRUE before the session starts):**

1. §1 complete (EPS production credentials in Secrets Manager)
2. §2 complete (prod EC2 cut over, prod-branch ff-merged, deploy.sh works)
3. §3 complete (Phase 4 prod wiring confirmed via mailbox-simulator)
4. **STAGING_PAYMENT_BLOCK lift recorded** in decisions.md just before lift; re-enable immediately after
5. Operator on-call for the full smoke window (~30 min)
6. EPS merchant dashboard open for refund-if-needed; refund authority confirmed
7. The transaction's reversal path pre-arranged (the BDT 100 refund mechanic confirmed working)

**Session structure** (full procedure in `production-smoke.md`):

1. Operator opens EPS merchant dashboard in browser tab #1
2. Operator opens production tenant portal in browser tab #2 + provisions a one-off BDT 100 test event tier
3. Operator opens production public event landing in browser tab #3 + completes a BDT 100 bKash purchase as a buyer (own bKash account; NOT a customer account)
4. Server-side: `verifyOrder()` returns the EPS-charged fee in paisa
5. **Critical assertion:** the EPS fee should be 175 bps × 100 BDT = 1.75 BDT (175 paisa). If observed fee is **within 5%** of this value, the v1.0 calculator's `DEFAULT_EPS_FEE_BPS_ESTIMATE = 175` is confirmed. If significantly off, update the calculator BEFORE first paying tenant onboards (per `production-smoke.md` §6).
6. Operator immediately refunds the BDT 100 via the EPS merchant dashboard (no actual money should leave the platform)
7. Re-enable `STAGING_PAYMENT_BLOCK=1` on staging (production EC2 stays at production EPS_MODE; staging stays blocked from prod transactions)
8. Stamp the empirical fee + the refund reference in `decisions.md`

**If the smoke fails the 5% assertion:** halt launch sequencing; investigate before first-paying-tenant onboarding. The calculator MUST match production rate. This is the same single-source-of-truth discipline as the §14.2 Mode-A empirical observation that anchored Day-38's Option-3 decision.

## §5 — First paying tenant identification + onboarding

**Status:** PENDING. Operator-led identification; Claude Code prepares onboarding checklist (this section).

### Identification criteria

The first paying tenant must satisfy ALL:

- Hosts a paid event (forces KYC + bKash payment path exercise)
- Event date is after the launch target (2026-06-10) but before the operator's first-week vacation window (operator action item: confirm dates)
- Ticket face value modest (BDT 100-500 range — limits financial blast radius if the smoke is wrong)
- Bilingual audience preferred (Bangla + English) — exercises both locale paths
- Bangladeshi attendee base preferred — bKash is the only payment method at v1.0
- Organiser willing to be a "design partner" who reports issues directly to the operator within 24 hours
- KYC-grade documents on hand: NID (individual) or RJSC + Trade Licence + BIN + signatory ID (organisation)

### Onboarding checklist (operator runs after identification)

1. [ ] Send Buyer-Terms-Lite v1.0 + Privacy + ToS links via email; capture written acknowledgement
2. [ ] Operator confirms first-paying-tenant accepts Path-B-incorporation interim arrangement (Salehin's 4-6 week novation window applies; operator is the contracting party until Pvt Ltd certificate issues)
3. [ ] Tenant signs up via the apex landing page; chooses account type via the post-login Account-Type modal
4. [ ] Tenant submits KYC submission via the new wizard (Individual Tier 1 or Organisation Tier A); operator reviews via super-admin queue
5. [ ] On approve: tenant subdomain auto-provisions; tenant gets the `kyc_approved` SES email
6. [ ] Tenant creates the event via the (limited-template) event wizard; configures ticket tier with `price_paisa > 0`; confirms event-level fee-handling mode (both pass-through default per §14)
7. [ ] Tenant publishes the event; the public event page is reachable at `{tenant}.eventpulse.com.bd/{event-slug}`
8. [ ] Operator runs a **test purchase** on the live event with own bKash account; refunds via EPS dashboard immediately
9. [ ] Operator confirms with tenant that the public page renders correctly + buyer journey is clean
10. [ ] Tenant goes live; operator monitors `/admin/revenue` dashboard hourly for the first 24 hours
11. [ ] At each successful purchase: operator manually verifies the consent_records row + the order_events trail + the QR ticket email delivered (no bounce/complaint)
12. [ ] First T+5 disbursement window: operator manually generates the BEFTN file from the order data (manual-disbursement-second-half is DEFERRED to Sprint 7; v1.0 launch is operator-attended)
13. [ ] Operator records the disbursement reference + the bank rail confirmation in `decisions.md` as the "first paying tenant disbursement successful" entry

### Communications cadence

- **Slack/WhatsApp daily for the first 5 business days** between operator and first-paying-tenant
- **One synchronous call** at the end of week 1 to gather feedback
- **Any issue reported by tenant: under-24h response from operator + decisions.md entry within the same day**

## §6 — Cost ceiling enforcement (carries forward post-launch)

**Standing constraint:** total AWS spend < $30/month combined across both envs. Codified in decisions.md 2026-06-01 "STANDING CONSTRAINT" entry.

**Current trajectory (Day 42 close):** ~$26/month with ~$4 headroom.

**Post-cutover projection:** ~$43-45/month at §17.x defaults; needs cost-aware deltas to fit.

### Cost-enforcement mechanisms

1. **AWS Budget alarm** ($25 actual + $30 forecast) — next AWS-write session. Free resource. Email notifications to operator's primary inbox (action item: operator confirms email address).
2. **Every AWS-write STOP-ASK** includes monthly cost delta + running total before proceeding.
3. **Cost-Explorer review at every EOD memory closeout** (Claude Code can't query Cost Explorer directly — blocked by SCP — but tracks resource-count-based estimates).
4. **Pre-merge cost diff in every infra PR's body** — "this PR adds/removes the following AWS resources" + "monthly cost impact: +$X / -$X / $0".
5. **No `t3.medium` upgrade** for MVP — Day-34 swap fix is the standing answer until revenue justifies.

### Trims available if trajectory threatens to exceed ceiling

| Trim | Saving | Cost |
|---|---|---|
| Switch staging EC2 to spot instances for non-business hours | ~$5-7/mo | Loses persistence; revisit post-launch |
| Drop staging KYC CMK; use AWS-managed for staging KYC bucket | $1/mo | Staging KYC data is test-only |
| Reduce EBS snapshot retention to 2 weeks | $0.10-0.30/mo | Reduces restore window |
| Reduce SES sending IP pool size (default 1 — already minimal) | $0 | No further trim |
| Consolidate staging + prod CloudWatch Logs into a single log group | $0.50-1/mo | Loses env-scoped log queries |

**If all trims applied at peak load: ceiling has $5-8/mo additional headroom.**

## §7 — Security checklist sweep

**Status:** PENDING. Claude Code runs at cutover-ceremony start.

### Pre-cutover security checklist

Each item is a separate audit task; each failure blocks cutover until resolved.

#### Authentication + Authorization

- [ ] `eventpulse_app` is **NOT a superuser** + **NOT BYPASSRLS** per §4.2.1 (verified at every migration)
- [ ] `eventpulse_admin` is **BYPASSRLS** + has explicit table grants per §4.2.1
- [ ] `withTenant()` always switches role to `eventpulse_app` via `SET LOCAL ROLE` BEFORE setting `app.current_tenant_id`
- [ ] Every domain table has RLS enabled + FORCED per §4.3 template
- [ ] Append-only tables (`audit_logs`, future entries) have explicit `REVOKE UPDATE, DELETE, TRUNCATE` from `eventpulse_app` per §4.2.1.1
- [ ] JWT signing keys rotated within the last 90 days (currently `eventpulse/staging/jwt-access-secret` + `jwt-refresh-secret`)
- [ ] Three audience contexts (super-admin, tenant, attendee) enforce distinct `aud` claims; no cross-audience token reuse
- [ ] OAuth providers (Google + Apple) configured with correct redirect URIs for production hostnames

#### Money path

- [ ] Money math goes through `fee-calculator.ts` EXCLUSIVELY (no fee arithmetic in marketing page server math beyond the drift-guard-tested mirror)
- [ ] Order creation requires `Idempotency-Key` header per §6.4 + §1.3 R6
- [ ] Order capacity locks use row-level locks (no race on the last ticket of a tier)
- [ ] `paid` status comes from EPS Verify, not from the redirect query params (§1.3 R3)
- [ ] `STAGING_PAYMENT_BLOCK=1` on staging refuses any priced order in `awaiting_payment` regardless of EPS_MODE
- [ ] Refund flow requires super-admin approval; super-admin notes mandatory on reject (PR #242 Day 41)

#### Data protection

- [ ] KYC documents in S3 encrypted with `alias/eventpulse-kyc-prod` CMK
- [ ] No raw PII in pino logs (verified by spot-check of recent api logs)
- [ ] `email_suppression_list` enforces outbound-send guard (PR #237 Day 40)
- [ ] `consent_records` rolled into the same `withSuperAdmin` tx as order creation (PR #237 Day 39 PM)
- [ ] `audit_logs` writes one row per state change; actor_type split (super_admin vs tenant_user) preserved

#### Webhook security

- [ ] EPS webhook handlers use verify-by-callback (verifyOrder() against EPS) — payload itself is not authoritative
- [ ] SNS webhook handlers verify Amazon-issued signature using `verify-signature.ts` (Day 39 Phase 4)
- [ ] SNS topic allowlist (`SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` env vars) — non-matching TopicArns return `verify:"topic_not_allowed"`

#### Transport + network

- [ ] All public hostnames use TLS 1.2+ (verified via SSL Labs or `ssl-cert-check`)
- [ ] Let's Encrypt wildcard cert + apex cert valid for at least 30 days post-launch
- [ ] Nginx security headers configured (HSTS, X-Frame-Options, X-Content-Type-Options) per `infra/nginx/snippets/security-headers.conf`
- [ ] Port 22 closed permanently — SSM Session Manager only per §17.7

#### Compliance + retention

- [ ] BFIU 5-year KYC retention enforced via S3 lifecycle rule
- [ ] Postgres `pg_dump` daily backup uploaded to S3 with versioning
- [ ] CloudTrail enabled on the production account (cost: ~$0 for management events)
- [ ] Trust Center pages reachable + Decision-J pipeline produces sanitised body_html

## §8 — AUP + Terms host-liability spot check

**Status:** AUDIT at Day-42 close. Counsel content for full AUP body is Phase-2 scope.

**Current state.** All 6 legal contracts + 12 trust artefacts are published at v0.1 placeholder content per Decision J 2026-05-19. Buyer-Terms-Lite v1.0 (Salehin-approved 2026-05-31) is the one exception with real body.

**Host-liability framing audit (PASS at Day 42 close):**

- §21.3 "Host Liability Clause" verbatim text exists in CLAUDE.md as the binding clause for tenant Terms
- Buyer-Terms-Lite v1.0 incorporates the framing via §3 (Salehin-approved language)
- /trust/acceptable-use page is published as v0.1 placeholder — body content pending counsel return
- /terms page is published as v0.1 placeholder — body content pending counsel return
- /trust/transparency page is published as v0.1 placeholder — body content pending counsel return

**Launch posture on counsel-pending v0.1 placeholders:**

The v0.1 placeholder content (real headings + one-sentence "PLACEHOLDER — to be drafted by counsel covering X" per section) was operator-approved per Decision J 2026-05-19 specifically so the launch is not blocked on counsel timing. The first-paying-tenant onboarding (§5) explicitly requires:

1. Buyer-Terms-Lite v1.0 (DONE — body content real)
2. Operator-tenant interim arrangement: tenant accepts that v0.1 placeholders bind via the same Decision-J consent-mechanic (operator confirms with tenant in writing during onboarding)
3. Salehin's 4-6 week novation window applies: tenant accepts re-acknowledgement of finalised v1.0 docs once counsel returns

**Pre-launch action items (none block launch; all scheduled post-launch):**

- [ ] Operator follows up with Law Legacy Bangladesh on remaining 5 doc bodies (Refund Policy, AUP, Cookies, DPA, EULA — Privacy + Terms are DONE per Day-39)
- [ ] Once counsel returns: publish v1.0 versions via the super-admin Legal & Trust editor; trigger material-change consent re-flow per §20.4
- [ ] AUP triage queue + report-button UI (§9.15 + §10.1 + §21.5) ships in Sprint 8 per §26.2 — NOT a launch blocker per §26.1 Day 9 spec

## Post-launch monitoring expectations (first 7 days)

- **Hourly:** `/admin/revenue` dashboard headline KPIs (Day-35 PR #197)
- **4-hourly:** CloudWatch CPU 85% alarm state; any alarm triggered = operator pages own phone
- **Daily:** `email_suppression_list` count (Day-40 Phase 4 — alerts on unexpected growth)
- **Daily:** `audit_logs` count + spot-check 10 random rows
- **Daily:** `/health` 200 + DB ms < 50 expected
- **Weekly (Mondays):** Cost Explorer review against $30 ceiling
- **At every state-changing operation:** decision/gotcha codification within the same session

## Standing invariants (re-stated for the launch crew)

These survive launch unchanged:

- `STAGING_PAYMENT_BLOCK=1` on staging (lift only for §4 BDT-100 smoke; re-enable immediately)
- `EPS_MODE=production` on prod EC2 after §1 + §2
- `MAIL_DRY_RUN=0` on prod EC2 (sub-step of §3)
- All money math via `fee-calculator.ts` exclusively
- All consent capture via `consent_records` (failure rolls back order)
- All outbound email consults `email_suppression_list` first
- All super-admin operations write `actor_type='super_admin'` to audit_logs
- Cross-tenant guards return 404 (not 403) on tenant-portal endpoints
- AWS spend < $30/month total
- Per-purpose KMS CMKs only for high-PII surfaces (KYC); general CMK shared
- 14-day CloudWatch Logs retention
- §17.11 alarm catalogue full on prod; minimal on staging

## When this runbook is out of date

This runbook is canonical at Day 42 close. Update with every new launch-impacting decision codified in `decisions.md`. Surfaces of likely change between Day 42 and the launch date:

- §1 transitions from PENDING to DONE when operator receives EPS prod credentials
- §2 transitions through 8 sub-step DONE checkpoints
- §3 lands as a single session after §2 completes
- §4 runs ONCE; outcome stamped in decisions.md
- §5 runs ONCE per first-paying-tenant cycle; subsequent paying tenants don't follow this runbook
- §6 carries forward post-launch as steady-state operations discipline
- §7 + §8 rerun at each material architectural change

**Final reminder:** the operator drives every section. Claude Code prepares + verifies + surfaces; the operator decides + executes + accepts cost-of-failure for the live financial pipeline.
