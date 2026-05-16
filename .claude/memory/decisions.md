# Event Pulse — Decisions Log

Append-only. Most recent at the top. If a decision is superseded, add a new entry on top with `Supersedes: <date of old decision>` and add a note to the old one with `Superseded by: <date of new decision>`.

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
