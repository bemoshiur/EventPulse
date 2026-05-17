# Event Pulse — Decisions Log

Append-only. Most recent at the top. If a decision is superseded, add a new entry on top with `Supersedes: <date of old decision>` and add a note to the old one with `Superseded by: <date of new decision>`.

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
