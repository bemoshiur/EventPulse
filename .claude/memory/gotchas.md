# Event Pulse — Gotchas

Things that broke, surprised us, or took >30 min to figure out. Add the moment you learn them, not at session end.

---

## AWS Security Group rule description rejects `>` (and most non-ASCII punctuation)

**Status:** RESOLVED 2026-05-17 — discovered while authoring inbound rules for `eventpulse-staging-web` SG. Description "HTTP -> HTTPS redirect + ACME http-01 fallback" rejected with `InvalidParameterValue: Invalid rule description`.

**Symptom:** `aws ec2 authorize-security-group-ingress` returns `(InvalidParameterValue) Invalid rule description. Valid descriptions are strings less than 256 characters from the following set: a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`.

**Why it happens:** AWS restricts SG rule descriptions to a narrow ASCII set. Crucially absent: `>` `<` `'` `"` `\` `|` `?` `~`. Easy to slip in `->` arrows or HTML-like text without thinking about it. The error is descriptive but it's a paper-cut that costs one retry every time it happens.

**Fix:** Spell the arrow out (`"HTTP redirect to HTTPS plus ACME http-01 fallback"`). Or just drop ornamental punctuation from SG descriptions entirely.

**How to avoid:** When writing SG descriptions, stick to the allowed set: `a-zA-Z0-9 . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *`. Single-quote and double-quote characters are also out — wrap-quotes are fine in your shell command but cannot appear *inside* the description string.

---

## IAM `--description` field rejects em-dash and other non-Latin-1 characters

**Status:** RESOLVED 2026-05-17 — discovered when creating IAM role `eventpulse-staging-ec2` with description containing `—` (em-dash, U+2014).

**Symptom:** `aws iam create-role --description "Event Pulse staging EC2 instance role — SSM access, ..."` returns `ValidationError: Value at 'description' failed to satisfy constraint: Member must satisfy regular expression pattern: <tab/LF/CR + ASCII printable + Latin-1 Supplement>` (the full regex in the AWS error message contains literal tab and CR characters that do not reproduce cleanly in markdown).

**Why it happens:** The allowed character set is tab/LF/CR plus printable ASCII plus the Latin-1 Supplement block (`U+00A1`-`U+00FF`). Em-dash (`U+2014`), en-dash (`U+2013`), curly quotes (`U+2018`-`U+201F`), ellipsis (`U+2026`) — all outside that range. Easy to slip in via copy-paste from documents that auto-promote `--` to `—`.

**Fix:** Use ASCII `-` (regular hyphen-minus) in `--description` fields. If a longer separator is needed, write a double-dash `--`.

**How to avoid:** Avoid copying CLI commands out of word processors. When pasting from the playbook (which uses real em-dashes for prose readability), strip them in the command line. Same risk applies to other AWS `--description` fields (KMS keys, etc).

---

## CLAUDE.md §14.1 contradicts schema §9.12 on default fee mode

**Status:** RESOLVED 2026-05-16 — see `decisions.md` → "Default fee handling mode: pass_through". §9.12 was updated to match §14.1.

**Why it happens:** §14.1 ("Both default to `pass_through` for new tenants") and §9.12 (`tenant_fee_config.default_fee_mode text NOT NULL DEFAULT 'absorb'`) disagreed on what a brand-new tenant's default fee mode should be. The prose section and the DDL were edited at different times and drifted.

**Fix:** Schema DDL in §9.12 changed from `DEFAULT 'absorb'` to `DEFAULT 'pass_through'`. Prose in §14.1 was already correct.

**How to avoid:** Whenever the schema and the prose section for the same subsystem are edited, diff them for default values, enum members, and required-vs-optional flags. The fee engine is the riskiest place for this kind of drift — make it part of the §25 Definition of Done checklist whenever §9 or §14 is touched.

---

## GitHub Free plan blocks branch protection on private repos

**Status:** OPEN — deferred 2026-05-16. Add protection once a paid plan is in place.

**Why it happens:** `gh api -X PUT /repos/{owner}/{repo}/branches/{branch}/protection` returns `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` when the owning account is on GitHub Free and the repo is private. Same restriction applies to rulesets. Documented at <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>.

**Fix:** Either (a) upgrade `publicpulseagency` to GitHub Pro ($4/month), (b) convert the user account to an Organization and pay for GitHub Team ($4/user/month) — also unlocks team-based push restrictions for prod — or (c) keep the repo public (rejected: exposes the playbook + decisions log).

**Current state of main and prod branches:** UNPROTECTED. Direct pushes work; nothing enforces PR-based review or required CI checks. The Sprint 1 commits already on `main` are fine, but anything pushed straight to `main` from now until a paid plan exists bypasses every quality gate. Mitigation while unprotected: discipline only.

**How to avoid:** Pick a plan at the start of any new project. The cost ($4/mo) is dwarfed by one bad force-push. Tracked in handoff.md "Open questions" until resolved.

---

## AWS credentials accidentally pasted in chat during Day 3-4 bootstrap

**Status:** RESOLVED 2026-05-16 — both exposed keys deleted, CloudTrail audit clean (zero events on either key in ap-southeast-1 or us-east-1), replacement key never pasted.

**Symptom:** Two `eventpulse-cli` access keys (`AKIA2YICANXVR4KILEOZ`, `AKIA2YICANXVWVKCAE7Q`) exposed in chat via terminal output paste during initial AWS setup on 2026-05-16.

**Why it happens:** Shell command blocks with embedded `#` comments and multi-line structure caused zsh parse errors that scrambled terminal state; credential JSON output (which contains `AccessKeyId` + `SecretAccessKey`) got bundled into subsequent terminal log shares without being noticed in the moment.

