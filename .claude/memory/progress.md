# Event Pulse — Progress

## In flight

**Sprint 2 (Days 11-20) — KYC pipeline + Trust Center scaffolding** (planned; awaiting Moshiur approval before Day 11 starts)

- 2026-05-17 — **Day 11-12: Foundation re-baseline** — CLAUDE.md v2.2 PR (auth-library swap, SSM-only / 30GB-EBS / explicit-staging-DNS clarifications to §17, BYPASSRLS gotcha codified into §4 role-hierarchy guidance). RLS migration 0003 (`app.current_user_id` + `withUser()` helper) for user-scoped tables. OAuth callback routes (Google + Apple) — start + callback + state cookie + auto-link by verified email. Real staging deploy via `deploy.sh` against a built artefact for the first time.
- 2026-05-17 — **Day 13-15: KYC pipeline** — `eventpulse-kyc-staging` S3 + KMS bucket (CHECKPOINT #2 before creation). `kyc_submissions` table + RLS. Signed-URL upload API + zod schema. Submission state machine + audit-log + notification firing. eTIN regex. BFIU sanctions list seeded at `infra/compliance/sanctions.json` (CHECKPOINT #5 before any matching code).
- 2026-05-17 — **Day 16-18: KYC UI (tenant + admin)** — post-login Account-Type modal, KYC wizard (individual + org variants), super admin review queue with manual NID fields + approve/reject (CHECKPOINT #4 default: super admin only).
- 2026-05-17 — **Day 19: Trust Center scaffolding** — `legal_documents` + `legal_document_versions` tables. v0.1 PLACEHOLDER content for all 18 pages with "DRAFT — not yet legally reviewed" banner (CHECKPOINT #3 before any v1.0 content). Super admin Legal & Trust editor with version control.
- 2026-05-17 — **Day 20: Porichoy adapter scaffold + sprint closeout** — interface + env vars + Secrets Manager entry + TODO + gotchas entry (CHECKPOINT #1 immediately before: procurement status check). Tenant subdomain provisioning logic. `kyc_approved` + `kyc_rejected` bilingual SES templates. Sprint 2 retro + `v0.2.0-sprint-2` tag.

**Carry-over from Sprint 1 (folded into Day 11-12 work):**

- OAuth callback route handlers (lazy `arctic` clients exist; routes need wiring)
- SES `tenant_welcome`, `verify_email`, `auth_password_reset` templates (pair with onboarding UI)
- RLS migration 0003 unblocking `users` / `sessions` / `magic_links` / `oauth_identities` / `handle_history` via `app.current_user_id` + `withUser()` helper
- CLAUDE.md bump to v2.2 (auth-library swap, SSM-only/30GB EBS/explicit-staging-DNS, BYPASSRLS gotcha → §4 amendment)
- Real staging app deploy via `deploy.sh` (script exists, never run against a built artefact)
- Pre-push hook fix to allow tag pushes from `main` (gotchas.md)

**Open procurement items (per Sprint 2 kick-off decision):**

- Porichoy API credentials — Moshiur reports service unreachable; revisit before Day 19-20
- SES out-of-sandbox response from AWS Support — submitted; awaiting case ID + decision
- EPS sandbox credentials for the Sprint 2 §24.4 escalation-ladder "EPS sandbox happy-path test"
- SSL Wireless API access (Sprint 3+)
- Cloudflare for SaaS account (Sprint 3+)
- bKash B2C disbursement API access (Sprint 3+)

## Done

### Sprint 1 — MVP Foundation (released as `v0.1.0-sprint-1`, commit `53ae000`)

- 2026-05-17 — **Sprint 1 closeout** — 14 stale Sprint 1 issues (#21-#34) closed against their merged PRs. Tag `v0.1.0-sprint-1` pushed on commit `53ae000` with release notes covering shipped scope, surface area, carries, and retro highlights. GitHub release published (prerelease, per v0.x.y semantics). Five-checkpoint amendment for Sprint 2 logged. Porichoy deferral logged. Pre-push hook tag-blocking gotcha logged.
- 2026-05-17 — **Sprint 1 Day 9-10: SES + PM2 + deploy scripts** — SES domain identity for `eventpulse.com.bd` created in ap-southeast-1 with easyDKIM (RSA 2048); 3 DKIM CNAMEs + SPF + DMARC added to Route 53 zone `Z003493917KJX7VCR8ZMR`; SES verification SUCCESS within ~15 min. SES SDK client wrapper (`apps/api/src/infra/ses/client.ts`) with MAIL_DRY_RUN=1 mode for tests. Bilingual magic-link transactional template wired into `/magic-link/request`. PM2 ecosystem.config.cjs (web :3000 + api :4000, fork mode). `infra/deploy/deploy.sh` (fetch→install→build→migrate→pm2 reload→healthcheck→auto-rollback) + `rollback.sh`, both executable, triggered via SSM SendCommand. 5 new template unit tests. **PR #49 merged (commit `f41f9e0`).** Plus PR #51 (`53ae000`) — slash commands installed + SES sandbox-exit request submitted via `aws sesv2 put-account-details`.
- 2026-05-17 — **Sprint 1 Day 7-8: auth foundation** — hash.ts (argon2id), tokens.ts (256-bit random + SHA-256), sessions.ts, magic-link.ts (15-min TTL, single-use, /24 IP-bound), jwt.ts (HS256, 15-min access + 7-day refresh), oauth.ts (lazy Google + Apple arctic clients), middleware.ts (3 require* + optional), users.ts (CRUD). Hono routes at `/api/v1/auth`: signup/login/magic-link request+consume/logout. Library choice decision logged: rolled our own (Lucia in maintenance). 38 unit + 7 integration tests. **PR #47 merged (commit `7f7707e`).**
- 2026-05-17 — **Sprint 1 Day 5-6: identity schema + RLS** — 11 Drizzle tables (`users`, `tenants` with v2.1 `is_personal`+`owner_user_id`, `oauth_identities`, `magic_links`, `super_admins`, `tenant_users`, `sessions`, `tenant_fee_config` defaulted to pass_through/25 bps, `fee_override_log`, `reserved_handles`, `handle_history`), 2 SQL migrations, `withTenant()` SETs LOCAL ROLE `eventpulse_app` (non-superuser, RLS engages), `withSuperAdmin()` SETs LOCAL ROLE `eventpulse_admin` (BYPASSRLS), hand-rolled idempotent migration runner, 13 schema unit tests + 11 RLS cross-tenant integration tests (CI green against PG 16 service). **PR #43 merged (commit `ddffd96`).**
- 2026-05-17 — **Sprint 1 Day 3-4: EC2 + Route 53 + TLS** — full stack provisioned: KMS CMK `alias/eventpulse-staging` (rotation on), IAM role + instance profile + scoped policies (`AmazonSSMManagedInstanceCore` + custom app inline + scoped ACME route53), S3 ssm-logs bucket (KMS + 90d lifecycle + TLS+KMS bucket policy), CW Logs group (KMS + 90d retention), SSM-SessionManagerRunShell document, SG `sg-0f4fd53e848eda1f9` (80/443 v4+v6 only, no port 22), Elastic IP `18.141.7.246`, EC2 `i-02e4fddeb923c14f9` (Ubuntu noble, t3.small, 30GB gp3 KMS-encrypted, IMDSv2 required, instance profile attached, SSM Online), 5 staging A records in zone `Z003493917KJX7VCR8ZMR`, full software stack (Node 22.22.2 + pnpm 9.15.9 + pm2 7.0.1 + PG 16.14 cluster `eventpulse_staging` + Redis 8.6.3 + Nginx 1.24 + certbot 5.6 + CWA + fail2ban), Nginx vhost serving placeholder + healthcheck + HTTP-to-HTTPS redirect, Let's Encrypt TLS cert (5 SANs, ECDSA E7, valid through 2026-08-15) — all 5 hostnames respond HTTPS 200. AWS Budget `eventpulse-monthly` $40/mo with 50%/80%/forecast-100% email alerts to `moshiur@publicpulse.com.bd`. **PR #42 merged (commit `61fb2b4`).**
- 2026-05-16 — **Sprint 1 Day 1-2: Design system + sign-in screen** — §1.5 palette as Tailwind 4 `@theme` tokens; glass component classes; gradient mesh with motion + reduced-motion fallback; primitives in `components/ui/`; static `/sign-in` exercising the four entry points per §19.2. (commit `1b45b16`)
- 2026-05-16 — **Sprint 1 Day 1-2: Monorepo scaffold** — Turborepo + pnpm workspaces, tsconfig presets, prettier, vitest, playwright. 5 packages (`@eventpulse/web`, `api`, `shared-utils`, `shared-types`, `tsconfig`). All typecheck green, 8/8 tests pass. (commit `1b45b16`)
- 2026-05-16 — **Repo bootstrap** — git init, CLAUDE.md (playbook v2.0), `.claude/` rules + memory seed, README, .gitignore (commit `6a89a29`)
- 2026-05-16 — **Resolve §14.1 vs §9.12 fee-mode contradiction** — schema default changed to `pass_through` (commit `82ab55a`)
- 2026-05-16 — **GitHub wiring (Sprint 1 sub-task)** — remote `publicpulseagency/EventPulse` (private), `main` + `prod` branches pushed (commits `6a89a29`/`82ab55a`/`1b45b16`/`21dad2c`); 5 workflows (ci/deploy-staging/deploy-prod/commitlint/release); 4 issue templates + config.yml; PR template with DoD checklist; CODEOWNERS; dependabot.yml; SECURITY.md / LICENSE / CONTRIBUTING.md / CODE_OF_CONDUCT.md; README badges; 3 environments (bare); 7 secret placeholders + 2 deploy-gate variables; wiki disabled; Dependabot alerts + automated security updates enabled; 15 labels (`sprint-1`, `phase-1`, `subsystem:*`, `estimate:*`, `day-*`); **16 Sprint 1 issues** (#19–#34) created; all closed against their respective merged PRs at sprint closeout. Decision logged: "GitHub workflow established". (commit `21dad2c` + memory commit)

## Blocked

- 2026-05-16 — **Branch protection on `main`/`prod`** — GitHub Free cannot apply branch protection to private repos. See `gotchas.md`. Re-enable as soon as the account is on GitHub Pro or converted to an Organisation with the Team plan.
- 2026-05-16 — **Environment reviewers + deployment-branch policies** on `staging`/`production`/`production-approval` — same Free-plan limitation. Environments exist as bare shells; workflows still reference them syntactically. Re-enable when plan flips.
- 2026-05-16 — **GitHub Project v2 "Event Pulse Roadmap"** — `gh` CLI token lacks `project,read:project` scopes. User must run `gh auth refresh -s project,read:project` once; then Claude Code creates the project + 4 custom fields + adds Sprint 2 issues.
- 2026-05-16 — **Secret scanning + push protection + code scanning** — require GitHub Advanced Security (paid) on private repos. Wiki + Dependabot alerts/updates ARE on. AdvSec adds the rest when plan upgrades.
- 2026-05-16 — **CODEOWNERS team validation** — `@publicpulseagency/eventpulse-core` references a team that doesn't exist until the user-→-org conversion completes. CODEOWNERS still parses, just doesn't enforce code-owner reviews.
- 2026-05-17 — **Porichoy live NID validation** — service unreachable, procurement timeline unclear. Adapter scaffolded as Day 20 of Sprint 2; live calls deferred to a dedicated PR when credentials arrive. See decisions.md 2026-05-17 "Porichoy deferred".
- 2026-05-17 — **SES out-of-sandbox** — request submitted via `aws sesv2 put-account-details`; awaiting AWS Support case ID + decision. Until approved, prod sends to non-verified addresses bounce.
