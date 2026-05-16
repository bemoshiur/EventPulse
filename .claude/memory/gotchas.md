# Event Pulse — Gotchas

Things that broke, surprised us, or took >30 min to figure out. Add the moment you learn them, not at session end.

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
