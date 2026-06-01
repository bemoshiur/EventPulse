# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-01 — **Day 40 EOD** of 47-day Phase 1 MVP runway. **Phase 4 SNS bounce/complaint suppression-list AWS-side wiring SHIPPED end-to-end on staging.**
**LAUNCH TARGET: 2026-06-10** (9 days out; runway healthy — only the EPS-credentials clock + production-cutover ceremony stand between us and launch).
**Driver:** Claude Code (Opus 4.7).
**Today's headline:** Day 40 executed Phase 4 AWS-side wiring through 8 STOP-ASK-gated steps. 2 SNS topics + IAM topic policies + 2 confirmed HTTPS subscriptions + 1 SES Configuration Set with 2 event destinations + 3 new EC2 env vars + mailbox-simulator round-trip end-to-end verified. 2 bugs surfaced + fixed mid-session: (a) SNS topics default to `SignatureVersion=1`; topics must opt into v2 per-topic via `set-topic-attributes`; (b) SES Configuration Set event publishing uses `eventType` envelope field, NOT the `notificationType` of legacy SNS direct feedback (Phase 4 PR #236 webhook handlers checked the wrong field). Bug (b) fixed via PR #239 (merged + deployed Day 40 mid-session); the webhook now accepts both envelope shapes. Phase 4 launch-gate item ✅ CLOSED. `MAIL_DRY_RUN=0` flip is now structurally enabled (separate operator decision, not in this session).

**Day 40 AWS billing tally:** **< $0.002 total** (essentially zero). SNS topics/subs/Config Set/event destinations free. ~6 SES test sends (mailbox simulator, no reputation impact) ~$0.001. ~12 SNS publishes ~$0.0001. CloudWatch metric queries + ~40 list/get/describe calls $0. Ongoing monthly cost from Phase 4 wiring at expected MVP volume: ~$0/month.

**Carryover:** Day 39 closed the legal track entirely (Buyer-Terms-Lite v1.0 live in checkout at `2026-06-01T10:32:57Z`; 5 PRs landed on Day 39 alone). §29 #9 + #10 RESOLVED. Path B incorporation LOCKED with dated carry items 2026-06-24 + 2026-07-08 → 2026-07-22.

## 🎯 Pre-launch tracks — remaining work

Phase 4 launch-gate item is now ✅ CLOSED. The remaining pre-launch work is entirely **infrastructure + ceremony + external-clock** track:

| # | Item | Gate | Owner |
|---|---|---|---|
| 1 | EPS production credentials arrival | External clock; gates step #3 | Operator-action |
| 2 | `MAIL_DRY_RUN=0` flip on staging | Structurally enabled (Phase 4 wiring done); separate operator decision | Operator + Claude Code |
| 3 | Production EPS BDT-100 smoke per `docs/runbooks/production-smoke.md` | Gated on #1 + production EC2 cutover (#4 sub-items) | Operator + Claude Code |
| 4 | Production EC2 cutover ceremony — 8 sub-items (Day-37 audit critical-path step [14]) | Multiple STOP-ASK gates per sub-item | Operator + Claude Code |
| 5 | Phase 4 AWS-side wiring on PROD (when prod EC2 lands) — copy of Day 40's 8-step procedure with `-prod` suffixes + `api.eventpulse.com.bd` host | Sub-step of cutover ceremony | Operator-authorised |
| 6 | First paying tenant onboarding | Identified at Day 38 EOD; sequenced post-cutover | Operator-led |

### Production EC2 cutover — 8 sub-items (unchanged from Day 39 EOD)

