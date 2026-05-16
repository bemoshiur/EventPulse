# Event Pulse

[![CI](https://github.com/publicpulseagency/EventPulse/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/publicpulseagency/EventPulse/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-proprietary-red.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%20LTS-339933.svg)](./.nvmrc)
[![Playbook](https://img.shields.io/badge/playbook-v2.0-6c4fe0.svg)](./CLAUDE.md)

Multi-tenant SaaS ticketing and event registration platform for Bangladesh at **eventpulse.com.bd**. Three portals share one codebase: tenant (`app.eventpulse.com.bd`), super admin (`admin.eventpulse.com.bd`), and public event pages. Tenants build branded events with drag-and-drop forms, accept EPS payments, and receive T+5 disbursements. Platform earns 0.25% per paid transaction.

## Developers start here

1. **[CLAUDE.md](./CLAUDE.md)** — the project bible (playbook v2.0). Mission, locked stack, immutable rules, full database schema, API spec, settlement engine, sprint plan. Read end-to-end before touching code.
2. **[.claude/memory/handoff.md](./.claude/memory/handoff.md)** — exactly where work stopped and what the next concrete step is.
3. **[CONTRIBUTING.md](./CONTRIBUTING.md)** — branch strategy, Conventional Commits, PR template, Definition of Done.

## How we work in this repo (free-plan workflow)

Event Pulse is a private repo on **GitHub Free**, which means UI-level branch protection isn't available. We enforce the same outcomes through tooling instead:

| Concern                                | What we use                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Don't push to `main` / `prod` directly | Local pre-push hook (`.husky/pre-push`) — install via `pnpm install` (husky `prepare` script wires it up)                                                          |
| Don't merge broken code                | `ci.yml` runs typecheck/lint/unit/integration/RLS/Playwright on every PR — the merge bar is **never click "Merge anyway"** with a red CI                           |
| Don't accidentally deploy to prod      | `deploy-prod.yml` is `workflow_dispatch`-only and requires typed-input gates (`confirm_target=production` exact match + `release_tag` matching `^v\d+\.\d+\.\d+$`) |
| Self-review honesty                    | PR template carries a solo-review banner + the full §25 Definition-of-Done checklist                                                                               |

Override the pre-push hook in genuinely exceptional cases with `git push --no-verify`, and immediately log the override (date + reason) to `.claude/memory/gotchas.md`. The day a second developer joins, the move is to upgrade to GitHub Pro (~$48/year) so UI-enforced branch protection comes back. See `.claude/memory/decisions.md` 2026-05-16 "GitHub free plan — branch protection via local hooks + CI" for the full rationale.

## How this project remembers itself

`.claude/` is the committed persistent brain shared across teammates and AI sessions.

- **[.claude/rules/](./.claude/rules/)** — memory, session, and handoff protocols
- **[.claude/memory/](./.claude/memory/)** — `MEMORY.md` (index), `decisions.md` (architectural log), `progress.md` (Done / In flight / Blocked), `gotchas.md`, `handoff.md`

## Quickstart

```bash
nvm use                              # Node 22 LTS
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
pnpm dev                             # runs web (:3000) + api (:4000) in parallel
```

Open <http://localhost:3000/sign-in> to see the design system on the four-button auth screen.

## Contact

- Sales / partnerships / press → <https://eventpulse.com.bd/contact>
- Security disclosures → `security@eventpulse.com.bd` (72-hour response SLA)
- Code of Conduct concerns → `conduct@eventpulse.com.bd`
- Legal enquiries → `legal@eventpulse.com.bd`

---

© 2026 Event Pulse. All rights reserved. Built by [Team Event Pulse](https://eventpulse.com.bd)