**Fix:** Both compromised keys deleted from IAM. Third access key created for `eventpulse-cli`, never pasted anywhere. Root access key deleted entirely (programmatic root access is now impossible). `default` profile removed from `~/.aws/credentials` and `~/.aws/config`. CloudTrail audit performed across both regions for both key IDs — zero events on either key, no unauthorised use, no unfamiliar source IPs.

**How to avoid:**

1. **Never paste credential output** — AWS access keys, EPS hash keys, JWT signing keys, OAuth client secrets, KMS key material, anything sensitive — into any chat, screenshot, email, document, or log file. The only places credentials belong are `~/.aws/credentials` (or equivalent secrets file with `chmod 600`) and a password manager.
2. **Shell commands shared in prompts should be one command per line** with no `#` comments inside copy-paste blocks. zsh parses comments differently than bash and can leak surrounding text into the next visible line.
3. **When verifying setup, share only the minimum** — for `aws sts get-caller-identity` that's the `Arn` line via `--query 'Arn' --output text`, not the full JSON. For `aws iam create-access-key`, output goes straight to `aws configure --profile <name>` via piping or manual paste into the secrets file, never to stdout that gets captured.
4. **Treat any pasted credential as compromised even if the chat is private.** Rotate immediately. Run a CloudTrail audit for unauthorised use. Document the incident here.

---

## Dependabot opens majors aggressively on first push

**Status:** RESOLVED 2026-05-16 — `.github/dependabot.yml` now has explicit `ignore` entries for `version-update:semver-major` on every §1.2 locked package + every GitHub Action.

**Why it happens:** Dependabot scans the repo within minutes of the first push that contains `dependabot.yml` and opens PRs for every outdated dep it finds. Without `ignore` rules at repo init, it cheerfully proposes Next 15→16, zod 3→4, vitest 2→4, eslint 9→10, etc. — all of which would break the documented locked-stack contract in CLAUDE.md §1.2. We opened on day-one with 15 PRs sitting in the inbox, 13 of them majors that should never auto-bump.

**Fix:** Land `dependabot.yml` with `ignore` rules in the same commit that introduces it, not added later. The rule shape:

```yaml
ignore:
  - dependency-name: 'next'
    update-types: [version-update:semver-major]
```

Repeat for every locked dependency. For GitHub Actions, `dependency-name: '*'` is fine since action majors are universally a manual-read situation.

**How to avoid:** On any new project, the moment a `dependabot.yml` is authored, the `ignore` block goes in immediately, listing everything in the canonical-versions section of the project bible. Trying to enforce a locked stack via human discipline alone gets out-shouted by Dependabot's daily PR stream.

---

## CI written for the finished platform fails on early-sprint codebases

**Status:** RESOLVED 2026-05-16 — `ci.yml` rewritten with a `detect-scope` job that gates integration + e2e suites on the existence of the code they test. CLAUDE.md §24.4 ("CI Evolution") now documents the per-sprint escalation ladder.

