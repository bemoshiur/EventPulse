# Event Pulse

[![CI](https://github.com/publicpulseagency/EventPulse/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/publicpulseagency/EventPulse/actions/workflows/ci.yml)
[![Playbook](https://img.shields.io/badge/playbook-v2.3-6c4fe0.svg)](./CLAUDE.md)
[![Node](https://img.shields.io/badge/node-22%20LTS-339933.svg)](./.nvmrc)
[![License](https://img.shields.io/badge/license-proprietary-red.svg)](./LICENSE)

Multi-tenant SaaS ticketing and event registration platform for Bangladesh at **eventpulse.com.bd**. Tenants build branded events, collect registrations through drag-and-drop forms, accept payments via EPS Bangladesh in BDT, and receive T+5 disbursements to bank or MFS accounts. The platform earns 0.25% on every paid transaction.

---

## Overview

Three portals share one codebase:

- **Tenant portal** at `app.eventpulse.com.bd` — event organisers create events, manage attendees, run check-in, view payouts.
- **Super admin portal** at `admin.eventpulse.com.bd` — platform operators run the KYC review queue, fee overrides, disbursement approval, AUP triage.
- **Public surfaces** at `eventpulse.com.bd/{tenant}/{event}`, `{tenant}.eventpulse.com.bd/{event}`, and tenant custom domains via Cloudflare for SaaS.

Phase 2 also brings a fourth surface, **attendee portal** at `my.eventpulse.com.bd`, plus self-service event hosting where any signed-in user can publish free events instantly and graduate through KYC when they add a paid ticket tier.

The platform is built with **TypeScript 5.4+** (strict, no `any`), **Next.js 15 App Router** on the frontend, **Hono** on the backend, **PostgreSQL 16** with row-level security for multi-tenancy, **Drizzle ORM**, **Redis** for sessions + rate limits + idempotency keys, and **BullMQ** for background work. Authentication is in-repo composition (`@noble/hashes` argon2id + `jose` JWT + `arctic` OAuth + custom Postgres session adapter) — Lucia was the original pick but went into maintenance mode in early 2026. EPS integration is an in-house wrapper at `apps/api/src/infra/eps/`; both candidate community SDKs were evaluated and rejected.

For everything below to make sense — the immutable rules, the fee modes, the KYC pipeline, the settlement engine, the deployment shape, the BD regulatory posture — read **[CLAUDE.md](./CLAUDE.md)** first. It is the authoritative playbook (currently v2.3, ~3,100 lines). This README orients; CLAUDE.md governs.

---

## Architecture (MVP — single EC2)

```text
                    eventpulse.com.bd, *.eventpulse.com.bd (Route 53)
                                       │
                            Custom domains (Cloudflare for SaaS)
                                       │
                                       ▼
                    ┌────────────────────────────────────┐
                    │  EC2 (ap-southeast-1, Ubuntu LTS)  │
                    │                                    │
                    │   Nginx (TLS + vhost routing)      │
                    │      │                             │
                    │      ├─► Next.js 15  (:3000)       │
                    │      └─► Hono API   (:4000)        │
                    │                                    │
                    │   PM2 (cluster mode, log rotate)   │
                    │                                    │
                    │   PostgreSQL 16  + RLS             │
                    │   Redis 7        + BullMQ          │
                    │                                    │
                    │   CloudWatch Agent                 │
                    └────────────────────────────────────┘
                              │              │
                              ▼              ▼
                         AWS S3          AWS SES
                      (KYC, assets,    (transactional
                       backups,         email + bounce
                       audit exports)   webhooks)
```

A single EC2 instance runs everything for MVP. **Route 53 + S3 + SES** are the only AWS services used in the application path. Lambda, API Gateway, ECS, RDS, and CloudFront are deliberately deferred. The migration path off single-EC2 is documented in CLAUDE.md §17.12 with clear triggers (sustained CPU, DB size, write IOPS, multi-developer-team thresholds) — this is intentional simplicity, not under-engineering.

Why this shape: it is small enough to debug end-to-end, costs under USD 30/month at idle, and gets to the first paying tenant fast. The KYC bucket uses a dedicated KMS CMK (`alias/eventpulse-kyc-<env>`) for per-purpose blast-radius isolation; general operational data uses `alias/eventpulse-<env>`. Shell access to the EC2 is **AWS SSM Session Manager only** — port 22 is closed permanently and no SSH key pair exists for the instance.

---

## Sprint structure

| Sprint   | Window       | Scope                                                                                 |
| -------- | ------------ | ------------------------------------------------------------------------------------- |
| Sprint 1 | Days 1–10    | Foundation: monorepo + design system, EC2 + Route 53 + TLS, identity + RLS, auth flows |
| Sprint 2 | Days 11–20   | KYC pipeline, super admin review queue, Trust Center v0.1 placeholders, OAuth wiring   |
| Sprint 3 | Days 21–30   | **Active.** Fee calculator, Event CRUD, EPS in-house wrapper, sandbox truth gate       |
| Sprint 4 | Days 31–40   | Attendees, check-in, refunds, manual disbursement, public marketing, launch readiness  |
| Phase 2  | Sprints 5–8  | Form/landing builders, automated disbursement, attendee portal, self-service hosting    |
| Phase 3  | Sprints 9–12 | White-label, email campaigns, wallet passes, mobile check-in, discovery search          |
| Phase 4  | Sprints 13+  | Marketplace recommendations, fraud ML, social layer, alternative payment gateways      |

Sprint scope and per-day deliverables live in **CLAUDE.md §26**. Current sprint state — Done / In flight / Blocked — lives in **[.claude/memory/progress.md](./.claude/memory/progress.md)**. The annotated git tag `v0.X.0-sprint-N` ships at sprint end with a release notes file under [docs/releases/](./docs/releases/) carrying the retro.

---

## Memory protocol

`.claude/` is the committed persistent brain shared across teammates and AI sessions. Every meaningful decision, every gotcha, every sprint boundary persists here so the next reader — whether a future you, a teammate, or an AI session — picks up where the last one stopped.

| File                                          | Purpose                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| [.claude/memory/MEMORY.md](./.claude/memory/MEMORY.md)       | One-line index of every other memory file                                          |
| [.claude/memory/handoff.md](./.claude/memory/handoff.md)     | Session exit state — the first file to read at session start                       |
| [.claude/memory/progress.md](./.claude/memory/progress.md)   | Current sprint — Done / In flight / Blocked                                        |
| [.claude/memory/decisions.md](./.claude/memory/decisions.md) | Append-only architectural and product decision log                                 |
| [.claude/memory/gotchas.md](./.claude/memory/gotchas.md)     | Things that broke or surprised us, with the avoid-next-time recipe                 |

Protocols enforcing how these files get written and read live in **[.claude/rules/](./.claude/rules/)** — `memory-protocol.md`, `session-protocol.md`, `handoff-protocol.md`. Read them once before opening any session that will write code or memory.

The cardinal rules: memory is committed in its own commits prefixed `memory:` so a teammate can review them as cleanly as a feature diff; memory is append-mostly (never silently deleted; mark superseded with a link to the correcting decision); and a decision or gotcha gets written in the same turn it happens, never batched to session end.

---

## Playbook

**[CLAUDE.md](./CLAUDE.md)** is the authoritative project playbook. Currently v2.3 (19 May 2026). Treat it the way you would a constitution — every architectural decision, immutable rule, schema, API contract, fee mode, KYC tier, deployment shape, and BD regulatory posture lives there. If two sources disagree, CLAUDE.md wins; if CLAUDE.md is silent, decisions.md fills the gap; if both are silent, surface the gap before acting.

Most-referenced sections:

| Section | Topic                                                       |
| ------- | ----------------------------------------------------------- |
| §1.2    | Locked tech stack (versions are immutable)                  |
| §1.3    | Twelve immutable rules                                      |
| §1.5    | Design system tokens, glassmorphism utilities, motion       |
| §4.2.1  | Postgres role hierarchy (`eventpulse_app` ← `eventpulse_admin`) |
| §5      | Authentication (three audiences, rolled-our-own composition) |
| §6      | API patterns (envelope, error codes, idempotency, pagination) |
| §9      | Complete database schema (Phase 1 + Phase 2)                |
| §11     | EPS integration (flow + per-endpoint hash mechanism + gotchas) |
| §13     | KYC engine + platform-wide manual-verification policy        |
| §14     | Settlement engine + fee modes + single source of money truth |
| §17     | Infrastructure (single-EC2 architecture + scaling triggers)  |
| §20     | Trust Center                                                |
| §21     | Legal positioning (hosting-space doctrine + AUP enforcement) |
| §26     | Sprint plan                                                 |
| §29     | Open decisions (Claude Code halts on these)                  |

---

## Development setup

**Prerequisites:** Node 22 LTS (use `nvm`), pnpm 10 (via `corepack`), Docker (for local Postgres + Redis), AWS CLI v2 with an `eventpulse` profile configured if you need to read Secrets Manager entries.

```bash
nvm use                                  # respects .nvmrc → Node 22 LTS
corepack enable && corepack prepare pnpm@10 --activate
pnpm install                             # also wires husky hooks via prepare script

cp .env.example .env.local               # fill in DB + JWT secrets for local dev
docker compose up -d postgres redis      # local dependencies (see docker-compose.yml)
pnpm --filter @eventpulse/api db:migrate # apply Drizzle migrations

pnpm dev                                 # runs web (:3000) + api (:4000) in parallel
```

Open `http://localhost:3000/sign-in` for the design system on the auth screen.

`.env.example` documents every required environment variable with a comment. Production and staging environments materialise these from AWS Secrets Manager entries named `eventpulse/<env>/<purpose>` — JWT, OAuth providers, EPS, KYC bucket, Porichoy (scaffold-only). The names are stable; the values never appear in the repo.

**Useful scripts:**

```bash
pnpm typecheck             # tsc --noEmit across all packages
pnpm lint                  # eslint + prettier check
pnpm test                  # vitest run (unit + integration; gated by detect-scope)
pnpm test:e2e              # Playwright (boots api + web via webServer)
pnpm --filter @eventpulse/api db:generate    # generate migration from schema diff
pnpm --filter @eventpulse/api db:migrate     # apply pending migrations
pnpm build                 # turbo build all packages
pnpm format:check          # prettier check (no write)
```

---

## Deployment

**Staging — auto-deploy on push to main.** A successful push to `main` fires `.github/workflows/deploy-staging.yml`. The workflow assumes an AWS role via OIDC (canonical three-claim trust pattern; see CLAUDE.md §17.9.1), then issues `aws ssm send-command` to run `infra/deploy/deploy.sh` on the staging EC2 under the `eventpulse` user. No SSH key is generated for the instance; no port 22 is opened.

Steps inside `deploy.sh`:

1. Source `.env.staging` (loud failure if absent — bootstrap-staging.sh is the writer).
2. `git fetch` + `git reset --hard` to the requested commit (resolves both branch names and SHAs).
3. `pnpm install --frozen-lockfile` (with `NODE_ENV=development` override so devDeps land for the build).
4. Build workspace packages in dependency order: `@eventpulse/shared-types` → `@eventpulse/web` → `@eventpulse/api`.
5. Detect Nginx vhost or snippet changes vs the previous commit; if changed, run `nginx -t` then `systemctl reload nginx` (rollback on validation failure).
6. Apply pending Drizzle migrations via `db:migrate`.
7. Zero-downtime `pm2 reload` of the ecosystem file.
8. Healthcheck retry loop (5 × 3s) against `http://127.0.0.1:4000/health`; rollback via `infra/deploy/rollback.sh` if the API isn't 200 by the end.

**Production — manual workflow_dispatch with typed input gate.** `.github/workflows/deploy-prod.yml` requires `confirm_target=production` (exact match) and `release_tag` matching `^v\d+\.\d+\.\d+$`. Production deploys are infrequent and tag-driven (one annotated tag per release; release notes under [docs/releases/](./docs/releases/)).

**Rollback.** `infra/deploy/rollback.sh` reverts the working tree to the previous commit (snapshotted before the `git reset`), reloads PM2, and re-runs the healthcheck loop. Rollback is automatic on healthcheck failure during deploy; manual rollback is a single `ssm send-command` invocation documented in [docs/runbooks/](./docs/runbooks/).

**Shell access.** All operator + investigation access is via `aws ssm start-session --target <instance-id> --profile eventpulse`. Session logs land in an environment-scoped S3 bucket plus a matching CloudWatch Logs group, both KMS-encrypted with 90-day retention.

---

## Testing

The test pyramid (CLAUDE.md §24):

- **Unit (Vitest)** — pure functions, validators, state machines, money math, hash helpers. Fast (~1ms each), no I/O.
- **Integration (Vitest + real Postgres)** — Hono route handlers against a transactional test database. Every domain table gets an RLS cross-tenant isolation test. Tests run inside `BEGIN…ROLLBACK` per case for fast cleanup.
- **E2E (Playwright)** — critical user journeys (sign-up → KYC submit → super admin approve → publish; ticket purchase → check-in; etc.). Boots both apps via Playwright `webServer` config.
- **Frontend component (Vitest + jsdom + Testing Library + vitest-axe)** — every new interactive component test includes `expect(await axe(container)).toHaveNoViolations()`. Modal-open state needs its own scan.

CI is in **`.github/workflows/ci.yml`** with a `detect-scope` job that gates conditional suites: integration / RLS / E2E only fire when the corresponding code paths exist. The required check set grows sprint by sprint per CLAUDE.md §24.4 — by Sprint 4, load test budget and dependency audit join the gate.

Required tests for every new feature (CLAUDE.md §24.3): one happy path, one validation failure, one auth failure, one RLS cross-tenant for tenant-scoped endpoints, one idempotency test for money-moving endpoints.

---

## Operational notes

**Cost.** Single EC2 + Route 53 + S3 + SES + Secrets Manager + KMS CMKs runs at roughly USD 22–30/month at idle. The `$40/mo` AWS Budget acts as a canary alarm. Cost growth triggers re-evaluation per CLAUDE.md §17.12.

**Backups.** Postgres nightly `pg_dump` to S3 (`eventpulse-<env>-backups/postgres/YYYY/MM/DD.sql.gz`) with 90-day retention; WAL archiving enabled for point-in-time restore. Daily EBS snapshots, 7-day retention, KMS-encrypted. S3 versioning on every production bucket; Glacier lifecycle after 30 days. Restore drill: scheduled quarterly per CLAUDE.md §17.10.

**Monitoring.** CloudWatch Agent ships system metrics (CPU, mem, disk, swap) plus pino JSON logs from the application. Sentry handles application errors with PII scrubbing. External uptime monitoring (UptimeRobot / BetterStack) hits the `/health` endpoints. Alert thresholds in CLAUDE.md §17.11.

**Compliance posture.** KYC documents retained 5 years per BFIU. NID verification: Phase 2 manual reviewer flow only (Porichoy adapter scaffolded; live wiring deferred — see `.claude/memory/decisions.md` "Platform-wide policy — manual verification only for MVP"). EPS sub-merchant aggregator model Year 1; PSO licence application Year 2. Withholding tax + VAT classification: open legal decisions (CLAUDE.md §29).

**Memory + sprint boundaries.** Memory commits ship in their own commits prefixed `memory:`. Sprint boundaries cut annotated tags (`v0.<sprint>.0-sprint-<n>`) with retro answers in the release notes.

---

## Repository structure

```text
eventpulse/
├── apps/
│   ├── api/                  Hono backend (routes, domain, infra, db, services)
│   └── web/                  Next.js 15 frontend (app router, components, hooks)
├── packages/
│   ├── shared-types/         Zod schemas + cross-app TypeScript types (real tsc build → dist/)
│   ├── shared-utils/         Currency, date, BD-specific helpers
│   └── tsconfig/             Shared TypeScript config
├── infra/
│   ├── deploy/               deploy.sh + rollback.sh (SSM-invoked on EC2)
│   ├── nginx/                Vhost configs + snippets (TLS, security headers)
│   └── scripts/              setup-kyc-bucket.sh, setup-github-oidc.sh, bootstrap-staging.sh
├── docs/
│   ├── investigations/       Decision-input notes (e.g. EPS library comparison)
│   ├── releases/             Sprint release notes (retro per sprint boundary tag)
│   └── runbooks/             Operational procedures (deploy, rollback, restore drill)
├── .claude/
│   ├── commands/             Project-specific slash commands
│   ├── memory/               Persistent brain — see Memory Protocol above
│   └── rules/                memory-protocol.md, session-protocol.md, handoff-protocol.md
├── .github/
│   └── workflows/            ci.yml, commitlint.yml, deploy-staging.yml, deploy-prod.yml, release.yml
├── CLAUDE.md                 Authoritative playbook (v2.3)
├── CHANGES.md                User-visible change log
├── README.md                 This file
├── package.json              Workspace root
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

Naming conventions (CLAUDE.md §3.1): kebab-case filenames; PascalCase React components matching the export; snake_case table + column names; SCREAMING_SNAKE_CASE constants; `EVENTPULSE_*` env var prefix for app-owned variables.

Module boundaries: `apps/web` and `apps/api` never import from each other; both pull from `packages/*`; shared types live in `packages/shared-types`.

---

## Active sprint tracker

To pick up live work in flight, start at:

1. **[.claude/memory/handoff.md](./.claude/memory/handoff.md)** — session exit state with the next concrete step.
2. **[.claude/memory/progress.md](./.claude/memory/progress.md)** — Done / In flight / Blocked for the active sprint.
3. **[.claude/memory/decisions.md](./.claude/memory/decisions.md)** — read the last 10 entries before forming opinions.
4. **[.claude/memory/gotchas.md](./.claude/memory/gotchas.md)** — search before debugging anything that "shouldn't be hard."

---

## Free-plan workflow

Event Pulse is a **private repo on GitHub Free**. UI-level branch protection isn't available on this tier, so the same outcomes get enforced through local tooling and CI gates:

| Concern                                | What enforces it                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Don't push to `main` / `prod` directly | Local pre-push hook (`.husky/pre-push`) — installed automatically via `pnpm install`                                          |
| Don't merge broken code                | `ci.yml` runs typecheck / lint / unit / integration / RLS / Playwright on every PR; merge gate is "never click Merge anyway"  |
| Don't accidentally deploy to prod      | `deploy-prod.yml` is `workflow_dispatch`-only and requires a typed input gate (`confirm_target=production` + semver tag match) |
| Self-review honesty                    | PR template ships a solo-review banner + the full §25 Definition-of-Done checklist                                            |

Override the pre-push hook in genuinely exceptional cases with `git push --no-verify`, and immediately log the override (date + reason) in `.claude/memory/gotchas.md`. The day a second engineer joins, the move is to upgrade to GitHub Pro (~USD 48/year) so UI-enforced branch protection comes back. Full rationale in `.claude/memory/decisions.md` "GitHub free plan — branch protection via local hooks + CI" (2026-05-16).

---

## Definition of done

A unit of work is "done" only when (CLAUDE.md §25):

- Code merged to main via PR with at least one approval
- All CI checks green (typecheck, lint, unit, integration, RLS, e2e smoke)
- New env vars documented in `.env.example` with comments
- Migrations applied to staging and verified
- User-visible changes logged in `CHANGES.md`
- For new financial logic: hand-verified against spreadsheet math
- For new payment flow: tested in EPS sandbox with at least one success and one failure
- For new RLS policy: cross-tenant negative test green
- Logs structured, no `console.log` in source
- Documentation updated in `docs/`

---

## Contact

Project owner: **Moshiur Rahman**, Public Pulse Agency / TiCON System Limited.

- Sales / partnerships / press → public site contact form
- Security disclosures → `security@eventpulse.com.bd` (72-hour response SLA)
- Code of Conduct concerns → `conduct@eventpulse.com.bd`
- Legal enquiries → `legal@eventpulse.com.bd`

**Confidentiality.** Private repository. Do not redistribute source, schema, infrastructure scripts, or memory files outside the authorised contributor list.

---

© 2026 Event Pulse. All rights reserved.
