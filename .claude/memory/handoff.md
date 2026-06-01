# Event Pulse — Handoff (session exit state)

**Last update:** 2026-05-31 — **Day 39 PM EOD** of 47-day Phase 1 MVP runway. **Buyer-Terms-Lite v1.0 SHIPPED end-to-end + legal track entirely closed.**
**LAUNCH TARGET: 2026-06-10** (calendar countdown continues; runway de-risked further by Day 39's three legal RESOLVES + Phase 2 wire-in landing same-day).
**Driver:** Claude Code (Opus 4.7).
**Today's PM headline:** PR #237 (`feat(checkout): Buyer-Terms-Lite v1.0 consent_records wire-in`) merged → main `6e54f34` at 2026-06-01T10:31:02Z UTC → deploy SUCCESS → seed ran via SSM bootstrap-recovery (12104 bytes HTML cached on `legal_document_versions.body_html`; row effective 2026-06-01T10:32:57.174Z UTC) → smoke confirmed all four Salehin signature markers (`পরোক্ষ ক্ষতি`, `Clause 6.2`, `Continue with bKash`, `প্রতারণামূলক উপস্থাপনা`) present in production body_html → standing invariants intact (STAGING_PAYMENT_BLOCK=1 / EPS_MODE=production / MAIL_DRY_RUN=1 / /health db=ok / Phase 4 SNS topics still NOT created). **Sign-off chain Step 5 ✅ CLOSED in `docs/legal/buyer-terms.md`** — the chain is 5/5. **Salehin's Buyer-Terms-Lite engagement is end-to-end COMPLETE.** Day 39 shipped 4 PRs end-to-end (#232 disputed-orders + #233 memory + #236 SNS code-only + #237 Buyer-Terms-Lite v1.0 wire-in) on a single day.

**Today's AM headline (carryover):** Both overnight legal replies + the CA NBR/VAT reply captured verbatim. **§29 #10 NBR/VAT RESOLVED with written record** (CA confirmed disclosed-agency interpretations (a)(b)(c); commission within existing PPA BIN 009043032-0102; Mushak-9.1 nil-return cadence continues). **Path B incorporation LOCKED** (soft-launch 2026-06-10 on existing sole proprietorship + Pvt Ltd 4–6 weeks post-launch; novation clause is load-bearing; carry items dated 2026-06-24 + 2026-07-08 → 2026-07-22). **Buyer Terms reading (a) confirmed by Salehin** as primary; Buyer-Terms-Lite required at checkout — drafted Day 39 AM, signed off Day 39 PM, shipped Day 39 PM.

## 🎯 Legal track — entirely closed at Day 39 PM EOD

All overnight + Day-39 legal items are now end-to-end RESOLVED with written records:

| Item | Day-38 EOD state | Day-39 PM EOD state |
|---|---|---|
| §29 #9 AIT classification | ✅ RESOLVED 2026-05-26 (CA) | unchanged |
| §29 #10 NBR/VAT registration | ⏳ external clock | ✅ RESOLVED 2026-05-31 AM (CA written opinion) |
| Salehin: Buyer Terms framing | ⏳ external clock | ✅ RESOLVED 2026-05-31 AM (reading (a) confirmed) |
| Salehin: Buyer-Terms-Lite v1.0 doc draft | n/a (surfaced Day 39 AM) | ✅ SHIPPED 2026-05-31 PM (v0.3 → v1.0 → live in checkout) |
| Salehin: Incorporation path | ⏳ external clock | ✅ RESOLVED 2026-05-31 AM (Path B LOCKED; dated carry items below) |
| Candidate first paying tenant | ✅ identified 2026-05-30 | unchanged (ready for onboarding) |

**Implication:** of the four operator-action external clocks at Day-38-EOD, three are RESOLVED and the fourth (first paying tenant) is identified and ready. **Only the EPS-credentials-procurement clock remains as a launch blocker**, and that is sequenceable inside the remaining 10-day runway.

## ⚠️ Next pre-launch items — entirely AWS / infrastructure / ceremony track

With the legal track closed, the remaining pre-launch work is operations + AWS-side. None of these are dependent on the legal track:

| # | Item | Gate | Owner |
|---|---|---|---|
| 1 | **Phase 4 AWS Console writes** — SNS topic creation (2 topics: `eventpulse-ses-bounce`, `eventpulse-ses-complaint`) + Configuration Set event destinations + IAM policy attachment | Own operator-authorised session per `docs/runbooks/sns-bounce-complaint-aws-wiring.md` (7-step procedure documented Day 39 PM in PR #236) | Operator |
| 2 | **Production EPS smoke (BDT-100)** | Own gated session per `docs/runbooks/production-smoke.md` (PR #230, Day 38). Gates: EPS prod-credentials arrival (operator-action #1) + production EC2 cutover (item #3 below). Re-enable STAGING_PAYMENT_BLOCK immediately after. | Operator + Claude Code |
| 3 | **Production EC2 cutover ceremony** (Day-37 audit's critical-path step [14] — 8 sub-items) | Own session; multiple gates per sub-item | Operator + Claude Code |

### Production EC2 cutover ceremony — 8 sub-items (audit-derived)

Per the Day-37 audit's critical-path step [14]:

1. Prod EC2 provisioning + Ansible bootstrap
2. Prod Route 53 records (8-record set: apex, www, api, app, admin, my, customers, wildcard)
3. Prod wildcard cert via DNS-01 (Let's Encrypt with route53 plugin)
4. `eventpulse-deploy-prod` GitHub-OIDC role (canonical three-claim trust pattern per CLAUDE.md §17.9.1)
5. 11 `eventpulse/prod/*` Secrets Manager entries (database / eps — already authorised Day 38 EOD-late / cloudflare-saas / porichoy / ssl-wireless / ses / sentry / jwt / redis / oauth-google / oauth-apple)
6. 2 prod KMS CMKs (`alias/eventpulse-prod` for general; `alias/eventpulse-kyc-prod` for per-purpose KYC bucket per §17.9)
7. Prod-branch ff-merge (`origin/prod` at `21dad2cc` → current main `6e54f34`; ~90+ commits to bring forward)
8. §17.11 alarm catalogue (CPU >85%/10min, mem >90%/5min, disk >80%, error rate >1%/5min, payment success <95%/15min, disbursement batch failure, reconciliation invariant violation)

The CloudWatch >85% memory alarm is the smallest sub-task and a good first one (5-minute AWS-write task; ASK-FIRST).

## 📅 Path B incorporation — DATED CARRY ITEMS (unchanged from Day 39 AM)

Path B chosen 2026-05-31 (`decisions.md` 2026-05-31 Day 39 "Salehin written opinion received on incorporation; Path B LOCKED" entry). Carry items below have **dated calendar markers** (not vague "post-launch"):

| Item | Target date / window | Status |
|---|---|---|
| Begin Pvt Ltd incorporation paperwork (RJSC name-clearance + draft memorandum/articles + bank-account-opening initiation) | **Week of 2026-06-24** | PENDING — starts after launch stabilises |
| Novation execution window (transfer (a) Organiser Agreements + (b) AWS account + Secrets Manager ownership + (c) EPS merchant account ownership + (d) BIN/VAT registration transition) | **2026-07-08 → 2026-07-22** | PENDING — gated on RJSC certificate of incorporation |
| Pvt Ltd target completion (RJSC certificate issued; new Organiser Agreements sign against Pvt Ltd directly) | **2026-07-22** (outer boundary of Salehin's 4–6 weeks recommended window) | PENDING |
| Update CLAUDE.md §29 #9 + #10 + Path B + Buyer-Terms-Lite to v2.4 playbook bump backlog | Pre-launch nice-to-have; post-launch firm | TRACKED |

## ⚠️ TL;DR for next session (Day 40)

- **First-thing-tomorrow (Day 40):** Phase 4 AWS-side wiring is the cleanest immediate handle — own session per `docs/runbooks/sns-bounce-complaint-aws-wiring.md` (PR #236, Day 39 PM). Operator-authorised. STOP-ASK before any AWS Console write. Lands `MAIL_DRY_RUN=0` for staging once subscription confirms + first SES mailbox-simulator bounce/complaint round-trip succeeds.
- **Then (Day 40 or 41+):** Production EC2 cutover ceremony — pick the lightest sub-item first (CloudWatch >85% memory alarm; 5-minute AWS-write task; ASK-FIRST), surface the larger ones (Route 53 record set; Ansible bootstrap; eventpulse-deploy-prod OIDC role; secrets manager entries) one by one. Each AWS write is its own STOP-ASK.
- **Then (subject to EPS prod-credentials arrival):** BDT-100 production bKash smoke per `docs/runbooks/production-smoke.md` (PR #230, Day 38). Precondition #2 (`eventpulse/prod/eps` Secrets Manager entry SATISFIED). Own gated session; 9-step procedure; STAGING_PAYMENT_BLOCK lift recorded in decisions.md; re-enable immediately after.
- **Post-launch roadmap explicit (carryover from Day 38):** Card-method addition is the immediate next addition — target week 1 post-launch. Each new method requires its own production rate-confirmation smoke before going live (same discipline as v1.0 bKash; runbook generalises). Copy plan at `docs/copy/bkash-only-launch.md` captures the multi-method copy strings for when methods join.

## ⚠️ Day 39 PM EOD deliverables (this session's PM batch)

- **PR #232 `feat(admin)` `719967b`** — Phase 2b disputed-orders workflow. State machine `disputed → refunded`; `writeOrderRefunded` audit; `order-disputed-wrong-method` SES template (XSS-hardened with escapeHtml + safeUrl helpers); `manualRefundService`; super-admin `GET /admin/orders/disputed` (cursor-paginated) + `POST /admin/orders/:id/mark-refunded`. CI required a test-isolation fix (`Option A` patch: assert presence-of-our-seeded-rows + absence-of-our-seeded-paid via `body.data.find()`, instead of exact list length — the super-admin queue is global by design, so cross-suite leakage from settle.test.ts is expected).
- **PR #236 `feat(notifications)` `ed03132`** — SNS bounce/complaint suppression-list (code-only Phase 4). Migration 0014 (`email_suppression_list` table); X.509 RSA-SHA256 SNS signature verification with TopicArn allowlist (load-bearing trust-source check) + ±1-hour timestamp freshness window; SES bounce + complaint webhook handlers; outbound-send guard in SES client. AWS-side wiring **STOP-ASK gated**; runbook documented but NOT executed; current env has `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` unset → fail-closed. Three operator-required clarifications in PR description: anchored regex confirmation; replay-defense scope (MessageId-replay deferred with idempotency rationale; topic-allowlist-then-signature is the load-bearing pair); topicArn-in-log observability fix landed within PR scope (commit `65f428b`).
- **PR #237 `feat(checkout)` `6e54f34`** — Buyer-Terms-Lite v1.0 consent_records wire-in. 6 commits (4 substantive + 2 CI-fix). Doc promotion v0.3 → v1.0 (Step 4 ✅ + Step 5 ✅ in `docs/legal/buyer-terms.md`); migration 0015 (`consent_records`); seed `db:seed:buyer-terms-v1`; `resolveBuyerTermsCurrentVersion` helper; service tx-seam INSERT inside `withSuperAdmin` order tx (precondition semantics — failure rolls back order → no EPS Initialize); buyer-form clickwrap line + body_html panel; Day-34 link-footer REMOVED. 2 service tests (happy path + precondition-failure with try/finally restore) + 5 buyer-form tests (clickwrap render + body render + fallback + Day-34 regression guard). CI-fix commit chain: unescaped `'` → `&apos;` (next-lint catches what api-side noop-lint misses); seed-legal-documents.test.ts cleanup needs `delete consentRecords` BEFORE the version delete (new FK from migration 0015); prettier-format on 2 files I missed re-running prettier on. All 8 CI checks SUCCESS on final ca564df.

**Codebase state at Day 39 PM EOD:**

```text
main HEAD: 6e54f34 feat(checkout): Buyer-Terms-Lite v1.0 consent_records wire-in (#237)
        │
        └── ed03132 feat(notifications): SNS bounce/complaint suppression-list — code-only Phase 4 (#236)
        └── 719967b feat(admin): Phase 2b disputed-orders workflow — SES template + admin queue + manual-refund (#232)
        └── 48460a2 memory: Day 39 AM reconciliation — Salehin + CA written replies captured verbatim (#233)
        └── 124c171 docs(runbook): BDT-100 production bKash smoke for v1.0 rate confirmation (#230)
```

## ⚠️ Day 38 EOD shipped (carryover record)

- **PR #227 `fix(fees)`** `8afb079` — `DEFAULT_EPS_FEE_BPS_ESTIMATE` 250 → 175 bKash MFS rate per Option 3.
- **PR #228 `feat(checkout)`** `8fefa41` — Phase 2a Verify-guard rejection mechanism (d): non-bKash `FinancialEntity` → `disputed`.
- **PR #229 `feat(copy)`** `79177d7` — Phase 3 honest UI copy bilingual bKash-only notice + `Continue with bKash` button label.
- **PR #230 `docs(runbook)`** `124c171` — Production BDT-100 smoke runbook (7 preconditions + 9-step procedure).
- **Day 38 EOD memory PR** `feea4b8` (carried into PR #233 Day 39 AM rewrite).

## ⚠️ The launch gate state — 0 legal blockers; only EPS credentials clock + infrastructure track remain

1. ~~EPS sandbox credentials~~ ✅ RESOLVED 2026-05-26.
2. ~~SES out-of-sandbox~~ ✅ RESOLVED 2026-05-31 (case 177899559700777, ap-southeast-1).
3. ~~EPS fee-model structural decision~~ ✅ RESOLVED 2026-05-31 Day 37 EOD — Option 3 chosen + implementation SHIPPED Day 38 across PRs #227 / #228 / #229 / #230.
4. ~~§29 #9 AIT classification~~ ✅ RESOLVED 2026-05-26 (CA written opinion).
5. ~~§29 #10 NBR/VAT registration model~~ ✅ RESOLVED 2026-05-31 Day 39 AM (CA written opinion).
6. ~~Salehin: Buyer Terms framing~~ ✅ RESOLVED 2026-05-31 Day 39 AM — reading (a) primary; Buyer-Terms-Lite required (NEW pre-launch deliverable).
7. ~~Salehin: Incorporation path~~ ✅ RESOLVED 2026-05-31 Day 39 AM — Path B LOCKED; soft-launch + post-launch Pvt Ltd 4–6 weeks.
8. ~~Buyer-Terms-Lite v1.0 wire-in (consent_records replaces Day-34 link-footer)~~ ✅ **RESOLVED 2026-05-31 Day 39 PM** (PR #237 merged + deployed + smoked; sign-off chain Step 5 ✅ CLOSED; legal-doc consent-capture pattern established for future Trust Center v1.0 docs).

**Pre-launch commitments (gate env flips or ceremony, not legal):**

- **Phase 4 SNS bounce/complaint AWS-side wiring** — own operator-authorised session per `docs/runbooks/sns-bounce-complaint-aws-wiring.md` (PR #236). Gates `MAIL_DRY_RUN=0` per AWS commitment in case 177899559700777 reply. Code shipped Day 39 PM; AWS side STOP-ASK pending.
- **STAGING_PAYMENT_BLOCK lift for prod smoke** — own gated session per `docs/runbooks/production-smoke.md` (PR #230). Precondition #2 (`eventpulse/prod/eps`) SATISFIED at Day-38-EOD-late verification. Remaining preconditions still gate the smoke (EPS prod credentials, prod EC2 + Nginx + DNS + wildcard cert, prod-branch ff-merge, EPS_MODE=production on prod EC2 once provisioned, operator on-call, reversal path).
- **Production EC2 cutover ceremony** — 8 sub-items from Day-37 audit's critical-path step [14] (see table above). Multiple STOP-ASK gates per sub-item.

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
- ⏳ **Production cutover surface** — 11 `eventpulse/prod/*` Secrets Manager entries; 2 prod KMS CMKs (`alias/eventpulse-prod` + `alias/eventpulse-kyc-prod`); prod EC2 Ansible bootstrap; prod Route 53 records (8-record set); prod wildcard cert via DNS-01; `eventpulse-deploy-prod` OIDC role; prod-branch ff-merge (`21dad2cc` → `6e54f34`).
- ⏳ **v2.4 playbook bump backlog** — §14.2 Mode C narrative, §29 #9 + #10 reclassification, §29 list housekeeping, Buyer-Terms-Lite v1.0 + Path B incorporation, prod-branch tracking discipline, Sprint 2-4 accumulated amendments, fee-model resolution Day 38 sweep, Day 39 PR sweep, consent_records §9.11 amendment.
- ⏳ **Sprint 4 remaining buildable** — Refund flow + manual disbursement + BEFTN file generator (§26.1 Day 7-8) + Marketing pages w/ single-method honest pricing (§26.1 Day 9) + Launch readiness (§26.1 Day 10).
- ⏳ **Loose ends (low priority):** Counsel docs 4-8 bodies (Refund Policy, AUP, Cookies, DPA, EULA — Buyer-Terms-Lite v1.0 already SHIPPED Day 39 PM); manual click-through of OAuth callback redirect (PR #149 carry); stale `magic-link-form.tsx:20` + `super-admin/kyc.ts:51` TODO audit.

## Where things live (quick map — Day 39 PM additions)

- **Decision surface:** `decisions.md` 2026-05-31 Day 39 PM EOD top entry — Buyer-Terms-Lite v1.0 SHIPPED end-to-end (this commit).
- **Critical path tracking surface:** Day-37 audit critical-path diagram (unchanged shape; steps [1]-[3] + [7]-[12] now ✅ COMPLETE; remaining = [4]-[6] + [13]-[17]).
- **Buyer Terms v1.0 doc (canonical):** `docs/legal/buyer-terms.md` (APPROVED v1.0; replaces obsolete `buyer-terms-lite-draft.md`).
- **Buyer Terms v1.0 production timestamp:** deploy SHA `6e54f34` at 2026-06-01T10:31:02Z UTC; `legal_document_versions.effective_at` for the v1.0 row = 2026-06-01T10:32:57.174Z UTC (12104 bytes body_html cached).
- **PR #237 commits:** `7d9bded` doc; `3a3dba8` schema + migration + seed + hooks; `94be645` service + frontend; `8aef922` tests; `082cd19` + `ca564df` CI fixes.

## Standing invariants (still enforcing through remaining runway)

- **`STAGING_PAYMENT_BLOCK=1`** in `.env.staging` + pm2 env id=1. Re-verified live Day 39 PM EOD invariants check post-PR-#237-deploy. **Only authorized lift: BDT-100 production smoke on its own gated session per `docs/runbooks/production-smoke.md` + decisions.md §11.0; re-enable immediately after.** Non-negotiable through 2026-06-10.
- **v1.0 single-method launch — bKash-only enforcement (Day 38):** Server-side via Phase 2a Verify-guard + Phase 2b dispute-flow surfaces (PR #228 + PR #232). UI-side via Phase 3 honest copy (PR #229) + Day-39-PM bilingual clickwrap line (PR #237). v1.0 launch posture is server-side-enforced, not honour-system.
- **HARD STOP on `apps/api/src/domain/payments/fee-calculator.ts`** — LIFTED Day 38; carries forward as single-PR-at-a-time discipline rather than blanket lock.
- **Buyer-Terms-Lite v1.0 consent capture precondition (Day 39 PM):** every paid + free order created via `createOrder` writes a `consent_records` row inside the same `withSuperAdmin` tx, anchored by `order_id`. INSERT failure rolls back the entire tx → no order persisted → no EPS Initialize call. This is the operator-spec'd precondition behavior ("consent capture is a precondition, not a side effect"). Future legal-doc consent surfaces follow the same wire-in shape.
- **Phase 4 AWS-side STOP-ASK** (Day 39 PM): code shipped (PR #236) but AWS resources (SNS topics, Configuration Set event destinations, IAM policy) NOT created. `SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS` env vars unset → webhooks fail-closed on every message. AWS-side wiring lands in own operator-authorised session per `docs/runbooks/sns-bounce-complaint-aws-wiring.md`.
- Branch protection: pre-push hook + workflow_dispatch gates on `main`; memory commits go through PRs.
- Memory protocol: decisions → decisions.md the turn they're made; gotchas → gotchas.md the moment learned.
- Money math single source: `fee-calculator.ts`. No fee arithmetic elsewhere.
- Snapshot-vs-current display discipline (Day-33 Choice A).
- Auth-gate-is-the-entire-security-model for `/api/v1/admin/*` (Day-35).
- Build-track owns surfacing what's draftable for the launch gate (Day-35).
- Wire-protocol diagnostic logging (PR #217) — keep ON permanently.
- **Prod branch tracking discipline (Day 37):** track `origin/prod` SHA every session; if it diverges from `main` by more than a sprint, document as pre-cutover requirement. Current: `origin/prod` at `21dad2cc`; `main` at `6e54f34` post-Day-39-PM sweep; divergence now ~90+ commits; ff-merge or cherry-pick onto `prod` required before any production deploy — critical-path step [14] sub-task.
- **Method-agnostic-calculator discipline (Day 38 codified):** Day 21 author's decision to make `epsFeeBps` a calculator input made Phase 1's Option 3 implementation a 1-line caller-default change instead of a calculator surgery. Future per-method work respects the same architecture: the method-to-bps mapping lives in the CALLER, not in fee-calculator.ts.
- **Bash-buffering deploy.sh discipline (Day 39 PM codified):** edits to `infra/deploy/deploy.sh` itself don't execute on the deploy that ships them — bash buffers the small script at process start; `git reset --hard` updates the on-disk file but the running process continues from the buffer. New steps in deploy.sh edits need either (a) a manual SSM one-shot for bootstrap recovery on the shipping deploy, or (b) the next deploy after to exercise them. See `gotchas.md` "deploy.sh edits don't execute on the deploy that ships them". Files INVOKED by deploy.sh (migrations, seed scripts, dist code) are picked up fresh because they're exec'd post-`git reset`.
