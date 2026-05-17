# Event Pulse — Gotchas

Things that broke, surprised us, or took >30 min to figure out. Add the moment you learn them, not at session end.

---

## Postgres tables pre-existed on staging without migration history → 0001 re-apply fails

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 (first real deploy).

**Symptom:** Deploy attempt 6's migration runner reported `relation "users" already exists` while applying `0001_identity_tables.sql`. The 12 identity tables existed in `eventpulse_staging` (likely from a Sprint 1 Day 5-6 manual verification run), but the `_eventpulse_schema_migrations` table was empty — the runner had no way to know 0001/0002 were already in place.

**Why it happens:** The hand-rolled migration runner (`apps/api/src/db/migrate.ts`) maintains its own history table. If schema state was created outside the runner (manual psql + .sql application, drizzle-kit push, or a different test harness), the runner is blind to it and tries to replay every migration from scratch.

**Fix (when it happens):** Backfill the migrations history table with the already-applied filenames, then re-run the deploy:

```sql
INSERT INTO _eventpulse_schema_migrations (filename, applied_at)
VALUES ('0001_identity_tables.sql', now()),
       ('0002_identity_rls_policies.sql', now())
ON CONFLICT DO NOTHING;
```

Verify the runner is in sync afterwards: `SELECT * FROM _eventpulse_schema_migrations ORDER BY filename;` should list every migration that has had its DDL applied.

**How to avoid:** Never apply schema via `psql -f *.sql` directly on a long-lived environment — always go through `pnpm --filter @eventpulse/api db:migrate`. For test/scratch DBs, prefer dropping + recreating the DB rather than applying SQL out-of-band.

---

## Postgres `eventpulse` user lacks ADMIN OPTION → migration 0001 GRANT fails

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5.

**Symptom:** `error: permission denied to grant role "eventpulse_app"` — `Only roles with the ADMIN option on role "eventpulse_app" may grant this role.` Migration 0001 runs `GRANT eventpulse_app TO CURRENT_USER` (and same for eventpulse_admin); the CURRENT_USER (`eventpulse` login role on staging) didn't have ADMIN OPTION on the target roles.

