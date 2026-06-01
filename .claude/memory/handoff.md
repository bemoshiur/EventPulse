# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-01 — **Day 41 EOD** of 47-day Phase 1 MVP runway. **Sprint 4 §26.1 Day 7-8 refund flow v1.0 SHIPPED end-to-end on staging.**
**LAUNCH TARGET: 2026-06-10** (9 days out — runway healthy).
**Driver:** Claude Code (Opus 4.7).
**Today's headline:** Day 41 ran three workstreams in one continuous "work continue" session: (1) the CloudWatch CPU >85%/10min alarm — first of seven §17.11 alarm catalogue entries codified (~$0.10/month, console-only, no SNS subscription yet); (2) the `MAIL_DRY_RUN=0` staging flip — durable across deploys, no suppression-list churn in 30-min observation window; (3) Sprint 4 §26.1 Day 7-8 **refund flow v1.0** — PR #242 (6 commits, ~1700 LOC, 14 new integration tests) merged + deployed + smoke green. Migration 0016 advances ladder, 7 new columns + 2 indexes + 2 CHECK constraints on `refunds`; state-machine extension `refund_requested → paid` for super-admin rejection rollback; 3 new audit helpers (writeRefundRequested actor=tenant_user + writeRefundApproved + writeRefundRejected actor=super_admin) + writeOrderRefunded reason union widened; `services/refunds/refund-flow.ts` 666 LOC with discriminated Result unions per function; tenant + super-admin routes wired. All 3 standing invariants intact post-deploy (`STAGING_PAYMENT_BLOCK=1` + `EPS_MODE=production` + `MAIL_DRY_RUN=0`).

**Day 41 AWS billing tally:** ~$0.10/month ongoing (single CloudWatch alarm). No other AWS resources created. Zero spike.

