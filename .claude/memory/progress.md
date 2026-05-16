# Event Pulse — Progress

## In flight

- 2026-05-16 — **Sprint 1 Day 3-4** (EC2 + Route 53 provisioning) — next concrete piece of work; awaiting AWS-profile + domain-registrar answers before starting
- 2026-05-16 — **Playbook v2.1 bump** — user saving v2.1 to `Playbook/EventPulse_Claude_Code_Playbook_v2.1.md`; on confirmation, copy to CLAUDE.md and commit as `memory+docs: bump CLAUDE.md to playbook v2.1`

## Done

- 2026-05-16 — **Repo bootstrap** — git init, CLAUDE.md (playbook v2.0), `.claude/` rules + memory seed, README, .gitignore (commit `6a89a29`)
- 2026-05-16 — **Resolve §14.1 vs §9.12 fee-mode contradiction** — schema default changed to `pass_through` (commit `82ab55a`)
- 2026-05-16 — **Sprint 1 Day 1-2: Monorepo scaffold** — Turborepo + pnpm workspaces, tsconfig presets, prettier, vitest, playwright. 5 packages (`@eventpulse/web`, `api`, `shared-utils`, `shared-types`, `tsconfig`). All typecheck green, 8/8 tests pass. (commit `1b45b16`)
- 2026-05-16 — **Sprint 1 Day 1-2: Design system + sign-in screen** — §1.5 palette as Tailwind 4 `@theme` tokens; glass component classes; gradient mesh with motion + reduced-motion fallback; primitives in `components/ui/`; static `/sign-in` exercising the four entry points per §19.2. (commit `1b45b16`)
- 2026-05-16 — **GitHub wiring (Sprint 1 sub-task)** — remote `publicpulseagency/EventPulse` (private), `main` + `prod` branches pushed (commits `6a89a29`/`82ab55a`/`1b45b16`/`21dad2c`); 5 workflows (ci/deploy-staging/deploy-prod/commitlint/release); 4 issue templates + config.yml; PR template with DoD checklist; CODEOWNERS; dependabot.yml; SECURITY.md / LICENSE / CONTRIBUTING.md / CODE_OF_CONDUCT.md; README badges; 3 environments (bare); 7 secret placeholders + 2 deploy-gate variables; wiki disabled; Dependabot alerts + automated security updates enabled; 15 labels (`sprint-1`, `phase-1`, `subsystem:*`, `estimate:*`, `day-*`); **16 Sprint 1 issues** (#19–#34) created; #19 and #20 closed against `1b45b16`. Decision logged: "GitHub workflow established". (commit `21dad2c` + memory commit)

## Blocked

- 2026-05-16 — **Branch protection on `main`/`prod`** — GitHub Free cannot apply branch protection to private repos. See `gotchas.md`. Re-enable as soon as the account is on GitHub Pro or converted to an Organisation with the Team plan.
- 2026-05-16 — **Environment reviewers + deployment-branch policies** on `staging`/`production`/`production-approval` — same Free-plan limitation. Environments exist as bare shells; workflows still reference them syntactically. Re-enable when plan flips.
- 2026-05-16 — **GitHub Project v2 "Event Pulse Roadmap"** — `gh` CLI token lacks `project,read:project` scopes. User must run `gh auth refresh -s project,read:project` once; then Claude Code creates the project + 4 custom fields + adds the 16 Sprint 1 issues.
- 2026-05-16 — **Secret scanning + push protection + code scanning** — require GitHub Advanced Security (paid) on private repos. Wiki + Dependabot alerts/updates ARE on. AdvSec adds the rest when plan upgrades.
- 2026-05-16 — **CODEOWNERS team validation** — `@publicpulseagency/eventpulse-core` references a team that doesn't exist until the user-→-org conversion completes. CODEOWNERS still parses, just doesn't enforce code-owner reviews.
