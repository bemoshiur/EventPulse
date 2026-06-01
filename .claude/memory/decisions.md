# Event Pulse — Decisions Log

Append-only. Most recent at the top. If a decision is superseded, add a new entry on top with `Supersedes: <date of old decision>` and add a note to the old one with `Superseded by: <date of new decision>`.

---

## 2026-06-01 · Day 40 EOD — Phase 4 SNS bounce/complaint suppression-list AWS-side wiring SHIPPED end-to-end on staging

**Closes:** the AWS-side STOP-ASK gate from Day 39 PM's Phase 4 PR #236 ("AWS Console writes — SNS topic creation + Configuration Set + IAM — STOP-ASK for separate operator-authorised session"). Phase 4 is now operational end-to-end on staging: SES bounces + complaints route through SNS → webhook → `email_suppression_list` → outbound-send guard. Verified by mailbox-simulator round-trip.

### Context

Day 39 PM PR #236 shipped the Phase 4 code (verify-signature.ts, ses-bounce.ts + ses-complaint.ts webhooks, suppression-list service, outbound-send guard in SES client, migration 0014 `email_suppression_list`) with the AWS-side wiring **deliberately NOT executed** (STOP-ASK boundary). Runbook authored at `docs/runbooks/sns-bounce-complaint-aws-wiring.md` documented the 7-step procedure.

Day 40 (this entry) executed the wiring on staging via 8 STOP-ASK-gated steps, each operator-approved before any AWS or EC2 write:

| Step | Action | Verification |
|---|---|---|
| 0 | Read-only baseline (no writes) | 0 existing eventpulse SNS topics; 0 Config Sets; webhook endpoints reachable + fail-closed |
| 1 | Create 2 SNS topics: `eventpulse-ses-bounces-staging` + `eventpulse-ses-complaints-staging` | ARNs recorded; tags `Environment=staging, Service=ses-feedback, Owner=eventpulse` |
| 1.5 | Append `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` to `.env.staging` + reload api with `set -a; source` pattern | `/proc/<api-pid>/environ` confirms env vars live; webhook returns `signature_mismatch` (not `topic_not_allowed`) for matching ARN, proving allowlist active |
| 2 | Apply IAM topic policy to both topics: allow `ses.amazonaws.com` → `sns:Publish` with `SourceAccount` + `SourceArn` confused-deputy guards | Read-back via `get-topic-attributes` matches |
| 3 | HTTPS subscriptions to webhook URLs + topic `SignatureVersion=2` opt-in + fresh subscribe to trigger SubscriptionConfirmation with SHA256 signature | Both subscriptions transition `PendingConfirmation` → full ARN; api log shows `webhook.sns.subscription_confirm` for each |
| 5 | SES Configuration Set `eventpulse-staging` + 2 event destinations (BOUNCE → bounces topic; COMPLAINT → complaints topic) | `get-configuration-set-event-destinations` shows both enabled |
| 6 | Append `AWS_SES_CONFIGURATION_SET=eventpulse-staging` to `.env.staging` + reload api with source pattern | `/proc/<api-pid>/environ` confirms; SES client (`apps/api/src/infra/ses/client.ts:120`) reads the var → passes `ConfigurationSetName` on every send |
| 7 | Send 2 mailbox-simulator emails (bounce + complaint) via AWS CLI with `--configuration-set-name eventpulse-staging` | Full chain landed: api logs `webhook.ses.bounce.suppressed` (`hard_bounce`) + `webhook.ses.complaint.suppressed`; `email_suppression_list` row inserted for each; cleanup DELETE verified empty post-test |

Standing invariants (`STAGING_PAYMENT_BLOCK=1`, `EPS_MODE=production`, `MAIL_DRY_RUN=1`, `/health db=ok`) preserved throughout.

### Two bugs surfaced + fixes

**Bug 1: SNS topic default `SignatureVersion=1`.** Topics default to SHA1; our `verify-signature.ts` only accepts v2 per AWS recommendation. The initial subscribe call's SubscriptionConfirmation was rejected with `verify:"bad_signature_version"`. **Fix:** `aws sns set-topic-attributes --attribute-name SignatureVersion --attribute-value 2` on both topics, then issue fresh subscribe (subscriptions in PendingConfirmation can't be unsubscribed via API; a fresh subscribe generates a new pending sub signed with v2). Documented in `gotchas.md` "SNS HTTPS subscriptions default to SignatureVersion=1".

**Bug 2: SES envelope field name mismatch.** Phase 4 PR #236's webhook handlers checked `notificationType` only — based on the legacy `SetIdentityNotificationTopic` envelope shape. Configuration Set event destinations (Day 40 mechanism) publish with `eventType` instead. Mailbox-simulator round-trip showed `webhook.ses.message_unparseable` in api logs even though signature + topic-allowlist + cert checks all passed. **Fix:** PR #239 — accept BOTH field names via a small `sesPayloadEventType()` helper in each webhook. Forward + backward compatible. Merged + deployed mid-Day-40; re-running the round-trip landed both suppression rows cleanly. Documented in `gotchas.md` "SES publishes bounce/complaint events to SNS with `eventType`, not `notificationType`".

### Third gotcha codified (architecture knowledge, not a bug)

**`pm2 reload --update-env` only sees env vars from the parent shell.** The api process doesn't use `dotenv`; env loading happens via `deploy.sh:49`'s `set -a; source $ENV_FILE; set +a` pattern, then pm2 reload injects the parent shell's env into the restarted process. SSM `AWS-RunShellScript` runs each command in a fresh shell with no `.env.staging` sourced — so naive `pm2 reload --update-env` doesn't propagate new env vars. **Always wrap reload with the source pattern:**

```bash
sudo -u eventpulse bash -c '
  set -a
  source /home/eventpulse/.env.staging
  set +a
  pm2 reload api --update-env
'
```

Documented in `gotchas.md` "`pm2 reload --update-env` only sees env vars from the parent shell".

### Decision (atomic)

