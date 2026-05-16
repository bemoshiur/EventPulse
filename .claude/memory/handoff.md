# Event Pulse — Handoff (session exit state)

**Last session:** 2026-05-16 (Sprint 1 Day 1-2 + GitHub wiring)
**Ended by:** Moshiur Rahman

## State right now

Four commits on `main` (and `prod`, pushed to private repo `publicpulseagency/EventPulse`):

- `6a89a29` chore: bootstrap repo with CLAUDE.md v2.0, .claude/ protocols, memory seed
- `82ab55a` memory+docs: resolve §14.1 vs §9.12 fee-mode contradiction (pass_through wins)
- `1b45b16` feat(scaffold): sprint 1 day 1-2 — monorepo + design system + sign-in screen
- `21dad2c` chore(github): wire repo for collaboration — workflows, templates, dependabot, repo-level files

Sprint 1 Day 1-2 fully closed (typecheck green, 8/8 tests, `next build` prerenders, `/health` responds, static `/sign-in` exercises §1.5 system end-to-end). GitHub wiring sub-task closed — 5 workflows, 4 issue templates, PR template, CODEOWNERS, dependabot, repo-level files (SECURITY/LICENSE/CONTRIBUTING/CODE_OF_CONDUCT), 15 labels, 16 Sprint 1 issues (#19–#34) live, 3 environments created (bare shells), 7 secret placeholders + 2 deploy-gate variables, wiki disabled, Dependabot vuln alerts + automated security updates on.

## Where we are in §26.1

- Day 1-2 → **done**
- Day 3-4 → **next**, blocked on AWS profile + domain registrar confirmation
- Day 5-6 (Drizzle identity-tables schema + RLS) — issues #24, #25, #26, #27
- Day 7-8 (auth: email/password, magic link, Google, Apple, Lucia) — issues #28, #29, #30, #31
- Day 9-10 (SES + PM2 + deploy + green CI) — issues #32, #33, #34

## Immediate next step (one of)

1. **Bump CLAUDE.md to playbook v2.1** — user is saving v2.1 to `Playbook/EventPulse_Claude_Code_Playbook_v2.1.md`. On confirmation: copy to CLAUDE.md, log decisions.md entry for v2.0 → v2.1, commit as `memory+docs: bump CLAUDE.md to playbook v2.1`. v2.1 adds attendee accounts to Phase 2, self-service hosting, unified identity model, handle system. Schema (issue #24) will pick up `users.handle`, `users.handle_chosen_at`, `tenants.is_personal`, `tenants.owner_user_id`.
2. **Day 3-4 — EC2 + Route 53** — once v2.1 is in or the user chooses to defer it.

## Open questions for Moshiur (carry into next session)

- **AWS profile** for staging — assume `eventpulse-staging` unless told otherwise.
- **Domain `eventpulse.com.bd` registrar** — Route 53 must be authoritative for DNS-01 wildcard cert. If domain is elsewhere, NS records → Route 53 first.
- **GitHub plan upgrade** — branch protection + environment reviewers + advanced security all blocked on GitHub Free for private repos. $4/month Pro (user) or convert to org + Team. Cheapest path: Pro. Tracked in `gotchas.md` and `progress.md` Blocked.
- **User → Organization conversion** — needed for CODEOWNERS team (`@publicpulseagency/eventpulse-core`) to validate and for team-based push restrictions on prod. Manual step in GitHub Settings.
- **GitHub Project v2** — `gh auth refresh -s project,read:project` to unblock; then I can create the project + 4 custom fields + add the 16 Sprint 1 issues.
- **15 Dependabot PRs** opened immediately after first push. Many are major version bumps that would break the locked §1.2 stack (Next 15→16, zod 3→4, vitest 2→4). Triage when ready; consider tightening dependabot.yml `ignore` rules for locked majors.
- **3 Dependabot security alerts** flagged — review and decide on patch acceptance.
- §29 #9 (withholding tax/AIT) and #10 (VAT/Mushak) — book legal consult by week 4-5 of Phase 1.

## Half-done items

None — both Day 1-2 and the GitHub wiring sub-task are fully closed.