**Why it happens:** In CI the migration runs as the Postgres superuser (`postgres` from the postgres container's `POSTGRES_USER` default), which has ADMIN OPTION on every role implicitly. On staging the runtime DB user (`eventpulse`, a non-superuser LOGIN role created in Sprint 1 Day 3-4) does not. When 0001 creates `eventpulse_app` / `eventpulse_admin` it succeeds (no special perm needed if eventpulse has CREATEROLE), but the subsequent GRANT fails without ADMIN OPTION on those new roles.

**Fix (one-time, as postgres superuser via local socket):**

```sql
GRANT eventpulse_app   TO eventpulse WITH ADMIN OPTION;
GRANT eventpulse_admin TO eventpulse WITH ADMIN OPTION;
```

After this, the migration's `GRANT ... TO CURRENT_USER` is a no-op (eventpulse already has the role with ADMIN OPTION) and 0001 applies cleanly. Verify via:

```sql
SELECT r.rolname AS member_of, g.rolname AS member, m.admin_option
FROM pg_auth_members m
JOIN pg_roles r ON m.roleid=r.oid
JOIN pg_roles g ON m.member=g.oid
WHERE r.rolname LIKE 'eventpulse%';
```

`admin_option=t` should appear for both eventpulse_app and eventpulse_admin members where member = eventpulse.

**How to avoid:** Make this part of the Ansible playbook from Sprint 1 Day 3-4, OR extend `infra/scripts/bootstrap-staging.sh` to ensure the roles + grants are in place before the first deploy. (Deferred to a follow-up cleanup; current staging is bootstrapped manually.)

---

## Postgres CREATE POLICY requires table ownership → 0003 fails for non-owner

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5.

**Symptom:** Migration 0003's `CREATE POLICY users_self_select ON users` failed with `must be owner of table users`. The runtime DB user (`eventpulse`) was running the migration, but the tables were owned by `postgres` (from a Sprint 1 Day 5-6 manual setup).

**Why it happens:** `CREATE POLICY`, `ALTER TABLE`, `DROP TABLE` and similar DDL all require table ownership (or superuser). Tables created by `postgres` via `psql -f` belong to `postgres` and can't be modified by `eventpulse` even with CREATEROLE + WITH ADMIN OPTION on the role family.

**Fix (one-time, as postgres superuser):** Transfer ownership of every public-schema table to the runtime DB user:

```sql
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='postgres'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO eventpulse', t.tablename);
  END LOOP;
END $$;
```

After this, `eventpulse` can run any DDL against those tables. Future tables created BY eventpulse during a migration are automatically owned by eventpulse, so this is a one-time fix.

**Why not `REASSIGN OWNED BY postgres TO eventpulse`:** That command operates on ALL objects owned by postgres in the current DB, including DB-system objects we can't reassign. Result: `cannot reassign ownership of objects owned by role postgres because they are required by the database system`. Scoping to public-schema-only via the loop above sidesteps this.

**How to avoid:** Don't seed schema as `postgres` on a long-lived environment. Either run the migration runner from a fresh DB (where eventpulse creates everything), or fold the chown into the Ansible/bootstrap step alongside the role+ADMIN OPTION setup above.

---

## pnpm v9: `NODE_ENV=production` skips devDeps; `--prod=false` and `NPM_CONFIG_PRODUCTION=false` do NOT override it

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — deploy.sh uses `NODE_ENV=development` for the install command, then restores `NODE_ENV=production` for build + migrate + pm2.

**Symptom:** Deploy attempts 2 + 3 had `pnpm install --frozen-lockfile --prod=false` or `NPM_CONFIG_PRODUCTION=false pnpm install --frozen-lockfile` and pnpm reported "Already up to date" but `apps/web/node_modules/` contained only the 10 prod deps — no `@tailwindcss/postcss`, no `typescript`, no `husky`. Next build then failed: `Cannot find module '@tailwindcss/postcss'`.

**Why it happens:** In pnpm v9.15.x, the `--prod` CLI flag has version-to-version parsing drift, and the `NPM_CONFIG_PRODUCTION` env var is treated as advisory at best — neither overrides pnpm's direct read of `NODE_ENV`. If `NODE_ENV=production` is in scope when pnpm runs, devDeps are skipped regardless of any "no, install everything" signals.

**Fix (in deploy.sh / rollback.sh):** Wrap the install command with `NODE_ENV=development`:

```bash
# .env.staging has NODE_ENV=production — correct for runtime.
# But pnpm install needs to see development to include devDeps for build.
HUSKY=0 NODE_ENV=development \
  $PNPM install --frozen-lockfile --config.confirm-modules-purge=false

# Restore NODE_ENV for the rest of the script.
NODE_ENV=production
export NODE_ENV
```

This is the only reliable knob in pnpm v9. The CLI flag and `NPM_CONFIG_PRODUCTION` env var do not work as documented; assume `NODE_ENV` is authoritative until pnpm v10+ behavior is verified.

**How to avoid:** Don't trust pnpm CLI flag documentation in v9.x for prod/dev toggling. Always test with `NODE_ENV` set to verify which knob actually moves the install behavior.

---

## pnpm `--frozen-lockfile` prompts "modules will be reinstalled" with no TTY in SSM → hangs

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — `--config.confirm-modules-purge=false` flag added.

**Symptom:** Deploy attempt 2 hung indefinitely. SSM command output showed `The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n) ‣ true` with an ANSI escape sequence trying to redraw the prompt. SSM's command channel has no PTY, so pnpm's `enquirer`-based prompt never got an answer and the command timed out.

**Why it happens:** When a previous install left node_modules in a partial state (e.g. an earlier `--prod` install then a later one requiring devDeps), pnpm decides the modules tree needs to be purged + reinstalled. It prompts the user for confirmation by default. SSM RunShellScript invocations don't allocate a TTY.

**Fix:** `pnpm install --config.confirm-modules-purge=false` auto-confirms the purge. Add it to every `pnpm install` invocation that might run in a non-TTY context (deploy scripts, CI, SSM, container entrypoints).

**How to avoid:** For any shell script that runs unattended, audit every interactive-capable subcommand for a non-interactive flag. pnpm has several others to watch: `--reporter=append-only` (no spinner), `--config.confirm-modules-purge=false`, `--config.fund=false`. CI environments usually set `CI=true` which pnpm respects for some prompts but not all.

---

## TypeScript `declarationMap` requires `declaration` or `composite` — base tsconfig + override interaction

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 — `apps/api/tsconfig.build.json` explicitly sets `declarationMap: false`.

**Symptom:** `tsc --project tsconfig.build.json` failed with `error TS5069: Option 'declarationMap' cannot be specified without specifying option 'declaration' or option 'composite'.`

**Why it happens:** Base config (`packages/tsconfig/node.json`) sets `declaration: true` + `declarationMap: true`. `apps/api/tsconfig.build.json` overrides `declaration: false` but doesn't override `declarationMap`, so `declarationMap=true` is inherited alone. TS 5.6+ catches this combination.

**Why CI didn't catch it:** `pnpm typecheck` invokes `tsc --noEmit` against `tsconfig.json`, not `tsconfig.build.json`. The build config is only exercised by `pnpm --filter @eventpulse/api build` which runs on the EC2 during deploy. CI's `pnpm test` uses vitest + tsx (which bypasses tsc's compiler-options validation entirely).

**Fix:** Explicit `declarationMap: false` alongside `declaration: false` in any tsconfig that disables `declaration` while inheriting from a base that enables `declarationMap`.

**How to avoid:** Add a CI step that runs the actual production build (`pnpm --filter @eventpulse/api build`) — not just typecheck against the dev tsconfig. The "Lint + typecheck + format" CI job currently doesn't exercise build configs. Sprint 2 Day 12 housekeeping candidate: add `build` to the CI matrix.

---

## SSM `commands=[]` array entries run in SEPARATE shells — env vars don't persist between entries

**Status:** RESOLVED 2026-05-17 during Sprint 2 Day 11 Item 5 (workaround: combine commands with `;` or `&&` into a single array entry).

**Symptom:** A multi-step SSM command like:

```bash
aws ssm send-command --parameters 'commands=[
  "PG_PASSWORD=$(sudo awk -F: ... .pgpass)",
  "sudo PG_PASSWORD=\"$PG_PASSWORD\" /path/to/bootstrap.sh"
]'
```

failed with `PG_PASSWORD: must be set in caller env`. The first entry set the variable; the second entry couldn't see it.

**Why it happens:** AWS SSM RunShellScript runs each `commands[]` array entry as a SEPARATE invocation of `bash -c`. Each gets its own shell + its own env. Variables set in one entry are gone by the time the next starts. This is documented but easy to miss because the array format looks like a script with multiple lines.

**Fix:** Combine dependent steps into a single array entry, chained with `;` (sequence) or `&&` (sequence-with-early-abort):

```bash
commands=[
  "set -e; PG_PASSWORD=$(sudo awk -F: ... .pgpass); sudo PG_PASSWORD=\"$PG_PASSWORD\" /path/to/bootstrap.sh"
]
```

This way the whole pipeline runs in one shell and variables persist. Or write a small wrapper script + invoke it as a single command.

**How to avoid:** Mentally treat each entry in the SSM commands array as its own self-contained shell script. Need state to flow between them? Either combine them, or persist via a tempfile (`/tmp/foo.env` then `source /tmp/foo.env`).

---

## Pre-push hook blocks tag pushes from `main` as if they were branch pushes

**Status:** RESOLVED 2026-05-17 — `.husky/pre-push` rewritten to inspect git's per-ref stdin and gate solely on branch refs (`refs/heads/main` and `refs/heads/prod`). Tag pushes (`refs/tags/*`) and feature-branch pushes (`refs/heads/feat/*`, etc) pass cleanly even when HEAD is on main. Verified against an 8-case test matrix covering tag-only, branch-only, mixed, empty-stdin, and dual-protected scenarios before merge. Sprint 2 Day 11 Item 2; durable fix landed in the same sprint the issue surfaced.

**Symptom:** `git push origin v0.1.0-sprint-1` (with no branch ref) fails with `✋  Direct push to 'main' is blocked.` from the pre-push hook even though only a tag is being pushed.

**Why it happens:** The original `.husky/pre-push` checked `git symbolic-ref --short HEAD` to determine the current branch and matched against `^(main|prod)$`. When pushing only a tag, HEAD is still on `main` (because that's where the local checkout sits), so the hook fired identically to a branch push. The hook did not inspect git's pre-push stdin (which provides per-ref `<local ref> <local sha> <remote ref> <remote sha>` lines that would distinguish tag refs from branch refs).

**Fix (durable, landed):** `.husky/pre-push` now reads stdin line-by-line:

```bash
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/prod)
      blocked_refs+=("${remote_ref#refs/heads/}")
      ;;
    refs/heads/*|refs/tags/*)
      # Feature branches and tags: allowed.
      ;;
  esac
done
```

Block fires only when at least one ref being pushed is `refs/heads/main` or `refs/heads/prod`. Empty stdin (nothing being pushed) is a no-op. Multi-ref pushes are evaluated independently. Message includes the explicit "tag pushes are NOT blocked" line so future-me doesn't reach for `--no-verify` reflexively.

**Fix (historical, immediate workaround that was used during Sprint 1 closeout):** `git push --no-verify origin <tag>` per the hook's documented override. One-time use on 2026-05-17 for `v0.1.0-sprint-1` before this resolution landed.

**How to avoid:** Tag pushes from a protected branch checkout now work without intervention. The `--no-verify` override is reserved for the rare deliberate-direct-push-to-main case, which still requires a gotchas.md entry.

---

## Postgres superusers ALWAYS bypass RLS — `FORCE ROW LEVEL SECURITY` only binds table owners

**Status:** RESOLVED 2026-05-17 — Sprint 1 Day 5-6 first CI integration test pass surfaced this. Tenant A's "expected 1, got 2" assertions revealed that RLS wasn't engaging at all even though every policy was correct and every `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` was set.

**Symptom:** `withTenant(tenantA, ...)` reads `tenants` and gets BOTH the A and B fixture rows, instead of just A. The RLS policy `id = current_setting('app.current_tenant_id', true)::uuid` looks correct. The session variable is set correctly. Yet rows from other tenants are still visible.

**Why it happens:** PG docs are explicit but easy to miss:

> Superusers and roles with the BYPASSRLS attribute always bypass the row security system when accessing a table. Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with ALTER TABLE ... FORCE ROW LEVEL SECURITY.

In CI the connection user is `POSTGRES_USER` from the postgres image — a SUPERUSER. Superusers bypass RLS regardless of FORCE. The session variable is read; the policy is evaluated; the result is *thrown away* because the calling role is a superuser.

This is also why the issue didn't show locally — local tests `describe.skip` without `DATABASE_URL`, so they never exercised the bug.

**Fix:** Always run *application* queries as a non-superuser role. Migration creates `eventpulse_app` (NOLOGIN, no BYPASSRLS), grants it to the connection user, gives it ordinary table privileges. `withTenant()` does `SET LOCAL ROLE eventpulse_app` before setting `app.current_tenant_id`. `withSuperAdmin()` keeps using `SET LOCAL ROLE eventpulse_admin` (which has BYPASSRLS and is the *only* sanctioned way to bypass RLS).

**How to avoid:**

1. **Anywhere RLS matters, the application code must `SET LOCAL ROLE` a non-superuser role at the start of every transaction.** This is non-negotiable; relying on "the connection user isn't superuser in prod" is a foot-gun because dev/CI environments often run as superuser.
2. **Test RLS against a real Postgres in CI, not just unit tests.** Without the integration test, this would have shipped silently.
3. **Add a smoke check to every RLS migration: `SET LOCAL ROLE eventpulse_app` then count rows in a tenant-scoped table; should return 0 when the session variable is unset.** Catches future regressions.
4. **The `eventpulse_admin` BYPASSRLS role is the audit-logged escape hatch.** Don't put any business logic into "the connection user happens to be a superuser" — that's an accident waiting to leak across tenants.

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
