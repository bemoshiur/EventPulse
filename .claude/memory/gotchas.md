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