**Symptom:** Right after PR #35 merged the initial `ci.yml`, all 7 open PRs (including markdown-only PR #37) showed red CI. Four jobs (`Lint + typecheck`, `Unit tests`, `Integration + RLS tests`, `E2E smoke (Playwright)`) failed in ~7 seconds each. Only `commitlint` passed.

**Why it happens:** Two overlapping things, with one masking the other:

1. **Immediate cause (pnpm version conflict):** `pnpm/action-setup@v4` errors when both `version:` is passed AND `packageManager` is set in `package.json`. The action explicitly bails out with `ERR_PNPM_BAD_PM_VERSION` even when the versions agree on the major. This killed every job at the pnpm setup step before any work ran.
2. **Underlying cause (CI ahead of code):** Even after the pnpm fix, `Integration + RLS tests` would have failed (no Drizzle migrations exist yet — Sprint 1 Day 5-6 work) and `E2E smoke` would have failed (no Playwright spec files exist yet). The original `ci.yml` was written assuming the finished platform's coverage.

**Fix:**

- `version:` removed from every `pnpm/action-setup@v4` invocation in `ci.yml`. `packageManager` field in `package.json` is now authoritative.
- New `detect-scope` job runs first; checks for `apps/api/src/db/migrations/*.sql` and `apps/web/e2e/**/*.spec.ts`; emits `has_migrations` + `has_e2e` outputs.
- `integration-tests` job gated on `needs.detect-scope.outputs.has_migrations == 'true'`. Currently skipped — will start running automatically when Day 5-6 lands migrations.
- `e2e-smoke` job gated on `needs.detect-scope.outputs.has_e2e == 'true'`. Currently skipped — will start running when Playwright specs land.
- `format:check` via prettier added to `lint-and-typecheck` (now always required).
- §24.4 "CI Evolution" in CLAUDE.md documents the per-sprint required-check escalation so future check additions don't repeat this drift.

**How to avoid:** The general rule (now §24.5 in CLAUDE.md):

> Every check declared in `ci.yml` must pass on the **current main branch** as-is, not as it will be in two sprints. If a check needs code that doesn't exist yet, gate it via `detect-scope` until the code lands. The PR that adds a check explains which sprint's milestone it represents.

A check that fails because the thing it validates doesn't exist is a broken check, not a strict check — it trains the team to ignore red CI, which is the worst outcome a CI system can produce. Red CI should always mean a real regression.

---

## GitHub PR event delivery stuck — stale mergeability cache after base branch advances

**Status:** RESOLVED 2026-05-16 — observed empirically on PR #36; cleared by merging current `origin/main` into the branch (creates a new merge commit that explicitly references the advanced base).

**Symptom:** After `main` moved past PR #36's `base_sha` via PR #38 merge, GitHub stopped firing `workflow_run` events on new pushes to PR #36 specifically. `mergeable_state: dirty` despite a clean merge tree confirmed via `git merge-tree origin/main origin/feat/...`. Other PRs in the same time window (Dependabot #16, #6) received normal CI triggers. PR #36 specifically had `mergeable: false` cached.

**Why it happens:** GitHub's mergeability calculation is asynchronous and can get wedged when the base branch advances rapidly while a PR is open. Workflow event dispatch appears to wait on the mergeability state being clean; if the cache stays in `dirty` indefinitely, events never fire on subsequent pushes. Not documented behaviour; observed empirically.

**Fix:** Try in order — when one works, stop:

1. `gh pr edit <n> --base main` — no-op base edit to force mergeability recompute. (Did not work for #36.)
2. `gh pr close <n> && gh pr reopen <n>` — full event regeneration via PR open/close. (Did not work for #36.)
3. **`git merge origin/main` into the branch + push** — creates a new merge commit that explicitly references current `main` HEAD; clears both the stale mergeability state AND unsticks event delivery. ✓ This worked. The new merge commit fired CI within seconds.
4. Force-push a rebase — new SHAs bypass stuck state. (Not tried; #3 worked.)
5. Admin-merge with local-CI audit trail — absolute last resort, only when 1-4 all fail.

**How to avoid:** When a long-lived PR has `main` move past its base, proactively `git merge origin/main` into the branch (or rebase + force-push) within the same session to reset the PR's view of the base. Don't let multiple in-flight PRs accumulate with mutually advancing bases — merge in topological order, fastest first. Before opening a new PR, check if any open PRs have `base_sha` older than current `main` HEAD; rebase those first or merge them.
