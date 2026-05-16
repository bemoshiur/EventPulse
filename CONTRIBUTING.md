# Contributing to Event Pulse

Event Pulse is a proprietary SaaS platform. Contributions are accepted from authorised Public Pulse Agency / TiCON System Limited team members and engaged contractors only. External contributions are not solicited.

If you are authorised to contribute, this is how we work.

## Start here

1. Read **[CLAUDE.md](./CLAUDE.md)** end-to-end. It is the project's constitution — the locked stack, the immutable rules, the full database schema, the API spec, the settlement engine, the sprint plan. Most of your questions are already answered there.
2. Read **[.claude/memory/handoff.md](./.claude/memory/handoff.md)** — it tells you exactly where the project stopped and what the next concrete step is.
3. Skim **[.claude/memory/decisions.md](./.claude/memory/decisions.md)** — the architectural choices that shape your work.

## Branch strategy (§18.3)

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | Integration. PRs land here. | Staging (automatic on merge) |
| `prod` | Production cut. Merge-commit from `main` only. | Production (manual dispatch with reviewer approval) |
| `feat/<scope>-<short>` | New work | — |
| `fix/<scope>-<short>` | Bug fixes | — |
| `hotfix/<short>` | Urgent prod fix; can go directly to `prod` with explicit override | Production |

## Commits — Conventional Commits (§23.5)

Format: `type(scope?)!?: subject`

Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `memory`, `perf`, `refactor`, `revert`, `style`, `test`.

Examples:

```
feat(events): add capacity tracking
fix(payments): handle EPS COMPLETED status alias
chore(deps): bump drizzle-orm to 0.30
test(rls): add cross-tenant order isolation test
memory: end of session 2026-05-20
```

The PR title is enforced by the **Commit lint** CI job. Subject lines are 100 chars max.

When a commit implements a decision recorded in `.claude/memory/decisions.md`, reference the date in the body so `git log` always tells the "why":

```
feat(payments): implement fee-calculator absorb mode

Implements the absorb mode introduced in decisions.md 2026-05-20.
```

## Pull requests

- Open as **Draft** while you're working — CI runs continuously and reviewers can read the description.
- The PR template's Definition-of-Done checklist (§25) is not decorative. Tick boxes only **after** you've verified.
- Squash-merge to `main` (clean history). Merge-commit to `prod` (preserves the cut moment).
- **One PR per `progress.md` "In flight" item.** If a PR sprawls beyond one item, it's two PRs.
- Solo-review ritual until a teammate exists: Draft → full self-review against the checklist → merge.

## Memory protocol

`.claude/memory/` is the project's persistent brain. Before opening a PR:

- A new architectural choice? Append to `decisions.md` first, **then** implement.
- A weird thing that took >30 min to figure out? Append to `gotchas.md` in the same PR.
- Memory changes are committed separately from feature work with the `memory:` prefix. Never bundle.

Full protocol: `.claude/rules/memory-protocol.md`.

## Definition of Done (§25)

Code is "done" when, and only when:

- Code merged to `main` via PR with at least one approval
- All CI checks green (typecheck, lint, unit, integration, RLS, e2e smoke)
- New env vars documented in `.env.example` with comments
- Migrations applied to staging and verified
- User-visible changes logged in `CHANGES.md`
- If new user-facing copy on public surfaces: both English and Bangla
- If new financial logic: hand-verified against spreadsheet math by Moshiur
- If new payment flow: tested in EPS sandbox with at least one success and one failure
- If new RLS policy: cross-tenant negative test green
- Logs structured, no `console.log`
- Sentry receives errors with `request_id` tags

## Things that get a PR rejected on sight

- New table without RLS policy in the **same** migration (R11)
- Any money math outside `apps/api/src/domain/payments/fee-calculator.ts` (§14.3)
- Any deviation from the §17 single-EC2 architecture without a `decisions.md` entry first
- Raw PII in logs (R5) — buyer email, phone, NID, bank details
- `--no-verify` on commits, `--no-gpg-sign`, force-pushes to `main` or `prod`

## Communication

- Bugs / features / decisions → GitHub Issues (use the templates)
- Security → `security@eventpulse.com.bd` (never a public issue)
- Anything else → contact form at <https://eventpulse.com.bd/contact>

## Code of Conduct

By participating in this project you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
