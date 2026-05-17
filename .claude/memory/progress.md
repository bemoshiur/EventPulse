# Event Pulse — Progress

## In flight

- 2026-05-17 — **12-hour autonomy mandate (Moshiur AFK)** — full authority granted to push Sprint 1 Day 3-4 → Day 10 work, with the hard guardrail of a single AWS EC2 instance and no monthly bill creep beyond ~$22 for staging. Decision logged ("12-hour autonomy mandate + AWS cost ceiling"). STOP-ASK gates 2 + 3 + 4 auto-approved under the mandate; gate 4's mailbox-reachable check resolved by using `moshiur@publicpulse.com.bd` for LE registration (the `security@eventpulse.com.bd` mailbox doesn't exist yet).
- 2026-05-17 — **Sprint 1 Day 5-6 (next)** — branch `feat/day-5-6-identity-schema`. Drizzle identity tables per v2.1 schema (§9.1 + §9.14 + §9.15); RLS policies template + tests; reserved-handles seed; cross-tenant negative tests.
- 2026-05-16 — **7 slash commands** — blocked, message content was `[paste …]` placeholder; awaiting actual command bodies from Moshiur

**Sprint 1 Day 5-6 schema scope (v2.1 expanded):**
The identity-table issue (#24) now includes the v2.1 schema additions per CLAUDE.md §9.1 / §9.3 / §9.14 / §9.15:

- `users.handle` (citext UNIQUE) + `users.handle_chosen_at`
- `tenants.is_personal` + `tenants.owner_user_id`
- `events.is_listed_publicly`
- New tables: `reserved_handles`, `handle_history`, `event_reports`
- Seed data: `apps/api/scripts/seed-reserved-handles.ts` populates the reserved list

This affects the migration size; the cross-tenant RLS test plan (#27) must extend to cover the new tables (`event_reports` is tenant-scoped; `reserved_handles` is global so no RLS needed; `handle_history` is user-scoped).

## Done

- 2026-05-16 — **Repo bootstrap** — git init, CLAUDE.md (playbook v2.0), `.claude/` rules + memory seed, README, .gitignore (commit `6a89a29`)
- 2026-05-16 — **Resolve §14.1 vs §9.12 fee-mode contradiction** — schema default changed to `pass_through` (commit `82ab55a`)
- 2026-05-16 — **Sprint 1 Day 1-2: Monorepo scaffold** — Turborepo + pnpm workspaces, tsconfig presets, prettier, vitest, playwright. 5 packages (`@eventpulse/web`, `api`, `shared-utils`, `shared-types`, `tsconfig`). All typecheck green, 8/8 tests pass. (commit `1b45b16`)
- 2026-05-16 — **Sprint 1 Day 1-2: Design system + sign-in screen** — §1.5 palette as Tailwind 4 `@theme` tokens; glass component classes; gradient mesh with motion + reduced-motion fallback; primitives in `components/ui/`; static `/sign-in` exercising the four entry points per §19.2. (commit `1b45b16`)
- 2026-05-17 — **Sprint 1 Day 3-4: EC2 + Route 53 + TLS** — full stack provisioned: KMS CMK `alias/eventpulse-staging` (rotation on), IAM role + instance profile + scoped policies (`AmazonSSMManagedInstanceCore` + custom app inline + scoped ACME route53), S3 ssm-logs bucket (KMS + 90d lifecycle + TLS+KMS bucket policy), CW Logs group (KMS + 90d retention), SSM-SessionManagerRunShell document, SG `sg-0f4fd53e848eda1f9` (80/443 v4+v6 only, no port 22), Elastic IP `18.141.7.246`, EC2 `i-02e4fddeb923c14f9` (Ubuntu noble, t3.small, 30GB gp3 KMS-encrypted, IMDSv2 required, instance profile attached, SSM Online), 5 staging A records in zone `Z003493917KJX7VCR8ZMR`, full software stack (Node 22.22.2 + pnpm 9.15.9 + pm2 7.0.1 + PG 16.14 cluster `eventpulse_staging` + Redis 8.6.3 + Nginx 1.24 + certbot 5.6 + CWA + fail2ban), Nginx vhost serving placeholder + healthcheck + HTTP-to-HTTPS redirect, Let's Encrypt TLS cert (5 SANs, ECDSA E7, valid through 2026-08-15) — all 5 hostnames respond HTTPS 200. AWS Budget `eventpulse-monthly` $40/mo with 50%/80%/forecast-100% email alerts to `moshiur@publicpulse.com.bd`. Branch `feat/day-3-4-ec2-route53` pushed to origin; PR to be opened next.
- 2026-05-16 — **GitHub wiring (Sprint 1 sub-task)** — remote `publicpulseagency/EventPulse` (private), `main` + `prod` branches pushed (commits `6a89a29`/`82ab55a`/`1b45b16`/`21dad2c`); 5 workflows (ci/deploy-staging/deploy-prod/commitlint/release); 4 issue templates + config.yml; PR template with DoD checklist; CODEOWNERS; dependabot.yml; SECURITY.md / LICENSE / CONTRIBUTING.md / CODE_OF_CONDUCT.md; README badges; 3 environments (bare); 7 secret placeholders + 2 deploy-gate variables; wiki disabled; Dependabot alerts + automated security updates enabled; 15 labels (`sprint-1`, `phase-1`, `subsystem:*`, `estimate:*`, `day-*`); **16 Sprint 1 issues** (#19–#34) created; #19 and #20 closed against `1b45b16`. Decision logged: "GitHub workflow established". (commit `21dad2c` + memory commit)

## Blocked

- 2026-05-16 — **Branch protection on `main`/`prod`** — GitHub Free cannot apply branch protection to private repos. See `gotchas.md`. Re-enable as soon as the account is on GitHub Pro or converted to an Organisation with the Team plan.
- 2026-05-16 — **Environment reviewers + deployment-branch policies** on `staging`/`production`/`production-approval` — same Free-plan limitation. Environments exist as bare shells; workflows still reference them syntactically. Re-enable when plan flips.
- 2026-05-16 — **GitHub Project v2 "Event Pulse Roadmap"** — `gh` CLI token lacks `project,read:project` scopes. User must run `gh auth refresh -s project,read:project` once; then Claude Code creates the project + 4 custom fields + adds the 16 Sprint 1 issues.
- 2026-05-16 — **Secret scanning + push protection + code scanning** — require GitHub Advanced Security (paid) on private repos. Wiki + Dependabot alerts/updates ARE on. AdvSec adds the rest when plan upgrades.
- 2026-05-16 — **CODEOWNERS team validation** — `@publicpulseagency/eventpulse-core` references a team that doesn't exist until the user-→-org conversion completes. CODEOWNERS still parses, just doesn't enforce code-owner reviews.