**Carryover:** Day 40 closed Phase 4 SNS bounce/complaint AWS-side wiring end-to-end (PR #239 + PR #240 + PR #241). Day 39 closed the legal track entirely (Buyer-Terms-Lite v1.0 live in checkout 2026-06-01T10:32:57Z). Sprint 4 §26.1 plan now **~70% shipped** (Days 1-2 attendees ✓, 3-4 check-in ✓, 5 sales dashboard ✓, 6 super-admin revenue ✓, 7-8 refund flow first-half ✓; Day 9 marketing + Day 10 launch readiness + Day 7-8 second-half manual-disbursement adapters PENDING).

## 🎯 Pre-launch tracks — remaining work

§26.1 Day 7-8 first-half (refund flow) is now ✅ CLOSED. The remaining pre-launch surface is **infrastructure ceremony + marketing pages + external-clock**:

| # | Item | Gate | Owner |
|---|---|---|---|
| 1 | EPS production credentials arrival | External clock; gates step #3 | Operator-action |
| 2 | §26.1 Day 9 marketing pages — apex, /features, /pricing, /contact, /legal/changelog | None | Claude Code |
| 3 | Production EPS BDT-100 smoke per `docs/runbooks/production-smoke.md` | Gated on #1 + production EC2 cutover (#5 sub-items) | Operator + Claude Code |
| 4 | §26.1 Day 10 launch readiness — AUP review, first paying tenant identification | None for AUP review; operator-led for first tenant | Claude Code + Operator |
| 5 | Production EC2 cutover ceremony — 8 sub-items (Day-37 audit critical-path step [14]) | Multiple STOP-ASK gates per sub-item | Operator + Claude Code |
| 6 | Phase 4 AWS-side wiring on PROD (when prod EC2 lands) | Sub-step of cutover ceremony | Operator-authorised |
| 7 | Manual disbursement second half (BEFTN file gen + bKash B2C + Nagad + Rocket adapters per §14.8) | DEFERRED to Sprint 7 settlement engine | Sprint 7 |

### Production EC2 cutover — 8 sub-items (unchanged)

1. Prod EC2 + Ansible bootstrap
2. Prod Route 53 records (8-record set: apex, www, api, app, admin, my, customers, wildcard)
3. Prod wildcard cert via DNS-01 (Let's Encrypt with route53 plugin)
4. `eventpulse-deploy-prod` GitHub-OIDC role (canonical three-claim trust pattern per §17.9.1)
5. 11 `eventpulse/prod/*` Secrets Manager entries (eps ✅ already; 10 remaining)
6. 2 prod KMS CMKs (`alias/eventpulse-prod` + `alias/eventpulse-kyc-prod`)
7. Prod-branch ff-merge (`origin/prod` at `21dad2cc` → current main; ~100+ commits to bring forward)
8. §17.11 alarm catalogue (CW CPU 85% ✅ codified Day 41 on staging; 6 remaining: mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation)

## 📅 Path B incorporation — DATED CARRY ITEMS (unchanged)

| Item | Target date / window | Status |
|---|---|---|
| Begin Pvt Ltd incorporation paperwork (RJSC name-clearance + draft memorandum/articles + bank account opening) | **Week of 2026-06-24** | PENDING — post-launch stabilisation |
| Novation execution window (Organiser Agreements + AWS + Secrets Manager + EPS + BIN/VAT transition) | **2026-07-08 → 2026-07-22** | PENDING — RJSC-cert-gated |
| Pvt Ltd target completion (RJSC certificate issued; new Organiser Agreements against Pvt Ltd) | **2026-07-22** outer boundary | PENDING |
| v2.4 playbook bump backlog update | Pre-launch nice-to-have; post-launch firm | TRACKED |

## ⚠️ TL;DR for next session (Day 42)

- **First-thing-tomorrow (Day 42):** Likely §26.1 Day 9 — marketing pages. Apex landing, /features, /pricing (with single-method honest copy from Day 38 Phase 3), /contact, /legal/changelog. No truth-gate dependency; pure build-track work that progresses without operator unblock. Use existing `apps/web/src/app/(public)/page.tsx` as starting point if scaffolded; otherwise scaffold from the §1.5 design tokens.
- **Then (Day 42+):** §26.1 Day 10 launch readiness — AUP review of `apps/api/src/services/aup/` surface area; first paying tenant identification (operator-led).
- **Prod-cutover sub-items as standalone tasks:** §17.11 remaining 6 alarms each is ~5-minute AWS write task — ASK-FIRST. CloudWatch memory >90%/5min is the natural next-pick after CPU 85%. Each landed on staging first; staged on prod under cutover ceremony.
- **EPS prod credentials arrival:** still external clock. When credentials land, BDT-100 production smoke per `docs/runbooks/production-smoke.md` runs as its own gated session. Precondition #2 (`eventpulse/prod/eps`) already SATISFIED.
- **MAIL_DRY_RUN=0 prod flip:** lands as sub-step of production EC2 cutover ceremony, not standalone.

## ⚠️ Day 41 deliverables shipped (this session)

- **PR #242 `feat(refunds): Sprint 4 tenant-initiated refund flow + super-admin approval`** — 6 commits, ~1700 LOC, merged as `c38c91d`:
  - Commit 1 `627d01a` — Migration 0016 + Drizzle schema (7 new columns + 2 indexes + 2 CHECK constraints + Phase 2b backfill UPDATE)
  - Commit 2 `3af0bdf` — State-machine `refund_requested → paid` rejection rollback + 3 new audit helpers + widened RefundReasonCode union
  - Commit 3 `ccaaeec` — `services/refunds/refund-flow.ts` (666 LOC, 4 functions, discriminated Result unions)
  - Commit 4 `f67076f` — Tenant routes (POST /orders/:id/refund + GET /refunds[/:id] cursor-paginated)
  - Commit 5 `2b48907` — Super-admin routes (queue + detail + approve/reject/mark-processed with super_admin_notes required on reject)
  - Commit 6 `06d5668` — 14 DB-gated integration tests
- **CloudWatch CPU alarm `eventpulse-staging-cpu-high-85pct`** — first §17.11 catalogue entry codified on staging. Console-only (no SNS subscription yet). ~$0.10/month.
- **MAIL_DRY_RUN=0 staging flip** — durable across deploys. No suppression-list churn in 30-min post-flip observation window. Day-40 mailbox-simulator chain already proven; flip is "open valve and observe" not new verification.
- **`decisions.md` 2026-06-01 Day 41 EOD entry** — Decisions A-H codified (v1.0 scope cuts + state-machine rollback + actor_type split + cross-tenant 404 hiding + super_admin_notes required-for-reject + describeIfDb test pattern + CW alarm threshold + MAIL_DRY_RUN flip semantics).
- **`progress.md` Day 41 entry** — Sprint 4 §26.1 plan progress update (~70% shipped).
- **§29 #5 STRUCTURALLY RESOLVED** — refund authority codified verbatim against §29 entry text.

**Codebase state at Day 41 EOD:**

```text
main HEAD: c38c91d
        │  (today, in order)
        └── feat(refunds): Sprint 4 tenant-initiated refund flow + super-admin approval (#242)
        └── docs(runbook): Day 40 amendments to SNS bounce/complaint AWS-side wiring runbook (#241)
        └── memory: Day 40 EOD closeout (#240)
        └── fix(notifications): accept SES eventType + notificationType envelopes (#239)
        └── (this EOD memory PR — pending merge)
```

Staging EC2 at HEAD `c38c91d`. Migration ladder at 0016. pm2 web + api online + restart counts unchanged. /health db=ok 11ms.

## ⚠️ The launch gate state — 9 ✅ RESOLVED items (unchanged at Day 41 EOD)

1. ~~EPS sandbox credentials~~ ✅ 2026-05-26
2. ~~SES out-of-sandbox~~ ✅ 2026-05-31 (case 177899559700777)
3. ~~EPS fee-model structural decision~~ ✅ 2026-05-31 Day 37 EOD (Option 3 chosen; Day 38 SHIPPED)
4. ~~§29 #9 AIT classification~~ ✅ 2026-05-26
5. ~~§29 #10 NBR/VAT registration model~~ ✅ 2026-05-31 Day 39 AM
6. ~~Salehin: Buyer Terms framing~~ ✅ 2026-05-31 Day 39 AM
7. ~~Salehin: Incorporation path~~ ✅ 2026-05-31 Day 39 AM (Path B LOCKED)
8. ~~Buyer-Terms-Lite v1.0 wire-in~~ ✅ 2026-05-31 Day 39 PM
9. ~~Phase 4 SNS bounce/complaint suppression-list AWS-side wiring~~ ✅ 2026-06-01 Day 40

**New §29 Open Decision STRUCTURALLY RESOLVED Day 41:** ~~§29 Open #5 Refund authority for MVP~~ ✅ STRUCTURALLY RESOLVED 2026-06-01 Day 41 (PR #242 codes the §29 policy verbatim into the running platform).

**Pre-launch commitments (gate ceremony or env flip, not legal):**

- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session per `docs/runbooks/production-smoke.md`. Precondition #2 SATISFIED.
- **Production EC2 cutover ceremony** — 8 sub-items from Day-37 audit critical-path step [14] (table above). Multiple STOP-ASK gates.
- **Phase 4 production-side AWS wiring** — copy of Day 40's 8-step procedure with `-prod` suffixes. Sub-step of cutover.
- **MAIL_DRY_RUN=0 prod flip** — sub-step of cutover (not standalone).

## ⚠️ Empirical findings table — quick recall (decision-grade context; carryover)

| Mode | Status | FE | TotalAmount | StoreAmount | observedEps | predictedEps | Δ | Trust |
|:---:|:---:|:---:|---:|---:|---:|---:|---:|:---:|
| A (PT,PT) | Success | bKash | 102756 | 101009 | 1747 | 2506 | −759 | **CLEAN** |
| B (AB,AB) | Success | bKash | 100000 |  98300 | 1700 | 2500 | −800 | clean-but-AB |
| C (AB,PT) | **Fail** | bKash | 102500 | 100757 | 1743 | 2500 | −757 | **PARTIAL** |
| D (PT,AB) | **Fail** | Nagad | 100250 |  98546 | 1704 | 2506 | −802 | **PARTIAL** |

All amounts paisa. §14.10 Invariant-1 PASS across all 4. The only fully-clean fee-rate data point is Mode A bKash @ 1.747% MFS rate.

## ⚠️ Build-track items still in play

- ⏳ **§26.1 Day 9 marketing pages** — apex landing, /features, /pricing (single-method honest copy), /contact, /legal/changelog. No truth-gate dependency.
- ⏳ **§26.1 Day 10 launch readiness** — AUP review, first paying tenant identification.
- ⏳ **§17.11 alarm catalogue beyond CPU 85%** — mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation. Each ~5-min AWS-write standalone task. Required pre-prod-cutover.
- ⏳ **t3.medium upgrade** (4 GB, ~+$15/mo) — pre-prod-cutover Moshiur decision.
- ⏳ **k6/artillery load test budget** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **`pnpm audit` blocking on high+critical** (§24.4 Sprint-4-close CI requirement) — NOT WIRED.
- ⏳ **Production cutover surface** — 8 sub-items above. Notable: prod-branch ff-merge (`21dad2cc` → current main; now ~100+ commits divergent).
- ⏳ **v2.4 playbook bump backlog** — §14.2 Mode C narrative, §29 #5+#9+#10 reclassification, §29 list housekeeping, Buyer-Terms-Lite v1.0 + Path B incorporation, Phase 4 SHIPPED, prod-branch tracking discipline, Sprint 2-4 accumulated amendments, fee-model resolution Day 38 sweep, Day 39 PR sweep, Day 40 Phase 4 sweep + runbook amendments, Day 41 refund-flow + §17.11 alarm catalogue progress + MAIL_DRY_RUN flip + §29 #5 structural resolution, consent_records §9.11 amendment.
- ⏳ **Loose ends (low priority):** Counsel docs 5 remaining bodies; manual click-through of OAuth callback redirect (PR #149 carry); stale `magic-link-form.tsx:20` + `super-admin/kyc.ts:51` TODO audit.

## Where things live (quick map — Day 41 additions)

- **Decision surface:** `decisions.md` 2026-06-01 Day 41 EOD top entry — Sprint 4 §26.1 Day 7-8 refund flow v1.0 + CW CPU 85% + MAIL_DRY_RUN flip.
- **Critical path tracking surface:** Day-37 audit critical-path diagram. Step [8] Phase 4 ✅ COMPLETE Day 40. Step [16] CW alarm-catalogue first entry ✅ Day 41. Step [10] Day-7-8 refund-flow first-half ✅ Day 41.
- **Refund-flow service:** `apps/api/src/services/refunds/refund-flow.ts` (666 LOC, 4 functions).
- **Refund-flow tests:** `apps/api/src/services/refunds/refund-flow.test.ts` (680 LOC, 14 DB-gated tests).
- **Refund routes:** `apps/api/src/routes/tenant/refunds.ts` + `apps/api/src/routes/super-admin/refunds.ts`.
- **Migration 0016:** `apps/api/src/db/migrations/0016_refunds_approval_workflow.sql`.
- **CW alarm:** `eventpulse-staging-cpu-high-85pct` (ap-southeast-1, console-only).

## Standing invariants (still enforcing through remaining runway)

- **`STAGING_PAYMENT_BLOCK=1`** — re-verified Day 41 EOD post-deploy. Only authorized lift: BDT-100 production smoke on its own gated session. Non-negotiable through 2026-06-10.
- **`MAIL_DRY_RUN=0`** — flipped Day 41 on staging. Durable across deploys. Real SES sends now exercise the full Phase 4 pipeline. Suppression-list outbound-guard intercepts before AWS call. Production flip lands as sub-step of cutover ceremony.
- **`EPS_MODE=production`** — Day 38 codified. Verified Day 41.
- **v1.0 single-method launch — bKash-only enforcement (Day 38).** Server-side via Phase 2a Verify-guard + Phase 2b dispute-flow surfaces. UI-side via Phase 3 honest copy + Day-39-PM bilingual clickwrap.
- **HARD STOP on `fee-calculator.ts`** — LIFTED Day 38; single-PR-at-a-time discipline carries forward.
- **Buyer-Terms-Lite v1.0 consent capture precondition (Day 39 PM):** every order writes `consent_records` row inside same `withSuperAdmin` tx; INSERT failure rolls back.
- **Phase 4 outbound-send guard (Day 40):** every SES SendEmail consults `email_suppression_list` before AWS call.
- **Phase 4 webhook fail-closed (Day 40):** `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` allowlist gates. Non-matching TopicArn → `verify:"topic_not_allowed"`.
- **Refund cross-tenant guard (Day 41):** tenant routes return 404 (not 403) on cross-tenant order/refund lookups. No enumeration.
- **Refund actor_type split (Day 41):** tenant-portal-initiated → `actor_type=tenant_user`. Super-admin operations → `actor_type=super_admin`. Filter by actor_type in audit_logs distinguishes the two paths cleanly.
- **Append-only refund row (Day 41):** the `refunds_approve_reject_exclusive_chk` CHECK constraint prevents the impossible-state row (`approved_at IS NOT NULL AND rejected_at IS NOT NULL`). Migration-level defence beyond state-machine invariants.
- **CW CPU 85% alarm threshold (Day 41):** sized at 85% × 10 min per §17.11. Subsequent alarms inherit the same per-§17.11-spec discipline (each landed on staging first; staged on prod under cutover).
- **Source-then-reload discipline for ad-hoc env edits (Day 40 codified):** `pm2 reload --update-env` only sees env vars from the parent shell. Wrap with `set -a; source .env.staging; set +a; pm2 reload api --update-env`. Verify post-reload by `/proc/<api-pid>/environ` grep.
- **SES envelope-shape defensive coding (Day 40 codified):** SES → SNS payloads use different top-level fields (`eventType` for Configuration Set; `notificationType` for legacy). Phase 4 webhooks accept both via `sesPayloadEventType()`.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. No fee arithmetic elsewhere. Refund-flow v1.0 reads `order.totalPaisa` directly for the refund amount; no calculator invocation needed (full-refund semantics).
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (Day 37):** `origin/prod` at `21dad2cc`; `main` at `c38c91d`; divergence now ~100+ commits.
- **Method-agnostic-calculator discipline (Day 38).** Day 21 author's decision on `epsFeeBps` parameter still load-bearing.
- **Bash-buffering deploy.sh discipline (Day 39 PM).** Edits to deploy.sh don't execute on the deploy that ships them.