**Phase 4 SNS bounce/complaint suppression-list pipeline is LIVE on staging as of 2026-06-01.** End-to-end verified. The `MAIL_DRY_RUN=0` flip is now structurally enabled — the AWS Support case 177899559700777 commitment is satisfied. The flip itself remains a **separate operator decision** (recommended sequence: flip on staging, run synthetic sends through the platform's SES client, confirm no unexpected suppressions accumulate, leave staging at 0 indefinitely).

The production-equivalent wiring (substitute `-staging` → `-prod` in resource names + webhook URL host) is now a copy-paste of this exact 8-step procedure, applied during the production EC2 cutover ceremony per critical-path step [14].

### Resources created on staging (AWS-side state)

- SNS topic `arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-bounces-staging` (SignatureVersion=2; IAM policy allows `ses.amazonaws.com` → `sns:Publish`)
- SNS topic `arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-complaints-staging` (same shape)
- HTTPS subscription `…:eventpulse-ses-bounces-staging:764fb5c1-…` → `https://api.staging.eventpulse.com.bd/api/v1/webhooks/ses-bounce`
- HTTPS subscription `…:eventpulse-ses-complaints-staging:a94e2110-…` → `https://api.staging.eventpulse.com.bd/api/v1/webhooks/ses-complaint`
- SES Configuration Set `eventpulse-staging` with `bounces-to-sns` + `complaints-to-sns` event destinations
- EC2 env vars: `SES_BOUNCE_TOPIC_ARNS`, `SES_COMPLAINT_TOPIC_ARNS`, `AWS_SES_CONFIGURATION_SET=eventpulse-staging`

### Day 40 AWS billing tally — actually zero

| Item | Cost |
|---|---|
| 2 SNS topics | $0 (resource creation free) |
| 2 HTTPS subscriptions | $0 |
| 1 SES Configuration Set | $0 |
| 2 event destinations | $0 |
| ~6 SES test sends (mailbox simulator; no reputation impact) | ~$0.001 |
| ~12 SNS publishes (4 subscription confirmations + ~8 actual events) | ~$0.0001 |
| ~40 AWS CLI list/get/describe + SSM commands | $0 |
| CloudWatch metric queries | $0 |
| **Day 40 total** | **< $0.002** (essentially zero) |

**Ongoing monthly cost from Phase 4 wiring at expected MVP launch volume (sub-100 bounces/month):**

- SNS publishes per real bounce/complaint: $0.50/million → at MVP scale, **~$0/month**
- Configuration Set + topics + subscriptions: $0/month
- **Net new ongoing cost: ~$0/month**

### Consequences

- **Phase 4 launch gate item ✅ CLOSED.** `docs/runbooks/sns-bounce-complaint-aws-wiring.md`'s "STOP-ASK boundary" no longer applies on staging. The pre-launch commitment from Day-39 PM handoff (item 1 of "Next pre-launch items — entirely AWS / infrastructure / ceremony track") is satisfied for staging.
- **The legal track + the SES bounce/complaint observability infrastructure are both now closed.** Remaining pre-launch work is entirely EPS-credentials-clock + production cutover ceremony + production smoke + first-tenant onboarding.
- **`MAIL_DRY_RUN=0` flip on staging is now structurally enabled** — separate operator decision (not in this session's scope).
- **The runbook needs a v1.1 amendment** — add a step for SignatureVersion=2 attribute set after topic creation (the missing step that surfaced as Bug 1). Day 40 backlog: amend `docs/runbooks/sns-bounce-complaint-aws-wiring.md` with the corrected 9-step sequence (steps 0 + 1 + 1.5 + 2 + 3 + 5 + 6 + 7 from this entry + a SignatureVersion-set step bundled into 1).
- **Production cutover.** When production EC2 lands, the same 8 steps run with `-prod` suffixes and the `api.eventpulse.com.bd` webhook host. The Phase 4 code on prod will Just Work because PR #239's dual-field shape handles either mechanism.

### Cross-references

- **Phase 4 code:** PR #236 (Day 39 PM) — `apps/api/src/infra/sns/verify-signature.ts`, `apps/api/src/routes/webhooks/ses-bounce.ts` + `ses-complaint.ts`, `apps/api/src/services/notifications/suppression-list.ts`, `apps/api/src/infra/ses/client.ts` outbound-send guard, migration 0014 `email_suppression_list`
- **Bug 2 fix:** PR #239 (Day 40) — `fix(notifications): accept SES eventType + notificationType envelopes`
- **Runbook:** `docs/runbooks/sns-bounce-complaint-aws-wiring.md` (needs the SignatureVersion-set step amendment)
- **Gotchas codified Day 40:** `gotchas.md` top 3 entries — `eventType` vs `notificationType`, SNS SignatureVersion-1 default, pm2-reload-env-source pattern

---

## 2026-05-31 · Day 39 PM EOD — Buyer-Terms-Lite v1.0 SHIPPED end-to-end (sign-off chain Step 5 ✅ CLOSED; legal track entirely closed)

**Closes:** the v0.3 sign-off chain in `docs/legal/buyer-terms.md`. Step 4 (operator final sign-off on v0.3 → v1.0 promotion) cleared 2026-05-31 with Salehin's "all good to go" final-check confirmation. Step 5 (wire into checkout `consent_records`) cleared 2026-05-31 with PR #237 merged + deployed + smoke-confirmed live.

**Closes (broader frame):** Salehin's Buyer-Terms-Lite engagement is now **end-to-end COMPLETE.** v0.1 → v0.2 (operator) → v0.3 (Salehin round 1 + operator selective-adoption clarification) → v1.0 (Salehin "all good to go" + operator final sign-off + checkout wire-in). The legal track of the Day-39 work shape is closed.

### Context

Day 39 AM reconciliation (top entry below this one and the two further-down Salehin entries) captured Salehin's substantive review of v0.2; v0.3 was drafted with four edits applied (§1 minor-age verbatim per Salehin / §4 BN "পরোক্ষ ক্ষতি" / §3 fraud-prevention recipient / §4 Clause 6.2 verbatim five-exception list with selective adoption boundary). Two BN-rendering items ("সম্মতি ও তত্ত্বাবধানে" for "consent and supervision"; "প্রতারণা বা প্রতারণামূলক উপস্থাপনা" for "fraud or fraudulent misrepresentation") were flagged for Salehin's final-check.

Salehin's 2026-05-31 final-check reply: **"all good to go"** — no edits requested; both flagged BN renderings confirmed acceptable. Operator final sign-off cleared same day.

PR #237 (`feat/buyer-terms-v1-consent-wire-in`) shipped Day 39 PM in 6 commits (4 substantive + 2 CI-fix). Merged to main at `6e54f34` (squash commit "feat(checkout): Buyer-Terms-Lite v1.0 consent_records wire-in (#237)") at **2026-06-01T10:31:02Z UTC**. Deploy completed SUCCESS same UTC window. Migration 0015 applied (`consent_records` table). Seed `db:seed:buyer-terms-v1` ran via SSM bootstrap-recovery (see gotcha below) — 12104 bytes HTML cached on `legal_document_versions.body_html`; row effective at `2026-06-01T10:32:57.174Z UTC`.

### Decision (atomic)

**Buyer-Terms-Lite v1.0 is the canonical buyer-terms surface for v1.0 launch.** It ships in checkout as of 2026-06-01T10:32:57 UTC (deploy SHA `6e54f34`; seed row effective same window). All paid + free orders at checkout from this point forward capture a `consent_records` row anchored by `order_id`, pointing at (document_id, version_id) for `slug='buyer-terms'` + `version='v1.0'`.

**The Day-34 link-footer pattern is dead** — replaced atomically by the bilingual clickwrap line + collapsible body panel in `apps/web/src/components/public/buyer-form.tsx`. Regression-guard test pins the absence of the old footer text.

### Selective-adoption boundary preserved (verbatim from PR #237 description)

- **Clause 6.2 exception list — ✅ ADOPTED VERBATIM** in §4 carve-out list: (a) Gross negligence or wilful misconduct; (b) Fraud or fraudulent misrepresentation; (c) Breach of fiduciary duty; (d) Death or personal injury caused by negligence; (e) Any other liability that cannot be limited or excluded by applicable law.
- **Clause 6.1 (cap formula: "total fees received from the Organiser during 12 months preceding") — ❌ DELIBERATELY NOT ADOPTED** per Salehin's written confirmation 2026-05-31. Buyer-side cap stays "total ticket amount you paid". Rationale: Organiser-side 12-month-fees cap is B2B-appropriate; applying it to consumers would be mismatched and could create enforceability issues.
- **Clause 6.3 (Organiser-indemnifies-Platform) — ❌ DELIBERATELY NOT ADOPTED** per Salehin's written confirmation 2026-05-31. A buyer-indemnifies-Platform clause would carry Consumer Rights Protection Act 2009 risk; inappropriate for a v1.0 consumer-facing lite document.

### Out-of-v1.0 scope (per Salehin 2026-05-31, explicitly deferred)

A **narrow buyer indemnity limited to fraud or wilful abuse** may be revisited post-launch with transaction data. Explicitly deferred from v1.0 per the editing-notes section of `docs/legal/buyer-terms.md`. Revisit gate: real customer-pattern data from launch + first 30 days (fraud incident rate, account-abuse pattern frequency, dispute classification) informing Salehin's draft.

### Architecture (load-bearing for future reviewers)

**The consent_records INSERT lives INSIDE the existing `withSuperAdmin` order-creation tx in `apps/api/src/services/orders/index.ts`** — positioned AFTER `audit_logs` INSERT and BEFORE the tx commits, anchored by `order_id`, with `(document_id, version_id)` resolved via the new helper `apps/api/src/services/consent/buyer-terms.ts:resolveBuyerTermsCurrentVersion`.

**This is the operator-spec'd precondition behavior** ("consent capture is a precondition, not a side effect"). Failure modes:

1. `resolveBuyerTermsCurrentVersion` throws (e.g. seed not run, `currentVersionId` NULL) → `BuyerTermsNotSeededError` → tx rolls back → orders row never persists → STEP 7 EPS Initialize never fires.
2. `consent_records` INSERT throws (FK violation, RLS, DB hiccup) → same rollback chain → no order, no EPS.
3. tx commits successfully but STEP 7 EPS init fails → order persists in `awaiting_payment` WITH consent captured (correct — consent IS captured pre-EPS).

Both free and paid events capture consent (the document covers ALL platform usage — data processing, platform's limited role, liability — not just payment). The bilingual clickwrap line varies by button label ("Continue with bKash" vs. "Confirm registration") but the consent semantics are identical.

### Schema amendment vs CLAUDE.md §9.11

Migration 0015 amended §9.11's spec for guest-buyer reality:

- `user_id` is **nullable** (guest buyers have no user_id at checkout).
- `order_id` is **NEW** (guest-checkout anchor).
- CHECK requires at least one of `(user_id, order_id)` to be set.
- §9.11's `UNIQUE (user_id, document_id, version_id)` **dropped** — guest consents wouldn't satisfy it; authenticated-user uniqueness story ships later when a `/my` consent surface lands. Out of v1.0 scope.

RLS enabled + FORCED with **NO policies** — mirrors `legal_document_versions` pattern (Decision K 2026-05-19); all v1.0 reads/writes via `withSuperAdmin`. Future tenant/user-portal read surfaces add policies in their own migrations alongside the read code.

NOT append-only: `withdrawn_at` is UPDATE'd to mark consent withdrawal; §4.2.1.1 invariant explicitly does NOT apply.

### Consequences

- **Step 5 of v0.3 sign-off chain CLOSES.** The chain is 5/5 ✅ in `docs/legal/buyer-terms.md`. Salehin's Buyer-Terms-Lite engagement is end-to-end complete.
- **Legal track of the Day-39 work shape closes entirely** — both overnight legal replies (Salehin Buyer Terms, Salehin incorporation Path B, CA NBR/VAT) processed end-to-end this single day. §29 #9 + #10 both RESOLVED; both Salehin items both RESOLVED.
- **The legal-doc consent-capture pattern is now established** for future Trust Center docs. When `privacy` / `terms` / `eula` / `dpa` / `cookies` / `refund-policy` ship v1.0 (post counsel-completion), they follow the same wire-in shape: `legal_documents` row + `legal_document_versions` row at v1.0 + consent capture inside the relevant tx + a clickwrap reference on the relevant submit surface.
- **Pre-launch commitment list shrinks by one** — the Day-39-morning "Buyer-Terms-Lite document at checkout (NEW)" line is replaced by "DONE 2026-05-31 Day 39 PM" in `handoff.md`.
- **Next pre-launch commitments are entirely AWS / infrastructure / ceremony track:** (a) Phase 4 SNS topic creation (own operator-authorised session per runbook); (b) BDT-100 production bKash smoke (own gated session per runbook); (c) production EC2 cutover ceremony (8 sub-items from the Day-37 audit's critical-path step [14]). The legal track is no longer a launch blocker.

### Day 39 PM PR sweep (record of what shipped today end-of-day)

Four PRs landed Day 39 (in order):

1. **PR #233** (`memory: Day 39 AM reconciliation`) — merged `48460a2`. Salehin + CA written replies captured verbatim in this `decisions.md` (three entries below) + `handoff.md` Day-39-AM-state rewrite.
2. **PR #232** (`feat(admin): Phase 2b disputed-orders workflow`) — merged `719967b`. State machine `disputed → refunded`; `writeOrderRefunded` audit helper; `order-disputed-wrong-method` SES template (XSS-hardened); `manualRefundService`; super-admin GET `/admin/orders/disputed` + POST `/admin/orders/:id/mark-refunded`. CI-fix required (`Option A` test-isolation patch on `GET /disputed` assertions — assert presence-of-our-seeded rows + absence-of-our-seeded-paid instead of exact list length, because the super-admin queue is global by design).
3. **PR #236** (`feat(notifications): SNS bounce/complaint suppression-list — code-only Phase 4`) — merged `ed03132`. `email_suppression_list` table (migration 0014); X.509 RSA-SHA256 SNS signature verification with TopicArn allowlist (load-bearing trust-source check) + ±1-hour timestamp freshness; SES bounce + complaint webhooks; outbound-send guard in SES client. AWS-side wiring (SNS topic creation + Configuration Set + IAM) **STOP-ASK gated** — runbook `docs/runbooks/sns-bounce-complaint-aws-wiring.md` documented but NOT executed. Three operator-required clarifications in PR description: anchored regex confirmation; replay-defense scope (MessageId-replay deferred with idempotency rationale); topicArn-in-log observability fix landed within PR scope (commit `65f428b`).
4. **PR #237** (`feat(checkout): Buyer-Terms-Lite v1.0 consent_records wire-in`) — merged `6e54f34`. This entry.

### Operator-action items remaining after Day 39 PM EOD

Per the post-Phase-2 reframe, **only one external-clock item still gates June 10 launch**: EPS production credentials (operator-action #1; gates critical-path step [4]→[5]→[6] production smoke). All four operator-action items from the Day-38 EOD shape are now: #1 ⏳ still pending; #2 ✅ resolved Day 39 (Salehin Buyer-Terms-Lite engagement end-to-end complete); #3 ✅ resolved Day 39 AM (CA NBR/VAT written opinion); #4 ✅ identified Day 38 EOD (first paying tenant) — onboarding sequence ready once Phase 4 AWS-side wiring + production smoke + the cutover ceremony complete.

### Cross-references

- **Doc:** `docs/legal/buyer-terms.md` (canonical APPROVED v1.0; replaces the prior `buyer-terms-lite-draft.md` filename)
- **Migration:** `apps/api/src/db/migrations/0015_consent_records.sql`
- **Schema:** `apps/api/src/db/schema/index.ts` (`consentRecords` export)
- **Seed:** `apps/api/src/db/seeds/seed-buyer-terms-v1.ts` + `apps/api/src/db/seeds/buyer-terms-v1-body.ts`
- **Service helper:** `apps/api/src/services/consent/buyer-terms.ts` (`resolveBuyerTermsCurrentVersion` + `BuyerTermsNotSeededError`)
- **Service tx-seam:** `apps/api/src/services/orders/index.ts` (lines after `audit_logs` INSERT, before `return oid`)
- **Frontend:** `apps/web/src/components/public/buyer-form.tsx` (clickwrap line + body panel + Day-34 footer removed); `apps/web/src/components/public/event-landing.tsx` (props threaded); `apps/web/src/app/(public)/[tenant]/[event]/page.tsx` (parallel fetch)
- **Tests:** `apps/api/src/services/orders/orders.test.ts` (two new precondition tests at end of file); `apps/web/src/components/public/buyer-form.test.tsx` (clickwrap render + body render + Day-34 footer absence)
- **Prior day's frame:** `decisions.md` entries directly below this one — Salehin Buyer Terms reading (a) + Salehin incorporation Path B + CA NBR/VAT (§29 #10).

---

## 2026-05-31 · Day 39 — CA written opinion received on NBR/VAT (§29 #10) — RESOLVED with written record

**Resolves:** §29 #10 NBR/VAT registration model (the last open §29 launch-blocking legal question per CLAUDE.md §29 "MUST resolve with NBR before MVP launch"). This entry is the canonical written-record citation; §29 #10 moves from "external clock" / "still open" to RESOLVED at Day 39.

### Context

The operator submitted a written request to the CA who previously handled the AIT opinion (2026-05-26 resolved entry). The CA's reply arrived overnight 2026-05-30 → 2026-05-31; operator surfaced it in the Day 39 session. The reply confirms all three interpretations the operator surfaced for review: (a) disclosed-agency VAT treatment, (b) commission falls within the existing PPA BIN at v1.0 scale, (c) Mushak-9.1 nil-return cadence continues.

### Verbatim record — CA written opinion

> **From:** Jannatul Maoua, Chartered Accountant
> **Date:** 2026-05-31
> **Re:** VAT registration opinion — Event Pulse / Public Pulse Agency
>
> "Based on the facts discussed yesterday and the operational model you described (Event Pulse acting as a disclosed payment facilitator and technology provider under a disclosed agency arrangement), my opinion is as follows:
>
> (a) is correct: Under the disclosed agency model (Section 182, Contracts Act 1872), the Organiser remains the principal and the seller of the ticket. Accordingly, the VAT obligation on the ticket sale itself rests with the Organiser, not with Event Pulse / Public Pulse Agency.
>
> (b) is also correct for the v1.0 launch: Your platform commission (service fee) falls within the scope of your existing Public Pulse Agency BIN (009043032-0102). No separate or new VAT registration is required at this stage solely because of the platform commission.
>
> (c) is correct: You may continue with the existing Mushak-9.1 nil-return filing cadence under your current BIN, unless and until your turnover or nature of supplies crosses the relevant VAT registration thresholds or changes in a manner that requires fresh registration or different treatment.
>
> This position is based on the agency/facilitator characterisation of your model and the current expected transaction volumes for the June 10 soft launch. Should your operational model change, commission structure be revised significantly, or turnover approach the VAT threshold, we should revisit the position promptly.
>
> Please feel free to share this email with your legal counsel or Organisers as needed for their records."

### Decision

**§29 #10 NBR/VAT is RESOLVED with written record cited above.** The platform's VAT posture for v1.0 launch is: (a) VAT on ticket sale rests with Organiser per disclosed-agency Section 182 framing; (b) platform commission falls within existing PPA BIN 009043032-0102, no new VAT registration; (c) Mushak-9.1 nil-return cadence continues. Sharing-authorisation clause in the reply explicitly authorises showing this opinion to counsel and Organisers for their records.

### Trigger conditions for revisiting (verbatim from CA reply)

The opinion is bounded by today's facts. **Three documented revisit conditions** that require returning to the CA before proceeding:

1. Operational model change (anything that moves Event Pulse away from disclosed-agency / payment-facilitator / technology-provider characterisation)
2. Commission structure significant revision (the 0.25% / 175 bps composition; any change in who-charges-what)
3. Turnover approaching the VAT registration threshold (current PPA BIN scope; threshold per NBR rules — operator + CA to monitor)

### Consequences

- **§29 #10 moves from "external clock" / "still open" to RESOLVED in `handoff.md`.** The CLAUDE.md §29 "Still open — Claude Code asks before assuming" list previously had #9 (AIT) and #10 (NBR/VAT) as the two launch-blocking legal questions. AIT resolved 2026-05-26; NBR/VAT resolves today. **Both §29 launch-blocking legal questions are now RESOLVED with written records.**
- **v2.4 playbook bump backlog grows by 1 item:** update CLAUDE.md §29 to reflect both #9 AIT and #10 NBR/VAT as resolved; move the "Still open" framing to reflect zero remaining §29 legal blockers for v1.0.
- **No code changes triggered.** Calculator's `DEFAULT_EPS_FEE_BPS_ESTIMATE = 175` (PR #227) computes platform commission under the existing PPA BIN per (b); no per-tenant VAT split required at v1.0; settlement engine retains its current single-rate-snapshot model.
- **No new compliance surfaces required for v1.0.** Mushak-9.1 nil-return cadence continues unchanged per (c); no Mushak-6.3 (VAT invoice) generation needed for v1.0; no per-tenant VAT registration prompts in tenant onboarding.
- **Disclosed-agency framing becomes a structural anchor for Buyer-Terms-Lite** (Day 39 Phase 2 deliverable). The Section 182 Contracts Act 1872 grounding cited by both the CA and Salehin (separately on Buyer Terms — see entry below) is the canonical legal lens for the platform's limited-role disclaimer to buyers.

### Cross-references

- `decisions.md` 2026-05-26 "AIT (Advance Income Tax) treatment under ITA 2023 — RESOLVED" — sibling resolution; same CA
- `decisions.md` 2026-05-31 Day 39 "Salehin written opinion received on Buyer Terms" entry (this commit) — independent confirmation of disclosed-agency framing
- CLAUDE.md §29 #10 (Still-open list to be updated in v2.4 playbook bump per v2.4 backlog)
- `handoff.md` (updated this session to move §29 #10 to RESOLVED + Path B carry items)

---

## 2026-05-31 · Day 39 — Salehin written opinion received on incorporation; Path B (soft-launch + post-launch Pvt Ltd) LOCKED

**Context:** Companion to the Salehin Buyer Terms reply (entry below). The operator's request asked counsel to weigh Path A (incorporate before June 10) vs Path B (soft-launch on existing sole proprietorship + post-launch Pvt Ltd) given the June 10 launch timeline. Salehin's reply arrived overnight 2026-05-30 → 2026-05-31.

### Verbatim record — Salehin written opinion

> **From:** Mahmudus Salehin, Managing Partner & Founder, Law Legacy Bangladesh (salehin@lawlegacybd.com)
> **Date:** 2026-05-31
> **Re:** Incorporation
>
> "Given the June 10 soft launch with your first paying tenant, it is pragmatic to proceed with the current sole proprietorship structure for the initial transactions. However, I maintain my earlier recommendation: incorporate as a Private Limited Company as soon as practicable after launch (ideally within 4–6 weeks, once you have some volume data and operational clarity). This will limit personal liability before you scale third-party fund flows.
>
> If incorporation can be completed comfortably before June 10 without delaying the launch, that would be cleaner. Otherwise, proceed with the soft launch and treat formal incorporation as a priority post-launch task."

### Decision — Path B LOCKED

**Path B chosen:** soft-launch June 10 on existing sole proprietorship (Public Pulse Agency); formal Pvt Ltd incorporation within 4–6 weeks post-launch per Salehin's recommendation. **Path A (incorporate before June 10) is technically possible per Salehin's qualification but rejected on stacked-task risk.**

### Operator rationale (for Path B over Path A)

Path A (incorporate before June 10) is technically possible but would stack incorporation work (RJSC filing + name clearance + memorandum/articles + TIN/BIN reissue + bank account) against the technical critical path (Phase 2b + Phase 4 + production smoke + production cutover) and first-tenant onboarding in a 10-day window. Risk of stacking is launch slip and operational mistake. Path B leverages the novation clause Salehin already structured into the Organiser Agreement to allow clean contract transfer when the Pvt Ltd is formed. Exposure during the 4–6 week window is bounded by initial transaction volume; counsel-confirmed acceptable for soft-launch scale.

### Path B carry items — dated markers (per Day 39 operator instruction "Path B carry items need a dated marker")

- **Begin Pvt Ltd incorporation paperwork:** target start **week of 2026-06-24** (≈14 days post-launch; falls within Salehin's "4–6 weeks post-launch" recommended window). RJSC name-clearance application + draft memorandum/articles + bank-account-opening initiation.
- **Novation execution target window:** **2026-07-08 → 2026-07-22** (≈4–6 weeks post-launch; mirrors Salehin's recommended Pvt Ltd completion window). When the Pvt Ltd is operational, transfer (a) Organiser Agreements via the novation clause; (b) AWS account + Secrets Manager ownership to new entity; (c) EPS merchant account ownership (a real EPS-side process with documentation); (d) BIN/VAT registration transition (per the CA reply above — current PPA BIN 009043032-0102 transitions to Pvt Ltd-held BIN).
- **Pvt Ltd target completion:** **2026-07-22** (6 weeks post-launch; the outer boundary of Salehin's recommended window). After this date, every new Organiser Agreement signs against the Pvt Ltd directly; the novation transition phase ends.

### Consequences

- **June 10 launch proceeds on existing sole proprietorship** (Public Pulse Agency). No incorporation work blocks the launch sequence.
- **Novation clause in Organiser Agreement is now load-bearing** for the post-launch transfer. The clean-transfer mechanism Salehin structured into the master agreement (the operator confirmed exists) is the canonical path; no parallel Pvt-Ltd-specific Organiser Agreement needs drafting now.
- **First paying tenant signs against the sole proprietorship**, with the explicit understanding (captured in the Organiser Agreement language; counsel-confirmed) that novation will transfer the contract to the Pvt Ltd within 4–6 weeks.
- **`handoff.md` gets two new carry items dated 2026-06-24 (incorporation paperwork start) and 2026-07-08 → 2026-07-22 (novation execution window).** These are tracked obligations, not soft "post-launch" notes.
- **AWS account + Secrets Manager + EPS merchant ownership transitions** become Pvt-Ltd post-incorporation work items, sequenced after RJSC issues the certificate of incorporation. None of these transitions need to start before incorporation completes.

### Cross-references

- `decisions.md` 2026-05-31 Day 39 "CA written opinion on NBR/VAT" entry (this commit) — independent reply; the BIN transition is one of the four novation work items in (d)
- `decisions.md` 2026-05-31 Day 39 "Salehin written opinion on Buyer Terms" entry below (this commit) — companion Salehin reply; same author/date/correspondence thread
- `handoff.md` (updated this session to add Path B carry items)
- Organiser Agreement master document (counsel-held; novation clause is the cited mechanism)

---

## 2026-05-31 · Day 39 — Salehin written opinion received on Buyer Terms — reading (a) primarily confirmed, Buyer-Terms-Lite required at checkout

**Context:** The operator submitted Buyer Terms framing to counsel asking which reading applies: (a) Organiser holds the consumer contract, Event Pulse does not need full parallel Buyer Terms; (b) Event Pulse needs full parallel Buyer Terms regardless; (c) some hybrid. Salehin's reply arrived overnight 2026-05-30 → 2026-05-31; surfaced in Day 39 session. Reply confirms reading (a) "primarily, with a practical qualification" — the qualification surfaces a NEW pre-launch deliverable (Buyer-Terms-Lite checkout document covering 4 specific topics).

### Verbatim record — Salehin written opinion

> **From:** Mahmudus Salehin, Managing Partner & Founder, Law Legacy Bangladesh (salehin@lawlegacybd.com)
> **Date:** 2026-05-31
> **Re:** Buyer Terms for v1.0
>
> "The correct position is primarily (a), with a practical qualification. The core consumer contract for the ticket is between the Organiser and the Buyer. As the disclosed agent and payment facilitator, Event Pulse does not need to issue a full parallel set of consumer-facing Buyer Terms for the ticket itself. The Organiser's own event terms govern the primary buyer relationship.
>
> However, you should still have lightweight platform-level terms presented at checkout (covering platform usage, disclaimers on Event Pulse's limited role, data processing consent, and basic liability carve-outs). This protects the platform and supports your consent_records and refund workflow. We can keep this version concise for the June 10 soft launch and expand it into full dedicated Buyer Terms shortly after you have initial transaction data and user feedback.
>
> Happy to review the consent capture flow and refund workflow language this week if you share the draft text."

### Decision

**Reading (a) confirmed as primary — with practical qualification.** Event Pulse does NOT need a full parallel consumer-facing Buyer Terms document for v1.0. The Organiser's own event terms govern the primary buyer-Organiser relationship; Event Pulse operates as the disclosed-agent / payment-facilitator under that contract (consistent with the disclosed-agency framing in the CA NBR/VAT entry above + Section 182 Contracts Act 1872 grounding).

**Practical qualification — NEW pre-launch deliverable:** Salehin requires lightweight platform-level terms at checkout covering **four topics**: (1) platform usage, (2) disclaimers on Event Pulse's limited role, (3) data processing consent, (4) basic liability carve-outs. This protects the platform and supports the `consent_records` capture + refund-workflow surfaces (PR #228 Verify-guard + Phase 2b notification/queue deliverables).

**Full Buyer Terms deferred to post-launch.** Per Salehin's "we can keep this version concise for the June 10 soft launch and expand it into full dedicated Buyer Terms shortly after you have initial transaction data and user feedback" — full Buyer Terms is deliberately deferred until transaction-data and user-feedback inform the scope. Not a launch blocker.

**Review-this-week offer accepted (operator-action):** Salehin offered to review the draft consent-capture flow and refund-workflow language this week if the operator shares the draft text. Day 39 Phase 2 produces a first-draft Buyer-Terms-Lite document for operator review; operator emails the draft to Salehin once approved (Claude Code does not send the email).

### Consequences

- **NEW pre-launch deliverable surfaces:** Buyer-Terms-Lite checkout document, drafted by Wednesday (target 2026-06-03), sent to Salehin via operator email for his review-this-week offer. Day 39 Phase 2 produces the first draft.
- **Four sections fixed by Salehin's framing:** (1) Platform usage, (2) Event Pulse's limited role (disclosed-agency + Section 182 Contracts Act 1872 grounding; cite the CA reply's same framing for consistency), (3) Data processing consent + link to Privacy Policy, (4) Basic liability carve-outs (mirror the master Organiser Agreement's carve-out structure — counsel-held; the gross-negligence / wilful-misconduct / fraud / fiduciary-duty / death-injury / non-limitable exceptions structure).
- **Bilingual per CLAUDE.md R12 (BN-first):** native Bengali primary; English alongside. Operator instruction Day 39 explicit: "BN-first per R12 (native Bengali, not translated-from-English)."
- **Plain-language buyer-readable tone** (not lawyer-readable). Target ~600–1,000 words EN + ~600–1,000 words BN per Day 39 Phase 2 brief.
- **Existing `consent_records` capture path (PR #228 + downstream) becomes the wire for buyer consent at checkout** once Buyer-Terms-Lite ships into checkout (post-Salehin-review). Current buyer-form footer-link pattern (Day-34) bridges the gap until then.
- **Full Buyer Terms NOT a launch blocker.** v2.4 playbook bump backlog grows by 1 item: track full Buyer Terms as a post-launch deliverable triggered by "initial transaction data + user feedback" milestone.

### Cross-references

- `decisions.md` 2026-05-31 Day 39 "CA written opinion on NBR/VAT" entry above (this commit) — companion legal record; same disclosed-agency / Section 182 framing
- `decisions.md` 2026-05-31 Day 39 "Salehin written opinion on incorporation" entry above (this commit) — companion Salehin reply; same author/date/correspondence thread
- `docs/copy/bkash-only-launch.md` (PR #229) — existing buyer-flow copy that the Buyer-Terms-Lite draft slots into at checkout
- `handoff.md` (updated this session to mark Buyer Terms full-version-deferred + Buyer-Terms-Lite as NEW pre-launch deliverable)
- Day 39 Phase 2 deliverable: `docs/legal/buyer-terms-lite-draft.md` (this session)

---

## 2026-05-31 · Day 38 — Option 3 implementation SHIPPED end-to-end (4 PRs: calculator + Verify-guard + UI copy + smoke runbook)

**Context:** Day 38 implementation of the Option 3 decision recorded yesterday (top entry below this one). Operator-prompt sequence: Phase 1 fee-calculator rate change → Phase 2 buyer-method-restriction → Phase 3 honest UI copy → Phase 4 production smoke prompt → Phase 5 EOD closeout. STAGING_PAYMENT_BLOCK=1 stayed enforcing throughout; no production EPS calls fired this session; HARD STOP on fee-calculator.ts lifted at Phase 1 per the Option 3 entry's "What stays unchanged" section + STOP-ASK gate.

### What shipped today — 4 PRs against main

- **PR #227 `fix(fees)`** `8afb079` — `DEFAULT_EPS_FEE_BPS_ESTIMATE` 250 → 175 (bKash rate per truth-gate Mode A 1.747%). Calculator architecture unchanged (method-agnostic by Day 21 design; the rate lives in the caller). JSDoc rewritten with Option 3 citation + observed 1.747% + capture-base arithmetic (+7-paisa floor delta over the BDT 17.47 observation). Truth-gate `scenarios.ts:49` LEFT at 250 (§14.2-narrative-bound historical artifact for completed Phase 1.4 work; bumping cascades through 3 test files + invalidates cross-check semantics). v2.4 playbook bump backlog grows by 2 items: scenarios.ts rewire + CLAUDE.md §14.2 worked-example doc update.
- **PR #228 `feat(checkout)`** `8fefa41` — Day 38 Phase 2a Verify-guard rejection (mechanism (d) per operator choice). When EPS Verify returns Success but `FinancialEntity` is anything other than bKash, the order is diverted to `disputed` status instead of `paid`. New files: `bkash-financial-entity.ts` predicate (case-insensitive trimmed exact match against `'bkash'`, fails closed on null/missing/non-string) + 15 predicate tests. State machine extended: `awaiting_payment → disputed` newly legal. New audit helper `writeOrderDisputed` captures `dispute_reason` + verbatim `FinancialEntity` value. settle.ts integrates the guard between EPS-status-mapping and state-machine-validation; `/orders/return/wrong-method` redirect target added. 8 new integration tests covering happy-bKash + card-disputed + Nagad-disputed + missing-FE-fail-closed + EPS-failed-not-success + audit + events + no-delivery. Two pre-existing settle.test.ts mocks updated to include `FinancialEntity: 'bKash'` so they continue testing the happy paid-path (the new fail-closed behaviour on missing FE is exhaustively tested by the new dispute suite).
- **PR #229 `feat(copy)`** `79177d7` — Day 38 Phase 3 honest UI copy. `buyer-form.tsx`: NEW bilingual bKash-only notice below subtotal preview ("Currently accepting bKash payments only. More methods coming soon." + BN) + submit-button label `Continue to payment` → `Continue with bKash` (paid tier only; free-tier label unchanged). 4 new tests pin notice + button across paid/free/bilingual/isFreeEvent-gating. NEW `docs/copy/bkash-only-launch.md` living document with canonical EN+BN strings for surfaces that don't exist yet (marketing pages, Day 28+ buyer-return frontend pages, tenant pre-Organiser-Agreement disclosure, Phase 2b dispute-notice email template). Counsel-owned legal docs surveyed: NONE imply multi-method support, no follow-up flag needed. Email templates surveyed: method-agnostic, no change. KYC step-3-financial.tsx is organiser PAYOUT options (distinct from buyer payment method) — no change.
- **PR #230 `docs(runbook)`** (pending CI at EOD-write time) — Day 38 Phase 4 BDT-100 production bKash smoke runbook. 7 hard preconditions gating session start (EPS prod credentials, Secrets Manager, prod EC2 ready, prod-branch ff-merged, EPS_MODE=production, operator on-call, reversal path pre-arranged). Smoke transaction parameters (BDT 100 face, Mode A both-PT, bKash only, calculator predicts buyer BDT 102.04 / EPS fee BDT 1.79 / organiser net BDT 100.00). Decision rules matrix (CONFIRMED ±0.05% / CALCULATOR-UPDATE-REQUIRED ±0.50% / STOP-INVESTIGATE > 0.50% / CRITICAL-FAILURE if FinancialEntity != bKash). 9-step procedure (lift block → smoke → capture → decide → refund → re-enable block → record). Post-smoke gates. Post-launch evolution (each new method requires its own smoke before joining catalogue). Documented but NOT run this session.

### Key operator decisions logged today (in addition to Phase 1 175 bps and Phase 2 mechanism (d))

- **Phase 1 (1/2) bps value:** 175 with JSDoc citing both the observed 1.747% AND the truncated 175 bps — operator picked "175 + JSDoc note observed 1.747%" over plain 175 or defer-until-prod-smoke. Rationale: preserves empirical-observation archaeology in source code.
- **Phase 1 (2/2) truth-gate scenarios.ts:** stay at 250; track "rewire truth-gate scenarios for v1.0 launch-rate baseline" as v2.4 playbook bump backlog item. Operator picked "Skip scenarios.ts entirely; consider in a separate later PR" over the structural-refactor option, after Claude surfaced that the file is §14.2-narrative-bound (the cross-check semantics break if epsFeeBps changes without recomputing the spec14_2_primaryEpsFeePaisa constants).
- **Phase 2 mechanism choice — (d) Verify-guard rejection** chosen over (c) UI-side-only, deferred-pause, and other options. Rationale: highest-discipline path honoring the Option-3 product principle "buyers see the exact fee at checkout, no estimate." Cost accepted: dispute orders require manual ops handling (EPS V5 has no public refund API per §11.4; ops uses EPS merchant dashboard). Mitigated in v1.0 by Phase 3 honest UI copy reducing buyer deviation rate.
- **Phase 2 sub-decision A — admin queue UI:** lightweight endpoint in Phase 2 PR; full React UI deferred to Phase 2b follow-up. Honoured in Phase 2a as: minimal endpoint NOT shipped (deferred to Phase 2b alongside the buyer-notification SES template). v1.0 launch posture: ops queries `audit_logs WHERE action = 'order.disputed'` directly to drive manual-refund work. Acceptable because dispute volume expected to be near-zero with Phase 3 copy in place.
- **Phase 2 sub-decision B — FinancialEntity match semantics:** exact case-insensitive trimmed match against `'bkash'`. Pinned in 15 unit tests; substring matches (`bKash Wallet` / future EPS variants) explicitly NOT accepted at v1.0 — adding a new variant requires explicit code change + operator sign-off.

### Consequences

- **HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts` is LIFTED** per the Option 3 decision entry's "What stays unchanged" section + Phase 1's money-math PR shipping with operator approval. The calculator architecture itself remains untouched (no code changes inside fee-calculator.ts; only the caller's default constant in services/orders/index.ts changed). Future fee-math changes are still STOP-ASK gates per CLAUDE.md §1.4; the HARD STOP language carries forward as a single-PR-at-a-time discipline rather than a blanket lock.
- **STAGING_PAYMENT_BLOCK=1 stays enforcing through the entire remaining 9-day runway.** Re-verified live this session (pm2 api process env). The only authorized lift is the BDT-100 production smoke per the Phase 4 runbook + decisions.md §11.0; smoke is its own gated session (Day 39+, subject to EPS prod-credential arrival).
- **Phase 2b deferred to Day 39 session:** buyer-notification SES template (bilingual `order_disputed_wrong_method` with full copy already drafted in `docs/copy/bkash-only-launch.md`) + admin disputed-orders queue endpoint + mark-as-refunded action. Until then, ops uses direct `audit_logs` queries.
- **Phase 6 / Phase 7 (prior Day 37 handoff naming):** SNS bounce/complaint suppression-list wiring still queued for Day 39-40; gates `MAIL_DRY_RUN=0` per AWS commitment (decisions.md 2026-05-31 SES entry). Sequenceable parallel with Phase 2b.
- **v2.4 playbook bump backlog grows by 2 items today:** rewire truth-gate scenarios.ts for v1.0 launch-rate baseline + update CLAUDE.md §14.2 worked examples to reflect Option 3 launch rate. Plus the existing Day 37 backlog items.
- **4 operator-action external clocks — STATUS CORRECTED at Day 38 EOD Phase 5 STOP-ASK:** All four were started BEFORE Day 38 (Day 37 handoff had them as queued-but-not-confirmed; Phase 5 STOP-ASK confirmed all four already in motion). Specifically: (1) EPS production credentials request — sent before Day 38, awaiting EPS reply; (2) NBR/VAT opinion request to the AIT CA — sent before Day 38, awaiting reply (CA's prior turn-around was excellent and fast); (3) Salehin Buyer Terms body follow-up — sent before Day 38, awaiting reply; (4) **candidate first paying tenant — IDENTIFIED, bKash-audience-suitable for v1.0 single-method launch shape per Option 3 implication (b).** The runway picture is materially healthier than the Day 37 handoff implied; all four clocks are running rather than pending start.
- **`eventpulse/prod/eps` AUTHORISED as the canonical production-credential holder (Day 38 EOD-late).** Read-only diagnostic at EOD verified the two EPS secrets in AWS Secrets Manager (ap-southeast-1): `eventpulse/staging/eps` (existing since 2026-05-19, single AWSCURRENT version) and `eventpulse/prod/eps` (newly created today, single AWSCURRENT version `6754cc98-164d-4504-aa92-e82c2c446409`, LastChangedDate 2026-05-31T10:00:31Z). Per-field sha256-digest comparison across the four hashed fields (merchant_id, store_id, username, hash_key) returned **SAME** on all four; password lengths identical (13 chars each). The two secrets hold bit-identical credentials. Operator authorisation: `eventpulse/prod/eps` IS the canonical production-credential holder going forward; the Day-20 architectural decision ("staging credentials are production-tier per Moshiur Day 20 directive") explains the per-path duplication and is accepted. Implication for `docs/runbooks/production-smoke.md` (PR #230): **precondition #2 ("Production credentials loaded into AWS Secrets Manager at `eventpulse/prod/eps` — JSON-shaped per CLAUDE.md §11.3") is now SATISFIED.** Read-only diagnostic also surfaced that the staging EC2 IAM role (`eventpulse-staging-ec2`) cannot read the prod secret (`AccessDeniedException` on `DescribeSecret` + `GetSecretValue`) — correct security boundary; prod EC2 will need its own role with `eventpulse/prod/eps` read access when provisioned per critical-path step [14] sub-tasks. **STAGING_PAYMENT_BLOCK=1 remains the sole real-money safety layer between staging and EPS prod calls** until prod EC2 is provisioned and the smoke session moves off this staging instance per the runbook discipline.

### Cross-references

- `decisions.md` 2026-05-31 "EPS fee-model structural decision — Option 3 CHOSEN" (the canonical decision this session implemented)
- `decisions.md` 2026-05-30 Phase 1.4 truth-gate empirical findings (the empirical basis)
- `decisions.md` 2026-05-31 Day 37 audit reconciliation entry (the launch-target + critical-path source)
- `handoff.md` (overwritten this session for Day 38 EOD state)
- `docs/copy/bkash-only-launch.md` (Phase 3 living-doc deliverable)
- `docs/runbooks/production-smoke.md` (Phase 4 deliverable)

---

## 2026-05-31 · EPS fee-model structural decision — Option 3 (single-method launch, bKash-only for v1.0) CHOSEN

**Resolves:** the active launch-gate item per `decisions.md` 2026-05-30 (Phase 1.4 truth-gate empirical findings + Options 1/2/3/4 framing) and the audit's critical-path step [1] (`handoff.md` 2026-05-31 Day 37). This is the sole remaining launch-gate blocker before June 10.

### Context

The Day 37 surface document (`docs/decisions/fee-model.md`, shipped via PR #224) laid out four structural options for how the fee-calculator handles per-method EPS rate variance:

- **Option 1** — Per-method rate catalogue (calculator stores a `Record<PaymentMethod, bps>`; init-time method selection picks the rate)
- **Option 2** — Single-rate calculator with platform absorbing per-method variance silently
- **Option 3** — Single-method launch (restrict EPS init to one method; calculator's single rate is exact for that method)
- **Option 4** — StoreAmount-as-source-of-truth (calculator's rate is a checkout-display estimate; post-Verify `TotalAmount − StoreAmount` is the actual EPS fee; settlement reads the corrected value)

Operator slept on the surface document overnight (per Day 37 Phase 4 sequencing) and made the call.

### Decision

**Option 3 — Single-method launch, bKash-only for v1.0.** The fee-calculator's single `epsFeeBps` value is set to the empirically-observed bKash rate (175 bps = 1.747% truth-gate observation, subject to production smoke confirmation). EPS hosted-checkout is restricted to bKash for the launch window. Calculator architecture remains single-rate — which under single-method launch is correct, not a compromise.

**Rationale — operator product principle: buyers see the exact fee at checkout, no "estimate."**

- **Option 4 violates this principle.** Option 4's mechanism explicitly treats the buyer-facing fee line as a display estimate that gets corrected post-Verify. Buyer sees "Payment fee: ~17.47 BDT" → settles for a different number. Operator rejected this framing as incompatible with the platform's transparency promise.
- **Option 1 also violates this principle at the June 10 timeline.** A per-method catalogue can only be honest if every method's rate is empirically populated. Truth-gate data state (Day 37 reconciliation Gap 1) is **one clean data point: Mode A bKash at 1.747%**. Card rate is unconfirmed; Nagad clean success absent; Rocket / Upay / bank-transfer un-observed. Shipping Option 1 with three of four methods' rates set to "best guess from EPS's published schedule" would surface those guesses as exact fee displays to the buyer — same product-principle violation as Option 4, just with the lie distributed across method choices instead of in the time dimension.
- **Option 2 violates this principle by absorbing variance silently.** Buyer sees a fee that the platform knows is wrong on every non-bKash method; the wrongness is paid for out of platform margin rather than displayed honestly.
- **Option 3 is the only path that delivers exact-fee honestly on the June 10 timeline.** Single method → single rate → calculator prediction matches reality on every transaction.

### Empirical basis

Single sandbox observation, Mode A bKash, 1.747% on face (Phase 1.4 truth-gate run, `decisions.md` 2026-05-30):

- `TotalAmount` 1027.56 BDT − `StoreAmount` 1010.09 BDT = 17.47 BDT EPS fee on 1000 BDT face → 17.47 / 1000 = 1.747% (175 bps).
- §14.10 Invariant-1 PASS on Mode A.

**Production parity to be confirmed in the BDT-100 production smoke** (critical-path step [6]). The smoke's purpose is now load-bearing in a new way: it confirms whether production charges bKash at the same rate as sandbox. If production rate ≠ 175 bps, the calculator's `epsFeeBps` value is updated before first paying tenant onboards; no launch until rate is confirmed.

### Implications recorded

- **(a) Buyer payment options restricted to bKash at launch.** EPS hosted-checkout init must pass a payment-method restriction (mechanism investigation deferred to Phase 6 — Day 38 Phase 2 of the implementation prompt — three plausible mechanisms (a) EPS supports init-time method allow-list / (b) EPS exposes method-availability check / (c) UI-side enforcement only, in that preference order).
- **(b) Tenant-fit constraint.** First paying tenant's event must work for a bKash-paying audience. Operator-action #4 (candidate first paying tenant identification, queued today per handoff.md Day 37) now has an explicit fit-criterion: the audience must be bKash-suitable. Card-heavy audiences (corporate conferences, diaspora-targeted premium tickets) are not first-paying-tenant material under v1.0.
- **(c) Marketing / UI copy honest about single-method launch.** Public marketing pages (`/features`, `/pricing`), tenant-onboarding flow, and buyer-facing event pages all state explicitly: "Currently accepting bKash. More payment methods coming soon." No copy implies multi-method support at v1.0. Tenant must see the bKash-only constraint BEFORE signing the Organiser Agreement (so the audience-fit decision is theirs to make consciously). Bilingual per R12 (Bengali first, English alongside).
- **(d) Post-launch roadmap explicit.** Card-method addition is the immediate next addition (week 1 post-launch target). **Each new method requires its own production rate-confirmation smoke before going live** — same discipline as v1.0's bKash smoke. Catalogue-driven Option 1 evolution remains a future option once 2+ methods are empirically populated; Option 4 remains a future option for rate-change robustness; neither is committed at this decision — the v1.0 architecture is forward-compatible with both.

### What stays unchanged

- **The fee-calculator architecture stays single-rate.** Under single-method launch this is correct, not a workaround. The calculator's contract — one `epsFeeBps` value, applied per §14.3 to compute `eps_fee_paisa` for each order — remains intact.
- **§14.10 Invariant-1 (`order.total = net + platform + eps + withholding`) works as-is.** No settlement-engine surgery required.
- **R2 paisa-discipline + bigint arithmetic** unchanged.
- **`fee-calculator.ts` HARD STOP lifts** for the focused PR that updates the single rate (Phase 6 Day 38). STOP-ASK before that money-math PR lands — operator reviews the diff (old bps → new bps + §14.2 worked-example updates + unit-test updates) before merge.

### Cross-references

- `docs/decisions/fee-model.md` (the structured Options 1/2/3/4 comparison surface, PR #224, 2026-05-31).
- `decisions.md` 2026-05-30 (Phase 1.4 truth-gate empirical findings — Mode A bKash 1.747% data point).
- `decisions.md` 2026-05-31 Day 37 (audit reconciliation + June 10 target + Gap 1 single-data-point framing that shaped this decision).
- `handoff.md` (overwritten this session to mark fee-model decision RESOLVED; step [6] BDT-100 smoke now carries bKash rate-confirmation purpose; post-launch card roadmap captured).
- §14 settlement engine specification — unchanged at code level; §14.2 worked examples to be re-verified against the 175 bps rate during Phase 6 implementation.

---

## 2026-05-31 · Day 37 — Operator launch target SET to June 10, 2026; audit critical-path adopted as tracking surface; four reconciliation gaps captured

**Context:** Day 37 operator (Moshiur) set the **official Phase 1 MVP launch target as 2026-06-10** (10 calendar days from today). A 137-finding multi-agent audit ran today (see "Pending Work to Ship EventPulse" audit dated 2026-05-31). It identifies 1 active launch-gate item (EPS fee-model decision + production smoke), 3 pre-launch commitments, ~9 Sprint 4 remaining buildables + the prod-cutover surface (Secrets Manager prod entries, KMS prod CMKs, prod EC2 Ansible bootstrap, Route 53 records, wildcard cert, OIDC role, CloudWatch alarm catalogue) + the §17.11 alarm catalogue beyond the single memory alarm. Critic verdict: good-with-minor-gaps; 12 missing items reconciled into the report; honest critical path is ~5-7 buildable workdays + the externals (NBR/VAT opinion, Buyer Terms body, EPS prod-credential procurement).

### Decision

**The audit's 17-step critical path replaces the §26.1 Sprint-4-day-by-day plan as the project's primary tracking surface from Day 37 onwards.** `handoff.md` is restructured around the path; `progress.md` continues to record day deliverables but each entry now ties back to the path-step it advances. The §26.1 sprint-day-by-day plan was authored assuming a perfectly-sequenced Phase 1; Day 37 reality has steps overlapping (V5 schema + refund flow + SNS suppression-list + marketing all parallel-safe) and the path captures that better.

### Four reconciliation gaps captured today

**Gap 1 — Modes C+D `Status: Fail` reframed.** The Phase 1.4 truth-gate empirical observation (decisions.md 2026-05-30) reported all 4 sandbox payments with footnote "Modes C+D returned EPS Status:Fail … informational, not blocking the fee-rate observation." **Reframe:** the fee-model structural decision is being made on **partial empirical data — only Mode A's bKash transaction (1.747% MFS rate) cleanly succeeded end-to-end.** Mode B succeeded but is the both-absorbed mode (least informative for organiser-facing rate display). Modes C + D produced fee fields but EPS marked the transactions Failed — which means the StoreAmount field on those rows may or may not reflect what EPS would have actually settled in a Success case. We do **not** have a card-rate observation; we do **not** have a Nagad observation that cleanly succeeded; we do **not** have a Rocket / Upay / bank-transfer observation. Implication: the fee-model decision (Options 1/2/3/4 per decisions.md 2026-05-30) should account for this **single-data-point empirical state** when weighing Option 1 (per-method rate catalogue — would require more data to populate honestly), Option 2 (single-rate-absorb-variance — safest under data scarcity), Option 3 (single-method launch — bKash-only would be most empirically grounded), Option 4 (StoreAmount-as-source-of-truth — robust to data scarcity by design, reads actual EPS settlement on every transaction).

**Gap 2 — §29 #9 AIT documentation drift.** AIT withholding-tax classification was **resolved 2026-05-26** via CA consultation (decisions.md "AIT (Advance Income Tax) treatment under ITA 2023 — RESOLVED"). CLAUDE.md §29 "Still open" list **still lists #9 as open.** This is documentation drift, not a real blocker. Capture for v2.4 playbook bump: §29 #9 should move to the "Resolved in v2.X" list with pointer to the 2026-05-26 decision; §29 #10 (VAT/Mushak registration model) remains the only genuine legal-opinion launch-blocker in §29.

**Gap 3 — §29 #10 NBR/VAT external clock surfaced.** The VAT/Mushak registration model (CLAUDE.md §29 #10: "whether the 0.25% platform fee VAT is paid by Event Pulse on its gross fee receipt, or whether tenants are the VAT-bearing party for the service fee component") **was not tracked in handoff.md as a live external clock.** It is now. The operator action: secure a written NBR/VAT opinion from the CA who handled AIT (their AIT opinion was excellent and fast); the operator queues the request today/tomorrow. Until resolved this is a launch-blocking decision per playbook framing ("MUST resolve with NBR before MVP launch").

**Gap 4 — prod branch divergence captured as pre-cutover requirement.** `origin/prod` is at SHA `21dad2cc` (last Sprint 1 era); `main` is at `ad0f5fe`. Sprint 2-4 work (~80+ commits across PRs #100-#221) is **not on the prod branch**. Prod EC2 cutover requires ff-merge or cherry-pick of Sprint 2-4 work onto `prod` before any production deploy can read sane code. This becomes critical-path step [14] sub-task. Pattern documented for v2.4 bump: track prod-branch SHA in standing-invariants section of handoff.md.

### Consequences

- **`handoff.md` is overwritten** to lead with the June 10 target + the 17-step critical path + the four reconciliation gaps. The audit becomes the day-by-day tracking surface for Day 37 → June 10.
- **Operator parallel actions queued today** (not Claude-Code's job — operator queues): (a) email EPS to request production credentials; (b) email Salehin (counsel) re Buyer Terms body + Pvt Ltd incorporation question pre-June-10; (c) email CA for NBR/VAT opinion on §29 #10; (d) identify candidate first paying tenant. Critical-path steps [4], [11], [13], [17] depend on these external clocks; clocks must start today.
- **HARD STOP on `fee-calculator.ts` carries.** Fee-model decision is operator-only and deferred to next session (Day 38) per the user's Phase 4 instruction; this session surfaces the decision-surface document for overnight reflection.
- **v2.4 playbook bump backlog grows by 4 items today** (audit Gap 1 framing, Gap 2 §29 #9 reclassification, Gap 3 §29 list housekeeping, Gap 4 prod-branch tracking discipline) on top of the Sprint 2-4 backlog already captured in `progress.md`. The v2.4 bump itself is not launch-blocking but is a pre-MVP-press-release quality bar.
- **STAGING_PAYMENT_BLOCK=1 stays enforcing through the entire remaining 10-day runway.** The only authorized lift is the BDT-100 production smoke on its own gated session (critical-path step [6]) and must be re-enabled immediately after. This invariant is non-negotiable; operator surfaced it explicitly in the Day 37 prompt.

### Cross-references

- `decisions.md` 2026-05-30 Phase 1.4 truth-gate empirical table (the canonical source for Option 1/2/3/4 framing + the Mode A bKash data point).
- `decisions.md` 2026-05-26 AIT decision (the resolution that §29 #9 should reference).
- `decisions.md` 2026-05-26 "Build-track owns gate-track drafts" — applies to all 4 operator-parallel actions (EPS prod-cred memo, Salehin follow-up template, NBR/VAT opinion brief, first-tenant onboarding outreach). Drafts land as `docs(ops):` PRs as Claude Code can produce them.
- `handoff.md` (overwritten Day 37) — the critical-path tracking surface.

---

## 2026-05-31 · SES production access GRANTED (AWS Support case 177899559700777, ap-southeast-1) — launch-gate blocker RESOLVED with pre-launch commitment to AWS

**Resolves:** the SES out-of-sandbox launch-gate blocker carried since Day 35 Phase 0.5 (`decisions.md` 2026-05-26 "Build-track owns gate-track drafts" — the `docs/ops/ses-out-of-sandbox-request.md` case body draft was the first build-track move on the launch gate).

### Context

AWS Support case **177899559700777** approved 2026-05-31 in region **ap-southeast-1 (Singapore)** — matching the platform's primary region (per CLAUDE.md §1.2). Send-to-full-audience capability is now available; daily sending quota + per-second send rate raised from sandbox defaults.

### Decision

**SES production access is live for ap-southeast-1.** Send-to-any-email-address (not just verified identities) is now permitted from the platform's SES configuration in Singapore. The notification catalogue (§16.3) becomes deliverable end-to-end for real recipients once `MAIL_DRY_RUN=0` flips.

### Consequences

- **Launch gate: 2 → 1 blocker.** Remaining (post-2026-05-30 truth-gate run):
  1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26 + truth-gate run COMPLETE 2026-05-30.
  2. ~~SES out-of-sandbox approval~~ ✅ **RESOLVED 2026-05-31 (this entry).**
  3. **EPS fee-model structural decision + production smoke** — the active launch-gate item now (decisions.md 2026-05-30 entry; Options 1/2/3/4 pending operator).
- **Loose ends (low priority, NOT gating launch):** Counsel docs 4-8 bodies — Buyer Terms remains the load-bearing one for unblocking buyer-form checkout-consent UI per the Day-34 link-footer pattern; rest of counsel follow-ups are forward-progress not gating.

### NEW PRE-LAUNCH COMMITMENT (required before `MAIL_DRY_RUN=0`)

**SNS bounce/complaint → suppression-list wiring MUST exist BEFORE flipping `MAIL_DRY_RUN=0`.** Promised verbatim to AWS in the case reply ("will be fully active before we begin production sending"). This is **a commitment to AWS Support that gates the env flip — not the SES blocker itself**. The SES blocker is resolved; the env flip has a separate gate of our own making.

**Implementation scope (the work that must land before flip):**

- SES bounce + complaint notifications routed via SNS topic(s) — separate topics for bounce vs complaint vs delivery, per AWS-recommended pattern.
- Webhook handler at `apps/api/src/routes/webhooks/ses-bounce.ts` + `ses-complaint.ts` (CLAUDE.md §10.5 already lists these endpoints as planned). Both endpoints verify SNS signature; enqueue to SQS; worker does the actual processing per R9.
- Worker writes to a suppression list (Postgres table — schema decision: per-tenant vs global? **Pin: global suppression list at the platform layer.** A bounced/complained address never receives platform email from any tenant; bounce-back-to-tenant is via in-app notification, not by attempting another email. Avoids the cross-tenant reputation-damage risk where one tenant's bad list poisons another tenant's sending.).
- Outbound email service checks suppression list BEFORE attempting send; if address suppressed → noop + audit log (no SES API call).
- Hard bounces + complaints suppress permanently; soft bounces use exponential-backoff retry up to a cap before promoting to hard suppression.
- Notification log (CLAUDE.md §9.10 `notification_log`) status transitions: `bounced` / `failed` per AWS-classified reason.

**Why "before the flip" is non-negotiable:** AWS's published guidance (and our case-reply commitment) treats production sending without bounce/complaint handling as a sending-reputation-management failure. Bounce rates >5% or complaint rates >0.1% can result in SES access being revoked. We promised a working pipeline before producing real send volume; the env flip without this is a credibility breach with AWS and a real reputation risk.

### Cross-references

- `progress.md` "Day 35 SHIPPED 2026-05-26" — the case body draft (PR #196) that enabled the submission.
- `decisions.md` "Build-track owns gate-track drafts" (2026-05-26) — the pattern that produced the draft; this entry validates the pattern (the gate moved because the build track produced the artefact).
- CLAUDE.md §10.5 — webhook endpoints `/webhooks/ses/bounce` + `/webhooks/ses/complaint` already documented as planned.
- CLAUDE.md §9.10 — `notification_log` table for bounce/complaint status persistence.
- CLAUDE.md §16.1 — SES integration spec (domain identity verified for `eventpulse.com.bd`; bounce/complaint webhooks already in the spec).

---

## 2026-05-30 · Phase 1.4 EPS sandbox truth-gate — RUN COMPLETE; pure eps_fee observed per mode; fee-model structural decision PENDING

**Resolves (partially):** the Decision N truth-gate execution carried since Day 24-25 (`decisions.md` 2026-05-19 "Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate"). Resolution is **partial** — the empirical data is captured; the structural fee-model decision the data demands is deliberately deferred to next session per operator direction.

### Context

PRs #218 + #219 shipped today land the in-house EPS wrapper's V4 sandbox wire-protocol and a `StoreAmount`-based derivation of pure eps_fee. The 4 §14.2 scenario sandbox payments (mtids `TXN-TG-{A,B,C,D}-1780147…`) were paid via MFS test-card (bKash on A/B/C, Nagad on D) and verified end-to-end through the production-shape adapter pipeline.

### Empirical findings — Phase 1.4 Predicted-vs-Actual Table

All amounts paisa unless decimal. `RAW` envelopes archived in SSM command-invocation `ffcfacd0-581b-4db5-b17e-d4345c72273a` (also reproduced in handoff.md).

| Mode | EPS Status | FinancialEntity | Predicted buyer total | Observed TotalAmount | Observed StoreAmount | **Observed eps_fee** | Predicted eps_fee | Δ eps_fee | EPS rate on Total | §14.10 Inv-1 |
|:-:|:-:|:-:|--:|--:|--:|--:|--:|--:|:-:|:-:|
| **A** (PT,PT) | Success ✅ | bKash | 102 756 | 102 756 | 101 009 | **1 747** | 2 506 | **−759** | 1.6997% | PASS |
| **B** (AB,AB) | Success ✅ | bKash | 100 000 | 100 000 |  98 300 | **1 700** | 2 500 | **−800** | 1.7000% | PASS |
| **C** (AB,PT) | **Fail** ⚠️ | bKash | 102 500 | 102 500 | 100 757 | **1 743** | 2 500 | **−757** | 1.7005% | PASS |
| **D** (PT,AB) | **Fail** ⚠️ | Nagad | 100 250 | 100 250 |  98 546 | **1 704** | 2 506 | **−802** | 1.7000% | PASS |

### Decision

1. **§14.10 Invariant-1 PASSED across all 4 modes.** The calculator's internal decomposition is sound (subtotal + pass-through-fees == buyerTotal). The mismatch is **not internal arithmetic** — it's that `epsFeeBps` does not match empirical reality.
2. **EPS charges ≈1.7000% of `TotalAmount`, rounded to integer paisa, consistently across both MFS methods tested (bKash + Nagad).** Calculator currently models 2.5% (card-rate). The calculator over-predicts EPS's cut by ~800 paisa per BDT 1 000 face-value transaction at the observed MFS rate.
3. **Mode C "AB,PT" sent buyerTotal=102 500 (calculator); EPS captured exactly 102 500.** The §14.2 narrative's 1025.06 was arithmetically inconsistent with the calculator's `floor((subtotal+platform_pt) × eps_bps / 10000)` rule and is **not what EPS actually charges**. The Decision-N "2500 vs 2506" question is resolved as a **documentation drift** — there's no behavioural question at the calculator level. The 2506 narrative in §14.2 Mode C primary will be amended on the next playbook revision; calculator rule stays.
4. **EPS V5 production wire shape matches V4 sandbox almost identically** per the EPS V5 production integration guide received today (Moshiur, message uploaded). The four "V4-vs-V5 divergences" feared during the wire-protocol abstraction (PR #218) are **not divergent in production**; the per-config `EpsWireProtocol` pattern is still useful for sandbox vs production schema variance but the production protocol body shape is essentially V4. Three small additive differences to handle in the V5 production schema (small follow-up PR):
   - `EpsTransactionId` (string, optional) — V5 publishes this where V4 does not, alternative hash/query param target.
   - `PaymentReferance` (NOTE THE TYPO — EPS uses "Referance" not "Reference"; match character-for-character) — string, optional.
   - `StoreAmount` — **unresolved whether V5 production publishes this.** Doc example doesn't show it; doc example is minimal (also missing the documented `EpsTransactionId`). Make `StoreAmount` optional in BOTH sandbox and production response schemas. If present → derive eps_fee from (TotalAmount − StoreAmount); if absent → fall back to (TotalAmount − subtotal) with a clear log line at runtime indicating which derivation is active. Production smoke (BDT 100, post-cutover) will empirically confirm V5 StoreAmount presence.

### Structural fee-model decision — DEFERRED to next session

Per operator direction (verbatim): "The data is now informational — I need to decide whether the fee model becomes payment-method-aware (per-method rates), stays single-rate with platform absorbing variance, or restricts launch to one method. That's a deliberate decision for the next session, not auto-derivable from the table."

**Pending options on the table** (none chosen, none preferred from the build side):

- **Option 1** — payment-method-aware fee model (look up `epsFeeBps` per `FinancialEntity` at order-creation time). Requires catalogue of per-method rates, kept fresh as EPS publishes changes; schema change for `tenant_fee_config` or `events`; calculator API change.
- **Option 2** — single-rate calculator with platform absorbing variance (pick a conservative rate, swallow over/under). Existing calculator stays; sets the rate prudently (above observed MFS, below observed card) and accepts that organisers may net slightly more in MFS-heavy events than predicted, slightly less in card-heavy. Predictable but accumulates rounding errors.
- **Option 3** — restrict launch to one payment method until per-method rates are catalogued. Lowest engineering complexity; commercially restrictive.
- **Option 4** — best-effort estimate + reconcile-at-settlement (calculator outputs an *estimate*; the disbursement engine reconciles to actual `StoreAmount` from the EPS settlement report; organiser-facing dashboards show estimate-and-actual side-by-side). Largest behavioural change; closest to a long-term-correct solution.

### Consequences

- **Calculator stays unchanged this session.** No `apps/api/src/domain/payments/fee-calculator.ts` edit. No §14.2 amendment in the playbook today. The HARD STOP held; the data is in memory for the next-session decision.
- **The Decision-N narrative simplifies.** "Did the calculator pick the right Mode-C arithmetic" is no longer the load-bearing question. "Does the calculator track EPS's payment-method-dependent rates" is the actual question, and only Option-1 / Option-4 attempt to answer it; Options 2 + 3 are deliberate-mismatch acceptance.
- **The sandbox truth-gate work is essentially complete on the sandbox side.** Phase 1.5's "predicted-vs-actual reconciliation" is this entry's table. Phase 1.6 (memory commit) is this entry. The remaining truth-gate work is (a) the V5-tolerant additive-field follow-up PR before any production smoke; (b) the small production smoke itself (BDT 100, one transaction, verifies StoreAmount presence in V5 + that the wire-protocol abstraction works in production); (c) executing the fee-model structural decision when the next session lands.
- **Modes C + D returned EPS `Status: "Fail"`** despite the buyer flow completing per operator. EPS sandbox populated TotalAmount + StoreAmount on the failed responses anyway, so the fee-rate observation holds, but C + D are NOT clean-success transactions. Not a blocker; flagged in handoff for next-session diagnosis if the structural decision wants more datapoints.
- **`STAGING_PAYMENT_BLOCK=1` remains enforcing.** Removing requires its own `decisions.md` entry per §11.0 and is gated on completing the V5-tolerant follow-up PR + the structural fee-model decision.

### Cross-references

- `decisions.md` "Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate" (2026-05-19) — the original Decision-N spec this entry empirically answers (partially).
- `decisions.md` "EPS library choice locked for Sprint 3 — in-house wrapper" (2026-05-19) — the wrapper that emits the V4 body shape verified today.
- PR #218 — V4 sandbox wire-protocol pluggable abstraction (merged `2882d9c`).
- PR #219 — V4 Verify schema null-tolerance + StoreAmount-based derivation (merged `f3eaa92`).
- `gotchas.md` "EPS V4 sandbox Verify returns null ErrorMessage/ErrorCode on success" (2026-05-30) + "EPS Verify publishes StoreAmount — pure eps_fee derivation" (2026-05-30).

---

## 2026-05-27 · Trust Center v1.0 / counsel engagement — CORE DOCUMENTS IN HAND (Law Legacy Bangladesh, Mahmudus Salehin)

**Resolves (substantially):** the "Trust Center v1.0 documents from counsel" launch-gate blocker carried since Day 19 (`decisions.md` 2026-05-17 "Trust Center v0.1 placeholders — skeleton-only") and amplified Day 34 ("Public buyer form: no blocking consent checkbox under v0.1-placeholder Trust Center" 2026-05-26) + Day 35 ("Build-track owns gate-track drafts" 2026-05-26 Phase 0.5) + Day 36 AIT entry (2026-05-26: agency model in contracts is a hard tax-correctness dependency for the disbursement-leg no-withholding treatment).

### Context

Counsel: **Law Legacy Bangladesh**, drafted by **Mahmudus Salehin**. Core legal-document suite delivered **27 May 2026**. Draft + signed-or-soon-to-be-signed Versions land as Trust Center v1.0; specific document set delivered today:

- **Terms of Service** (consumer-facing platform terms)
- **Organiser Agreement** (the load-bearing contract — establishes the agency model)
- **Privacy Policy**
- Plus drafts of: **Buyer Terms** (= checkout consent surface), **Refund Policy**, **Acceptable Use Policy**, **Cookie Policy**, **Data Processing Addendum** — bodies of these 4-8 to be confirmed in counsel follow-up

The Day-19 v0.1 placeholders + the Day-34 footer-link-only buyer-form pattern are now superseded for the first 3 documents and substantially-superseded for the rest pending body confirmation.

### Decision

**Counsel blocker moves from "blocking" to "core docs in hand, minor follow-ups open."** Launch gate drops from 3 → 2 remaining blockers; the dependent build-track items can now be planned (not yet shipped — body confirmation gates the buyer-form consent UI specifically).

### Key outcomes captured by the contracts

#### 1. Agency model legally anchored — satisfies the AIT contract-dependency

**Anchor:** Section 182, Contracts Act 1872 (Bangladesh) — establishes Event Pulse as **disclosed agent / payment facilitator**, not principal/reseller. Anchored in BOTH the ToS AND the Organiser Agreement (matters where one document might be partially superseded by the other).

**Direct effect on the AIT decision (2026-05-26):** the AIT entry's "Leg 1 disbursement — NO withholding" treatment was contingent on the contracts establishing agency. **That condition is now MET.** The CA-confirmed treatment — net-to-organiser disbursement carries zero withholding, calculator stays as-is — is now contract-backed, not aspirational. The §29 #9 AIT resolution is now operationally executable.

**Implication for `fee-calculator.ts`:** unchanged. Pre-withholding `netToOrganiserPaisa` remains the correct steady-state. The §14.10 ledger invariant verifier already enforces conservation per order; `withholdingTaxPaisa = 0` on the disbursement leg continues to hold under contract authority + tax authority simultaneously.

#### 2. AIT clauses embedded per the CA brief

The Organiser Agreement contains the four clauses the CA brief specified (decisions.md 2026-05-26 AIT entry, "Contract requirements" section):

- **Specified-person self-deposit** of 10% commission AIT under §93 + §140, ITA 2023
- **15-day A-Challan deadline** post month-end (matches CA-confirmed timeframe)
- **Recovery-from-disbursements mechanism** when A-Challan not provided
- **NBR indemnification** clause
- **Individual-organiser exemption** at transaction level (matches CA position; individuals exempt at the wire, flows through their year-end personal tax)

Code impact unchanged — calculator continues to take full commission in both organiser-type branches; A-Challan tracking remains Sprint-7-era alongside `disbursement_batches`.

#### 3. Liability cap structured with carve-outs (Organiser Agreement executable v1.3, clause 6.2)

**Cap:** 12-month-fees liability cap (industry-standard ceiling for SaaS).

**Carve-outs (NOT capped — full exposure stands):**
- Gross negligence
- Wilful misconduct
- Fraud
- Breach of fiduciary duty (the agency-model corollary — once you're an agent, fiduciary duty attaches)
- Death + injury
- Non-limitable liability under Bangladesh law (statutory carve-out clause)

The carve-out set is the load-bearing protection — a cap without these would attempt to limit liability for the categories Bangladesh law won't allow limitation for in the first place; structure here is correct.

#### 4. Incorporation recommendation — ON RECORD (pending owner decision)

Counsel advises **Public Pulse Agency** (currently sole proprietorship; proprietor **S M Moshiur Rahman** personally bears unlimited liability for platform obligations) incorporate a **Private Limited Company in Bangladesh** before handling significant third-party-fund volumes.

**Why this matters:** under the current sole-proprietorship structure, every contractual obligation in the Organiser Agreement + every fiduciary duty in the agency model + every operational liability the platform carries (data breach, payment-handling error, A-Challan recovery dispute) attaches personally to Moshiur as the legal owner of Public Pulse Agency. Moving to a Pvt Ltd creates the corporate veil that separates personal assets from platform liability.

**Counsel's mitigating design:** the contracts include a **novation / amendment clause** that lets all existing organiser + buyer agreements transfer to the future incorporated entity when it lands — so we don't have to renegotiate the entire contract base at incorporation time.

**Status:** **NOT a code item.** Owner decision. Tracked here so future memory reads know the unincorporated state is a known risk, not an oversight. Becomes load-bearing as the platform approaches the "significant third-party-fund volumes" trigger — likely the same threshold that warrants the Pvt-Ltd-PSO-licence Year-2 path in §15.3.

### Remaining counsel follow-ups (these are what keep the blocker "minor follow-ups open" not "fully closed")

1. **Confirm full bodies of documents 4-8.** The Buyer Terms specifically is the **checkout consent substrate** — the body must be finalised before we can wire real `consent_records` capture into the buyer-form's checkout path. Currently the buyer form (PR #193, Day 34) ships with the link-footer-only pattern explicitly because there was no v1.0 body to consent against. Buyer Terms body lands → that pattern can be replaced.
2. **Owner incorporation decision** (Moshiur). Not blocking MVP launch but on-record per counsel.

### Implication for the `consent_records` work — substrate can now be planned

The Day-34 buyer-form decision pinned: "real binding consent capture lands as a separate PR when v1.0 docs arrive from counsel." That condition is now substantially met for ToS + Privacy + Organiser Agreement.

**What can now be planned:**

- `consent_records` write path on order creation (per §9.11 schema — already in place; only the wire-up is pending)
- The buyer-form footer-link pattern → consent-checkbox pattern, gated on Buyer Terms body confirmation
- The post-login consent capture for tenants (ToS + Privacy + Organiser Agreement) at sign-up + at material-change re-prompt (per §20.4 re-consent flow architecture, already designed)
- The legal-document body load: drop counsel's v1.0 markdown bodies into `legal_documents` + `legal_document_versions` tables, marked `requires_signature=true` for the 3 contracts

**What stays blocked on the Buyer Terms body specifically:** the buyer-form checkout consent UI. Until the Buyer Terms text is final, putting a checkbox that says "I agree to the Buyer Terms" still risks the Day-34 "performative consent against unfinished text" anti-pattern. The other consent surfaces (tenant sign-up, organiser onboarding) can move forward on the docs already delivered.

### Why this is a decisions-layer entry

A future PR that:

- Treats the Trust Center placeholder constraint as still in force across ALL surfaces → only the Buyer-Terms-gated checkout-consent path is still blocked. ToS + Privacy + Organiser Agreement are real now; tenant + organiser consent flows can move.
- Removes the link-footer pattern from the buyer form before Buyer Terms body is confirmed → re-opens the Day-34 anti-pattern. Pin the dependency here.
- Treats the corporate-veil question as solved by the contracts → contracts protect the entity from third-party claims; they DO NOT create the entity. Sole-proprietorship liability stands until incorporation completes. Pin Moshiur's pending decision.
- Modifies the disbursement leg to add withholding "for safety" → the AIT decision's no-withholding treatment is now contract-backed AND tax-authority-confirmed. Don't add code that fights either.

### Consequences

- **Launch gate: 3 → 2 blockers.** Remaining: (1) EPS sandbox credentials → already provisioned 2026-05-26 (`eventpulse/staging/eps-sandbox`); the wire-format-fix PR #206 unblocks the truth-gate execution; (2) SES out-of-sandbox → DRAFT ready, awaiting Moshiur submission.
- The Trust Center placeholder constraint partially lifts immediately (tenant + organiser surfaces); fully lifts on Buyer Terms body confirmation.
- AIT decision is now fully operationally executable (agency model in contracts = MET); the §14.10 ledger invariants continue to hold with no calculator change.
- A new tracked carry-item: **Pvt Ltd incorporation** — Moshiur decision, not blocking MVP, but on-record per counsel for when volume warrants.
- Phase 2 `consent_records` wire-up + Phase-7 A-Challan tracking are now the two concrete tax-and-consent follow-ups; both have well-defined data-model substrates already in place (§9.11 consent_records, future `tenant_ait_challans`).

### Cross-references

- [`decisions.md` 2026-05-26 "AIT (Advance Income Tax) treatment under ITA 2023 — RESOLVED"](decisions.md) — the AIT entry whose contract-dependency this entry satisfies.
- [`decisions.md` 2026-05-26 "Sprint 4 Day 34 Phase 1 — Public buyer form: no blocking consent checkbox under v0.1-placeholder Trust Center"](decisions.md) — the buyer-form pattern this entry partially lifts (full lift gated on Buyer Terms body).
- [`decisions.md` 2026-05-17 "Trust Center v0.1 placeholders — skeleton-only"](decisions.md) — the original placeholder constraint now substantially superseded.
- [`decisions.md` 2026-05-26 "Sprint 4 Day 35 Phase 0.5 — SES out-of-sandbox case body drafted"](decisions.md) — the build-track-owns-gate-track-drafts pattern. Counsel docs are an instance of the same shape: getting concrete drafts into the gate.
- CLAUDE.md §15.2 (NBR / withholding) + §15.3 (PSP/PSO licence path) — incorporation recommendation ties to the Year-2 PSO trajectory.
- CLAUDE.md §20 Trust Center + §21 Legal positioning + §21.3 host-liability clause — the doctrinal anchors counsel's contracts now operationalise.
- CLAUDE.md §9.11 `consent_records` schema — the substrate now ready to wire.

---

## 2026-05-26 · AIT (Advance Income Tax) treatment under ITA 2023 — RESOLVED (CA consultation + follow-up)

**Resolves:** CLAUDE.md §29 #9 "AIT withholding classification" — open since v1.0 (16 May 2026).

**Context:** Bangladesh income-tax withholding treatment for Event Pulse's two-leg money flow (tenant ticket revenue disbursement + platform commission collection) had been an open §29 item flagged as "MUST get legal opinion before MVP launch" — and one of the four launch-gate blockers carried through Days 31–35. Moshiur consulted a CA on 2026-05-25, with a follow-up confirming the provisional commission-handling option. The decision below captures the CA's FINAL position, supersedes any earlier provisional drafts of this entry, and removes AIT from the launch-gate blocker list.

### Decision — leg-by-leg

#### Leg 1 — Disbursement of net ticket revenue to organiser: **NO AIT withholding**

Event Pulse operates as a **disclosed Agent / payment facilitator**, NOT a Principal/reseller. Ticket revenue legally belongs to the organiser from the moment of sale; we collect in a fiduciary capacity and take a fee for the software + payment-gateway service. Remitting the organiser's own money to them is not a "payment for a supply/service" under ITA 2023, so no AIT is deducted on disbursement.

**Code impact: NONE.** The fee calculator's pre-withholding `netToOrganiserPaisa` is CONFIRMED CORRECT as-is. The `withholdingTaxPaisa` column on `orders` (migration 0013) stays 0 for the disbursement leg in the steady-state design. The §14.10 ledger invariant 1 (`total = net + platformFee + epsFee + withholdingTax`) holds with `withholdingTax = 0` for ordinary tenant-disbursement orders.

**Hard dependency on Trust Center v1.0 / counsel blocker:** This Agent treatment holds **ONLY IF** the Terms of Service + Organiser Agreement explicitly establish the agency / facilitator relationship. If the contracts characterise us as a principal/reseller (or are silent), we risk Principal characterisation → 5% AIT withholding on gross organiser payments under ITA 2023 §89/§140 ("specified person" if turnover > BDT 1 Crore). **The legal docs are now a tax-correctness requirement, not only a consent gate.** Counsel must establish agency in the contracts.

#### Leg 2 — Platform commission (~0.25% fee): 10% AIT under ITA 2023 §93 — **organiser self-deposit (Option 1, CONFIRMED compliant by CA)**

Two organiser types behave differently:

- **Specified-person organisers** (registered company / NGO / trust / partnership per §140): organiser is solely responsible for withholding + depositing the 10% AIT on the commission and providing us a valid A-Challan within **10–15 days of transaction month-end**. The A-Challan is our absolute audit protection. If not provided in time, we may recover the 10% from future disbursements / hold-back / direct invoice (recovery clause in the Organiser Agreement).
- **Individual (unregistered) organisers:** NO AIT obligation at the transaction level. We take the full 0.25% commission as gross revenue; it flows into normal corporate income tax at year-end. No per-transaction handling.

**PSR (Proof of Submission of Return) conditional:** organiser without PSR → AIT rate is effectively 15% (50% surcharge per §93). This is the organiser's obligation to compute and deposit, not ours.

**Code impact: calculator UNCHANGED — we take the full commission in both cases.** New requirements are COMPLIANCE TRACKING, not fee math:

1. **A-Challan tracking field + status** (`pending` / `received` / `overdue`) on specified-person organisers' tenant rows or a dedicated `tenant_ait_challans` table, keyed off the existing `tenants.type` ('organisation' = specified person; 'individual' = exempt at transaction level).
2. **Recovery trigger on overdue A-Challan** — ties to the disbursement flow (Sprint-7-era; deferred until disbursement_batches exists). Data model should anticipate this so the recovery hold-back lands cleanly on top.

The organiser-type branch reads existing KYC data (`tenants.type`); no new tenant-typing work is required for this AIT handling.

### Contract requirements (the counsel brief for Trust Center v1.0)

Two concrete clause families needed in the legal docs counsel returns. These are the tax-correctness scaffolding for the decisions above:

**A. Agency model — Terms of Service + Organiser Agreement** (load-bearing for Leg-1 no-withholding):

- Platform = exclusive technology provider + payment facilitator.
- Organiser = sole Seller of tickets.
- Platform NEVER takes title to inventory.
- Organiser controls pricing, inventory, terms of sale.
- All risk (cancellations / chargebacks / disputes / refunds) sits on the organiser.
- Ticket revenues held in fiduciary / trust capacity; disbursed minus fees.

**B. Commission AIT — Organiser Agreement** (load-bearing for Leg-2 Option 1):

- Specified-person organiser is **solely responsible** for withholding + depositing the AIT on the platform fee.
- A-Challan delivery within strict timeframe (10–15 days post month-end).
- Recovery + indemnification if A-Challan not provided in time.

### What this is NOT

- **Not a license to skip the calculator's withholding column.** The column stays in the schema + ledger invariant. The steady-state value is 0 for disbursement; if a future tax treatment ever requires non-zero values on the disbursement leg, the schema is ready and the §14.10 invariant verifier already catches misuse.
- **Not a deferral of the A-Challan tracking work.** It's Sprint-7-adjacent (lands when disbursement batching does), but the data model should anticipate the tracking field so the eventual implementation is a clean addition rather than a schema migration scramble.
- **Not approval to ship before counsel returns the agency clauses.** The Leg-1 no-withholding treatment is contingent on agency being explicit in the contracts. Shipping with placeholder TOS would technically risk a Principal characterisation; the gate-track Trust Center v1.0 blocker now carries this tax-correctness weight, not only the consent-capture weight.

### Why this is a decisions-layer entry

A future PR that:

- Adds a withholding calculation on the disbursement leg "for safety" → ITA 2023 doesn't require it for agents; pinning agency means we don't withhold; calculator stays correct. Don't add code that fights the legal model.
- Treats individual organisers as if they owed AIT on the commission → they don't, per §140 specified-person definition. The branch on `tenants.type` matters.
- Ships an Organiser Agreement without the agency clauses or the A-Challan recovery clause → re-opens the tax exposure. Counsel brief above is the requirements list.
- Treats §29 #9 as still-open → it's resolved as of this entry. The Trust-Center-v1.0 blocker absorbs the residual contract-clause work; the AIT semantics are settled.

### Consequences

- **Launch gate drops from 4 to 3 blockers.** Remaining: (1) EPS sandbox credentials, (2) SES out-of-sandbox (DRAFT ready at `docs/ops/ses-out-of-sandbox-request.md` PR #196), (3) Trust Center v1.0 from counsel — **now carrying the AIT contract-clauses requirement as a tax-correctness gate, not only consent.**
- **Truth-gate calculator verification is UNAFFECTED.** The pre-withholding `netToOrganiserPaisa` is now confirmed correct, not a gap to be reconciled at truth-gate time. The §14.10 invariants verifier (PR #177, Day 30) continues to enforce conservation per order; `withholdingTax = 0` for the disbursement leg is the steady-state, not a placeholder.
- **A-Challan tracking** is a Sprint-7-era data-model addition (alongside `disbursement_batches`). Today's `tenants` + `orders` schema is sufficient; the tracking field lands when disbursement does.
- **CLAUDE.md §29 #9 should be marked resolved** in the next playbook revision, with a reference back to this decisions entry.

### Cross-references

- CLAUDE.md §15.2 (NBR — VAT, withholding) — the spec section that flagged this as OPEN.
- CLAUDE.md §14.4 + §14.10 (fee + ledger invariants) — the calculator's correctness contract this decision confirms.
- CLAUDE.md §29 #9 (Open Decisions) — the item this entry resolves.
- CLAUDE.md §20 + §21 (Trust Center + legal positioning) — where the agency-model + commission-AIT clauses land in the v1.0 contracts.
- `apps/api/src/domain/payments/fee-calculator.ts` — the calculator confirmed correct by this decision.
- `apps/api/src/db/schema/index.ts` `orders.withholdingTaxPaisa` (migration 0013) — column stays in steady-state design.
- `apps/api/src/services/orders/verify-invariants.ts` (Day 30, PR #177) — §14.10 invariant verifier; correctness confirmed for `withholdingTax = 0` on the disbursement leg.
- `decisions.md` 2026-05-26 Day 35 Phase 0.5 entry — the build-track-owns-gate-track-drafts pattern; the counsel brief above is the next concrete brief to hand to legal.

---

## 2026-05-26 · Sprint 4 Day 35 — Super-admin revenue dashboard: cross-tenant by design; auth gate is the entire security model

**Context:** Day 35 shipped the §14.7 platform-operator financial cockpit at `/api/v1/admin/revenue` + `/admin/revenue` (PRs #197 service + #198 UI). The Day-33 tenant-dashboard architecture (Choice B — aggregates always run under `withTenant()` + explicit `WHERE tenant_id =` dual defence) is the **inverse** of what §14.7 requires. The Day-33 entry called §14.7 out as the explicit exception; this entry codifies the inverse pattern.

### Decision

For the platform-operator revenue surface (and any future cross-tenant aggregation that the platform itself needs — financial reconciliation, GMV reporting, multi-tenant cohort analysis):

1. **The service runs under `withSuperAdmin()` (BYPASSRLS) with NO tenant filter.** Cross-tenant aggregation IS the point; per-tenant isolation here would defeat the dashboard.
2. **The entire security perimeter is `requireSuperAdminAuth` at the route layer.** A tenant or attendee token reaching these routes is a security incident.
3. **The route-layer tests assert the inverse of Day-33's isolation tests:** no token → 401; tenant-audience → **403** (NOT 200 with leaked cross-tenant data); attendee-audience → 403. The "must not leak" assertion is the load-bearing test, not "isolation works."
4. **Page-level UX reflects this:** the `/admin/revenue` page renders a FORBIDDEN-specific copy when the API returns 403 ("This surface requires a super-admin session. If you arrived here from a tenant session, sign out and sign in again.") — the user sees the security model surfaced as guidance, not just a generic error.

### What this is NOT

- **Not a relaxation of Day-33 Choice B.** Tenant-facing dashboards still aggregate under `withTenant()` + dual defence. The Day-33 rule remains the default for everything; this entry pins the §14.7 exception in writing so a future "let's just add a tenant filter for safety" PR doesn't accidentally defeat the dashboard's purpose.
- **Not a license to skip auth tests on other admin endpoints.** Every endpoint under `/api/v1/admin/*` MUST keep the same auth-gate test pattern; this is documented in the route file's header comment for `revenue.ts`.

### Why this is a decisions-layer entry

A future PR that:

- Adds a tenant filter to `getPlatformRevenueDashboard()` "for safety" → defeats the dashboard. Pin "cross-tenant by design" here.
- Skips the audience-rejection tests on a new admin endpoint → the auth gate is the entire security model; the test is the only thing that catches a regression. Pin here.
- Adds an actual disbursement-EXECUTION endpoint to this router → out of Day-35 scope; settlement queue is READ-ONLY until `disbursement_batches` lands Sprint 7. Pin the scope boundary here so the read-only widget doesn't drift into action by accretion.

### Consequences

- §14.7 platform revenue cockpit live + auth-gated; the four auth tests (revenue.test.ts) are the security backstop.
- Settlement queue is labelled honestly as "amounts owed; no payout action until Sprint 7."
- EPS reconciliation anomaly card is a forward-compatible placeholder (`epsReconciliationPlaceholder: true`) — the API surface is stable; only the data lights up when Sprint 7 ships `eps_settlements`.
- Future Sprint 7 work — actual disbursement execution + EPS reconciliation matching — extends this dashboard, doesn't replace it. The schema for `disbursement_batches` + the cron job land separately; the dashboard widgets then start showing real batch data without API breakage.

### Cross-references

- [`decisions.md` 2026-05-25/26 "Sprint 4 Day 33" Choice B](decisions.md) — the rule this entry is the codified exception to.
- CLAUDE.md §14.7 (the spec).
- `apps/api/src/services/admin/revenue.ts` — file header documents the security model in full.
- `apps/api/src/routes/super-admin/revenue.test.ts` — the four SECURITY tests + 8 dashboard-math/ledger tests.
- `apps/api/src/auth/middleware.ts:60` `requireSuperAdminAuth` — the entire perimeter.

---

## 2026-05-26 · Sprint 4 Day 35 Phase 0.5 — SES out-of-sandbox case body drafted for Moshiur (1st concrete move on the launch gate)

**Context:** Sprint 4 Day 35 opens with the launch gate at 4 blockers (EPS sandbox creds, AIT tax opinion, SES out-of-sandbox, Trust Center v1.0 docs). The build track has shipped 23 PRs across 5 days; the launch gate had moved 0 times and grew by 1 (Day 34). Moshiur explicitly called this out at the top of Day 35: build velocity + zero gate-track motion can't both be "finishing urgently."

### Decision

For the SES out-of-sandbox blocker specifically — which is a templated AWS Support case that I can draft but cannot submit on Moshiur's behalf — I shipped `docs/ops/ses-out-of-sandbox-request.md` (PR #196) with the complete case body: use-case description (4 transactional email categories — auth, ticket confirmations, tenant operational notifications, event communications; no bulk/marketing); bounce + complaint handling via SNS + suppression list; consent model per category; volume forecast (50k/day, 14/sec — best-guess from §16, edit-before-submit); domain auth state (DKIM/SPF/DMARC per §17.6); a pre-submission checklist (verify SES domain identity FIRST — case will be rejected if domain unverified); and a post-submission reminder to paste outcome into `decisions.md`.

This is the FIRST concrete move on any launch-gate item by the build track. The pattern: any launch-gate item I CAN draft for Moshiur review (rather than requiring him to write from scratch), I will draft as a separate small PR — minimum-viable removal of "I have to write it from scratch" friction. The other three gate items will get similar treatment in future sessions:

- **AIT withholding tax opinion** — I cannot give the legal opinion (this is a tax-counsel decision), but I CAN draft a focused question memo for the tax counsel summarising what the platform does (§14.4 + §15.2), what the calculator math assumes (pre-withholding), and the specific question to be answered. Day-36+ candidate.
- **Trust Center v1.0 documents** — I cannot replace counsel, but I CAN draft a per-page outline for each placeholder (the headings + intent) so counsel returns drafting input not blank slates. Already partially scoped in the Day-19 placeholders themselves. Day-36+ candidate.
- **EPS sandbox credentials** — Cannot procure on Moshiur's behalf. Best move: a Day-36+ PR drafting the request to EPS with the integration specs we've built (in-house wrapper per §11.0, the merchantTransactionId format per §11.4, the truth-gate definition) so EPS can issue credentials matching our integration.

### Why this is a decisions-layer entry

A future session that:

- Treats the launch gate as "Moshiur's homework" again → re-read this entry; offer to draft. The build track is responsible for surfacing what we CAN draft, not waiting to be asked.
- Tries to bundle gate-track drafts into feature PRs → keep separate (Day-19 placeholder docs precedent for separate docs PRs). Reviews are easier; the gate-track motion is visible in the PR history.
- Forgets the SES draft exists → see `docs/ops/ses-out-of-sandbox-request.md` (PR #196 merged `b26de1e`).

### Consequences

- The SES draft sits in `docs/ops/` ready for Moshiur to review, edit, and submit. If submitted + approved, the launch-gate count drops 4 → 3.
- Future gate-track drafts land as separate small `docs(ops):` PRs.
- The build track explicitly owns surfacing what's draftable for the gate — silent omission stops being acceptable.

### Cross-references

- `docs/ops/ses-out-of-sandbox-request.md` (PR #196 `b26de1e`).
- §16 (notification catalogue — the 4 categories).
- §17.6 (DKIM/SPF/DMARC — DNS state the case references).
- handoff.md "Decision Moshiur still owes" — now includes the SES "ready to submit" note.

---

## 2026-05-26 · Sprint 4 Day 34 Phase 1 — Public buyer form: no blocking consent checkbox under v0.1-placeholder Trust Center

**Context:** Day-34 Phase-1 shipped the public buyer registration/purchase form on the event landing page (PR #193 — `apps/web/src/components/public/buyer-form.tsx`), closing the operational loop across Days 25-33. Form collects buyer name/email/phone (+ optional NID last 4) and POSTs to `/api/v1/public/orders`. The form posts on behalf of a buyer who is, by §21.1 doctrine, entering a contractual relationship with the tenant — not Event Pulse — when the order goes through.

This raised the question of whether the form should require a consent checkbox ("I agree to the Terms / Refund Policy") before submit.

### Decision

**No blocking consent checkbox in the buyer form for MVP.** The form's footer line links to `/terms` and `/refund-policy` as informational reference (`<Link>` from next/link, underlined inline). No `consent_records` row is written by this form. Real binding consent capture lands as a SEPARATE PR when Trust Center v1.0 documents arrive from counsel.

### Why

1. **Trust Center docs are v0.1 placeholder per Day-19 decision** ("Trust Center v0.1 placeholders — skeleton-only", 2026-05-17). Every legal page renders a non-dismissable DRAFT banner with "PLACEHOLDER — to be drafted by counsel covering X" stubs. They carry no contractual weight today; counsel hasn't returned v1.0.

2. **A consent checkbox bound to a v0.1 placeholder is performative.** Writing a `consent_records` row that points at a `legal_document_versions` entry whose body is "PLACEHOLDER" is operationally meaningless — the row says "this user agreed to a draft." It doesn't satisfy GDPR Art. 7 (specific, informed, freely-given), doesn't satisfy DPDP Act consent requirements when those land, and doesn't provide §21.3 host-liability cover. A future audit would have to discount the data anyway.

3. **The link-footer pattern preserves disclosure without faking consent.** Buyers are told what they're agreeing to (the linked policies); they can navigate to read them (and see the DRAFT banner, which is itself a form of fair notice that the docs are not final). No `consent_records` divergence between Day-34-onwards orders and post-v1.0 orders — the post-v1.0 PR can backfill or skip historical orders cleanly.

4. **A real consent-capture PR is a separate concern from form layout.** When v1.0 docs land, the consent surface needs: (a) the checkbox itself, (b) the server-side `consent_records` write coupled to the POST /orders flow, (c) re-consent on material change (per Day-19 architecture), (d) audit trail. That's a focused PR, not a flag to set on this form.

### Why this is a decisions-layer entry

A future PR that:

- Adds a checkbox here "for compliance theater" before v1.0 docs land → loses §21.3 cover anyway + produces audit junk. Pin "no consent under placeholder docs" here.
- Argues "even a placeholder consent is better than nothing" → no it isn't; it's an audit liability and a user-trust liability when buyers later realise they "agreed" to a draft. Pin here.
- Wants to ship a real consent capture as a Day-34 follow-up "while we're at it" → that's the v1.0 PR; it depends on counsel returning v1.0 docs. Pin the sequencing here.

### Consequences

- Buyer form ships with footer line "By placing this order you agree to the [Terms] and [Refund Policy]." No checkbox; no submit-blocking; no `consent_records` write.
- When v1.0 docs land (still gated on counsel — see §29 / handoff truth-gate blockers), a dedicated consent-capture PR adds: the checkbox + server-side write into `consent_records` + the re-consent gate for material changes. The form layout already has room for the checkbox to slot in without restructuring.
- Free events DO write orders today and the loop works end-to-end (Day-30 born-paid bypass + Day-34 Phase 1 form + Day-34 Phase 2 loop e2e). No consent friction for free events at MVP, consistent with the broader §13.5 free-event simplification.
- Paid events on staging hit `STAGING_PAYMENT_BLOCK` and never settle real money, so the absence of consent there is moot until the truth gate runs.

### Cross-references

- [`decisions.md` 2026-05-17 "Trust Center v0.1 placeholders — skeleton-only"](decisions.md) — the upstream constraint.
- CLAUDE.md §20 + §21.3 (host-liability doctrine; what consent capture is supposed to support).
- §9.11 `consent_records` schema (already in place; the writes land later).
- §29 open items #9 (AIT tax) + counsel-v1.0-docs (implicit) — same truth-gate scope.

---

## 2026-05-26 · Sprint 4 Day 34 Phase 0 — Staging EC2 swap stopgap; t3.medium flagged as pre-production capacity decision

**Context:** Day-33 mid-session incident (recorded in [`gotchas.md`](gotchas.md) "Staging EC2 (t3.small, 2GB, no swap) went unreachable mid-session — in-VM hang"): the staging EC2 went unreachable under the full stack (web + api + Postgres + Redis + BullMQ delivery worker on 2 GB RAM with zero swap). Hypervisor healthy; OS hung; first console `Reboot` didn't fire (ACPI on a hung guest); recovered via Stop+Start. Handoff to Day 34 mandated this as the **FIRST THING** before any new feature code that would add memory pressure.

### Decision

Apply the **swap stopgap immediately** on staging EC2 `i-02e4fddeb923c14f9` and codify it so a fresh EC2 rebuild reproduces it. Flag the t3.medium upgrade as a pre-production capacity decision for Moshiur.

**What landed Day 34 Phase 0 (this entry):**

- 2 GB swap file at `/swapfile` (`fallocate -l 2G` + `chmod 600` + `mkswap` + `swapon`), persisted in `/etc/fstab` (`/swapfile none swap sw 0 0`).
- `vm.swappiness=10` (swap as safety net, not routine eviction), persisted via `/etc/sysctl.d/99-eventpulse-swap.conf`.
- Codified in [`infra/scripts/bootstrap-staging.sh`](../../infra/scripts/bootstrap-staging.sh) step 0.0 (idempotent — re-running on an existing instance is a no-op). A fresh EC2 rebuild via the documented bootstrap procedure will now apply the swap automatically.
- Recovery procedure documented in [`docs/runbooks/staging-bootstrap.md`](../../docs/runbooks/staging-bootstrap.md) "Recovering from an in-VM hang": Stop+Start (NOT Reboot) when port 443 + SSM are both dead but the hypervisor is healthy; post-recovery checklist including `STAGING_PAYMENT_BLOCK=1` re-verification.
- PM2 boot-resume verified already in place (`pm2-eventpulse.service` enabled, `dump.pm2` present + saved). No change needed.
- PM2 `max_memory_restart` per-process verified already in place in [`pm2/ecosystem.config.cjs`](../../pm2/ecosystem.config.cjs) (web=512M, api=256M — sensible headroom over Day-33 actuals of 125 MB + 128 MB). No change needed.
- Delivery worker confirmed running inline within the api process (`startDeliveryWorker()` in `apps/api/src/index.ts:36`), not a separate pm2 process. The 256M cap on api includes it.

**What's still flagged for Moshiur (NOT autonomously actioned):**

1. **Instance resize to t3.medium (4 GB RAM, ~+$15/mo).** Swap is staging-grade defence-in-depth; production wants real headroom. The full stack peaks under deploy compounded with running processes; the 2 GB ceiling is structurally close to that peak, and swap is slower than RAM. **Decision needed before prod cutover, not blocking for the rest of Sprint 4.** STOP-ASK condition for any future infra session.
2. **CloudWatch memory alarm at >85% sustained 5min.** CW Agent already ships the metric; just needs the alarm wired. Not done Phase 0 because the brief scoped Phase 0 to `{swap, fstab, swappiness, PM2 config}` only — AWS CW alarm creation is "AWS write beyond capacity fix" → STOP-ASK in this session, but a small follow-up.

### Why swap+swappiness=10 instead of e.g. swappiness=60 default or no swap

- **No swap was the actual cause of the hang.** With swap available, the OOM-killer is a last resort; without, it fires immediately and can take out load-bearing processes.
- **swappiness=10 keeps swap as a safety valve.** The default 60 means Linux will start swapping fairly aggressively even when there's free RAM — fine on a workstation, wasteful on a server where you'd rather use RAM and only fall back to swap during spikes. 10 means "only swap when really under pressure" — exactly the use case here.
- **2 GB swap on 2 GB RAM (1:1)** is the standard guidance for "I want a safety net but I'm not building a workstation." Doubling RAM via swap would be excessive (it would imply we expect to routinely run hot, which would be a separate problem to solve at the instance level).

### Why codifying in `bootstrap-staging.sh` (not Ansible)

The repo doesn't have an Ansible playbook in the tree yet (per CLAUDE.md §17.3 it's mentioned as the intended tool but not yet present). The `bootstrap-staging.sh` script is the de facto "fresh-EC2-to-running" runbook today. Adding it there keeps it executable + idempotent + co-located with the rest of the per-instance state. When/if Ansible lands, this section maps cleanly to a `swap` role.

### Consequences

- Day 34 buyer-form work + the rest of Sprint 4 deploys run with 2 GB swap headroom + swappiness=10 — recurrence of the Day-33 in-VM hang under transient build spikes is materially reduced.
- A fresh EC2 rebuild via the documented bootstrap procedure now reproduces the swap setup — institutional memory captured in code + runbook.
- The t3.medium upgrade is **not silently deferred**; it's pinned here + in `handoff.md` as a pre-production capacity decision Moshiur owes.
- A future capacity incident on staging that recurs DESPITE the swap → escalate to the t3.medium upgrade rather than chasing other root causes (swap was the primary OOM mitigation; if it doesn't suffice, the box is undersized).

---

## 2026-05-25/26 · Sprint 4 Day 33 — Tenant sales dashboard + payouts view; snapshot-vs-current display policy

**Context:** Sprint 4 Day 33 shipped 3 PRs (one per phase) completing §26.1 Sprint 4 Day 5 deliverable (tenant sales dashboard + tenant payouts view with current fee config visibility).

- PR #188 (Phase 1) — tenant sales metrics service + endpoint (`9b7b662`); 1 hotfix for the eventId-filter test fixture (`3b99fad`)
- PR #189 (Phase 2) — sales dashboard UI with Recharts time-series (`f428050`)
- PR #190 (Phase 3) — read-only payouts view (`f501298`); 1 hotfix for `react/no-unescaped-entities` on `you're` apostrophes
- **Incident:** mid-session, staging EC2 went unreachable (in-VM hang). Reboot → web crashloop on missing `.next` (deploy regenerates it) → final deploy succeeded after one workflow-waiter timeout. See incident section in handoff.md + new gotchas.

Two architectural choices warrant codification.

### Choice A — Snapshot-vs-current display policy for money dashboards

**Decision:** Dashboards that display money figures across paid orders MUST read the **snapshotted** fee fields stored on each order (`platformFeePaisa`, `epsFeePaisa`, `netToOrganiserPaisa`, etc.) — NEVER recompute via the fee calculator from current `tenant_fee_config`. The CURRENT fee config is displayed separately as "your current fee terms going forward."

**Why the snapshot is authoritative for display:**

1. **Per-tenant fee terms can change** (§14.4 + Decision N — super-admin per-tenant override; 4-eyes principle on >10 bps swings). A dashboard recomputing from current terms would lie about what was actually charged — including how much was actually owed to the organiser at the time.
2. **The fee calculator is the SINGLE SOURCE of money truth at order time** (§14.3). Recomputing it at display time risks divergence with what the buyer + EPS actually settled. The order row's snapshot IS the ledger; the dashboard reflects the ledger.
3. **§14.10 Invariant 1 already holds on the snapshot:** `total = subtotal + platformFee + epsFee + withholdingTax`. The dashboard surfaces what's already conserved.
4. **Regulator-facing semantics.** "Show me my revenue last quarter" must mean "what the books say you earned at the prices in effect then", not "what you would have earned under today's rates."

**Why current fee config is displayed separately:**

The payouts view's "Your current fee terms" panel reads `getEffectiveFees(tenantId)` directly. This is what NEW orders going forward will be charged. A tenant whose fee was raised from 25 bps to 100 bps sees:

- **Snapshot panel:** "Platform fee on these orders: ৳ 50.00" (the 25 bps that was actually charged)
- **Current terms panel:** "Platform fee rate: 1.00% (Custom rate set by Event Pulse)" (the new 100 bps)

Both true; neither contradicts the other. The dashboard makes the distinction visible.

**Why this is a decisions-layer entry:**

A future PR that:

- Recomputes net from current bps "for accuracy" → would lie about historical orders. Pin "snapshot for display, current for forward-looking" here.
- Removes the current-fees panel as "redundant" → loses forward visibility for the tenant. Pin "show both" here.
- Adds a refund-or-net adjustment that recomputes mid-view → same risk. Pin "the snapshot is the ledger" here.

**Consequences:**

- Pinned by `apps/api/src/routes/tenant/reports-payouts.test.ts` test "mutating tenant_fee_config does NOT change the payable total (snapshot stays)" — directly demonstrates the asymmetry.
- Pinned by `apps/api/src/routes/tenant/reports-sales.test.ts` test "fees come from order SNAPSHOT, NOT live tenant_fee_config recomputation".
- Future report endpoints (financial summary, monthly statements, ops reconciliation) inherit: snapshot for past, current for future, both labelled.
- The Sprint 7 super-admin Revenue Dashboard (§14.7) is the same shape one level up — it MUST also snapshot-read; that future PR's reviewer should pin this rule again.

**Priced-revenue verification caveat:** with STAGING_PAYMENT_BLOCK=1, only free-event paid orders exist on staging. Dashboard LOGIC is correct + tested (DB-gated synthetic orders); PRICED-revenue display is unverified until the truth gate produces real paid orders. The Decision N truth-gate run will be the first real proof.

### Choice B — Dashboard aggregation under withTenant() — RLS is the security boundary

**Decision:** All aggregate queries (`SUM`, `COUNT`, conditional `FILTER (WHERE ...)`) for the tenant dashboard run inside `withTenant(tenantId)`. The `eventpulse_app` role engages RLS via `orders_tenant_select` + sibling policies; aggregate sums only see rows visible to the policy. Aggregate queries also include an explicit `WHERE orders.tenant_id = $tenantId` predicate as defence in depth (belt + braces — RLS is the primary guard, the app-layer filter is the redundant second).

**Why both layers:**

The classic dashboard footgun is an unscoped `SUM(...)` that crosses tenants. One tenant seeing another's revenue is a data breach with regulatory consequences. The aggregate-isolation surface is uniquely dangerous because:

- The single number returned (a SUM) carries the leak silently — no PII row to flag, no per-row audit to catch it. The wrong-by-a-factor-of-10x revenue figure looks just like the right one to a naive reviewer.
- A future "performance" refactor that switches from `withTenant` to `withSuperAdmin` for speed (BYPASSRLS is faster on aggregates) would silently leak. The explicit `WHERE tenant_id =` is the secondary defence that catches that mistake.

**Why this is a decisions-layer entry:**

A future PR that:

- "Speeds up" by moving aggregates to `withSuperAdmin` without the app-layer filter → leaks. Pin "both layers always" here.
- Drops the explicit `WHERE tenant_id` thinking RLS makes it redundant → drops the redundancy that catches a future RLS regression. Pin "both layers always" here.
- Adds a new aggregate endpoint (e.g., funnel report, attendance reports) without the same dual defence → security regression. Pin the pattern as the canonical shape for ALL future aggregate-over-tenant-data endpoints here.

**Consequences:**

- Pinned by `apps/api/src/routes/tenant/reports-sales.test.ts` test "cross-tenant aggregate isolation: tenant A SUM excludes tenant B orders" — seeds 10M paisa under tenant B + asserts tenant A's gross stays well under 10M.
- Pinned by `apps/api/src/routes/tenant/reports-payouts.test.ts` test "cross-tenant aggregate isolation: tenant A view excludes tenant B orders" — same shape, different endpoint.
- The Sprint 7 super-admin Revenue Dashboard (§14.7) is the EXCEPTION — it's deliberately super-admin-scoped + cross-tenant-aggregating (that's its job). It does NOT inherit this pattern; its own audit + access-control surface is the security model. Future contributors should not mistakenly apply this pattern there.

**Cross-references:**

- `decisions.md` "Day 32 Choice A" (bulk PII extraction audit policy) — same security-class concern at the row layer; dashboard aggregates extend it to the SUM layer.
- §4.2.1 (Postgres role hierarchy — `eventpulse_app` vs `eventpulse_admin`) — the role-switch is the load-bearing primary defence.

---

## 2026-05-25 · Sprint 4 Day 32 — Attendee list (CRM) + CSV export; bulk-PII-extraction audit policy

**Context:** Sprint 4 Day 32 shipped 3 PRs (one per phase) completing §26.1 Sprint 4 Day 1-2 deliverable (Attendee CRM — search, filter, export CSV).

- PR #184 (Phase 1) — tenant attendee list service + endpoint (`4d9a2b3`)
- PR #185 (Phase 2) — attendee list UI (TanStack hook + plain-table page + filter bar) (`e41db45`)
- PR #186 (Phase 3) — CSV export — audited, UTF-8, RLS-scoped (`2c71520`); 1 hotfix for the WHATWG-BOM-strip gotcha (caught in CI)

Two architectural choices warrant codification.

### Choice A — Bulk PII extraction audit policy (list ≠ export)

**Decision:** The attendee LIST endpoint does NOT write per-row audit; the CSV EXPORT endpoint writes exactly ONE audit row per request, regardless of row count (including row_count=0 cross-tenant probes).

**Why the asymmetry:**

The list endpoint is per-page operational read — tenant viewing OWN attendees. Per-row audit on a paginated list of N attendees would write N audit rows per page load, drowning out the interesting state-changing events. This mirrors the Decision G precedent (Item 13 / Day 18 / 2026-05-18) where the KYC list view does NOT audit per row but the detail view DOES.

The CSV export is fundamentally different — it's a **discrete operational event** where potentially thousands of PII records leave the platform as a single user action. The right audit granularity is one row per export, capturing:

- Actor user (who clicked Export)
- Event id (whose data left)
- Row count (how much)
- Filter snapshot (search + tier + check-in + order-status applied at export time)
- IP + user-agent

Crucially, the audit row does NOT capture per-attendee names/emails. Those still live on the attendees rows themselves; replicating them in the audit trail violates §1.3 R5 (PII spreading) without adding regulator value. The audit answers "who exported whose data, when, with what filter" — enough for forensic reconstruction, no more.

**Cross-tenant export attempts get audited too.** The audit row is written inside `withTenant(tenantId)` so it carries the CALLER's tenant id (not the target's). When tenant B probes for tenant A's data, the audit row records "tenant B's actor exported event A, row_count=0". That's operationally interesting — ops dashboards can surface "tenant X has been probing other tenants' exports" as anomaly signal.

**Why this is a decisions-layer entry:**

A future PR that "simplifies" by either:

- Adding per-row audit to the list endpoint → would generate N rows per page load, noise that drowns out real state-changing events. Pin "list does NOT audit" here.
- Removing the export audit because "it's just a read" → loses the regulator-facing trail for PII extraction. Pin "export DOES audit" here.
- Capturing PII fields in the export audit "for completeness" → violates §1.3 R5 spreading. Pin "audit captures action+filter only, never row content" here.

**Consequences:**

- Pinned by `apps/api/src/routes/tenant/attendees.test.ts` test "list endpoint does NOT write per-row audit_logs entries" (the negative test).
- Pinned by `apps/api/src/routes/tenant/attendees-export.test.ts` test "happy path writes exactly one audit row" + "cross-tenant export → 0 rows + audit row recording the attempt".
- Future PII-export-class endpoints (financial-statement export, attendee-list-emailed-to-bcc, etc.) inherit this pattern: one audit row per discrete operational event, capturing action+filter, never row content.

### Choice B — Phase boundary ≠ scope boundary

**Decision (process-level, worth codifying):** Phases are boundaries for PR shape (one focused PR per logical change), NOT boundaries for scope splits when the scope is naturally one logical change.

Phase 3's `feat(attendees): CSV export` bundled:

- New service (`exportEventAttendees`)
- New audit helper (`writeAttendeesExported`)
- New route handler with text/csv response shaping
- New unit tests (11) + integration tests (6)
- **New UI download button (1 anchor + 3 tests)**

The download button (~10 lines) is meaningless without the endpoint, and the endpoint is unverified-end-to-end without the button. Splitting them into 3a (backend) + 3b (frontend) would have produced two PRs that are each individually unhelpful. They're one logical change.

**Why this is worth codifying:**

The brief's "ONE focused PR per logical change" rule could be misread as "one PR per file group / per app / per app-tier." The actual intent is "what could a reviewer hold in their head as a single atomic shipped feature." For CSV export, that's "the user can now click Export CSV and get an audited file." Backend-only OR frontend-only doesn't satisfy that bar.

Counter-example where splits ARE appropriate: Days 27-29's order pipeline shipped as Phase 1 (idempotency middleware) + Phase 2 (capacity lock) as separate PRs because each was independently shippable + testable — middleware works without the lock, lock works without the middleware.

The principle: **a logical change is one whose value can't be measured without all its parts.**

**Cross-references:**

- `decisions.md` "Day 28 architectural choices" Choice C (delivery decoupled from settlement) — opposite case: separable concerns get separable PRs
- `decisions.md` "Day 29 architectural choices" Choice A + B (idempotency fail-closed + capacity lock fail-open) — separable concerns even though both touch the same endpoint

---

## 2026-05-25 · Sprint 4 Day 31 — Web QR scanner + Check-In; optimistic-admit offline door policy

**Context:** Sprint 4 Day 31 shipped 3 PRs (one per phase) consuming Day 28's QR tokens via the §26.1 Sprint 4 Day 3-4 deliverable.

- PR #180 (Phase 1) — server check-in validation + endpoint (`37a2241`)
- PR #181 (Phase 2) — browser QR scanner UI (`f4aa8d8`)
- PR #182 (Phase 3) — offline-tolerant scan queue + sync-on-reconnect (`302a76a`)

Three architectural choices warrant codification.

### Choice A — Door-correctness invariant via atomic compare-and-swap

**Decision:** Check-in admission is the conditional UPDATE `WHERE checked_in_at IS NULL` `RETURNING` row, run inside the `withTenant` tx. Postgres row-lock serialises concurrent scans of the same ticket; the winning scan returns the row + transitions it to admitted; the loser returns zero rows + disambiguates via a follow-up `SELECT` that returns the prior `checked_in_at` / `checked_in_by` / `checked_in_gate` for the ALREADY_CHECKED_IN response.

**Why CAS, not check-then-update:**

A check-then-update sequence (SELECT … then UPDATE … if not checked in) is racey under concurrent scanners. Two device-side scanners can both SELECT the unchecked row, both decide "admit", and both UPDATE. Postgres' row-lock under conditional UPDATE collapses this race down to "one wins, one returns zero rows" — which is exactly the door semantic we want.

**Schema reality:** `attendees` has no `event_id` column; admission scoping is via a subquery through `ticket_tiers` (`inArray(attendees.ticketTierId, tierIdsForEvent)` for the UPDATE, `innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))` for the SELECT). The wrong-event case never leaks data — the UPDATE simply matches zero rows + a separate SELECT against `attendees` alone returns the row only for the disambiguation outcome (NOT a different event).

**Consequences:**

- Door-correctness pinned by `apps/api/src/routes/tenant/checkin.test.ts` 11 DB-gated tests including a 50-concurrent-scan race that always admits exactly one and returns ALREADY for the other 49.
- Sprint 4+ refactors that "tighten" the check-in service MUST preserve atomic-CAS semantics. A future refactor that splits "validate" from "transition" into separate tx ticks would re-introduce the race.
- The `checked_in_by` / `checked_in_gate` columns are the audit trail; the audit_logs row is the secondary record.

### Choice B — Optimistic-admit offline door policy (§-spec silent; Auto Mode call)

**Decision (Auto Mode call, §-spec silent on door UX):** When the scanner has no network, the door admits the attendee under a clearly-labelled "TENTATIVE (offline)" banner; the scan is queued to IndexedDB; flushed to the server on reconnect; the server's compare-and-swap from Choice A is the FINAL authority.

When two offline devices both admitted the same ticket during a network outage, the first to sync wins (server's CAS admits one), the second's sync receives `ATTENDEE_ALREADY_CHECKED_IN`, the sync orchestrator tags the outcome as `duplicate_on_sync`, and the sync report surfaces a `duplicateCount` for ops review (the existing dashboard would also see the audit_logs row).

**Why optimistic-admit:**

1. **Bad connectivity is the WHOLE reason §26.1 specified offline-tolerant.** Queue-and-wait would unwork festival / venue door staff at exactly the moment they need to keep moving.
2. **The §13.5 free-event bypass + Day 28 cryptographically-random QR token combination means the door-side validation is "this token format looks plausible, mark tentative, queue for server resolution."** The server is the ONLY source of admit-truth — that boundary already exists.
3. **The threat model is honest-mistake double-scan, not coordinated 2-device fraud.** A coordinated attacker could double-admit before sync, but the duplicate is detected the moment ONE device syncs + ops gets a forensic trail (the `duplicate_on_sync` flag + per-row audit).
4. **Industry standard for festival / venue ticketing.** Eventbrite, Universe, Frontgate all operate this way.

**Why this is a decisions-layer entry:**

The §-spec was silent on door UX. A future "tighten" PR that:

- Switches to queue-and-wait ("no server, no admit") — would unwork venues with bad connectivity. The whole point of §26.1 Day 3-4 is offline tolerance.
- Removes the duplicate_on_sync flag — would lose the forensic trail. Pin the flag here.
- Removes the "(tentative — offline)" UI banner — would let staff treat an unsynced admit as definitive. Pin the banner here.

**Consequences:**

- Pinned by `apps/web/src/lib/offline-checkin-queue.test.ts` 12 unit tests including the canonical OFFLINE-DOUBLE-ENTRY: two enqueued scans of SAME-QR → first admitted, second duplicate_on_sync, BOTH removed, `duplicateCount=1`.
- The sync orchestrator removes rows on ANY definitive outcome (admitted / duplicate_on_sync / invalid / wrong_event / voided) — "the server has decided" is the removal trigger. Network errors leave rows queued for retry.
- Future ops dashboard (Sprint 4+ admin reports) will surface duplicateCount alerts. Schema is ready.
- IndexedDB persistence survives page reload + OS sleep; door staff can refresh the scanner page without losing queued scans.

**Cross-references:**

- `decisions.md` "Day 28 architectural choices" Choice A (QR token is 256-bit cryptographically-random opaque base64url; brute-force ~3.7×10⁶⁰ years; no signature verification needed)
- `decisions.md` "Day 30 / Sprint 3 closeout" Choice B (§14.10 ledger invariants — same pattern: pure functions over rows, deterministic, property-testable)

### Choice C — Frontend offline-storage tests via injected `IDBFactory` (not `fake-indexeddb/auto` globals)

**Decision:** `apps/web/src/lib/offline-checkin-queue.ts` exposes every public function with an explicit `factory: IDBFactory | null = defaultFactory()` parameter. Production callers pass nothing (the default reads `globalThis.indexedDB`). Tests pass `(globalThis as { indexedDB: IDBFactory }).indexedDB` after `import 'fake-indexeddb/auto'` at the top of the test file — the fake-indexeddb package patches globals; we just hand the patched value into our pure-functions.

**Why dependency injection over global patching:**

1. **Testable without global mutation cascades.** A test failure in one storage test doesn't leave globals dirty for the next test (each test gets `clearAll(factory)` in `beforeEach` / `afterEach`).
2. **Composable with the sync orchestrator.** `syncCheckinQueue({ apiBase, fetcher?, factory? })` takes the same factory dep + a `fetcher` dep, so the orchestrator is testable end-to-end with both deps mocked — no `vi.spyOn(window, 'fetch')` shenanigans.
3. **Pattern matches `withTenant` / `withSuperAdmin` discipline.** Same idea: pure functions over an injected resource, not closure-captured singletons.

**Consequences:**

- A future "factor out the queue" refactor must preserve the `factory` parameter. Removing it would force tests back to global mutation.
- The pattern applies to future browser-storage work: localStorage (settings), Cache API (offline event pages), Service Worker registration (push notifications) all get the same shape.

**Pinned by:** `apps/web/src/lib/offline-checkin-queue.ts` defaultFactory pattern + `apps/web/src/lib/sync-checkin-queue.ts` syncCheckinQueue({factory}) shape.

---

## 2026-05-25 · Day 30 / Sprint 3 closeout — free-event bypass, ledger invariant verifier, sprint-close pivot

**Context:** Sprint 3 Day 30 — closeout day. 4 PRs shipped (the bypass fix + E2E smoke + ledger verifier + closeout). Tag `v0.3.0-sprint-3` cut. Sprint 3 buildable work DONE.

- PR #175 (Phase 1a) — §13.5 free-event bypass (`aeb006b`)
- PR #176 (Phase 1b) — E2E full-stack smoke (`2c6f36f`)
- PR #177 (Phase 2) — §14.10 ledger invariant verifier (`2cba41d`)
- PR #178 (Phase 3) — Sprint 3 closeout + v0.3.0-sprint-3 tag (this PR)

Three architectural decisions warrant codification at the decisions layer.

### Choice A — §13.5 free-event bypass: born-paid, NO EPS call

**Decision (per §13.5 spec, latent bug shipped today):** When `calc.buyerTotalPaisa === 0n`, `createOrder()` transitions the order to `status='paid'` + `paid_at=NOW()` inside the same withSuperAdmin tx that creates it, writes an `order.paid` event-sourcing row with `source='free_event_auto_settle'`, and SKIPS `initialiseOrder()` entirely (no EPS call ever fires for free orders). After the tx commits, `enqueueOrderDelivery()` fires the standard Day-28 delivery pipeline.

**Why this is a decisions-layer entry:**

The bypass was specified in playbook v1.0 (§13.5: "events where every ticket tier has price_paisa = 0 → No payment integration, order goes pending → paid immediately"). It was NEVER implemented. The createOrder service hardcoded `status: 'awaiting_payment'` + always called `initialiseOrder()`. No test exercised the free-event path (no test used `pricePaisa: 0n`). The bug was latent for ~6 months.

Caught at Day 30 Phase 0 reading createOrder + cross-checking against §13.5 ahead of the E2E smoke. The brief's Phase 1 STOP-ASK ("if the free-event path doesn't cleanly bypass EPS") matched the bug exactly.

**Consequences:**

- `CreateOrderResult.status` widened: `'awaiting_payment' | 'paid'`.
- `CreateOrderResult.paymentInitState` widened: `'ready' | 'blocked' | 'free'`. The new `'free'` discriminator distinguishes "free event bypassed EPS" from `'ready'` ("paid event, EPS init succeeded") and `'blocked'` ("paid event, STAGING_PAYMENT_BLOCK refused init").
- Mixed paid+free tier order takes the PAID path — §13.5 rule is "EVERY tier price_paisa = 0", NOT "any tier". A cart with one free + one paid tier has `totalPaisa > 0n` → EPS init fires (or block-refuses). Pinned by test.
- The paid path (`totalPaisa > 0n`) is byte-identical to before the fix. The bypass is purely additive.
- The §14.10 Invariant 1 holds trivially for free orders (total = 0 = 0+0+0+0).
- Sprint 4 buyer form UI works for free events without any further backend changes.

**Cross-references:**

- §13.5 verbatim (the spec that motivated the fix)
- `decisions.md` "Day 28 architectural choices" Choice C (delivery decoupled from settlement — the same enqueue pattern used by the free-event branch)
- `gotchas.md` (Sprint 4 Day 1 should audit other "spec'd behavior without dedicated test" sections — see retro in handoff.md)

### Choice B — §14.10 ledger invariant verifier shipped as PURE functions over row arrays

**Decision:** `apps/api/src/domain/ledger/invariants.ts` ships pure `checkInvariant1PerOrder` + `checkInvariant2PerBatch` + typed `LedgerInvariantError` + `assert*` convenience wrappers that throw. No I/O, deterministic, side-effect-free, property-testable. The §14.3-style "single source of truth" discipline applied to the verifier surface.

**Why pure-over-rows (not DB-backed-direct):**

1. **Property-testable.** The verifier can be exercised against ANY row array, including synthetic violations + fee-calculator outputs. 320 PROPERTY tests (4 §14.2 modes × 5 subtotals × 4 platform_bps × 4 eps_bps) prove the invariant holds BY CONSTRUCTION across the fee-calculator's input space. This wouldn't be possible if the verifier required a DB.
2. **Composable.** The DB-backed verifier (the Sprint 7 reconciliation cron, the Day 30 Phase 1b's `it('§14.10 Invariant 1 across ALL e2e-smoke orders')` test) is a thin wrapper that loads rows + delegates to the pure function.
3. **Per-row diagnostic.** §14.10 says "for every order"; the pure function returns per-row violations so the on-call can pinpoint the offending order, not just an aggregate mismatch.

**BIT-EXACT bigint arithmetic.** Per §1.3 R2 "money never lies": no tolerance, no rounding. A single paisa discrepancy IS a real money bug; the verifier surfaces it.

**Why this is a decisions-layer entry:**

The verifier is the load-bearing artifact for the §14.10 invariants. Future surfaces:
- Sprint 7's reconciliation cron will invoke `assertInvariant1PerOrder` + `assertInvariant2PerBatch` after every batch creation.
- Future enterprise-tier "audit log of audit log" features will use the per-row violation reports.
- The Decision N truth gate will invoke `checkInvariant1PerOrder` against the 4 real priced rows; ANY violation halts the gate + pages on-call.

A future "tighten" PR that:
- Adds a tolerance ("within 1 paisa is fine") — would silently allow money leakage. Pin the bit-exact requirement here.
- Switches from per-row to aggregate-only — would lose the diagnostic. Pin per-row here.
- Removes the `assert*` wrappers — would break the §14.10 "any violation halts new batch creation" semantic. Pin the throw-on-violation here.

**Consequences:**

- §14.10 Invariant 1 HOLDS BY CONSTRUCTION across 320 parameterized fee-calculator output cases.
- §14.10 Invariant 1 HOLDS on every free order persisted via Day 30 Phase 1b (trivially: total = 0).
- §14.10 Invariant 1 on PRICED orders is READY for the Decision N truth gate; the verifier just runs against the 4 priced rows.
- §14.10 Invariant 2 has the pure function shipped + fixture-tested; DB verifier wires in Sprint 7 when `disbursement_batches` schema lands.

### Choice C — Sprint close pivot: pipeline feature-complete, truth gate is THE blocker

**Decision (sprint-level not code-level):** Sprint 3's buildable work is DONE. Pipeline is feature-complete behind STAGING_PAYMENT_BLOCK. The Decision N truth gate is now THE gating milestone for any work that touches real money.

**Why this needs codification:**

The truth gate has been "deferred" or "pending" for ~10 days. After Sprint 3 closeout, calling it "deferred" is misleading — it's BLOCKING. Sprint 4 can ship buildable work in parallel (attendee list, QR scanner, dashboards, marketing) but anything touching priced money (refund flows, payouts, first paying tenant) is hard-gated on the truth gate.

The three Moshiur items the truth gate needs:

1. EPS sandbox credentials confirmed OR authorized controlled block lift + `decisions.md` entry per §11.0
2. §29 #9 (AIT withholding) tax opinion — calculator is pre-withholding per file header
3. SES out-of-sandbox approval — without it, real ticket emails won't deliver

**Consequences:**

- Sprint 4 kickoff issue (#178) prominently surfaces the truth-gate blockers + the parallel-buildable work split.
- Every session start through Sprint 4 should restate the truth-gate blockers in the session-start summary.
- The first paying tenant (§26.1 Sprint 4 Day 10) is hard-gated. Sprint 4 might land all its CODE without unblocking the launch.

**Pinned by:**

- handoff.md "CRITICAL: where we are right now" section (rewritten this PR)
- progress.md "In flight" section moved Sprint 3 → Done, Sprint 4 → In Flight as Planned, with the truth-gate-vs-parallel-buildable split called out
- Sprint 4 kickoff issue #178

**Cross-references:**

- `decisions.md` "EPS production credentials intentionally used in staging — STAGING_PAYMENT_BLOCK guard" (2026-05-19) — the guard that makes truth gate the right ceremony
- `decisions.md` "Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate" (2026-05-19) — the spec for what the truth gate does

---

## 2026-05-25 · Day 29 architectural choices — Idempotency semantics, capacity-lock ORDER BY, Redis warm-up

**Context:** Sprint 3 Day 29 shipped 5 PRs (2 phases + 2 hotfixes + memory) closing the last two hardening concerns on the order-creation surface before Sprint 3's pipeline is feature-complete.

- PR #170 (Phase 1) — Idempotency-Key middleware (`85259fb`)
- PR #171 (Phase 2) — FOR UPDATE capacity lock (`52e306a`)
- PR #172 (Phase 1 hotfix #1) — body-clone fix (`21b6a39`)
- PR #173 (Phase 1 hotfix #2) — Redis warm-up at boot (`1a93740`)
- PR #174 (memory) — this closeout

Four architectural decisions warrant codification.

### Choice A — Idempotency-Key middleware fails CLOSED on Redis absence (NOT pass-through)

**Decision:** When Redis is unavailable, the middleware returns 503 `IDEMPOTENCY_INFRA_UNAVAILABLE` rather than passing the request through to the route handler.

**Why fail-CLOSED (vs Day 28's fail-OPEN `enqueueOrderDelivery`):**

The two semantics differ by what's on the line:

- **Day 28 `enqueueOrderDelivery` fail-open** is correct because delivery is a downstream consequence; the operator can retry the failed delivery later (the order stays paid; ops can manually re-enqueue). Coupling settlement to Redis would make Redis a single point of failure for the money path.
- **Day 29 `idempotency-key` middleware fails CLOSED** because it gates the SOURCE OF TRUTH path. Without Redis, the middleware cannot guarantee at-most-once processing. Passing through would let two retries both create orders, defeating R6's at-most-once guarantee.

The right axis is: **does this layer have a deferred retry path, or is it the layer that decides what happened?** Delivery has retries; idempotency IS the layer.

**Pinned by tests + file header rationale.**

### Choice B — Idempotency body hash = SHA-256 of RAW request bytes (NOT canonicalised JSON)

**Decision:** The body-hash compared on replay is `sha256(raw bytes)`. Two requests with the same serialised bytes are TRULY identical; semantically-equivalent payloads with formatting differences (key reorder, whitespace change) are TREATED AS DIFFERENT → 422 `IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY`.

**Why strict:**

- Client-side serialisers are deterministic. The same code calling the same JSON.stringify on the same data produces the same bytes. A "tiny field reorder" between retries is a SIGNAL that the client code changed (e.g. user edited the form mid-retry) — and silently returning the cached response from the original would be wrong.
- The safer default is to reject and force a fresh key when the client genuinely intends a different operation. A false positive (rejecting two truly-equivalent payloads) is the client's bug to fix; a false negative (returning the wrong cached response) is OUR bug and silent.

**Trade-off acknowledged:** If a client uses a non-deterministic serialiser (rare but possible), they'll always get 422 on retry. The middleware's behavior is documented; clients must use stable serialisation.

**Pinned by test** `whitespace-only difference in JSON is treated as different body (deliberate strict policy)`.

### Choice C — FOR UPDATE capacity lock uses ORDER BY id for multi-tier deadlock avoidance

**Decision:** The capacity-lock SELECT is `SELECT ... FROM ticket_tiers WHERE id IN (...) ORDER BY id ASC FOR UPDATE`. The ORDER BY is LOAD-BEARING — not stylistic.

**Why it's load-bearing:**

Without ORDER BY, Postgres acquires row locks in the scan order it happens to choose (usually but not guaranteed to be the IN-clause order, which itself can come in any order from the application). For a multi-tier order:

- Order 1 buys tiers {X, Y}; Postgres scans → acquires X first, blocks waiting for Y.
- Order 2 buys tiers {Y, X}; Postgres scans → acquires Y first, blocks waiting for X.
- **Deadlock.** Postgres detects after a timeout (`deadlock_timeout`, default 1s) and aborts one of the transactions with `40P01 deadlock_detected`. The user sees a generic 500.

With ORDER BY id, the lock acquisition order is canonical — both Order 1 and Order 2 try to acquire X first (the lower-id tier), then Y. The second order BLOCKS on the first's X lock until the first commits; no deadlock.

**Pinned by test** `multi-tier ORDER BY id deadlock-free: two concurrent orders touching {A,B} and {B,A} both succeed`. Run against real Postgres via Promise.all — the deadlock would surface without the ORDER BY.

### Choice D — Redis singleton needs explicit `await redis.connect()` at boot

**Decision:** `apps/api/src/index.ts` calls `void redis.connect().catch(swallow)` at boot after `getRedis()`.

**Why this is load-bearing for the idempotency middleware:**

The singleton at `infra/redis/client.ts` uses `lazyConnect: true` + `enableOfflineQueue: false`. Day 26 design rationale: fail-fast for the EPS token cache hot path — a slow Redis can't hang token fetches indefinitely. Bounded retries + offline-queue-off means `redis.get()` throws synchronously if the connection isn't ready.

Without explicit warm-up at boot, the FIRST request after pm2 reload races against the deferred connect: ioredis throws "Stream isn't writeable", the idempotency middleware's `redis.get()` rejects, Hono returns generic 500. Production smoke after Phase 1 + Phase 2 deploy revealed this; the Day 26 design was right for runtime resilience (a Redis blip shouldn't hang requests indefinitely) but wrong at boot (the FIRST request should find Redis ready).

**Why warm-up at boot (vs flipping `enableOfflineQueue: true`):**

Flipping `enableOfflineQueue: true` would queue commands while connecting — fine for idempotency but DEFEATS the Day-26-intentional fail-fast on the EPS token cache. Boot-time warm-up preserves BOTH invariants: idempotency works on the first request AND EPS token cache stays bounded under runtime Redis blips.

**Pinned by:**

- Live staging smoke: simulated cold-start via `pm2 reload api`; first request returned typed 404 (not generic 500); boot log shows `redis.connect` + `redis.ready` immediately after `eventpulse api listening`.
- Decision-layer entry to prevent a future "tighten" PR from removing the warm-up without understanding why.

**Why this surfaced via TWO production hotfixes (#172 + #173) instead of being caught locally:**

Unit tests use `app.request()` which shortcuts Hono's internal caching AND injects mock Redis via `_setRedisClientForTest` BEFORE the singleton ever constructs. Real HTTP traffic goes through `@hono/node-server` (different path) AND uses the real singleton (which is lazy-connecting). The unit-test-vs-production-HTTP gap is the BLIND SPOT. Both hotfixes traced back to the same root.

Future practice: any HTTP-touching middleware change needs a post-deploy live curl smoke as part of the merge gate. Documented in handoff guard rails + gotchas.md.

**Cross-references:**

- PR #170 (Phase 1) → `85259fb`
- PR #171 (Phase 2) → `52e306a`
- PR #172 (hotfix #1) → `21b6a39`
- PR #173 (hotfix #2) → `1a93740`
- CLAUDE.md §1.3 R6 (idempotency requirement) + §6.4 (Idempotency-Key contract) + §9.3 (ticket_tiers.sold)
- `decisions.md` "Day 26 architectural choices" Choice C (Redis token cache stampede semantic; same singleton config under different threat model)
- `decisions.md` "Day 28 architectural choices" Choice C (delivery decoupled from settlement — the contrast that motivates Choice A here)
- `gotchas.md` "Hono middleware that hashes request body MUST use `c.req.raw.clone().text()`" (the body-stream production blind spot)
- `gotchas.md` "Redis singleton needs explicit warm-up at boot or the first request after pm2 reload races the lazy-connect"

---

## 2026-05-25 · Day 28 architectural choices — QR token design, PDF-as-attachment, BullMQ dedicated Redis connection

**Context:** Sprint 3 Day 28 shipped 3 PRs in dependency order, closing the post-paid delivery loop:

- PR #166 (Phase 1) — Per-attendee QR token + attendee row generation (`4392307`)
- PR #167 (Phase 2) — PDF ticket generation with embedded QR (`64e13dd`)
- PR #168 (Phase 3) — BullMQ delivery worker, end-to-end on paid (`f4ef282`)

Four architectural decisions were taken across these phases that warrant codification at the decisions layer.

### Choice A — QR token = 256-bit cryptographically-random opaque base64url (NOT a signed JWT-shape token)

**Decision:** `mintQrToken()` returns 32 random bytes from `crypto.randomBytes` → base64url-encoded (43 chars). Stored in `attendees.qr_code` (UNIQUE constraint from migration 0013); the QR image wraps the token in `${EVENTPULSE_API_BASE_URL}/scan/{token}`.

**Why opaque random (NOT signed):**

1. **Revocability via row delete.** Voiding a ticket = delete or null the row; the token becomes invalid instantly. A signed-JWT approach would need a blocklist surface that's expensive to consult at scan time.
2. **No shared signing key to compromise.** A key-compromise scenario on a JWT-signed scheme = mass-forgery across every ticket ever issued. Opaque-random has nothing to leak (other than the DB, which already has the tokens — the attacker who has DB access has already won).
3. **Simpler verifier.** Check-in (Sprint 4 Day 3-4) is a single `SELECT ... WHERE qr_code = $1 AND voided_at IS NULL` — no signature math, no key rotation, no clock-skew.
4. **§10.1 already documents** `POST /public/attendees/checkin` as the scanner pattern — DB lookup is the design.
5. **§ silent on encoding scheme** → opaque-random is the standard defensible MVP choice; the handoff plan documented this approach in advance.

**Why 256 bits of entropy:**

Brute-force at 1 billion attempts/second to enumerate the keyspace = ~3.7×10^60 years. The practical forge surface is zero. Birthday-paradox collision probability is vanishingly small (~10^38 tokens before collision becomes likely); DB UNIQUE constraint is the hard backstop and would surface any collision as a hard error, not silent overlap.

**Why URL-wrapping (not bare token):**

Camera apps + iOS Camera + Android Camera all recognise URLs and offer "open this link" out of the box. A bare opaque token doesn't trigger that affordance. Wrapping in a URL doesn't degrade security — the token is still 256 bits of opaque random; the URL just makes it scannable without a custom app.

**Consequences:**

- A future "tighten ticket security" PR that switches to signed tokens would need to justify the operational complexity (revocability + key rotation surface) — pin this entry as the prior decision.
- Token shape pinned by tests (43-char base64url, no `=`/`+`/`/`).
- The scanner endpoint (Sprint 4 Day 3-4) reads token from URL path param → DB row lookup → check-in.

### Choice B — PDF tickets travel as email attachments; NO S3 bucket (avoid AWS-write surface STOP-ASK)

**Decision:** `renderTicketPdf()` returns a Buffer; the delivery worker hands it to SES via `sendEmailRaw()` with the Buffer as an `application/pdf` MIME attachment. There is NO S3 bucket for tickets.

**Why no S3:**

1. **Day 28 brief explicit STOP-ASK condition:** "Tickets S3 bucket/KMS not established (AWS-write surface)". Going attachment-only avoids the surface entirely; no new bucket, no new KMS CMK, no IAM policy changes, no bucket policy review.
2. **SES 40MB attachment limit** is comfortable for ticket payloads (each PDF is ~10-50KB depending on QR density). A multi-attendee order with 10 tickets would be ~500KB. Well under the limit.
3. **Email IS the ticket delivery surface** in MVP. Buyers expect a "your ticket is attached" email — the PDF in-line is exactly what they want, not a click-to-download link that requires DB lookup + bucket policy traversal.
4. **Resend UX (future) re-generates.** No archival need at MVP — tickets are derivable from order + attendee + tenant brand at any time.

**When to revisit:**

If/when "resend ticket from dashboard" UX lands AND the regeneration latency becomes user-facing, we'd add a tickets bucket. That's a separate decision with its own KMS pattern (likely `alias/eventpulse-tickets-<env>` per the §17.9 per-purpose pattern). For Day 28's purpose, attachment-only is the cleanest MVP path.

**Consequences:**

- No bucket = no archive of historical tickets. The information IS in the DB (attendees + order rows); the PDF is the rendered surface.
- A future "ticket archive" requirement gets its own STOP-ASK + decision entry + bucket setup.

### Choice C — Delivery is DECOUPLED from settlement (settlement reliability invariant)

**Decision:** `enqueueOrderDelivery()` NEVER throws. A Redis blip / queue construct failure returns `{enqueued: false, reason: 'no_redis'}` + logs; settlement still commits paid. The delivery worker is a downstream retry surface; a failed delivery does NOT roll back the paid status.

**Why this is load-bearing:**

1. **Settlement IS the source-of-truth for money state.** A verified-paid order whose delivery hits a transient blip (Redis restart, SES throttle, PDF generator OOM) must still be paid in the DB. The order's `status='paid'` is the authoritative record; ticket delivery is a service consequence the operator can re-trigger.
2. **Without decoupling, a Redis outage would cascade into a payment processing outage.** That's the opposite of MVP scale-up readiness — Redis is the most-likely-to-blip component, and tying it to the paid transition would make Redis a single point of failure for payments.
3. **Idempotency on the worker side absorbs retries cleanly.** The `order.delivery_sent` append-only marker prevents double-send across worker retries; the operator can safely re-enqueue any time without risking double-delivery.

**Pinned by tests:**

- Unit test `enqueueOrderDelivery — no Redis (settlement reliability invariant) > does not throw — settlement must never be blocked by delivery infra`.
- Integration test `deliverOrder > idempotency — delivery marker > second invocation returns already_delivered without resending`.

**Consequences:**

- A future "tighten" PR that adds `await enqueueOrderDelivery(...)` outside a try/catch in settle.ts would silently re-couple settlement to delivery — pin this entry as the prior decision so reviewers grep before approving.
- The worker's own failure handling (BullMQ retry, DLQ) is the operator surface for delivery failures, NOT settlement rollback.

### Choice D — BullMQ requires a DEDICATED Redis connection with `maxRetriesPerRequest: null` (different threat model than the EPS token cache)

**Decision:** New `getBullRedis()` factory in `apps/api/src/workers/delivery-queue.ts` mints a SEPARATE ioredis instance for BullMQ with `maxRetriesPerRequest: null` + `lazyConnect: true`. The singleton at `apps/api/src/infra/redis/client.ts` (`maxRetriesPerRequest: 2`) stays bounded for the EPS token-cache hot path. Both the BullMQ Queue (producer) and Worker (consumer) consume the dedicated connection.

**Why this surfaced as a real bug:**

The first push of PR #168 crashed CI's E2E job with `Error: BullMQ: Your redis options maxRetriesPerRequest must be null.` BullMQ uses blocking Redis commands (BRPOPLPUSH, XREAD) that hold the connection open indefinitely; unbounded retries are part of the contract. The EPS token cache, by contrast, uses simple GET/SETEX commands and benefits from bounded retries (a slow Redis can't hang the EPS init path indefinitely).

**Why two clients (not one with the broader setting):**

Reusing the singleton with `maxRetriesPerRequest: null` would weaken the EPS token cache's bounded-retry property — a slow Redis could hang token fetches indefinitely, cascading into payment-init latency. Different threat models, different clients.

**Consequences:**

- A future BullMQ consumer (refunds queue, disbursement queue) reuses `getBullRedis()` — single source of truth for the BullMQ connection.
- Each Redis connection holds its own TCP socket + retry state. Two connections is operationally trivial.
- The `_resetDeliveryQueueForTest()` helper now resets the Bull-Redis singleton too so tests can re-init cleanly.

**Cross-references:**

- PR #166 (Phase 1 — QR + attendees) → merged `4392307`
- PR #167 (Phase 2 — PDF render) → merged `64e13dd`
- PR #168 (Phase 3 — BullMQ delivery worker) → merged `f4ef282`
- CLAUDE.md §1.3 R5 (no PII in logs; reviewed for QR token payload), §1.3 R12 (bilingual UI), §9.5 (attendees schema), §16.3 notification catalogue (`order_confirmed`, `attendee_ticket`)
- `decisions.md` "Day 27 architectural choices" — Choice A verify-by-callback authority that settle.ts implements; Day 28's delivery hook is the downstream consequence
- `decisions.md` "Auth foundation library choice" (2026-05-17) — same risk class: don't adopt a dependency for security-critical surface; opaque-random tokens have no external dependency
- `decisions.md` "Dedicated KMS CMK for KYC bucket" (2026-05-17) — same per-purpose pattern; if/when tickets bucket lands, it gets its own CMK

---

## 2026-05-25 · Day 27 architectural choices — EPS webhook auth model + browser-redirect non-authority

**Context:** Sprint 3 Day 27 shipped 3 PRs in clean dependency order:

- PR #162 (Phase 1) — Pure order state machine (`46a2575`)
- PR #163 (Phase 2) — Authenticated webhook + verifyOrder reconciliation (`bcfb89c`)
- PR #164 (Phase 3) — Browser redirect handlers — display-only, non-authoritative (`de0faed`)

Two architectural decisions were taken inside Phase 2 + Phase 3 that warrant codification beyond inline comments. Both are pinned by tests + by inline file headers; this decisions-layer entry exists to make the security model surveyable + to prevent future drift.

### Choice A — EPS webhook authentication model = verify-by-callback (NOT signature verification)

**Decision (Moshiur-approved at Day 27 Phase 0 STOP-ASK):** The webhook handler at `POST /api/v1/webhooks/eps/callback` does NOT verify a signature on the inbound payload. Instead, it treats the payload as a notification-only trigger. The only field consumed from the payload is `merchant_transaction_id` (used purely as a DB lookup key). The handler then ALWAYS calls `verifyOrder()` against EPS — the AUTHORITATIVE status read — and computes the state transition from the verify response, never from the webhook payload's claimed status.

**Why this is the right model:**

1. **§11 does NOT specify an EPS-side webhook signature mechanism.** §11.1 step 11 (the canonical guidance) reads: *"Server also receives EPS server-to-server webhook in parallel; webhook handler also calls Verify and reconciles. Idempotency handled via merchantTransactionId."* §10.5 generically notes that webhook endpoints verify signatures, but the EPS-specific mechanism (HMAC header? shared secret? IP allowlist?) is not documented anywhere in CLAUDE.md, the rejected SDK source the investigation doc inspected, or any prior repo commit.
2. **§11.1 step 11 explicitly designs verify-by-callback as the authority.** The webhook's role is to notify "this txn may have changed state" — the verify call IS the trust source. This is the canonical pattern when a payment provider's webhook signing is weak/absent.
3. **Fraud-impossibility argument (pinned by tests):**
   - Spoofed webhook claiming `paid` for an unknown txn → handler ignores payload status, calls `verifyOrder(that_id)` → EPS returns "txn not found" → no state change.
   - Spoofed webhook claiming `paid` for a real but unpaid txn → handler ignores payload status, calls `verifyOrder(that_id)` → EPS returns the TRUE status → if not paid, no transition. **Spoofing cannot fabricate paid status.**
   - Spoofed webhook with a real paid-txn-id → triggers verify → transitions to paid (correct outcome — the txn IS paid; spoofing doesn't fabricate, just triggers a re-reconcile of an already-true state).
   - Webhook flood (DoS) → mitigated by per-IP rate-limit (100/min) + per-txn-id rate-limit (20/min). At MVP scale this is sufficient defense-in-depth.

**Defense-in-depth shipped today (not as primary auth, but as belt-and-braces):**

- Zod body validation at the boundary (malformed → 200 OK ignored)
- In-memory rate-limiters (per-IP + per-txn-id)
- Always-200-OK policy on business outcomes (avoids leaking + suppresses EPS retries)
- Idempotent fast-path on already-settled orders (no verify call, no DB mutation)

**Why this is a decisions-layer entry (not just code comment):**

- The security model is non-obvious at first glance — a reviewer reading "no signature verification" might flag it as a vulnerability without understanding the verify-by-callback authority. Pinning the rationale + the fraud-impossibility argument here means a future reviewer can grep before raising the concern.
- Future "tighten the webhook" PR that ADDS signature verification without removing the verify-by-callback model is fine + welcome (additive defense). Future PR that REPLACES verify-by-callback with signature-only verification would be a regression — the §11.1 step 11 design is load-bearing.
- The documented gap: when EPS publishes a webhook signature mechanism, `EPS_WEBHOOK_SECRET`-gated check lands in `apps/api/src/routes/webhooks/eps.ts` BEFORE the rate-limit + body-parse + settle flow. It's a single add-point; no refactor needed.

**Consequences:**

- `settleOrderFromEps` (the service the webhook + redirects both call) is structured so the trigger source (`'webhook'` vs `'redirect_success'`/`'redirect_fail'`/`'redirect_cancel'`) is just an audit-trail label. The authority computation is identical across all sources.
- Test `settle.test.ts > verify-by-callback authority — the fraud-prevention surface > "CRITICAL: webhook source claims paid, but EPS verify returns failed → order transitions to failed (NOT paid)"` is the regression guard. If a future refactor "trusts" the source's claim, this test fails.
- Live smoke at Day 27 Phase 4 verification proved this end-to-end on staging: a POST webhook with `{"merchant_transaction_id":"TXN-spoofed-paid-12345","status":"SUCCESS"}` returned 200 + `kind:unknown_transaction`. The handler completely ignored the claimed status.

### Choice B — Browser redirect URLs are NEVER authoritative for payment status (§1.3 R3 codification)

**Decision:** The `/api/v1/public/orders/eps-return/{success,fail,cancel}` handlers DO NOT trust the inbound URL path as proof of payment status. A buyer landing on `/eps-return/success` does NOT mean the payment succeeded. The handler reconciles via `settleOrderFromEps` (same authority model as the webhook), then computes the OUTBOUND redirect URL from the RESOLVED order status — NOT from which inbound path EPS sent the buyer to.

**Why this is a decisions-layer entry:**

§1.3 R3 says "Payment status comes from EPS, not from the redirect." This codifies that rule at the URL-routing layer: the redirect handler structurally cannot mark an order paid via the URL alone, because the outbound redirect target is computed AFTER the verify call resolves. A malicious link to `/eps-return/success?merchantTransactionId=<real-unpaid-txn-id>` results in:

1. Handler calls `settleOrderFromEps`
2. settle service calls `verifyOrder(real-unpaid-txn-id)`
3. EPS returns actual status (e.g. `pending` or `awaiting_payment` from EPS's side)
4. settle service returns `verify_inconclusive` (no state transition)
5. Browser redirected to `/orders/return/pending`, NOT `/orders/return/success`

The buyer who clicked the malicious link sees a "pending" page, not a fake confirmation. State is unchanged. Audit log carries the `source: 'redirect_success'` label so post-mortem can see the spoof attempt.

**Pinned by tests** in `orders-eps-return.test.ts` "CRITICAL: redirect URL is NEVER authoritative for payment status":

- "buyer lands on /success but EPS says PENDING → browser redirected to /orders/return/pending (NOT /success)"
- "buyer lands on /success but EPS verifies FAILED → /orders/return/fail"
- "buyer lands on /fail but EPS verifies SUCCESS → /orders/return/success" (the truth wins regardless of inbound path)

**Consequences:**

- Both webhook (Phase 2) and redirects (Phase 3) consume the same `settleOrderFromEps` service. The authority computation is centralised. A future "shortcut" PR that adds a fast-path "if inbound URL is /success, mark paid" would have to bypass this service — surfacing in PR review as a deliberate decision that contradicts §1.3 R3 + this entry.
- Outbound redirect URL is sourced from `EVENTPULSE_WEB_BASE_URL` env var (mirrors the Day 24 OAuth callback pattern: api-vhost callback must redirect to web-vhost via absolute URL).
- No-PII: only `orderId` (a uuid) is echoed back in outbound query; `merchant_transaction_id` is NOT.
- Frontend pages at `${WEB}/orders/return/*` are Day 28+ scope. For Day 27, the browser ends up at a URL the frontend will eventually render.

**Cross-references:**

- PR #162 (Phase 1 — state machine) → merged `46a2575`
- PR #163 (Phase 2 — webhook + reconciliation) → merged `bcfb89c`
- PR #164 (Phase 3 — redirects) → merged `de0faed`
- CLAUDE.md §1.3 R3 (never trust redirect query params — codified here for URL routing), §10.5 (webhook routes), §11.1 step 9-11 (EPS redirect + verify-on-return + webhook), §11.4 (EPS gotchas — no webhook signing mentioned)
- `decisions.md` "Day 26 architectural choices" Choice B (withSuperAdmin for buyer-trigger paths — extended here for webhook + redirect)
- `decisions.md` "EPS library choice locked" (2026-05-19) — same rationale class as Lucia: SDK gaps don't get filled by trust assumptions, they get filled by verify-before-trust patterns
- `decisions.md` "Three distinct greppable EPS error classes" (2026-05-25; extended Day 26 with 2 more for HTTP errors) — `EpsNetworkError` + `EpsResponseError` are caught explicitly in the webhook handler's always-200 path

---

## 2026-05-25 · Day 26 architectural choices — order pipeline schema, Redis token cache stampede semantic, buyer-write RLS path

**Context:** Sprint 3 Day 26 shipped 4 PRs in clean dependency order:

- PR #157 (Phase 1) — EPS wrapper Part 2 real HTTP (`6993492`)
- PR #158 (Phase 2) — Redis-backed token cache adapter (`f3f8fee`)
- PR #159 (Phase 3) — order pipeline schema migration 0013 (`bebde7a`)
- PR #160 (Phase 4) — public order creation endpoint (`63d7a2c`)

Four architectural choices were made inside the implementation that warrant codification at the decisions layer — each pinned by tests + inline code comments, but the decisions-layer entry prevents future drift if anyone refactors the surrounding code without reading the originals.

### Choice A — Order row carries 4 fee-snapshot extension columns beyond §9.5 verbatim

**Decision:** Migration 0013 adds 4 columns to `orders` that are NOT in §9.5 verbatim: `platform_fee_bps integer NOT NULL`, `eps_fee_bps integer NOT NULL`, `platform_fee_handling text NOT NULL CHECK (... IN ('absorb','pass_through'))`, `eps_fee_handling text NOT NULL CHECK (... IN ('absorb','pass_through'))`. The 4 columns are written at order-create time alongside the paisa fields and are NEVER mutated afterward.

**Why these 4 columns are load-bearing (not optional convenience):**

1. **§14.4 explicit guidance.** "The `fee-calculator` reads `tenant_fee_config` at order-creation time, snapshots the bps into the order, and never re-evaluates afterward. The order is immutable on fee." Without the bps + handling columns on the order row, the snapshot lives only in the paisa fields — but those are *derived* outputs. The *inputs* are gone.
2. **Decision N requires snapshotted inputs for post-mortem.** If the calculator's prediction ever drifts from what EPS actually charged, post-mortem requires the snapshotted inputs to be on the order row — otherwise we'd be reconstructing inputs from foreign-key joins (`tenant_fee_config`, `events.platform_fee_handling`, `events.eps_fee_handling`) that may have CHANGED since order-time. Reconciliation against EPS settlement reports would be unauditable.
3. **The fields are written ONCE at order-create time.** Service layer (`apps/api/src/services/orders/index.ts`) reads `getEffectiveFees(tenantId)` + the order-time `epsFeeBps` input + the event's two handling fields → snapshots all 4 onto the orders row in the same `withSuperAdmin` transaction as the calculator output. The 4 fields are immutable on the order even if the tenant's `tenant_fee_config` later changes (§14.4 non-retroactive rule).

**Consequences:**

- Tests in `apps/api/src/services/orders/orders.test.ts` pin "for each §14.2 mode, the orders row's snapshot fields exactly equal the calculator's `FeeCalcResult` field-for-field" (4 parameterised cases — PT/PT, AB/AB, AB/PT, PT/AB).
- Day 27+ callback/reconciliation reads the snapshot when comparing actual EPS settlement against expected.
- Future "tighten the schema" PR that removes any of the 4 columns would silently degrade reconciliation auditability. This entry pins the rationale.
- If a future enterprise tier requires a different fee-snapshot shape (e.g. per-payment-method bps capture from the settlement report), it lands as additional columns — never by mutating existing snapshots.

### Choice B — Buyer-write path uses withSuperAdmin (BYPASSRLS); route handler is the trust boundary

**Decision:** `apps/api/src/services/orders/index.ts createOrder()` runs all DB writes (orders + order_items + order_events + audit_logs) inside a `withSuperAdmin` transaction. The route handler at `apps/api/src/routes/public/orders.ts` is the trust boundary: it (a) resolves event_id → tenant_id, (b) validates the event is in a sellable state + tier exists + on-sale, (c) sets tenant_id explicitly on every INSERT. Subsequent reads/updates by tenant context (e.g. the tenant's orders dashboard Day 28+) are RLS-scoped normally.

**Why withSuperAdmin (not a synthetic "public-buyer" RLS role):**

Buyers have no tenant session — they arrive at a public event page, fill the form, POST. No tenant context exists for the request. Options were:

- (a) **withSuperAdmin (BYPASSRLS), explicit tenant_id on insert.** Chosen.
- (b) Public-buyer RLS policy that allows insertion when tenant_id matches event_id's tenant (validated by trigger/function). Complex, error-prone — RLS becomes the trust boundary instead of the route handler.
- (c) Constrained service-role with audit log of "buyer-initiated order". Equivalent to (a) since audit row writes regardless.

(a) is the same pattern as the Day 25 public-events READ path (`decisions.md` "Public event reads use withSuperAdmin + path-mode URLs" 2026-05-25, Choice A). The common shape: **any read/write that genuinely crosses tenant scope (because the caller has no tenant context) runs under withSuperAdmin with the route handler as the trust boundary, rather than warping RLS into a synthetic "public-actor" role.**

**Consequences:**

- The route handler is the load-bearing trust boundary. Any future change that moves event-validation out of the route to a helper MUST preserve the property that tenant_id is correct before the INSERT runs (lest the buyer-write path become RLS-bypass-able by URL manipulation).
- The decision applies symmetrically to Day 27's callback/webhook handler (also runs under withSuperAdmin — buyer is returning to a public URL).
- Tenant-context reads (the tenant's dashboard) DO go through RLS — they have a tenant session and RLS isolation is exactly what's needed there. The exception is purely the public-buyer write/read path.
- Test `apps/api/src/db/orders-rls.test.ts > buyer-write path simulation` pins this: a withSuperAdmin INSERT with explicit tenant_id is visible to that tenant via withTenant. Future "tighten" PR that breaks this would fail the test.

### Choice C — Redis token cache stampede semantic = accept-double-fetch-but-cache-last (NOT single-flight)

**Decision:** When two PM2 workers both miss the cache simultaneously, both call `fetchAccessTokenFromEps()`, both write to Redis, last-write-wins. The wasted GetToken calls are bounded (1 per worker per ~14-min cache cycle); no NX-lock-based single-flight is implemented.

**Why this trade-off:**

§11 does not specify a stampede semantic; the Day 26 brief said "STOP-ASK if unspecified" — Auto Mode was active and the reasonable call was to ship the simpler semantic. Three reasons:

1. **TTL bounds the waste.** ~14 min cache TTL means the worst-case wasted GetToken is 1 per worker per cycle. At ~2 PM2 workers, that's ~2 extra GetToken calls per 14 min — negligible vs. the wider order pipeline's HTTP load.
2. **Cost is cheap.** A wasted GetToken is a single POST against EPS, no charge, no PII, no state mutation.
3. **Single-flight is 60+ LOC of operational complexity.** Redis NX-lock-based single-flight requires lock-acquire-with-timeout, lock-release-on-error, dead-lock recovery (what if a worker dies mid-fetch?), backoff retry on lock-busy. Each is a failure mode that itself needs testing. For ~2 workers at MVP scale, the complexity isn't justified.

**Consequences:**

- File header in `apps/api/src/infra/eps/redis-token-cache.ts` documents the trade-off + the swap path: if a future scale point (e.g. 20+ workers, sub-second concurrent traffic at TTL expiry) surfaces contention as a real problem, swap to single-flight at the same seam — `redisTokenCache(client)` is a pure function returning the `TokenCache` contract; callers don't change.
- Test `apps/api/src/infra/eps/redis-token-cache.test.ts > accept-double-fetch (chosen stampede semantics)` pins the semantic: two workers both write, last-write-wins, both see the final value.
- Future "tighten" PR adding single-flight as a "performance improvement" without surfacing the cost/benefit changes won't accidentally land — the test fails by asserting both writes succeed.

### Choice D — order_events APPEND-ONLY at GRANT layer with eventpulse_admin retention of mutation path

**Decision:** Migration 0013 ends with `REVOKE UPDATE, DELETE, TRUNCATE ON order_events FROM eventpulse_app;`. The standard §4.2.1 GRANT block over-grants UPDATE+DELETE on every newly-created table; the REVOKE moves the denial up to the GRANT layer where Postgres throws "permission denied" (not silent zero-rows-affected). `eventpulse_admin` (BYPASSRLS super-admin role) RETAINS full mutation grants intentionally — there must be a legitimate path to physically remove rows when regulator-required redaction lands (BFIU 5-year retention ceiling; the inverse: redaction within that window when law requires).

**Why this is a decision-layer entry (the pattern was already codified in §4.2.1.1):**

- The §4.2.1.1 pattern (codified Day 14 with `audit_logs`) is the canonical append-only pattern. Day 19 added `legal_document_versions` as the second; Day 26 adds `order_events` as the third.
- **A future "tighten" PR that adds REVOKE for `eventpulse_admin` would silently break the regulatory-redaction path.** The redaction path's testability is non-obvious until you need it. Pinning the decision means a reviewer can grep before approving the tighten.
- Test `apps/api/src/db/orders-rls.test.ts > order_events — eventpulse_admin (withSuperAdmin) CAN still UPDATE/DELETE — the redaction path` is the regression guard. If the test starts failing, the regulator-redaction path is broken.

**Consequences:**

- The same pattern applies to future append-only tables (e.g. settlement reconciliation receipts, signed legal-document consent receipts as PDFs). New append-only tables MUST: (1) get standard grants, (2) REVOKE UPDATE/DELETE/TRUNCATE from eventpulse_app explicitly, (3) leave eventpulse_admin grants intact, (4) include the regression-guard test.
- Tests for append-only invariants use the **capture-or-zero-rows pattern** mirroring `audit_logs` tests in `db/__tests__/rls-cross-tenant.test.ts`, NOT a regex on the error message. Drizzle wraps pg errors as "Failed query: ..." with the underlying "permission denied" in `error.cause`. The capture-or-zero-rows pattern + state-verification read-back is robust to Drizzle's wrapper format changes.

**Cross-references:**

- PR #157 (Phase 1 — EPS HTTP) → merged `6993492`
- PR #158 (Phase 2 — Redis token cache) → merged `f3f8fee`
- PR #159 (Phase 3 — order schema migration 0013) → merged `bebde7a`
- PR #160 (Phase 4 — order creation endpoint) → merged `63d7a2c`
- CLAUDE.md §9.5 (orders schema), §14.4 (fee snapshot), §4.2.1.1 (append-only pattern + REVOKE), §4.3 (RLS policy template), §11 (EPS flow), §1.3 R2/R3/R5/R6/R8/R10/R11
- `decisions.md` "Public event reads use withSuperAdmin + path-mode URLs only for MVP" (2026-05-25, Choice A — the read-side mirror of this entry's Choice B)
- `decisions.md` "EPS fee is NOT per-tenant configurable — pass-through, derived from payment-method metadata at order creation" (2026-05-24)
- `decisions.md` "Decision N — Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate" (2026-05-19)
- `decisions.md` "EPS wrapper Part 1 ships in-memory token cache; Redis adapter swap is Day 26+" (2026-05-25, Choice B — Day 26 Phase 2 RESOLVES this deferral)
- `gotchas.md` "`ALTER DEFAULT PRIVILEGES` over-grants UPDATE/DELETE on new append-only tables — REVOKE explicitly" (2026-05-19, the audit_logs entry — Day 26 extends to order_events)

---

## 2026-05-25 · Day 25 architectural choices — Public event read uses withSuperAdmin + path-mode URLs only for MVP

**Context:** Sprint 3 Day 25 shipped 3 PRs (ticket tier CRUD #153; bootstrap validation #154; public event landing template #155). Two architectural choices were made that aren't fully captured in code comments + warrant decisions-layer codification.

### Choice A — Public event reads use `withSuperAdmin()` (BYPASSRLS); visibility + status filtering is application-policy, NOT RLS

**Decision:** `fetchPublicEvent(tenantSlug, eventSlug)` at `apps/api/src/domain/public-events/queries.ts` runs under `withSuperAdmin()` context. RLS is bypassed. Visibility filter (`visibility IN ('public', 'unlisted')`) + status filter (`status IN ('published', 'on_sale', 'sold_out', 'live')`) + soft-delete filter (`deleted_at IS NULL` on both events + tenants) are applied in the WHERE clause as application-layer policy.

**Why not RLS:**

- The public read crosses tenant boundaries BY DESIGN — any tenant's public event is fetchable by URL on the platform's public surface. RLS's job is tenant ISOLATION (per §4.2.1, §4.3); using it for cross-tenant access here would invert its purpose.
- If we ran this under `withTenant()`, we'd need a synthetic "public-reader" tenant id that owns no rows but reads all `visibility = 'public'` events — that's a contortion that obscures the actual policy.
- Application-layer filtering puts the policy where it belongs: in code that's grep-able for "what counts as publicly visible" alongside any future audit-of-policy questions.

**Why this is a decision-level entry:**

- Future refactors might "tighten" this by running under `withTenant()` to "be safe" — that would silently reduce the public-reader surface to a single tenant's events. The decision pins the rationale so a reviewer can grep.
- The boundary between "RLS filters" and "application policy filters" is non-obvious; this is the canonical example.

**Consequences:**

- `fetchPublicEvent` always reads `withSuperAdmin()`. Future public-side reads (event list, `/discover` page in Phase 3) follow the same pattern.
- The audit cost: a super-admin context query that runs for every public event page load. Acceptable because the read is cache-friendly (60s browser / 300s edge per the API's `cache-control` header).
- A future per-tenant audit trail of "what events were viewed when" would need a separate write into `audit_logs` with `actor_type = 'system'` since there's no acting user. Not in scope today.

### Choice B — Public event URL routing = path-mode only for MVP

**Decision:** The Day 25 landing page ships at `/(public)/[tenant]/[event]/page.tsx` — path-mode URL only. `{tenant}.eventpulse.com.bd/{event}` subdomain mode + custom-domain mode (per §7.5) require middleware rewrites + Cloudflare for SaaS provisioning; both are deferred.

**Sequencing:**

- **MVP (now):** path-mode only. `/publicpulse/summer-sounds-2026` works. No middleware required.
- **Sprint 6+:** subdomain mode lands via `apps/web/src/middleware.ts` Host-header rewrite (rewrites `{tenant}.eventpulse.com.bd/{event}` → `(public)/_tenant/[tenant=resolvedFromHost]/[event]`).
- **Sprint 7:** custom-domain mode via Cloudflare for SaaS (per §12 + §9.9 schema). Same middleware extends with a `custom_domains` lookup.

The same `<EventLanding>` component renders in all three modes — only the middleware seam differs.

**Why path-mode first:**

- Zero middleware = zero failure mode. Sprint 8's attendee accounts + Sprint 7's custom domains are large in their own right; bundling them into Day 25's "minimum public landing" would balloon scope.
- Path-mode URLs are crawler-friendly + share-friendly out of the box. Tenant subdomain is a UX nicety + SEO carrier, not a launch requirement.
- The handle system (§9.14) is already designed around `users.handle` + `tenants.slug` sharing a global namespace; path-mode uses `tenants.slug` directly — no naming changes needed when subdomain mode lands.

**Consequences:**

- Day 25 cannot test subdomain-mode behaviour (no middleware shipped). Sprint 6+ adds the middleware + integration tests.
- Marketing copy + early-access invites should use the path-mode URL shape (`eventpulse.com.bd/{handle}/{event}`) for consistency. Subdomain redirects become aliases for the path-mode canonical when middleware lands.

**Cross-references:**

- PR #153 (Day 25 Phase 1 ticket tier CRUD; the tier schema this consumes) — merged `052e5f8`
- PR #154 (Day 25 Phase 3 bootstrap validation) — merged `307a483`
- PR #155 (Day 25 Phase 2 landing template; this entry's primary subject) — merged `e3ae382`
- CLAUDE.md §4.2.1 + §4.3 (RLS scope semantics), §7.5 (custom domain routing), §9.3 (events visibility/status), §9.14 (handle system), §26.1 (Sprint 3 Day 4 scope)

---

## 2026-05-25 · Day 24 architectural choices — OAuth post-sign-in redirect target + EPS wrapper Part 1 deferral patterns

**Context:** Sprint 3 Day 24 shipped 4 PRs (STAGING_PAYMENT_BLOCK guard #148; OAuth callback fix #149; EPS wrapper Part 1 #150; Decision N truth-gate harness #151). Three architectural choices were made inside the implementation that warrant explicit codification — they're already inline in code comments + commit messages, but pinning them at the decisions layer prevents future drift if anyone refactors the surrounding code without reading the originals.

### Choice A — OAuth post-sign-in redirect target = apex `/?signed_in=1` via `EVENTPULSE_WEB_BASE_URL`

**Decision:** The OAuth callback success path redirects to apex `/?signed_in=1` constructed via `EVENTPULSE_WEB_BASE_URL` (already populated in staging since Day 22). Implementation lives in `apps/api/src/routes/oauth-routes.ts postSignInUrl()`, exported + regression-tested against 4 cases (absolute URL composition, trailing-slash strip, localhost fallback, query-param presence).

**Why apex (not `/dashboard`, not `/sign-in`):**

- `/dashboard` exists but is a tenant-context route — OAuth creates an attendee-context session per `loginOrLink({ audience: 'attendee', ... })`. Redirecting a fresh attendee to a tenant-gated route is wrong-by-default.
- `/sign-in` would loop — the user just signed in; sending them back to the sign-in page is confusing UX.
- `(my)/tickets` is the §2.7 long-term attendee landing but the `(my)/` route group doesn't ship until Sprint 8 (attendee portal scope). Forward-compat: this decision flips to `/my/tickets` when Sprint 8 lands; `postSignInUrl()` is the single file to edit.
- Apex `/?signed_in=1` exists today, renders, and lets the marketing landing branch on `?signed_in=1` if a "Welcome back" UX surface is added later. It's the safe interim landing.

**Why absolute URL via `EVENTPULSE_WEB_BASE_URL`:**

- The OAuth callback runs on the **api vhost** (`api.staging.eventpulse.com.bd`). User-facing pages live on the **web vhost** (`staging.eventpulse.com.bd`). A relative `/` redirect would resolve against the api vhost which 404s — same gotcha class as `.claude/memory/gotchas.md` "API routes live ONLY on api.staging vhost" (2026-05-24) + "NEXT_PUBLIC_API_BASE_URL missing at Next.js build time" (2026-05-24). The dual-vhost rule means OAuth redirect targets MUST be absolute, sourced from an env that's available at runtime.

**Why this is a decision-level entry (not just code comment):**

- The redirect target is the only user-visible artefact of the OAuth flow's success state. A future refactor that "simplifies" `postSignInUrl()` to a relative path would silently degrade UX + reintroduce the vhost-confusion class of bug. Pinning the absolute-URL rule + the apex-target choice at the decisions layer means a reviewer can grep for the decision before approving such a refactor.

**Consequences:**

- All OAuth providers (today: Google only; Phase 2+ when Apple re-introduced: same applies) MUST go through `postSignInUrl()`. No per-provider redirect customisation.
- When `(my)/tickets` lands at Sprint 8, edit `postSignInUrl()` in one place. The function's regression tests update to assert the new path; the absolute-URL invariant stays.
- The OAuth flow's session establishment (cookie + DB session row) is unchanged. The redirect is purely the response-shape change.
- Token-bearing response body removed — caller-side consumption was already nil (browser-initiated OAuth flow; no JS reads the JSON before display). The session cookie is the auth state carrier. Future JWT-cookie-vs-middleware-cookie-read upgrade is separate scope for the auth-hardening bundle PR.

### Choice B — EPS wrapper Part 1 ships in-memory token cache; Redis adapter swap is Day 26+

**Decision:** `apps/api/src/infra/eps/token-cache.ts` ships a narrow `TokenCache` interface + an `inMemoryTokenCache()` adapter. The Redis adapter that CLAUDE.md §11.2 calls for is **deferred to Day 26+** when the order pipeline lands its first real `getAccessToken` caller.

**Why in-memory is acceptable in the interim:**

- No live caller exists yet at end of Day 24 — `initialiseOrder` + `verifyOrder` are stubs throwing `EpsNotImplementedError`. The cache is unused until Day 26+ wires real callers.
- Cache TTL is ~14 min (1-min margin against EPS's ~15-min JWT). Worst-case process-restart impact is one extra GetToken call per process per ~15 min.
- A multi-process PM2 setup would see N tokens fetched within ~15 min instead of 1 (cache is per-process). That's a latency/cost issue, not a correctness one. The Redis adapter collapses N → 1 when it lands.

**Why not add Redis now:**

- Adding `ioredis` dep + provisioning Redis on the staging EC2 is its own scope of work (~1-2 hours: dep install, env var, Redis systemd service if not running, connection lifecycle in app.ts).
- Gating Phase 3 on Redis provisioning would invert the safety priority: Phase 1 (guard) ships first, Phase 3 (wrapper primitives) ships second, Phase 4 (truth-gate) ships third, Day 25 (landing + tiers) ships fourth, Day 26-28 (order pipeline + Redis swap) ships fifth. The brief's phase order is correct.

**Day-26+ swap shape:**

```ts
// In apps/api/src/infra/eps/client.ts defaultTokenCache():
let _defaultTokenCache: TokenCache | null = null
export function defaultTokenCache(): TokenCache {
  if (!_defaultTokenCache) {
    // Day 26+: swap inMemoryTokenCache() → redisTokenCache(redisClient)
    _defaultTokenCache = inMemoryTokenCache()
  }
  return _defaultTokenCache
}
```

Single-file change at the seam. The `TokenCache` interface is narrow enough (`get` + `set(value, ttlSeconds)`) that a Redis-backed adapter is ~10 lines.

**Consequences:**

- The Day 26+ PR that wires the order pipeline carries the Redis swap as part of its scope.
- Until then, `getAccessToken()` cache-hit path is fully wired (returns cached value) + cache-miss path throws `EpsNotImplementedError`. Tests pass; functionality is gated by the throw, not by the cache.
- If a hot-path consumer surfaces between Day 24 and Day 26+ (unlikely — no consumer exists), the in-memory cache is sufficient — just costs a fresh GetToken per process restart.

### Choice C — Three distinct greppable EPS error classes

**Decision:** EPS wrapper exposes three distinct error classes — `StagingPaymentBlockedError`, `EpsConfigError`, `EpsNotImplementedError`. Distinctness is pinned by a test that asserts none is `instanceof` another. Future copy-paste regression that collapses two classes into one fails fast.

**Why three (not one generic `EpsError`):**

- Each error type signals a distinct root-cause class to the caller:
  - `StagingPaymentBlockedError` → deliberate safety refusal (caller should not retry without ops involvement; production cutover ceremony required)
  - `EpsConfigError` → missing env var (caller should not retry without ops fixing config)
  - `EpsNotImplementedError` → scope gap (caller can retry post-Day-26-28 wrapper Part 2)
- Day 26+ order pipeline + Day 24-25 truth-gate harness both need to distinguish these classes. Generic `EpsError` would force string-matching on error messages, which is exactly the anti-pattern §1.3 R10 "no client-side trust" warns about.

**Consequences:**

- All three classes have `.name` set + are exported from `apps/api/src/infra/eps/client.ts` (re-exporting from sub-modules).
- Tests in `client.test.ts` "error class hygiene (greppable distinct types)" pin all three.
- Future EPS errors (e.g. `EpsHashMismatchError`, `EpsTokenExpiredError`) added Day 26+ follow the same shape.

**Cross-references:**

- PR #148 (Phase 1, merged db4f807) — STAGING_PAYMENT_BLOCK guard
- PR #149 (Phase 2, merged a8cdb96) — OAuth redirect fix
- PR #150 (Phase 3, merged 2d8190f) — EPS wrapper Part 1
- PR #151 (Phase 4, merged 888827e) — Decision N truth-gate harness
- CLAUDE.md §11.0, §11.2, §14.2
- `.claude/memory/decisions.md` "Decision N" (2026-05-19) — the truth-gate that the harness drives
- `.claude/memory/decisions.md` "EPS library choice locked" (2026-05-19) — the in-house wrapper architecture
- `.claude/memory/decisions.md` "@noble/hashes deferred" (2026-05-24) — the dep-version context

---

## 2026-05-24 · Apple Sign-In dropped from MVP scope

**Context:** PR #111 (Sprint 2 Item 4) shipped Apple Sign-In wiring alongside Google OAuth: frontend Apple button + AppleLogo SVG, backend `/apple/start` + `/apple/callback` routes, Apple OIDC client construction with the JWT-based client_secret-from-team-key shape, Apple JWKS verifier, Apple-specific account-linked notification template label, Apple relay-email handling in the auto-link decision, schema CHECK allowing `('google', 'apple')` on `oauth_identities.provider`. The full implementation was in place; only the Apple Developer + procurement step (Apple Services ID + private key + redirect URI registration) was missing. During Sprint 3 Day 23 the staging URL pass surfaced that the Apple button shipped to users in the sign-in UI even though the credentials were never provisioned — clicking it would 503 with `OAUTH_NOT_CONFIGURED`. The procurement work was never started; it's a separate scope (Apple Developer Program enrolment + signing-key generation + per-app Services ID configuration) that doesn't align with MVP launch priorities. Continuing to ship the button creates a UX dead-end and an attack surface (unconfigured OAuth flows are a known phishing-redirect target if the credential later lands with wrong settings).

**Decision (Moshiur 2026-05-24, Sprint 3 Day 23):** Drop Apple Sign-In from MVP scope. Remove the live wiring + UI + the test cases that exercise Apple-specific paths. Lock the decision against future copy-paste regression with guard tests that assert `/apple/start` returns 404 and the frontend renders no Apple button. Google remains the only OAuth provider through MVP.

**What's removed in PR #144 (merged 2026-05-24 18:47 UTC, deployed as 5234728):**

- Frontend: Apple button + Apple test-id + AppleLogo SVG (`apps/web/src/components/auth/oauth-button-group.tsx` + `provider-icons.tsx`).
- Backend: `/apple/start` (GET) + `/apple/callback` (POST) route handlers in `apps/api/src/routes/oauth-routes.ts`.
- Backend: `appleClient()`, `decodeApplePrivateKey()`, `_apple` lazy singleton, `Apple` import from arctic in `apps/api/src/auth/oauth.ts`.
- Backend: `verifyAppleIdToken()`, `AppleIdClaims`, `_appleJwks`, `appleJwks()`, `APPLE_JWKS_URL` in `apps/api/src/auth/oauth.ts`.
- Backend: `APPLE_SCOPES` constant + Apple-specific helpers in routes.
- Types narrowed: `OAuthProvider` in `auth/users.ts`, `oauth-state.ts` `provider` literal, SES template `oauth-account-linked.ts` `OAuthProvider` all narrow from `'google' | 'apple'` to `'google'`. The SES template also adds an exhaustive `providerLabel` guard that throws on unknown providers (future copy-paste protection).
- Tests: Apple-specific cases removed from `oauth-state.test.ts`, `oauth-routes.test.ts`, `oauth-account-linked.test.ts`, `oauth-button-group.test.tsx`, `sign-in-smoke.spec.ts`.

**What's preserved (deliberately):**

- `oauth_identities.provider` DB CHECK enum still allows `('google', 'apple')` for historical-row readability + forward-compat re-introduction. No migration. The DB layer doesn't care that the application no longer emits `'apple'`; future re-introduction lands without a schema migration.
- `OAuthStatePayload`'s `provider` literal is narrowed to `'google'` only in TypeScript, but the wire payload format is unchanged — restoring Apple just requires widening the literal.
- The `AutoLinkDecision`'s `isPrivateEmail` input field stays on the shape with the comment that it's reserved for future providers (Apple-driven concern); callers pass `false` for Google. Restoring Apple is a literal-widening + re-introducing the `'apple'` provider branch.

**Regression guards (committed as part of PR #144):**

- `oauth-routes.test.ts` adds "Apple Sign-In removal guard" describe block: `GET /api/v1/auth/oauth/apple/start` → 404 + `POST /api/v1/auth/oauth/apple/callback` → 404. A future PR that copy-pastes Apple back in piecemeal fails CI at these gates before reaching review.
- `oauth-button-group.test.tsx` adds "does NOT render an Apple button" test that catches accidental re-add at the frontend layer.

**Consequences:**

- MVP sign-in surface: Google OAuth + email/password + email magic link. Three auth methods, not four. §5.2 + §19.2 narrowed accordingly.
- Apple Developer Program enrolment + Apple Services ID procurement come off the MVP procurement list. Reopens only if a Phase 2+ user-research signal shows Apple-only iOS users as a meaningful conversion gap.
- Reintroducing Apple is a deliberate Phase 2+ decision via a dedicated PR — restore from git history of `apps/api/src/routes/oauth-routes.ts` + `apps/api/src/auth/oauth.ts` for the prior implementation, then re-narrow the types, re-add the SES template branch, re-add the frontend button + icon, re-provision Apple Developer credentials + Secrets Manager entry `eventpulse/<env>/oauth-apple`. NOT a piecemeal add — landing only the backend routes without the procurement reproduces exactly the dead-end button this decision removes.
- Cleanup also addresses the immediate user-reported "OAuth not working" diagnosis chain (`.claude/memory/gotchas.md` "API routes live ONLY on `api.staging` vhost" + "`NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time" — both surfaced during the same Day 23 URL health pass).

**Cross-references:** PR #144 (merged 5234728); `.claude/memory/gotchas.md` "API routes live ONLY on `api.staging` vhost" (2026-05-24) + "`NEXT_PUBLIC_API_BASE_URL` missing at Next.js build time" (2026-05-24) — the same Day 23 URL pass that triggered this cleanup; CLAUDE.md §1.2 (sign-up methods table — Apple row removed) + §5.2 (OAuth implementation note — Apple section removed) + §19.2 (sign-in UI — Apple button removed from the mockup).

---

## 2026-05-24 · EPS fee is NOT per-tenant configurable — pass-through, derived from payment-method metadata at order creation

**Context:** During Day 23 pre-flight (Sprint 3 Day 3), draft brief speculatively included `eps_fee_bps` alongside `platform_fee_bps` in the `tenant_fee_config` super-admin exposure workstream. Cross-check against CLAUDE.md §14.1 + §14.4 + §9.12 + §14.3 confirmed this was a brief-side error — the playbook is unambiguous that only the platform fee is per-tenant configurable; the EPS fee is pass-through from the payment-gateway-side rate card based on which payment method the buyer selects at checkout (card ≈ 2.5%, MFS ≈ 1.5–1.8%, exact values from EPS settlement reports).

**Decision (Moshiur 2026-05-24):** `eps_fee_bps` is **not** a column on `tenant_fee_config` and never will be at any tier. The schema in §9.12 stays as currently written (`platform_fee_bps integer NOT NULL DEFAULT 25` only). The `fee-calculator` function (§14.3 + Day 21 implementation) receives `epsFeeBps` as an **order-time input** to `calculateFees()`, sourced at order creation time from payment-method metadata (the gateway's published rate card for the method the buyer chose). It is NOT read from any tenant-level config row.

**Rationale:**

1. **EPS sets EPS fees, not the platform.** Per §14.1: "Charged by EPS based on the payment method ... Pass-through — we do not mark this up." There is no business reason to allow super-admin override of a gateway's own fee schedule, and no contractual mechanism for one (EPS bills us by their schedule; we cannot bill the buyer at a rate divorced from what EPS will deduct).
2. **Per-method, not per-tenant.** EPS fees vary by payment method (card vs MFS vs net banking) within a single tenant's traffic. A tenant-level `eps_fee_bps` would be wrong on day one — it can only represent one method's rate. The order-time input pattern is correct: each order knows its method and its method's rate.
3. **The fee calculator already takes this shape.** Day 21 fee-calculator.ts implementation (per Sprint 3 Day 1 deliverable) accepts `epsFeeBps` as part of `FeeCalcInput`, NOT pulled from a tenant config. Adding a tenant-level column would be a no-op at best, double-source-of-truth confusion at worst.

**Consequences:**

- Day 23 Workstream 2 (super-admin fee config exposure) writes services + routes + UI for `platform_fee_bps` + `default_fee_mode` + `allow_per_event_override` + `custom_arrangement_note` only. No `eps_fee_bps` field anywhere in the form, no field in the audit log, no field in `setOverride()` payload.
- `fee_override_log` audit shape stays as currently migrated (0001 + RLS 0002): `previous_fee_bps`, `new_fee_bps`, `previous_mode`, `new_mode`, `reason`, `effective_from`, `changed_by`, `created_at`. The `_fee_bps` columns refer to platform fee only — schema is consistent with the decision because there is only one tenant-level fee bps.
- At order creation (Day 24+ work), `epsFeeBps` is sourced from the payment-method metadata (TBD: hardcoded constants from the EPS rate card initially, eventually a `payment_method_rates` lookup once the settlement-reconciliation work surfaces a need to make it data-driven). The calculator call site reads tenant config for `platform_fee_bps` + `platform_fee_handling`, reads event config for `eps_fee_handling`, derives `epsFeeBps` from payment-method choice — three independent inputs, single calculation.
- The Day 23 pre-flight brief erroneously listed `eps_fee_bps` as a fourth config column — that line is reframed here so the error doesn't echo into Day 24+ work. If a future spec change requires bookkeeping a tenant-specific EPS arrangement (e.g. an enterprise contract that absorbs EPS fees as a platform cost), it lands as a separate scope decision with a separate column and separate audit shape — NOT bolted onto `tenant_fee_config`.

**Cross-references:** CLAUDE.md §14.1 (EPS fee = pass-through, never marked up); §14.3 (calculator signature `FeeCalcInput` with order-time `epsFeeBps`); §14.4 (per-tenant fee — singular, platform-only); §9.12 (`tenant_fee_config` schema — `platform_fee_bps` is the only fee column).

---

## 2026-05-24 · `@noble/hashes` 1.8.0 → 2.2.0 (Dependabot PR #72) deferred to post-Days-24-25-EPS-truth-gate

**Context:** During the 2026-05-24 pre-Day-23 consolidation session, Dependabot PR #72 (`@noble/hashes` 1.8.0 → 2.2.0) was one of three open major bumps evaluated. Analysis surfaced that the v2 bump fails CI on import-resolution (`Cannot find module '@noble/hashes/argon2'` — v2's `exports` field requires explicit `.js` suffix on subpath imports; bare `'@noble/hashes/argon2'` is no longer a valid specifier). The fix scope itself is small (one-line change in `apps/api/src/auth/hash.ts:16` adding `.js` suffix). The deeper concern is the bump's TIMING relative to Sprint 3.

**Decision (Moshiur 2026-05-24):** Hold #72 — do not merge during the consolidation session. Defer to after the Days 24-25 EPS sandbox truth gate (Decision N) clears. Leave PR open with `deferred-post-eps-truth-gate` label; reopening after the truth gate clears.

**Rationale:**

1. **`@noble/hashes` underpins both surfaces that Days 24-25 stress-test.** Argon2id (live) is used for password hashing on every signup + signin via `apps/api/src/auth/hash.ts`. The EPS HMAC mechanism (not yet built; lands Days 26-28 per the in-house wrapper plan in CLAUDE.md §11.2 + Day 20 decisions.md "EPS library choice locked — in-house wrapper") will use `hmac` + `sha512` from `@noble/hashes` during the Days 24-25 truth-gate sandbox transactions. Bumping the crypto library now would make it a **confounding variable during EPS week** — a sandbox-call failure during the truth gate couldn't be cleanly attributed between (a) fee-calculator bug (the variable Decision N is designed to test), (b) EPS-integration bug (expected; that's why we're running the truth gate), or (c) silent v2 behavioral change in the crypto primitive itself.
2. **Analysis could NOT confirm argon2id produces byte-identical output in v2.** CI failed at import-resolution before exercising the function itself; Noble libraries publish no per-function changelog (only the package-level "modules reorganized" notice). A silent change in password-hash output would mean existing user passwords stop verifying — catastrophic at any scale beyond zero users.
3. **Zero production users means zero cost to holding.** No security CVE forces the bump. v1.8.0 continues to ship and is supported in the maintenance window. The cost of delay is only "the bump is held longer"; the cost of bumping now and discovering a silent breakage during truth-gate week is "lose the empirical clarity of Decision N AND potentially break auth."

**Post-truth-gate plan (when reopening #72):**

After the Days 24-25 truth gate clears, bump 1→2 in **ISOLATION** — NOT bundled with any other change. Dedicated test PR carrying:

1. The 1-line import-path fix in `apps/api/src/auth/hash.ts` (`'@noble/hashes/argon2'` → `'@noble/hashes/argon2.js'`).
2. Updated import paths in the (then-existing) EPS wrapper at `apps/api/src/infra/eps/` per CLAUDE.md §11.2 (`/hmac.js`, `/sha2.js`, `/utils.js` suffixes).
3. A **dedicated regression test** verifying:
   - argon2id produces byte-identical output pre/post bump for a known password+salt pair (use a hard-coded fixture from a real v1.8.0 hash that exists on disk in a test-vectors file)
   - EPS HMAC produces byte-identical HMACSHA512 output for a known payload (use a fixture against a known-good expected hex string)
4. Local + CI typecheck pass.

Isolating the crypto change from EPS-integration week means any breakage that surfaces post-bump is **unambiguously attributable** to the crypto change, not entangled with EPS sandbox integration noise.

**Consequences:**

- `@noble/hashes` stays at 1.8.0 through Sprint 3. Days 24-25 truth gate runs against the v1 crypto library — current behavior, known surface.
- The EPS wrapper code shipped in Days 26-28 will use the v1 subpath imports (`from '@noble/hashes/hmac'`, `from '@noble/hashes/sha512'`, `from '@noble/hashes/utils'`) — bare specifiers, no `.js` suffix. When #72 is reopened post-truth-gate, the EPS wrapper imports become part of the change scope alongside the `hash.ts` fix.
- CLAUDE.md §11.2 carries an amendment (added in the same 2026-05-24 consolidation closeout PR) noting that subpath imports will need explicit `.js` suffixes when v2 lands. This prevents the Day 26-28 wrapper work from being written against v2 paths that don't actually work on v1, OR from being written against v1 paths and then needing rework when v2 lands.
- PR #72 stays open with `deferred-post-eps-truth-gate` label. A deferral comment was posted to the PR pointing at this decisions entry.

**Reopening trigger:** Days 24-25 EPS sandbox truth gate (Decision N 2026-05-19) reports clean. After that gate clears, this entry's deferral lifts and the post-truth-gate plan above executes as a focused PR.

**Cross-references:** Decision N (decisions.md 2026-05-19) "Fee calculator EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate"; CLAUDE.md §11.2 (EPS wrapper plan + the v2 `.js`-suffix amendment); `.claude/memory/gotchas.md` "AWS SDK v3 packages share smithy internal Client types" (a related "library coupling" pattern — different library, same "things that look independent are actually coupled" lesson).

---

---

## 2026-05-20 · Org migration — `publicpulseagency` (personal) → `The-Public-Pulse-Agency` (org); OIDC trust policy updated to Option A

**Context:** Pre-Day-23 consolidation resumption discovered that the first auto-deploy after GHA was restored failed at the OIDC AssumeRole step with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Investigation surfaced two simultaneous changes that landed during the GHA outage window: (1) Moshiur's personal GitHub username `publicpulseagency` was changed; (2) a new GitHub organisation `The-Public-Pulse-Agency` was created and the EventPulse repo was transferred from the personal account into the new org. Nothing was deleted; HTTP redirects keep `publicpulseagency/EventPulse` URLs working, but the OIDC `sub` and `job_workflow_ref` claims carry the new canonical org login (`The-Public-Pulse-Agency`) — and the IAM trust policy on `eventpulse-deploy-staging` was pinned to the old name. Three claims, exact-match per the canonical pattern: both `sub` and `job_workflow_ref` mismatched, AssumeRole rejected.

**Decision:** Update the `eventpulse-deploy-staging` IAM trust policy via Option A — replace the old org login `publicpulseagency` with the new org login `The-Public-Pulse-Agency` on both `sub` and `job_workflow_ref` claims. No defensive arrays (`StringEquals` with both old + new values). Old name will never authenticate again — the personal account it came from no longer owns the repo. The three-claim exact-match canonical pattern (§17.9.1 + 2026-05-17 decision) is preserved unchanged; only the org-login value moves.

Companion updates land in the same PR:

1. `infra/scripts/setup-github-oidc.sh` — default `GITHUB_REPO` in usage docs flipped to `The-Public-Pulse-Agency/EventPulse`; comment added explaining the canonical-login vs display-name distinction.
2. `CLAUDE.md` §17.9.1 — example JSON updated to new org name; post-amendment blockquote pointing at this decisions entry + the new gotcha.
3. `.claude/memory/gotchas.md` — new entry "GitHub repo transfer breaks OIDC trust policies + moves billing to a new entity" with the two-claim mismatch failure pattern + recovery procedure + the billing-separation finding.

**Consequences:**

- **Deploys work again.** Post-fix `gh workflow run deploy-staging.yml --ref main` resumes catching up `origin/main` onto staging EC2.
- **`eventpulse-deploy-prod` (Sprint 4 carry) will be created via setup-github-oidc.sh against the new org login from day one** — no migration step needed for prod.
- **Billing surface moved.** The new org `The-Public-Pulse-Agency` is a separate billing entity from the previous personal account. The $20 Actions spending limit Moshiur set during the GHA outage was on the personal account and does NOT carry over. The new org gets its own 2,000-min Free-tier allowance + own spending limit (Free-tier default $0). If org-level consumption exceeds 2,000 min/cycle without a non-zero org-level spending limit, the GHA outage pattern recurs. Browser-only inspection at <https://github.com/organizations/The-Public-Pulse-Agency/settings/billing/summary> (REST endpoint deprecated → 410; `admin:org` scope needed for new API). Tracked as a pending user action in handoff.md.
- **Canonical pattern unchanged.** §17.9.1 three-claim shape stays exact-match-no-arrays. Org login is a stable value (changes only when a repo transfers to a new owner); arrays would erode the "exact" guarantee for a change that's both rare and not load-bearing-after-the-fact.
- **Cross-reference:** all `publicpulseagency/EventPulse` paths in old PR descriptions, commit messages, gotchas + decisions stay as-historical-record (those URLs still work via HTTP redirect). Only forward-looking values (trust policies, provisioning script defaults, CLAUDE.md examples) flip to the new org. The old gotcha (Sprint 1 Day 9-10) about CI failing because OIDC role didn't exist remains valid history; the new entry layers on top.

---

---

## 2026-05-19 · Decision O — Day 22 architectural choices: staging cert moves to wildcard + tenants.preferred_locale column

**Context:** Sprint 3 Day 22 pre-flight surfaced two STOP-ASKs against the brief's assumptions: (1) staging cert is 5-SAN, not wildcard — per-tenant subdomain provisioning would require certbot extend per approve; (2) `tenants.preferred_locale` column was referenced by the SES-templates workstream but doesn't exist in the schema. Both are upstream-of-feature-code architectural choices; resolving them before any feature PR lands keeps the dependency chain clean.

### O.1 — Staging cert moves to wildcard (apex + wildcard 2-SAN form)

**Decision (Moshiur 2026-05-19):** Reissue the existing Let's Encrypt cert lineage to a **2-SAN form**: apex `staging.eventpulse.com.bd` + wildcard `*.staging.eventpulse.com.bd`. The 4 single-label subdomains (admin/api/app/my.staging.eventpulse.com.bd) previously enumerated as explicit SANs are now covered by the wildcard. Add a wildcard A record to the Route 53 staging hosted zone pointing at the same Elastic IP. Tenant subdomain provisioning is then **pure-Nginx** with no certbot in the hot path — DNS resolves via wildcard, cert covers via wildcard SAN; the provisioning task writes a vhost file, symlinks it, runs `nginx -t`, and reloads.

**Net effect on cert shape:** SAN count 5 → 2; coverage went from 5 fixed subdomains to apex + all current subdomains + all future tenant subdomains. The original v2.2 §17.6 framing ("5 explicit SANs + 1 wildcard SAN = 6 total") that early drafts of this decision used was invalid: Let's Encrypt policy explicitly rejects SAN lists containing both a wildcard and the explicit names the wildcard would cover (the actual rejection text: "Domain name X is redundant with a wildcard domain in the same request"). The correct pattern is apex + wildcard only (2 SANs); apex is required because wildcards do not cover the apex per RFC 6125 §6.4.3 (wildcards match exactly one DNS label, left-most).

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

### O.1 — applied 2026-05-20 (operation log)

Cert reissue + Route 53 wildcard A record completed via SSM SendCommand and Route 53 API:

- **Cert reissue.** First attempt (`certbot certonly --expand` with the original 5 SANs + wildcard added) was rejected by Let's Encrypt: "Domain name admin.staging.eventpulse.com.bd is redundant with a wildcard domain in the same request." Adjusted command dropped to apex + wildcard only (2 SANs) and dropped `--email --agree-tos` since the LE account on this server has no email contact and uses an existing lineage. Second attempt without `--cert-name` succeeded BUT created a sibling lineage `staging.eventpulse.com.bd-0001` because `--expand` requires the new SAN set to be a superset of the existing one — going from 5 SANs to 2 SANs (where 4 of the originals become wildcard-covered but no longer explicitly listed) is not a superset relationship, so certbot disambiguated by making a new lineage. The orphan lineage was deleted with `certbot delete --cert-name staging.eventpulse.com.bd-0001`, then the existing lineage was reissued with `--cert-name staging.eventpulse.com.bd --force-renewal` (no `--expand`, which gets in the way of SAN-set replacements). End state on disk: `/etc/letsencrypt/live/staging.eventpulse.com.bd/fullchain.pem` carries 2 SANs (`*.staging.eventpulse.com.bd`, `staging.eventpulse.com.bd`), Not After Aug 17 2026 (fresh ~90-day expiry from the reissue). `nginx -s reload` picked up the new cert content. 5 external TLS regression checks (admin/api/app/my/staging) all return HTTP 200 + SSL verify 0; the 4 single-label subdomains now serve via wildcard SAN. Wildcard probe via `curl --resolve unseen.staging.eventpulse.com.bd:443:18.141.7.246` returned SSL verify 0 with HTTP 404 from Nginx default server (expected — no vhost for unseen subdomain, TLS handshake itself valid).
- **Route 53 wildcard A record.** `CREATE *.staging.eventpulse.com.bd A 18.141.7.246 TTL 300` in hosted zone `Z003493917KJX7VCR8ZMR`. ChangeInfo `/change/C02798732EGK3JHL407XV` moved PENDING → INSYNC within ~5 min. Regression check: 5 existing explicit A records still resolve to `18.141.7.246` (explicit records take precedence over wildcard in Route 53 routing). Wildcard probes for `acme-test.staging.eventpulse.com.bd` + `wildcard-2.staging.eventpulse.com.bd` both resolve to `18.141.7.246` via the new wildcard record.
- **IAM:** no changes required. EC2 role `eventpulse-staging-ec2` inline policy `eventpulse-staging-acme-route53` already grants `route53:ChangeResourceRecordSets` on the whole zone, so certbot's DNS-01 challenge for the wildcard worked without scope adjustment. (See the IAM-scope gotcha for hardening discussion.)

**Infrastructure state post-application:** the staging cert is now the 2-SAN form Decision O.1 specifies; provisioning of new tenant subdomains is pure-Nginx (no certbot in the per-tenant hot path). Workstream 2 can proceed when sequencing reaches it.

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