1. Prod EC2 + Ansible bootstrap
2. Prod Route 53 records (8-record set: apex, www, api, app, admin, my, customers, wildcard)
3. Prod wildcard cert via DNS-01 (Let's Encrypt with route53 plugin)
4. `eventpulse-deploy-prod` GitHub-OIDC role (canonical three-claim trust pattern per CLAUDE.md §17.9.1)
5. 11 `eventpulse/prod/*` Secrets Manager entries (eps ✅ already; 10 remaining)
6. 2 prod KMS CMKs (`alias/eventpulse-prod` for general; `alias/eventpulse-kyc-prod` for KYC bucket per §17.9)
7. Prod-branch ff-merge (`origin/prod` at `21dad2cc` → current main; ~95+ commits to bring forward)
8. §17.11 alarm catalogue (CPU/mem/disk/error-rate/payment-success/disbursement/reconciliation)

CloudWatch >85% memory alarm is still the lightest standalone sub-task (5-minute AWS-write; ASK-FIRST).

## 📅 Path B incorporation — DATED CARRY ITEMS (unchanged from Day 39)

| Item | Target date / window | Status |
|---|---|---|
| Begin Pvt Ltd incorporation paperwork (RJSC name-clearance + draft memorandum/articles + bank-account-opening initiation) | **Week of 2026-06-24** | PENDING — starts after launch stabilises |
| Novation execution window (transfer (a) Organiser Agreements + (b) AWS account + Secrets Manager ownership + (c) EPS merchant account ownership + (d) BIN/VAT registration transition) | **2026-07-08 → 2026-07-22** | PENDING — gated on RJSC certificate of incorporation |
| Pvt Ltd target completion (RJSC certificate issued; new Organiser Agreements sign against Pvt Ltd directly) | **2026-07-22** (outer boundary of Salehin's 4–6 weeks recommended window) | PENDING |
| Update CLAUDE.md §29 #9 + #10 + Path B + Buyer-Terms-Lite + Phase 4 to v2.4 playbook bump backlog | Pre-launch nice-to-have; post-launch firm | TRACKED |

## ⚠️ TL;DR for next session (Day 41)

- **First-thing-tomorrow (Day 41):** Consider the `MAIL_DRY_RUN=0` flip on staging. Structurally enabled by Phase 4 wiring; the recommended sequence is (i) flip on staging, (ii) trigger a few synthetic sends through the platform's SES client (e.g. magic-link signin to a test email), (iii) confirm no unexpected suppressions accumulate, (iv) leave staging at 0 indefinitely. This is the operational confidence ladder before the same flip lands on production post-cutover.
- **Then (Day 41+):** Production EC2 cutover ceremony — pick the CloudWatch >85% memory alarm first (5-minute AWS-write task; ASK-FIRST). Then larger sub-items one by one (Route 53 record set; Ansible bootstrap; eventpulse-deploy-prod OIDC role; Secrets Manager entries). Each AWS write is its own STOP-ASK.
- **Then (subject to EPS prod-credentials arrival):** BDT-100 production bKash smoke per `docs/runbooks/production-smoke.md` (PR #230, Day 38). Precondition #2 (`eventpulse/prod/eps` Secrets Manager entry SATISFIED). Own gated session; 9-step procedure; STAGING_PAYMENT_BLOCK lift recorded in decisions.md; re-enable immediately after.
- **Day-40 backlog: amend the Phase 4 runbook.** `docs/runbooks/sns-bounce-complaint-aws-wiring.md` is missing the SignatureVersion=2 attribute-set step that surfaced as Bug 1. Add it bundled with topic creation as step 1.5 of the runbook.
- **Post-launch roadmap explicit (carryover):** Card-method addition is the immediate next addition — target week 1 post-launch. Each new method requires its own production rate-confirmation smoke before going live (same discipline as v1.0 bKash; runbook generalises). Copy plan at `docs/copy/bkash-only-launch.md` captures the multi-method copy strings.

## ⚠️ Day 40 deliverables shipped (this session)

- **Phase 4 staging AWS-side wiring** — 8 STOP-ASK-gated steps + 2 in-step bug fixes. 2 SNS topics, 2 HTTPS subscriptions (confirmed), 1 SES Configuration Set, 2 event destinations, 3 new EC2 env vars (`SES_BOUNCE_TOPIC_ARNS`, `SES_COMPLAINT_TOPIC_ARNS`, `AWS_SES_CONFIGURATION_SET=eventpulse-staging`). End-to-end verified via mailbox-simulator round-trip (bounce → `hard_bounce` row; complaint → `complaint` row); cleanup DELETE confirmed empty post-test.
- **PR #239 `fix(notifications)` — accept SES eventType + notificationType envelopes.** Phase 4 PR #236 webhook handlers checked the wrong field name; SES Configuration Set event publishing uses `eventType`, not the legacy `notificationType`. The fix accepts BOTH via a small `sesPayloadEventType()` helper — forward + backward compatible. Merged + deployed mid-session.
- **3 new gotchas codified in `gotchas.md`** — `eventType` vs `notificationType`; SNS topics default to SignatureVersion=1; `pm2 reload --update-env` needs parent shell with `.env.staging` sourced.
- **THIS EOD memory PR** — Day 40 closeout. `decisions.md` top entry "Day 40 EOD — Phase 4 ... SHIPPED end-to-end"; `handoff.md` rewritten to Day 40 EOD state (this file).

**Codebase state at Day 40 EOD:**

```text
main HEAD: <a119ada-then-PR-#239-merge-then-this-memory-PR-merge>
        │  (today, in order)
        └── fix(notifications): accept SES eventType + notificationType envelopes (#239)
        └── (this EOD memory PR — pending merge)
```

## ⚠️ Day 39 PM EOD shipped (carryover record)

- **PR #233 `memory: Day 39 AM reconciliation`** `48460a2`
- **PR #232 `feat(admin)` Phase 2b disputed-orders workflow** `719967b`
- **PR #236 `feat(notifications)` SNS bounce/complaint suppression-list — code-only Phase 4** `ed03132`
- **PR #237 `feat(checkout)` Buyer-Terms-Lite v1.0 consent_records wire-in** `6e54f34`
- **PR #238 `memory: Day 39 PM EOD closeout`** `a119ada`

## ⚠️ The launch gate state — 9 ✅ RESOLVED items at Day 40 EOD

1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26.
2. ~~SES out-of-sandbox~~ ✅ RESOLVED 2026-05-31 (case 177899559700777, ap-southeast-1).
3. ~~EPS fee-model structural decision~~ ✅ RESOLVED 2026-05-31 Day 37 EOD — Option 3 chosen + implementation SHIPPED Day 38 across PRs #227 / #228 / #229 / #230.
4. ~~§29 #9 AIT classification~~ ✅ RESOLVED 2026-05-26 (CA written opinion).
5. ~~§29 #10 NBR/VAT registration model~~ ✅ RESOLVED 2026-05-31 Day 39 AM (CA written opinion).
6. ~~Salehin: Buyer Terms framing~~ ✅ RESOLVED 2026-05-31 Day 39 AM — reading (a) primary; Buyer-Terms-Lite required.
7. ~~Salehin: Incorporation path~~ ✅ RESOLVED 2026-05-31 Day 39 AM — Path B LOCKED.
8. ~~Buyer-Terms-Lite v1.0 wire-in (consent_records replaces Day-34 link-footer)~~ ✅ RESOLVED 2026-05-31 Day 39 PM.
9. ~~Phase 4 SNS bounce/complaint suppression-list AWS-side wiring~~ ✅ **RESOLVED 2026-06-01 Day 40** — pipeline live on staging end-to-end. `MAIL_DRY_RUN=0` flip structurally enabled.

**Pre-launch commitments (gate ceremony or env flip, not legal):**

- **`MAIL_DRY_RUN=0` flip on staging** — own operator decision per Day-40 decisions.md. Phase 4 wiring complete; recommended sequence is flip → synthetic sends → confirm clean → leave staging at 0.
- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session per `docs/runbooks/production-smoke.md` (PR #230, Day 38). Precondition #2 (`eventpulse/prod/eps`) SATISFIED at Day-38-EOD-late verification. Remaining preconditions still gate the smoke.
- **Production EC2 cutover ceremony** — 8 sub-items from Day-37 audit's critical-path step [14] (see table above). Multiple STOP-ASK gates per sub-item.
- **Phase 4 production-side AWS wiring** — copy of Day 40's 8-step procedure with `-prod` suffixes. Runs as sub-step of the cutover ceremony.
- **Phase 4 runbook amendment** — add the SignatureVersion-set step. Backlog.

## ⚠️ Empirical findings table — quick recall (decision-grade context; carryover)

| Mode | Status | FE | TotalAmount | StoreAmount | observedEps | predictedEps | Δ | Trust |
|:---:|:---:|:---:|---:|---:|---:|---:|---:|:---:|
| A (PT,PT) | Success | bKash | 102756 | 101009 | 1747 | 2506 | −759 | **CLEAN** |
| B (AB,AB) | Success | bKash | 100000 |  98300 | 1700 | 2500 | −800 | clean-but-AB |
| C (AB,PT) | **Fail** | bKash | 102500 | 100757 | 1743 | 2500 | −757 | **PARTIAL** |
| D (PT,AB) | **Fail** | Nagad | 100250 |  98546 | 1704 | 2506 | −802 | **PARTIAL** |

All amounts paisa. §14.10 Invariant-1 PASS across all 4. **The only fully-clean fee-rate data point is Mode A bKash @ 1.747% MFS rate.** No card-rate observation exists.

## ⚠️ Build-track items still in play

- ⏳ **CloudWatch >85% memory alarm — STILL OPEN.** 5-minute AWS-write task. ASK-FIRST. Lightest sub-item of the production cutover ceremony.
- ⏳ **Full §17.11 alarm catalogue** beyond memory: CPU >85%/10min, mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation. Required pre-prod-cutover.
- ⏳ **t3.medium upgrade** (4 GB, ~+$15/mo) — pre-prod-cutover Moshiur decision.
- ⏳ **k6/artillery load test budget** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **`pnpm audit` blocking on high+critical** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **Production cutover surface** — see 8 sub-items above. Notable absence: prod-branch ff-merge (`21dad2cc` → current main).
- ⏳ **v2.4 playbook bump backlog** — §14.2 Mode C narrative, §29 #9 + #10 reclassification, §29 list housekeeping, Buyer-Terms-Lite v1.0 + Path B incorporation, Phase 4 SHIPPED, prod-branch tracking discipline, Sprint 2-4 accumulated amendments, fee-model resolution Day 38 sweep, Day 39 PR sweep, Day 40 Phase 4 sweep + amendments to `docs/runbooks/sns-bounce-complaint-aws-wiring.md`, consent_records §9.11 amendment.
- ⏳ **Sprint 4 remaining buildable** — Refund flow + manual disbursement + BEFTN file generator (§26.1 Day 7-8) + Marketing pages w/ single-method honest pricing (§26.1 Day 9) + Launch readiness (§26.1 Day 10).
- ⏳ **Loose ends (low priority):** Counsel docs 5 remaining bodies (Refund Policy, AUP, Cookies, DPA, EULA, Privacy, Terms — Buyer-Terms-Lite v1.0 already SHIPPED Day 39 PM); manual click-through of OAuth callback redirect (PR #149 carry); stale `magic-link-form.tsx:20` + `super-admin/kyc.ts:51` TODO audit.

## Where things live (quick map — Day 40 additions)

- **Decision surface:** `decisions.md` 2026-06-01 Day 40 EOD top entry — Phase 4 SHIPPED end-to-end (this commit).
- **Gotchas surface:** `gotchas.md` top 3 new entries — `eventType` vs `notificationType`, SNS SignatureVersion-1 default, pm2-reload-env-source pattern.
- **Critical path tracking surface:** Day-37 audit critical-path diagram (unchanged shape; step [8] Phase 4 now ✅ COMPLETE).
- **Phase 4 runbook (needs v1.1 amendment):** `docs/runbooks/sns-bounce-complaint-aws-wiring.md`.

## Standing invariants (still enforcing through remaining runway)

- **`STAGING_PAYMENT_BLOCK=1`** in `.env.staging` + api pid env. Re-verified live Day 40 EOD invariants check post-Phase-4-wiring. **Only authorized lift: BDT-100 production smoke on its own gated session per `docs/runbooks/production-smoke.md` + decisions.md §11.0; re-enable immediately after.** Non-negotiable through 2026-06-10.
- **`MAIL_DRY_RUN=1`** still. Phase 4 wiring complete enables the flip (separate operator decision); the wiring itself does NOT auto-flip.
- **v1.0 single-method launch — bKash-only enforcement (Day 38):** Server-side via Phase 2a Verify-guard + Phase 2b dispute-flow surfaces (PR #228 + PR #232). UI-side via Phase 3 honest copy (PR #229) + Day-39-PM bilingual clickwrap line (PR #237). v1.0 launch posture is server-side-enforced.
- **HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts`** — LIFTED Day 38; carries forward as single-PR-at-a-time discipline.
- **Buyer-Terms-Lite v1.0 consent capture precondition (Day 39 PM):** every paid + free order writes a `consent_records` row inside the same `withSuperAdmin` tx; INSERT failure rolls back order → no EPS Initialize.
- **Phase 4 outbound-send guard (Day 40):** every SES SendEmail through the platform consults `email_suppression_list` before the AWS call. Suppressed → returns `{suppressed:true}` log line `ses.send.suppressed`. No external send to a suppressed address ever fires.
- **Phase 4 webhook fail-closed (Day 40):** `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` env vars set in staging; webhooks reject any non-matching TopicArn at the allowlist gate with `verify:"topic_not_allowed"`. Production wiring will mirror this exact pattern with `-prod` suffixes.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. No fee arithmetic elsewhere.
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (Day 37):** track `origin/prod` SHA every session. Current: `origin/prod` at `21dad2cc`; `main` at <after-Day-40-merges>; divergence now ~95+ commits; ff-merge or cherry-pick onto `prod` required before any production deploy — critical-path step [14] sub-item.
- **Method-agnostic-calculator discipline (Day 38 codified):** Day 21 author's decision to make `epsFeeBps` a calculator input made Phase 1's Option 3 implementation a 1-line caller-default change.
- **Bash-buffering deploy.sh discipline (Day 39 PM codified):** edits to `infra/deploy/deploy.sh` itself don't execute on the deploy that ships them; bash buffers the small script. Manual SSM one-shot for bootstrap recovery; next deploy exercises new logic naturally.
- **Source-then-reload discipline for ad-hoc env edits (Day 40 PM codified):** `pm2 reload --update-env` only sees env vars from the parent shell. When editing env vars on the running EC2 outside of a deploy.sh run, always wrap the reload with `sudo -u eventpulse bash -c 'set -a; source /home/eventpulse/.env.staging; set +a; pm2 reload api --update-env'` — mirroring deploy.sh:49 + 198. Verify post-reload by `/proc/<api-pid>/environ` grep.
- **SES envelope-shape defensive coding (Day 40 codified):** SES → SNS payloads use different top-level fields (`eventType` for Configuration Set event destinations; `notificationType` for legacy `SetIdentityNotificationTopic`). Phase 4 webhooks now accept both via `sesPayloadEventType()`. Future SES integrations follow the same dual-field shape.
