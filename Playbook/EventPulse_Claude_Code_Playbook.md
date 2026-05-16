# Event Pulse — Claude Code Mega Playbook

> **One prompt. Bootstrap to production.**
> Version 2.0 · 16 May 2026
> Author: Moshiur Rahman / Public Pulse Agency / TiCON System Limited

---

## §-1 — Changelog

**v2.0 — 16 May 2026 (major)**
- **Deployment** simplified to single AWS EC2 + Route 53 for MVP; migration path to multi-instance and managed services documented in §17.12
- **Auth** expanded: email/password, magic link, Google OAuth, Apple OAuth — all four from day one (§5.2)
- **Design system** rewritten: modern multi-colour palette, glassmorphism utilities, gradient mesh backgrounds, motion principles (§1.5 + §19)
- **Settlement engine** fully specified with two explicit fee modes (Absorb / Pass-Through), per-tenant dynamic fee override managed from super admin, and a dedicated revenue dashboard (§14)
- **Trust Center** added: 6 legal contracts (Privacy, Terms, EULA, DPA, Cookies, Refunds) and 12 trust artefacts (Security, Sub-processors, Vulnerability Disclosure, SLA, AUP, Anti-Bribery, AI Policy, BD Compliance, GDPR, Accessibility, Transparency, Retention) — §20
- **Legal positioning** as a SaaS platform: Event Pulse provides space and tooling only; hosts are fully liable for their events. Bangladesh-law mapped (DSA 2018, ICT Act 2006, BTRC) — §21
- **Contact** and **Changelog** as first-class routes — §22
- **Schema** additions: `oauth_identities`, `magic_links`, `legal_documents`, `legal_document_versions`, `consent_records`, `changelog_entries`, `contact_submissions`, `tenant_fee_config`, `fee_override_log` (§9.11 + §9.12)
- Section numbering shifted: PART I, J, K renamed to J, K, L; new PART I houses Design, Legal & Public Surfaces (§19–§22)

**v1.0 — 16 May 2026 (initial)**
- Initial playbook for Phase 1 MVP through Phase 4 platform

---

## §0 — How to Use This Playbook

This is a single self-contained document. You have three ways to use it:

**Mode A — Paste-as-prompt (fastest start, single session).**
Open Claude Code in your empty `eventpulse` repo and paste this entire document as the first message. Claude Code will index it and begin work. Best for the first session when you want to scaffold the project.

**Mode B — Save as CLAUDE.md (recommended for ongoing use).**
Save this whole file as `CLAUDE.md` in your project root. It will load at the start of every Claude Code session. Long, but acceptable — Claude Code handles large CLAUDE.md files; the alternative is more setup. Pair this with selective `/clear` between major tasks to keep the working context clean.

**Mode C — Split into lean CLAUDE.md + docs/ (best for long-lived projects).**
Keep §1 through §3 as `CLAUDE.md` (lean constitution, < 200 lines), and split §4 onwards into separate files under `docs/`. Reference them in CLAUDE.md using `@docs/database-schema.md`, `@docs/api-spec.md`, etc. Claude Code will pull these in on demand. This is the "Shopify-grade" setup — clean context, fast loading, modular maintenance. Instructions for splitting are in §30.

Whichever mode you pick, the **Kick-Off Prompt** at the bottom (§27) is the first thing to send Claude Code once the playbook is loaded.

---

# PART A — PROJECT CONSTITUTION

## §1 — Mission, Stack, and Working Agreement

### 1.1 The Mission

We are building **Event Pulse** — a multi-tenant SaaS ticketing and event registration platform for Bangladesh, at `eventpulse.com.bd`. Tenants (organisations and individuals) create branded event landing pages, design custom registration forms with drag-and-drop, accept payments via EPS, and receive automated T+5 disbursements. The platform earns 0.25% on every paid transaction. EPS gateway fees are pass-through (configurable per event).

Three portals share one codebase:
- **Tenant Portal** at `app.eventpulse.com.bd` — organisers manage events
- **Super Admin Portal** at `admin.eventpulse.com.bd` — platform operators
- **Public Event Pages** at `eventpulse.com.bd/{tenant}/{event}`, `{tenant}.eventpulse.com.bd/{event}`, or any tenant-connected custom domain

We follow the Shopify model: tenants own the brand surface end-to-end, including their own domains and (paid add-on) full white-label.

### 1.2 Tech Stack — LOCKED

These decisions are final. Do not propose alternatives without asking.

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Language | TypeScript | 5.4+ | `strict: true`, no implicit any |
| Runtime | Node.js | 22 LTS | Both frontend SSR and backend |
| Frontend framework | Next.js | 15 (App Router) | RSC enabled, SSR for landing pages |
| UI library | shadcn/ui + Tailwind | latest | Custom design tokens (see §1.5) |
| Animation | Framer Motion | latest | Page transitions, glass card hover, gradient mesh animation |
| Icons | lucide-react | latest | Single icon system across all surfaces |
| State (client) | Zustand for UI, TanStack Query for server state | latest | No Redux |
| Forms | react-hook-form + zod | latest | Both builder UI and rendered forms |
| Drag-and-drop | dnd-kit | latest | Form builder + landing page builder |
| Backend framework | Hono | latest | Runs as a Node process on EC2, fronted by Nginx |
| Reverse proxy | Nginx | latest stable | TLS termination, static caching, subdomain routing |
| Process manager | PM2 | latest | Manages Node processes, log rotation, restart on crash |
| Database | PostgreSQL | 16 | Self-hosted on the same EC2 (MVP). Migration path to RDS in §17.12 |
| Migrations | drizzle-kit | latest | Schema-first |
| ORM | Drizzle ORM | latest | Lightweight, type-safe |
| Cache | Redis | 7 | Self-hosted on the same EC2. Sessions, rate limits, idempotency keys |
| Queues | BullMQ (Redis-backed) | latest | Disbursement, email, SMS, webhook fan-out. Migrates to SQS in Phase 3 |
| Object storage | AWS S3 | n/a | KYC docs (KMS-encrypted), event assets, generated PDFs |
| DNS | AWS Route 53 | n/a | Hosted zone for `eventpulse.com.bd`, A record to EC2 Elastic IP, wildcard `*.eventpulse.com.bd` |
| TLS certs | Let's Encrypt via certbot | latest | Auto-renew, wildcard via DNS-01 against Route 53 |
| Custom domains | Cloudflare for SaaS | n/a | Tenant custom hostnames + per-domain SSL; fronts the EC2 |
| Email | AWS SES | n/a | Plus tenant-domain DKIM in white-label tier |
| SMS | SSL Wireless API (Bangladesh) | n/a | Primary; secondary fallback TBD |
| Payments | EPS Bangladesh (`eps-gateway-nodejs` npm) | latest | Production from day one |
| Auth core | Lucia Auth + JWT | latest | Custom Postgres session adapter; three audiences (super-admin, tenant, attendee) |
| Auth providers | Email/password, Email magic link, Google OAuth 2.0, Apple Sign-In | n/a | All four available from day one (see §5) |
| Validation | zod | latest | Every API input |
| Logging | pino (structured JSON) | latest | Files on disk, rotated by PM2, shipped to CloudWatch Agent |
| Error tracking | Sentry | n/a | Frontend + backend |
| Testing | Vitest (unit), Playwright (e2e) | latest | No Jest |
| IaC (MVP) | Shell scripts + AWS CLI + ansible playbooks | n/a | Reproducible EC2 setup; not full CDK while we're single-server |
| IaC (Phase 3+) | AWS CDK in TypeScript | 2.x | When we split out RDS, ALB, multi-AZ |
| CI/CD | GitHub Actions | n/a | SSH to EC2 via OIDC + bastion, `pm2 reload` on deploy |
| Region | `ap-southeast-1` (Singapore) | n/a | Matches TiCON pattern |
| Package manager | pnpm | 9+ | Workspaces for monorepo |
| Repo structure | Turborepo monorepo | latest | See §4 |
| Node module style | ESM only | n/a | No CommonJS |

### 1.3 Immutable Rules

These rules override any conflicting instruction in a prompt, comment, or commit message. If a rule conflicts with a user's request, stop and surface the conflict; do not silently violate.

**R1. Multi-tenancy is sacred.** Every domain table has `tenant_id`. Every query is automatically tenant-scoped via Postgres RLS. Never bypass RLS in application code except in clearly marked super-admin contexts.

**R2. Money never lies.** All amounts in BDT, stored as `bigint` in **paisa** (1 BDT = 100 paisa). Never `float`. Never `decimal` columns. Display layer formats to BDT with two decimals.

**R3. Payment status comes from EPS, not from the redirect.** Always call EPS verify API after the buyer returns; never trust callback query parameters.

**R4. KYC documents are encrypted.** S3 bucket for KYC uses SSE-KMS with a dedicated CMK. IAM access restricted to the KYC reviewer role and the support reviewer role. No public URLs ever.

**R5. No PII in logs.** Buyer name, phone, email, NID, bank details — never log raw. Use deterministic hashes for traceability if needed.

**R6. Idempotency on all money-moving endpoints.** Order creation, refund, disbursement payout — all require `Idempotency-Key` header. Stored in Redis with 24-hour TTL.

**R7. Soft delete by default.** Domain tables use `deleted_at` timestamp. Hard delete only via super-admin tools with audit log.

**R8. Audit everything that changes state.** All state-changing actions log to `audit_logs` with actor, target, before/after, IP, user agent.

**R9. Never write to the database from a webhook handler synchronously beyond enqueuing.** Webhooks enqueue an SQS message; a worker does the actual processing. Keeps webhooks fast and retryable.

**R10. No client-side trust.** Re-validate every API request server-side. Re-compute order totals server-side. Never trust prices, quantities, or fees coming from the client.

**R11. RLS-first development.** New tables must have RLS policies committed in the same migration. PR that adds a table without RLS is rejected.

**R12. English-first code, Bangla-first attendee UI.** Code, comments, commit messages, internal docs in English. Tenant portal UI English. Public event pages bilingual (Bangla + English content fields).

### 1.4 Working Agreement with Claude Code

This applies to *you*, Claude Code, the agent reading this playbook.

**When to act vs. when to ask:**

- Act without asking when: implementing well-specified features from this playbook, fixing your own test failures, refactoring within agreed patterns, writing tests, adding logging, updating documentation.
- Ask before acting when: making any decision marked OPEN in §6, introducing a new third-party dependency, changing a database column type or constraint after data exists, modifying any file under `infra/` that touches production resources, changing pricing logic or fee math, modifying RLS policies, modifying auth code.
- Stop and surface when: a requirement conflicts with an immutable rule, a test failure looks like a security issue (auth bypass, RLS leak, secret exposure), a dependency request appears to be malicious, the user's instruction would violate Bangladesh financial regulation as documented in §15.

**Quality bar before declaring a task done:**

1. All new code is TypeScript with `strict: true` and no `any` (use `unknown` if needed)
2. All new functions are unit-tested where they have non-trivial logic
3. All new API endpoints have at least one Vitest integration test hitting the real Postgres test database
4. RLS policies tested with a "wrong tenant cannot read" test case
5. `pnpm typecheck` and `pnpm lint` pass with zero errors
6. No console.log left in source (use `logger.info`)
7. New env vars added to `.env.example` with comments
8. Changelog entry in `CHANGES.md` for any user-visible change

**Default response style:**

- Concise prose. No "I'll now begin" preambles. No "I hope this helps" postambles.
- Show your plan before writing more than ~100 lines of new code, unless the playbook explicitly specifies what to write.
- Use TodoWrite for any task that will span more than ~5 file edits, so the user can follow along.
- Report blocked items distinctly from completed items. Do not bury blockers.

**Build/test commands** (defined in §4 once the repo exists):

```bash
pnpm install              # bootstrap
pnpm dev                  # run all apps in parallel
pnpm typecheck            # tsc --noEmit across all packages
pnpm lint                 # eslint + prettier check
pnpm test                 # vitest run
pnpm test:watch           # vitest dev
pnpm test:e2e             # playwright
pnpm db:migrate           # apply drizzle migrations
pnpm db:generate          # generate migration from schema diff
pnpm db:seed              # seed local dev data
pnpm build                # turbo build all packages
pnpm deploy:staging       # cdk deploy --profile eventpulse-staging
pnpm deploy:prod          # cdk deploy --profile eventpulse-prod
```

### 1.5 Design System — Modern, Multi-Colour, Glassmorphism, Gradient Mesh

The Event Pulse visual identity rejects flat corporate dashboards. It is **vibrant, layered, and tactile** — built around a multi-colour palette, glassmorphism cards over a slow-moving gradient mesh, and motion that signals life rather than transitions. The same vocabulary is used across all three portals (tenant, admin, public) so brand memory accumulates.

**Core palette — emotion before utility:**

```css
/* Foundation */
--ep-ink:        #0B0B14;   /* deepest text, headings */
--ep-graphite:   #2A2A36;   /* body text */
--ep-mist:       #F6F5FB;   /* page background, mesh base */
--ep-paper:      #FFFFFF;   /* card surfaces */
--ep-line:       #E4E2EE;   /* hairlines, dividers */

/* Brand spectrum — five accents that compose the gradient mesh */
--ep-violet:     #6C4FE0;   /* primary brand */
--ep-indigo:     #4A5BFF;   /* secondary brand */
--ep-cerulean:   #2DA8FF;   /* info, focus */
--ep-mint:       #19C39A;   /* success, payment confirmed */
--ep-coral:      #FF6F61;   /* CTA highlight, energy */
--ep-amber:      #FFB547;   /* warning, pending */
--ep-rose:       #FF4D7E;   /* error, refund, attention */

/* Semantic */
--ep-success:    var(--ep-mint);
--ep-warning:    var(--ep-amber);
--ep-error:      var(--ep-rose);
--ep-info:       var(--ep-cerulean);
--ep-primary:    var(--ep-violet);

/* Gradient stops used in the mesh and CTAs */
--ep-grad-1:     linear-gradient(135deg, #6C4FE0 0%, #2DA8FF 100%);
--ep-grad-2:     linear-gradient(135deg, #FF6F61 0%, #FF4D7E 100%);
--ep-grad-3:     linear-gradient(135deg, #19C39A 0%, #2DA8FF 100%);
--ep-grad-4:     linear-gradient(135deg, #FFB547 0%, #FF6F61 100%);
--ep-grad-hero:  radial-gradient(at 0% 0%, rgba(108,79,224,0.35) 0%, transparent 50%),
                 radial-gradient(at 100% 0%, rgba(45,168,255,0.30) 0%, transparent 50%),
                 radial-gradient(at 100% 100%, rgba(255,111,97,0.25) 0%, transparent 50%),
                 radial-gradient(at 0% 100%, rgba(25,195,154,0.25) 0%, transparent 50%);
```

**Glassmorphism utilities — exposed as Tailwind component classes:**

```css
/* tailwind.config — extend with these utility recipes */
.glass {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 1px 1px rgba(255, 255, 255, 0.8) inset,
    0 12px 40px -8px rgba(20, 18, 60, 0.15);
}
.glass-dark {
  background: rgba(20, 18, 40, 0.55);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--ep-mist);
}
.glass-strong { /* for elevated modals */
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 20px 60px -10px rgba(20, 18, 60, 0.25);
}
```

**Gradient mesh background — a `<canvas>` or fixed-position div behind every authenticated portal:**

A slowly-animated mesh of four radial gradients drifting on a sine curve over 30–60s loops. Falls back to a static SVG mesh for `prefers-reduced-motion: reduce`. Implementation lives in `apps/web/src/components/ui/gradient-mesh.tsx`.

**Typography:**

- **Display & headings:** Geist Sans (variable, 100–900) — clean modern grotesque
- **Body:** Inter (variable) — legibility workhorse
- **Bangla:** Hind Siliguri (paired with both above for bilingual surfaces)
- **Mono:** JetBrains Mono — for codes, QR fallbacks, transaction IDs

**Type scale (Tailwind tokens):**

```
text-xs   12 / 18    captions, badges
text-sm   14 / 22    secondary body
text-base 16 / 26    body
text-lg   18 / 28    lead paragraph
text-xl   20 / 30    card titles
text-2xl  24 / 34    section headers
text-3xl  32 / 40    page headers
text-4xl  44 / 52    hero on tenant dashboard
text-5xl  56 / 64    hero on landing pages
text-6xl  72 / 80    marketing hero
```

**Spacing rhythm:**

Stick to a 4-px grid. Card padding `p-6` (24px) by default, `p-8` (32px) for elevated. Sections `py-16` to `py-24` on marketing pages. Form fields gap `gap-4`.

**Border radius:**

- `rounded-md` 8px — buttons, inputs
- `rounded-lg` 12px — small cards, badges
- `rounded-2xl` 16px — primary cards (glass)
- `rounded-3xl` 24px — hero panels, modals
- `rounded-full` — avatars, status pills

**Motion principles:**

- Default ease: `cubic-bezier(0.2, 0.8, 0.2, 1)` — feels confident, not rubbery
- Default duration: 200ms for hover, 320ms for layout transitions, 600ms for hero entrance
- Cards lift `-translate-y-0.5` and gain shadow on hover
- Page transitions: fade + 4px translate; no big slides
- Skeleton loaders pulse at 1.6s — never spinners
- All animations respect `prefers-reduced-motion`

**Component design principles:**

1. **Cards are glass over mesh.** Never solid white over flat. The mesh provides visual depth so the card content can stay calm.
2. **One bold accent per screen.** A surface uses violet OR coral OR mint as its primary accent, not all three. Multi-colour is for the platform, not for a single page.
3. **Gradients earn their place.** Used for primary CTAs, success badges, hero panels — not for decoration. A page with five gradient elements is a failed page.
4. **Numbers get scale.** Stats, GMV, attendee counts use display sizes (text-3xl+) with thin weights, not body sizes.
5. **Bangla is first-class.** When bilingual, Bangla and English share visual hierarchy. Bangla never feels tacked on.
6. **Dark mode is not optional.** Both light and dark are designed deliberately. The mesh inverts; glass goes `glass-dark`.

### 1.6 Onboarding Principles

Sign-up friction kills SaaS adoption. The first run is designed for **under 90 seconds from landing to logged-in dashboard**, with KYC deferred until the first event is published.

- Single screen sign-up with three buttons (Continue with Google · Continue with Apple · Continue with email), plus a "Sign in instead" link
- Email path uses **magic link by default**, password as optional secondary auth method (set later in settings)
- No mandatory fields beyond email at first step
- Account type (Organisation / Individual) chosen on first dashboard load via a friendly modal, not at sign-up
- KYC gated only when the tenant tries to publish their first paid event
- Empty-state dashboards always show one clear next action ("Create your first event") with a worked example available behind a "Show me how" toggle

---

# PART B — PRODUCT SPECIFICATION

## §2 — Users, Surfaces, and Scope

### 2.1 User Types

| Type | Auth Context | Surface |
|---|---|---|
| Super Admin | `super-admin` JWT | `admin.eventpulse.com.bd` |
| Tenant Owner / Admin / Editor / Scanner / Finance | `tenant` JWT (scoped to tenant_id) | `app.eventpulse.com.bd` |
| Attendee (guest checkout, MVP) | none, just session token tied to order | event landing pages |
| Attendee (account, Phase 3) | `attendee` JWT | event landing pages + `my.eventpulse.com.bd` |

### 2.2 Tenant Roles (RBAC)

- **Owner** — full access, billing, irreversible actions (delete tenant)
- **Admin** — operational full access, no billing
- **Editor** — event creation/edit, no financial data, no team management
- **Scanner** — check-in only, no other access
- **Finance** — read-only financial reports + disbursement view

Permissions table in §5.4.

### 2.3 Tenant Onboarding Flow

```
Sign up
  → Choose type (Organisation / Individual)
  → Verify email (OTP link)
  → Verify mobile (OTP)
  → Select KYC tier (auto-suggested based on type)
  → Upload documents
  → Submit
  → KYC team review
  → Approved: enable event creation, provision tenant subdomain
  → Rejected: notify with reason, allow resubmit
```

See §10 for full KYC engine specification.

### 2.4 Event Lifecycle

```
Draft → Published → On Sale → Sold Out (optional) → Live → Completed → Archived
```

Per-state allowed actions and transitions are codified in `apps/api/src/domain/event-state-machine.ts`.

### 2.5 Order Lifecycle

```
Pending → Awaiting Payment → Paid → Completed
         ↘ Cancelled
         ↘ Failed
Paid → Refund Requested → Refunded (partial / full)
Paid → Disputed → Chargeback → Reversed
```

Each transition writes to `order_events` (event sourcing trail for orders specifically).

### 2.6 Scope by Phase

**Phase 1 (MVP, 8 weeks):**
- Auth (super admin, tenant), tenant onboarding with Light KYC for individuals and Tier A KYC for orgs
- Event CRUD with **fixed form template per event type** (no builder yet)
- Single landing page template with brand customisation (logo, colour, banner image, copy fields)
- Ticket tiers (multiple) with capacity and sales window
- EPS hosted checkout
- QR ticket generation and email delivery
- Attendee CRM (search, filter, export CSV)
- Web QR scanner for check-in
- Tenant sales dashboard
- Super admin KYC review queue
- Manual disbursement (admin generates payout, no automation)
- Refunds (admin-triggered only)

**Phase 2 (8 weeks):**
- Drag-and-drop form builder
- Landing page builder (5 templates)
- Coupon codes, group discounts
- Conditional form logic, per-tier form variations
- Automated T+5 disbursement engine
- Super admin financial reconciliation dashboard
- Tenant team management, RBAC
- SMS notifications
- Bulk messaging
- Per-event refund policies
- KYC Tier 2 (individual) + Tier B (org)
- Custom domains (free for KYC-verified tenants, no white-label yet)

**Phase 3 (12 weeks):**
- White-label add-on (footer removal, branded emails, branded PDFs, optional branded SMS sender)
- Email campaigns
- Attendee accounts ("find my tickets")
- Apple/Google Wallet passes
- Mobile check-in app (React Native)
- Discovery page, search
- Multi-session events (conferences)
- Recurring events
- Waitlist

**Phase 4 (12 weeks):**
- Marketplace discovery + recommendations
- Fraud-detection ML
- Alternative payment gateways (bKash, SSLCommerz adapters)
- White-label enterprise tier (custom contracts)
- Public API + webhooks for enterprise tenants
- Data warehouse + BI

---

# PART C — REPOSITORY AND CODE LAYOUT

## §3 — Monorepo Structure

```
eventpulse/
├── apps/
│   ├── web/                   # Next.js 15 app: tenant portal + super admin + public event pages
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (public)/        # Event landing pages, marketing site
│   │   │   │   │   ├── [tenant]/[event]/page.tsx
│   │   │   │   │   └── page.tsx     # eventpulse.com.bd marketing home
│   │   │   │   ├── (tenant)/        # Tenant portal — app.eventpulse.com.bd
│   │   │   │   │   ├── dashboard/
│   │   │   │   │   ├── events/
│   │   │   │   │   ├── attendees/
│   │   │   │   │   ├── disbursements/
│   │   │   │   │   ├── team/
│   │   │   │   │   ├── settings/
│   │   │   │   │   └── kyc/
│   │   │   │   ├── (admin)/         # Super admin portal — admin.eventpulse.com.bd
│   │   │   │   │   ├── tenants/
│   │   │   │   │   ├── kyc-queue/
│   │   │   │   │   ├── disbursements/
│   │   │   │   │   ├── reconciliation/
│   │   │   │   │   └── reports/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/
│   │   │   │   │   ├── signup/
│   │   │   │   │   └── verify/
│   │   │   │   ├── api/             # Next.js API routes (proxy to Hono, or auth-only)
│   │   │   │   └── layout.tsx
│   │   │   ├── components/          # shadcn/ui + custom
│   │   │   │   ├── ui/              # shadcn primitives
│   │   │   │   ├── form-builder/    # drag-and-drop form builder
│   │   │   │   ├── landing-builder/ # landing page builder
│   │   │   │   ├── tenant/          # tenant portal components
│   │   │   │   ├── admin/           # admin portal components
│   │   │   │   └── public/          # public event page sections
│   │   │   ├── lib/                 # client + server utilities
│   │   │   ├── hooks/
│   │   │   ├── styles/
│   │   │   └── middleware.ts        # routing for subdomains and custom domains
│   │   ├── public/
│   │   ├── next.config.mjs
│   │   └── package.json
│   │
│   ├── api/                   # Hono backend deployed to AWS Lambda
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── public/          # no auth: event pages, order creation
│   │   │   │   ├── tenant/          # tenant JWT
│   │   │   │   ├── admin/           # super admin JWT
│   │   │   │   └── webhooks/        # EPS, SMS, etc.
│   │   │   ├── domain/              # business logic
│   │   │   │   ├── orders/
│   │   │   │   ├── events/
│   │   │   │   ├── kyc/
│   │   │   │   ├── payments/
│   │   │   │   ├── disbursements/
│   │   │   │   └── tenants/
│   │   │   ├── infra/               # adapters: EPS, SES, SMS, S3, Cloudflare
│   │   │   │   ├── eps/
│   │   │   │   ├── ses/
│   │   │   │   ├── sms/
│   │   │   │   ├── s3/
│   │   │   │   └── cloudflare-saas/
│   │   │   ├── middleware/          # auth, RLS, logging, rate limit
│   │   │   ├── db/
│   │   │   │   ├── schema.ts        # Drizzle schema
│   │   │   │   ├── migrations/
│   │   │   │   └── client.ts
│   │   │   ├── lib/
│   │   │   ├── workers/             # SQS-triggered Lambda handlers
│   │   │   │   ├── disbursement-batch.ts
│   │   │   │   ├── send-email.ts
│   │   │   │   ├── send-sms.ts
│   │   │   │   ├── process-eps-webhook.ts
│   │   │   │   └── generate-pdf-ticket.ts
│   │   │   └── index.ts             # Hono app entrypoint
│   │   └── package.json
│   │
│   └── scanner-mobile/        # Phase 3: React Native check-in app
│
├── packages/
│   ├── shared-types/          # zod schemas, shared types
│   ├── shared-utils/          # currency, date, BD-specific helpers
│   ├── form-engine/           # JSON-schema → rendered form (used by both builder and runtime)
│   ├── landing-engine/        # JSON-schema → rendered landing page
│   ├── eslint-config/
│   └── tsconfig/
│
├── infra/                     # AWS CDK
│   ├── lib/
│   │   ├── network-stack.ts
│   │   ├── data-stack.ts
│   │   ├── api-stack.ts
│   │   ├── web-stack.ts
│   │   ├── workers-stack.ts
│   │   └── monitoring-stack.ts
│   ├── bin/
│   │   └── eventpulse.ts
│   └── package.json
│
├── docs/                      # Project documentation (split CLAUDE.md content lives here)
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-staging.yml
│       └── deploy-prod.yml
├── .claude/
│   └── rules/                 # Optional: split CLAUDE.md rules into focused files
├── CLAUDE.md                  # Project memory for Claude Code
├── CHANGES.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

### 3.1 Naming Conventions

- **Files**: kebab-case (`order-state-machine.ts`)
- **React components**: PascalCase file names matching the export (`EventCard.tsx`)
- **Types/Interfaces**: PascalCase (`OrderStatus`, `EventDraft`)
- **Constants**: SCREAMING_SNAKE_CASE
- **Database tables**: snake_case plural (`order_events`)
- **Database columns**: snake_case (`tenant_id`, `created_at`)
- **API routes**: kebab-case plural (`/api/v1/events`, `/api/v1/order-events`)
- **Env vars**: `EVENTPULSE_*` prefix for app, `EPS_*` for EPS, `AWS_*` for AWS

### 3.2 Module Boundaries

- `apps/web` imports from `packages/*`, never from `apps/api`
- `apps/api` imports from `packages/*`, never from `apps/web`
- `packages/*` never import from `apps/*`
- Shared types live in `packages/shared-types`. If a type is used by both frontend and backend, it goes there.

---

# PART D — ARCHITECTURE AND PATTERNS

## §4 — Multi-Tenancy

### 4.1 Strategy: Row-Level with PostgreSQL RLS

Every domain table has `tenant_id uuid not null references tenants(id)`. Postgres RLS enforces isolation. The application sets a session variable `app.current_tenant_id` at the start of each request based on the authenticated JWT's tenant claim.

### 4.2 Connection Pattern

```typescript
// apps/api/src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: NodePgDatabase) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_tenant_id', tenantId,
    ])
    const db = drizzle(client)
    return await fn(db)
  } finally {
    client.release()
  }
}

export async function withSuperAdmin<T>(
  fn: (tx: NodePgDatabase) => Promise<T>
): Promise<T> {
  // Run as a Postgres role that bypasses RLS (eventpulse_admin)
  const client = await pool.connect()
  try {
    await client.query('SET LOCAL ROLE eventpulse_admin')
    const db = drizzle(client)
    return await fn(db)
  } finally {
    client.release()
  }
}
```

### 4.3 RLS Policy Template

For every domain table:

```sql
CREATE POLICY "tenant_isolation_select" ON {table}
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON {table}
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON {table}
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON {table}
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
```

The `eventpulse_admin` role uses `BYPASSRLS` for super admin operations.

### 4.4 RLS Test Pattern (Required for Every New Table)

```typescript
test('order cannot be read by another tenant', async () => {
  const tenantA = await createTestTenant()
  const tenantB = await createTestTenant()
  const order = await withTenant(tenantA.id, db =>
    db.insert(orders).values({ ... }).returning()
  )

  await expect(
    withTenant(tenantB.id, db =>
      db.select().from(orders).where(eq(orders.id, order.id))
    )
  ).resolves.toHaveLength(0)
})
```

## §5 — Authentication and Authorisation

### 5.1 Three Auth Contexts

| Context | Audience | Token | Storage |
|---|---|---|---|
| `super-admin` | Platform staff | JWT with `aud: super-admin` | HttpOnly cookie on `admin.eventpulse.com.bd` |
| `tenant` | Tenant team members | JWT with `aud: tenant`, `tenant_id`, `role` | HttpOnly cookie on `app.eventpulse.com.bd` |
| `attendee` (Phase 3) | Ticket buyers with accounts | JWT with `aud: attendee` | HttpOnly cookie on `my.eventpulse.com.bd` |

Tokens: 15-minute access + 7-day refresh, rotated on refresh.

### 5.2 Sign-Up and Sign-In — Four Methods, One Funnel

All four methods feed into the same `users` row. Linking is automatic when the verified email matches an existing account.

**Email + password.** Argon2id hashed. Rate-limited 5 attempts / 15 min / (email + IP). Optional TOTP MFA.

**Email magic link.** Default for new sign-ups. One-time token, 15-minute TTL, single-use, bound to the requesting IP's `/24` for low friction without sacrificing safety. Implemented with Lucia's one-time-token primitive plus our `magic_links` table.

**Google OAuth 2.0.** OIDC flow via `arctic` (Lucia's OAuth helper library). Scopes: `openid email profile`. Stores Google `sub` in `oauth_identities`. Required env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

**Apple Sign-In.** OIDC flow via `arctic` with Apple's specific JWT-based client_secret minted from the team's private key. Apple's name field is only sent on first auth — we capture it. Required env: `APPLE_OAUTH_CLIENT_ID` (Services ID), `APPLE_OAUTH_TEAM_ID`, `APPLE_OAUTH_KEY_ID`, `APPLE_OAUTH_PRIVATE_KEY` (PEM, multi-line via Secrets Manager).

**Account linking rules:**
- A user can have multiple OAuth identities + a password on the same account
- If an OAuth flow returns a verified email matching an existing user, link automatically (no merge prompt)
- A user without a password can set one from Settings → Security; this does not remove their OAuth links
- Two-factor: TOTP available regardless of sign-in method

**Rate limits & abuse controls:**
- Sign-up: 3 / hour / IP
- Magic link send: 5 / hour / email
- OAuth callback: 10 / hour / IP
- Login: 5 / 15 min / (email + IP)

### 5.3 Session Adapter

Lucia Auth with a custom Postgres adapter using the `sessions` table:

```sql
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  audience text NOT NULL CHECK (audience IN ('super-admin','tenant','attendee')),
  tenant_id uuid REFERENCES tenants(id),  -- null for super-admin and attendee
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 5.4 RBAC Permissions Matrix (Tenant Context)

| Action | Owner | Admin | Editor | Scanner | Finance |
|---|---|---|---|---|---|
| Create / edit events | ✓ | ✓ | ✓ | — | — |
| Delete events | ✓ | ✓ | — | — | — |
| View attendees | ✓ | ✓ | ✓ | ✓ | — |
| Check-in attendees | ✓ | ✓ | ✓ | ✓ | — |
| View financial reports | ✓ | ✓ | — | — | ✓ |
| Trigger refund | ✓ | ✓ | — | — | — |
| Manage team | ✓ | ✓ | — | — | — |
| Manage billing | ✓ | — | — | — | — |
| Connect custom domain | ✓ | ✓ | — | — | — |
| KYC management | ✓ | — | — | — | — |
| Delete tenant | ✓ | — | — | — | — |

## §6 — API Patterns

### 6.1 Hono Route Pattern

```typescript
// apps/api/src/routes/tenant/events.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireTenantAuth } from '../../middleware/auth'
import { createEvent, listEvents } from '../../domain/events'

const app = new Hono()

app.use('*', requireTenantAuth)

const createEventSchema = z.object({
  type: z.enum(['concert','alumni','standup','conference','workshop','community','sports','other']),
  title: z.string().min(3).max(120),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  venue: z.object({...}),
  capacity: z.number().int().positive().optional(),
  visibility: z.enum(['public','unlisted','private']).default('public'),
})

app.post('/', zValidator('json', createEventSchema), async (c) => {
  const input = c.req.valid('json')
  const tenant = c.get('tenant')
  const event = await createEvent(tenant.id, input, c.get('user').id)
  return c.json({ data: event }, 201)
})

app.get('/', async (c) => {
  const tenant = c.get('tenant')
  const query = c.req.query()
  const result = await listEvents(tenant.id, query)
  return c.json({ data: result.items, meta: result.meta })
})

export default app
```

### 6.2 Response Envelope

```typescript
// Success
{ "data": <payload>, "meta"?: { ... } }

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",       // SCREAMING_SNAKE_CASE machine code
    "message": "Human-readable message",
    "details"?: [{ field: "title", message: "..." }],
    "request_id": "req_abc123"
  }
}
```

### 6.3 Error Codes (Canonical List)

`VALIDATION_ERROR`, `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `EPS_INIT_FAILED`, `EPS_VERIFY_FAILED`, `KYC_NOT_APPROVED`, `EVENT_SOLD_OUT`, `TIER_SOLD_OUT`, `EVENT_NOT_ON_SALE`, `REFUND_WINDOW_CLOSED`, `INTERNAL_ERROR`.

### 6.4 Idempotency

For money-moving endpoints (`POST /orders`, `POST /refunds`, `POST /disbursements/payout`):

```
Header: Idempotency-Key: <client-generated UUID>
```

Server stores key → response in Redis for 24 hours. Repeated request with same key returns cached response.

### 6.5 Pagination

Cursor-based for all list endpoints:

```
GET /tenant/events?limit=20&cursor=<opaque>
→ { data: [...], meta: { next_cursor: "abc123", has_more: true } }
```

Cursor is base64 of `{id, sort_value}` — never exposed as offset.

### 6.6 Versioning

All endpoints prefixed `/api/v1`. New breaking changes go to `/api/v2`. Until then, additive only.

## §7 — Frontend Patterns

### 7.1 App Router Conventions

- One route group per portal: `(public)`, `(tenant)`, `(admin)`, `(auth)`
- Route group layouts handle auth gating
- Loading and error boundaries at every route segment
- Use `generateMetadata` for SEO on public pages

### 7.2 Server vs Client Components

- Default: server components
- Mark client only when you need: state, refs, event handlers, browser APIs, third-party browser libraries
- Form builder, landing page builder: client-only (interactive editing)
- Public event landing pages: server-rendered for SEO; client islands for ticket selector, form submission

### 7.3 Data Fetching

- Server components: direct service-layer calls via internal RPC (`apps/api` deployed alongside, called via fetch with internal token) OR direct DB access if running in the same Lambda
- Client components: TanStack Query against `/api/v1/*` REST endpoints
- Mutations: TanStack Query `useMutation` + optimistic updates where safe

### 7.4 Form Handling

```typescript
const form = useForm<z.infer<typeof createEventSchema>>({
  resolver: zodResolver(createEventSchema),
  defaultValues: { ... }
})
```

### 7.5 Routing for Custom Domains

`apps/web/src/middleware.ts` reads the `Host` header and rewrites:

```typescript
// pseudo
if (host === 'eventpulse.com.bd') → marketing site
if (host === 'app.eventpulse.com.bd') → tenant portal (require tenant auth)
if (host === 'admin.eventpulse.com.bd') → super admin (require super admin auth)
if (host endsWith '.eventpulse.com.bd') {
  const subdomain = host.split('.')[0]
  → rewrite to /(public)/_tenant/[tenant=subdomain]/...
}
if (custom domain lookup hits) {
  → rewrite to /(public)/_tenant/[tenant=lookedUpTenantSlug]/...
}
```

The lookup uses a Redis-cached `custom_domains` table query.

## §8 — Error Handling and Logging

### 8.1 Structured Logging (pino)

```typescript
import { logger } from '@/lib/logger'

logger.info({
  request_id: c.get('requestId'),
  tenant_id: tenant.id,
  user_id: user.id,
  event_id: event.id,
  action: 'event.published',
  duration_ms: 234,
}, 'event published')
```

Never put raw PII. For traceability, use deterministic hashes:

```typescript
const buyerHash = createHash('sha256').update(buyerEmail + SALT).digest('hex').slice(0, 16)
```

### 8.2 Sentry Integration

- Frontend: `@sentry/nextjs` with source maps
- Backend: `@sentry/node`, breadcrumbs for DB queries and external calls
- Scrub PII before sending (configured in Sentry init)

### 8.3 Error Boundary

Server-side: every Hono route is wrapped with an error middleware that converts thrown errors into the standard error envelope.

```typescript
app.onError((err, c) => {
  const requestId = c.get('requestId')
  logger.error({ err, request_id: requestId }, 'unhandled error')
  Sentry.captureException(err, { tags: { request_id: requestId } })

  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, request_id: requestId } }, err.status)
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', request_id: requestId } }, 500)
})
```

---

# PART E — DATABASE SCHEMA

## §9 — Complete Schema (Phase 1 + Phase 2)

This is the authoritative starting schema. Generate Drizzle definitions matching this DDL. Every domain table has RLS policies and audit triggers.

### 9.1 Identity and Tenancy

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('organisation','individual')),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_kyc'
    CHECK (status IN ('pending_kyc','active','suspended','terminated')),
  kyc_tier text NOT NULL DEFAULT 'tier_1'
    CHECK (kyc_tier IN ('tier_1','tier_2','tier_3','org_a','org_b','org_c')),
  kyc_status text NOT NULL DEFAULT 'not_submitted'
    CHECK (kyc_status IN ('not_submitted','submitted','under_review','approved','rejected')),
  fee_override_bps integer,
  brand_logo_url text,
  brand_color_primary text,
  brand_color_accent text,
  monthly_gmv_paisa bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  phone text,
  full_name text NOT NULL,
  password_hash text,                    -- nullable: OAuth-only users may have no password
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret text,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  avatar_url text,
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE oauth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('google','apple')),
  provider_user_id text NOT NULL,
  email citext,
  raw_profile jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE magic_links (
  token_hash text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  email citext NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup','signin','email_change')),
  ip_prefix inet,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_links_email ON magic_links(email, expires_at);

CREATE TABLE super_admins (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','editor','scanner','finance')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  audience text NOT NULL CHECK (audience IN ('super-admin','tenant','attendee')),
  tenant_id uuid REFERENCES tenants(id),
  ip inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.2 KYC

```sql
CREATE TABLE kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  submission_type text NOT NULL CHECK (submission_type IN ('individual','organisation')),
  tier_requested text NOT NULL,
  documents jsonb NOT NULL,
  fields jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','approved','rejected')),
  reviewer_id uuid REFERENCES users(id),
  decision_reason text,
  decided_at timestamptz,
  nid_verified boolean NOT NULL DEFAULT false,
  porichoy_verification_id text,
  bank_name_match boolean NOT NULL DEFAULT false,
  bfiu_screened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_status ON kyc_submissions(status, created_at);
```

### 9.3 Events and Tickets

```sql
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug citext NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','on_sale','sold_out','live','completed','archived')),
  visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public','unlisted','private')),
  title text NOT NULL,
  title_bn text,
  description text,
  description_bn text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  venue jsonb NOT NULL,
  capacity integer,
  banner_image_url text,
  og_image_url text,
  primary_domain_id uuid REFERENCES custom_domains(id),
  eps_fee_handling text NOT NULL DEFAULT 'pass_through'
    CHECK (eps_fee_handling IN ('absorb','pass_through')),
  platform_fee_handling text NOT NULL DEFAULT 'pass_through'
    CHECK (platform_fee_handling IN ('absorb','pass_through')),
  refund_policy jsonb NOT NULL DEFAULT '{"allowed":false}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_events_tenant_status ON events(tenant_id, status, starts_at);
CREATE INDEX idx_events_starts_at ON events(starts_at) WHERE status IN ('published','on_sale','live');

CREATE TABLE ticket_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL,
  description text,
  price_paisa bigint NOT NULL CHECK (price_paisa >= 0),
  capacity integer NOT NULL CHECK (capacity > 0),
  sold integer NOT NULL DEFAULT 0,
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  min_per_order integer NOT NULL DEFAULT 1,
  max_per_order integer NOT NULL DEFAULT 10,
  is_complimentary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_event ON ticket_tiers(event_id);
```

### 9.4 Forms and Landing Pages

```sql
CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid NOT NULL REFERENCES events(id) UNIQUE,
  version integer NOT NULL DEFAULT 1,
  schema jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid NOT NULL REFERENCES events(id) UNIQUE,
  version integer NOT NULL DEFAULT 1,
  schema jsonb NOT NULL,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.5 Orders, Attendees, Refunds

```sql
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid NOT NULL REFERENCES events(id),
  merchant_transaction_id text NOT NULL UNIQUE,
  buyer_name text NOT NULL,
  buyer_email citext NOT NULL,
  buyer_phone text NOT NULL,
  buyer_nid_last4 text,
  subtotal_paisa bigint NOT NULL,
  eps_fee_paisa bigint NOT NULL DEFAULT 0,
  platform_fee_paisa bigint NOT NULL,
  withholding_tax_paisa bigint NOT NULL DEFAULT 0,
  total_paisa bigint NOT NULL,
  net_to_organiser_paisa bigint NOT NULL,
  currency text NOT NULL DEFAULT 'BDT',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_payment','paid','completed','cancelled','failed','refund_requested','refunded','disputed','chargeback','reversed')),
  eps_transaction_id text,
  eps_payment_method text,
  eps_verified_at timestamptz,
  ip inet,
  user_agent text,
  utm jsonb,
  idempotency_key text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status, created_at);
CREATE INDEX idx_orders_event ON orders(event_id, status, created_at);
CREATE INDEX idx_orders_eps_txn ON orders(eps_transaction_id);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  ticket_tier_id uuid NOT NULL REFERENCES ticket_tiers(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_paisa bigint NOT NULL,
  subtotal_paisa bigint NOT NULL
);

CREATE TABLE attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  ticket_tier_id uuid NOT NULL REFERENCES ticket_tiers(id),
  attendee_name text NOT NULL,
  attendee_email citext,
  attendee_phone text,
  submission_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  qr_code text NOT NULL UNIQUE,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES users(id),
  checked_in_gate text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendees_event ON attendees(tenant_id, order_id);
CREATE INDEX idx_attendees_qr ON attendees(qr_code);

CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  amount_paisa bigint NOT NULL CHECK (amount_paisa > 0),
  reason text NOT NULL,
  initiated_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','processed','failed')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.6 Coupons

```sql
CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid REFERENCES events(id),
  code citext NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed_paisa')),
  discount_value bigint NOT NULL CHECK (discount_value > 0),
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  applies_to_tier_ids uuid[],
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id, code)
);
```

### 9.7 Disbursements

```sql
CREATE TABLE disbursement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_paisa bigint NOT NULL DEFAULT 0,
  platform_fee_paisa bigint NOT NULL DEFAULT 0,
  eps_fee_paisa bigint NOT NULL DEFAULT 0,
  refunds_paisa bigint NOT NULL DEFAULT 0,
  withholding_tax_paisa bigint NOT NULL DEFAULT 0,
  net_paisa bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','processing','paid','failed','on_hold')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  payout_method text CHECK (payout_method IN ('bank_beftn','bkash','nagad','rocket','upay','manual')),
  payout_reference text,
  payout_account_snapshot jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_disbursements_status ON disbursement_batches(status, created_at);

CREATE TABLE disbursement_batch_orders (
  batch_id uuid NOT NULL REFERENCES disbursement_batches(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  PRIMARY KEY (batch_id, order_id)
);

CREATE TABLE tenant_payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_type text NOT NULL CHECK (account_type IN ('bank','bkash','nagad','rocket','upay')),
  account_name text NOT NULL,
  account_number text NOT NULL,
  bank_name text,
  branch_name text,
  routing_number text,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.8 EPS Reconciliation

```sql
CREATE TABLE eps_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_date date NOT NULL,
  eps_reference text NOT NULL UNIQUE,
  amount_paisa bigint NOT NULL,
  fee_paisa bigint NOT NULL,
  net_paisa bigint NOT NULL,
  transaction_count integer NOT NULL,
  reconciliation_status text NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending','matched','partial','mismatch')),
  raw_report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.9 Custom Domains and White-Label

```sql
CREATE TABLE custom_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  domain citext NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('tenant_wide','event_specific')),
  pinned_event_id uuid REFERENCES events(id),
  status text NOT NULL DEFAULT 'pending_dns'
    CHECK (status IN ('pending_dns','verifying','provisioning_ssl','active','failed','expired')),
  is_primary boolean NOT NULL DEFAULT false,
  ssl_provider text NOT NULL DEFAULT 'cloudflare_saas',
  cloudflare_hostname_id text,
  ssl_activated_at timestamptz,
  ssl_expires_at timestamptz,
  dns_verified_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_domains_tenant ON custom_domains(tenant_id);
CREATE INDEX idx_custom_domains_status ON custom_domains(status);

CREATE TABLE white_label_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  enabled boolean NOT NULL DEFAULT false,
  email_sender_domain text,
  email_sender_local text DEFAULT 'tickets',
  email_dkim_verified boolean NOT NULL DEFAULT false,
  email_spf_verified boolean NOT NULL DEFAULT false,
  email_dmarc_verified boolean NOT NULL DEFAULT false,
  sms_sender_id text,
  remove_footer boolean NOT NULL DEFAULT false,
  white_label_pdf boolean NOT NULL DEFAULT false,
  white_label_emails boolean NOT NULL DEFAULT false,
  subscription_active boolean NOT NULL DEFAULT false,
  subscription_renews_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.10 Notifications and Logs

```sql
CREATE TABLE notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('email','sms','in_app','push')),
  template_id text NOT NULL,
  recipient_hash text NOT NULL,
  provider text NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK (status IN ('queued','sent','delivered','bounced','failed')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user','tenant_user','super_admin','system','webhook')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  diff jsonb,
  metadata jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at);
```

### 9.11 Legal, Consent, Trust Center, Changelog

```sql
CREATE TABLE legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,            -- 'privacy', 'terms', 'eula', 'dpa', 'cookies', 'refund-policy'
  category text NOT NULL CHECK (category IN ('legal_contract','trust_artefact')),
  title text NOT NULL,
  one_liner text NOT NULL,              -- short description shown on Trust Center landing
  current_version_id uuid,              -- pointer to legal_document_versions.id
  requires_signature boolean NOT NULL DEFAULT false,  -- true for contracts, false for artefacts
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES legal_documents(id),
  version text NOT NULL,                -- semver-ish: "1.0.0", "1.1.0"
  effective_at timestamptz NOT NULL,
  body_md text NOT NULL,                -- full markdown content
  body_html text NOT NULL,              -- pre-rendered for fast serving
  summary_of_changes text,              -- for material-change notices
  material_change boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE INDEX idx_legal_versions_document ON legal_document_versions(document_id, effective_at DESC);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES legal_documents(id),
  version_id uuid NOT NULL REFERENCES legal_document_versions(id),
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  withdrawn_at timestamptz,
  UNIQUE (user_id, document_id, version_id)
);

CREATE INDEX idx_consent_user ON consent_records(user_id, consented_at);

CREATE TABLE changelog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,            -- '2026-05-16-launch'
  version text NOT NULL,                -- semver, e.g. '1.4.0'
  title text NOT NULL,
  body_md text NOT NULL,
  body_html text NOT NULL,
  category text NOT NULL CHECK (category IN ('feature','improvement','fix','breaking','security','deprecation')),
  audience text[] NOT NULL DEFAULT ARRAY['tenant','public']::text[],
  published_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_changelog_published ON changelog_entries(published_at DESC);

CREATE TABLE contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email citext NOT NULL,
  phone text,
  organisation text,
  subject text NOT NULL,
  message text NOT NULL,
  topic text CHECK (topic IN ('sales','support','legal','partnership','press','security','other')),
  ip inet,
  user_agent text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','responded','closed','spam')),
  assigned_to uuid REFERENCES users(id),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 9.12 Fee Configuration and Audit

```sql
-- Per-tenant fee overrides (super admin only)
CREATE TABLE tenant_fee_config (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  platform_fee_bps integer NOT NULL DEFAULT 25,    -- basis points: 25 = 0.25%
  default_fee_mode text NOT NULL DEFAULT 'absorb'
    CHECK (default_fee_mode IN ('absorb','pass_through')),
  allow_per_event_override boolean NOT NULL DEFAULT true,
  custom_arrangement_note text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit trail of every fee change for every tenant
CREATE TABLE fee_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  previous_fee_bps integer NOT NULL,
  new_fee_bps integer NOT NULL,
  previous_mode text NOT NULL,
  new_mode text NOT NULL,
  reason text NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fee_log_tenant ON fee_override_log(tenant_id, created_at DESC);
```

### 9.13 Apply RLS

Every domain table (everything with `tenant_id`) gets the policy template from §4.3. The seed migration must include these. `tenants` itself gets a slightly different policy: tenant users can read their own row (`id = current_setting('app.current_tenant_id')::uuid`).

---

# PART F — API SPECIFICATION

## §10 — Endpoint Catalogue

All endpoints prefixed with `/api/v1`. Request/response bodies use the envelope from §6.2.

### 10.1 Public (no auth)

```
GET  /public/events/:slug                    # for path-mode URLs
GET  /public/tenants/:tenantSlug/events/:eventSlug
POST /public/orders                          # idempotent, creates order + initiates EPS
GET  /public/orders/:id/status               # poll status post-redirect
POST /public/attendees/find                  # email + phone + OTP → reveal tickets
POST /public/attendees/checkin               # not directly public, called from scanner with scanner JWT
```

### 10.2 Tenant Auth

```
# Auth
POST   /tenant/auth/login
POST   /tenant/auth/refresh
POST   /tenant/auth/logout
POST   /tenant/auth/mfa/enable
POST   /tenant/auth/mfa/verify

# Tenant profile
GET    /tenant/profile
PATCH  /tenant/profile
GET    /tenant/brand
PATCH  /tenant/brand

# KYC
POST   /tenant/kyc/submit
GET    /tenant/kyc/status

# Events
GET    /tenant/events
POST   /tenant/events
GET    /tenant/events/:id
PATCH  /tenant/events/:id
DELETE /tenant/events/:id (soft)
POST   /tenant/events/:id/publish
POST   /tenant/events/:id/unpublish

# Tickets
GET    /tenant/events/:id/tickets
POST   /tenant/events/:id/tickets
PATCH  /tenant/events/:id/tickets/:tierId
DELETE /tenant/events/:id/tickets/:tierId

# Form
GET    /tenant/events/:id/form
PUT    /tenant/events/:id/form        # full schema upsert
POST   /tenant/events/:id/form/publish

# Landing page
GET    /tenant/events/:id/landing
PUT    /tenant/events/:id/landing
POST   /tenant/events/:id/landing/publish

# Coupons
GET    /tenant/events/:id/coupons
POST   /tenant/events/:id/coupons
PATCH  /tenant/coupons/:id
DELETE /tenant/coupons/:id

# Attendees
GET    /tenant/events/:id/attendees       # search, filter, paginate
GET    /tenant/attendees/:id
POST   /tenant/attendees/:id/resend-qr
POST   /tenant/attendees/:id/void
GET    /tenant/events/:id/attendees/export

# Check-in
POST   /tenant/events/:id/checkin         # body: { qr_code, gate }
GET    /tenant/events/:id/checkin/stats

# Reports
GET    /tenant/reports/sales
GET    /tenant/reports/funnel
GET    /tenant/reports/disbursement-summary

# Disbursements
GET    /tenant/disbursements
GET    /tenant/disbursements/:id
GET    /tenant/payout-accounts
POST   /tenant/payout-accounts
PATCH  /tenant/payout-accounts/:id

# Refunds
POST   /tenant/orders/:id/refund

# Team
GET    /tenant/team
POST   /tenant/team/invite
PATCH  /tenant/team/:userId
DELETE /tenant/team/:userId

# Custom domains
GET    /tenant/custom-domains
POST   /tenant/custom-domains             # initiate add
POST   /tenant/custom-domains/:id/verify
DELETE /tenant/custom-domains/:id
PATCH  /tenant/custom-domains/:id         # set primary, pin to event

# White-label
GET    /tenant/white-label
PATCH  /tenant/white-label
POST   /tenant/white-label/subscribe
POST   /tenant/white-label/cancel
POST   /tenant/white-label/email-domain/verify

# Communications
POST   /tenant/events/:id/bulk-message    # email + SMS to attendees
GET    /tenant/notification-log
```

### 10.3 Super Admin Auth

```
# Tenants
GET    /admin/tenants
GET    /admin/tenants/:id
PATCH  /admin/tenants/:id                 # suspend, activate
POST   /admin/tenants/:id/fee-override

# KYC review
GET    /admin/kyc-queue
GET    /admin/kyc-submissions/:id
POST   /admin/kyc-submissions/:id/approve
POST   /admin/kyc-submissions/:id/reject

# Disbursements
GET    /admin/disbursements/batches
GET    /admin/disbursements/batches/:id
POST   /admin/disbursements/generate-batches    # cron-triggered, also manual
POST   /admin/disbursements/batches/:id/approve
POST   /admin/disbursements/batches/:id/release
POST   /admin/disbursements/batches/:id/hold

# Reconciliation
GET    /admin/eps/settlements
POST   /admin/eps/settlements/import
GET    /admin/eps/reconciliation/:date

# Reports
GET    /admin/reports/gmv
GET    /admin/reports/revenue
GET    /admin/reports/cohorts

# Audit
GET    /admin/audit-logs

# Platform config
GET    /admin/config/fees
PATCH  /admin/config/fees
```

### 10.4 Webhooks

```
POST   /webhooks/eps/callback           # EPS server-to-server payment status
POST   /webhooks/cloudflare-saas/hostname-status   # custom domain SSL events
POST   /webhooks/ses/bounce
POST   /webhooks/ses/complaint
POST   /webhooks/sms/delivery
```

All webhook endpoints verify signature, enqueue to SQS, return 200 fast. Workers do actual processing.

---

# PART G — CRITICAL SUBSYSTEMS

## §11 — EPS Integration

### 11.1 Flow (Source of Truth)

```
1. Buyer hits POST /public/orders with { event_id, tier_selections, buyer_info, idempotency_key }
2. Server validates capacity, computes paisa amounts (subtotal, EPS fee, platform fee, total)
3. Server creates order in status 'pending', returns merchantTransactionId
4. Server calls EPS GetToken (cached short-term in Redis, keyed by hash of credentials)
5. Server calls EPS InitializeEPS, receives RedirectURL
6. Server updates order to 'awaiting_payment', returns RedirectURL to client
7. Client navigates to RedirectURL → EPS hosted checkout → buyer pays
8. EPS redirects to /public/orders/success?merchantTransactionId=...
9. Server receives redirect, calls EPS Verify API (NEVER trust query params)
10. Server matches status → updates order
   - SUCCESS/COMPLETED → status 'paid', generate QR for each attendee, enqueue email + SMS
   - FAILED/FAILURE → status 'failed'
   - CANCELLED/CANCEL → status 'cancelled'
11. Server also receives EPS server-to-server webhook in parallel; webhook handler also calls Verify and reconciles. Idempotency handled via merchantTransactionId.
```

### 11.2 Implementation Skeleton

```typescript
// apps/api/src/infra/eps/client.ts
import { EpsGateway } from 'eps-gateway-nodejs'

export const eps = new EpsGateway({
  merchantId: process.env.EPS_MERCHANT_ID!,
  storeId: process.env.EPS_STORE_ID!,
  username: process.env.EPS_USERNAME!,
  password: process.env.EPS_PASSWORD!,
  hashKey: process.env.EPS_HASH_KEY!,
  mode: (process.env.EPS_MODE ?? 'production') as 'production' | 'sandbox',
})

export async function initialiseOrder(order: Order): Promise<string> {
  const init = await eps.initializeEPS({
    merchantTransactionId: order.merchant_transaction_id,
    transactionTypeId: 1, // Web
    totalAmount: order.total_paisa / 100,
    successUrl: `${BASE_URL}/api/v1/public/orders/eps-return/success`,
    failUrl: `${BASE_URL}/api/v1/public/orders/eps-return/fail`,
    cancelUrl: `${BASE_URL}/api/v1/public/orders/eps-return/cancel`,
    customerName: order.buyer_name,
    customerEmail: order.buyer_email,
    customerMobile: order.buyer_phone,
    customerAddress: 'Bangladesh',
  })
  return init.RedirectURL
}

export async function verifyOrder(merchantTransactionId: string) {
  const result = await eps.checkMerchantTransactionStatus({ merchantTransactionId })
  // Handle field aliases: Status / transactionStatus / status / nested data.*
  // Values: SUCCESS, COMPLETED, FAILED, FAILURE, CANCEL, CANCELLED, CANCELED, Pending
  return normaliseStatus(result)
}
```

### 11.3 Required Env Vars

```
EPS_MERCHANT_ID=
EPS_STORE_ID=
EPS_USERNAME=
EPS_PASSWORD=
EPS_HASH_KEY=
EPS_MODE=production
EPS_SUCCESS_URL=https://app.eventpulse.com.bd/api/v1/public/orders/eps-return/success
EPS_FAIL_URL=https://app.eventpulse.com.bd/api/v1/public/orders/eps-return/fail
EPS_CANCEL_URL=https://app.eventpulse.com.bd/api/v1/public/orders/eps-return/cancel
```

### 11.4 Known Gotchas (DO NOT IGNORE)

- `401 Unauthorized` on InitializeEPS → JWT from GetToken expired; refetch
- `x-hash` rejected → hashed wrong field; per-endpoint hash mechanism differs:
  - `GetToken` hashes `userName`
  - `InitializeEPS` hashes `merchantTransactionId`
  - `CheckMerchantTransactionStatus` hashes `merchantTransactionId` OR `EPSTransactionId`
- `merchantTransactionId` must be globally unique per merchant, min 10 chars. Use `TXN-${timestamp}-${tenantSlugShort}-${random}`
- DB never updates after redirect → you skipped Verify. Always Verify.
- `transactionTypeId`: 1=Web, 2=Android, 3=iOS (ignore old "10" samples)
- Sandbox works, prod fails → check `EPS_MODE=production`, base URL is `pgapi.eps.com.bd` (no sandbox prefix), prod credentials loaded
- Refunds not in V5 public API → must be handled via EPS merchant dashboard, contact `integration@eps.com.bd`

### 11.5 Reconciliation

Daily job pulls EPS settlement report and matches against `orders` where `eps_verified_at` is within the settlement window. Discrepancies flagged in `admin/eps/reconciliation` dashboard.

## §12 — Custom Domains and White-Label

### 12.1 Architecture: Cloudflare for SaaS

1. Tenant adds custom hostname (`events.tenantbrand.com`) via tenant portal
2. Server calls Cloudflare SaaS API to create a custom hostname under the platform's parent zone
3. Server returns DNS instructions: tenant must add `CNAME events.tenantbrand.com → customers.eventpulse.com.bd`
4. Tenant adds CNAME, clicks "Verify" in portal
5. Server polls Cloudflare API for status; once verified, Cloudflare provisions SSL
6. On status webhook from Cloudflare, server marks `custom_domains.status = 'active'`
7. Edge routing: request arrives at Cloudflare → forwarded to platform origin → middleware in `apps/web` reads Host → looks up `custom_domains` table (Redis-cached) → rewrites to appropriate `(public)/[tenant]/[event]` route

### 12.2 Required Env Vars

```
CLOUDFLARE_SAAS_ACCOUNT_ID=
CLOUDFLARE_SAAS_API_TOKEN=
CLOUDFLARE_SAAS_ZONE_ID=
CLOUDFLARE_SAAS_FALLBACK_ORIGIN=customers.eventpulse.com.bd
```

### 12.3 White-Label Add-On (Phase 3)

Toggle in `white_label_settings`. Affects:
- Footer rendering on event pages (`Powered by Event Pulse` hidden)
- Email From address (verify DKIM via SES domain identity first)
- SMS sender ID (registered with SSL Wireless on tenant's behalf)
- PDF ticket header/footer (use tenant brand instead of platform)

## §13 — KYC Engine

### 13.1 Tier Flow

```
On signup:
  - Org: default kyc_tier='org_a', kyc_status='not_submitted'
  - Individual: default kyc_tier='tier_1', kyc_status='not_submitted'

On submit:
  - Validate required fields per tier
  - Upload documents to S3 (encrypted bucket, per-tenant prefix)
  - Run automated checks:
    - NID format
    - eTIN format (tier_2+)
    - Bank/MFS name match vs NID/org name
    - SIM-NID match via operator API (tier_2+)
    - BFIU sanctions list (tier_2+)
    - Porichoy NID validation
  - tier_1 + all checks pass → auto-approve, set status='active'
  - else → status 'under_review', enqueue to KYC review queue

On reviewer decision:
  - Approve → tenant.status='active', tenant.kyc_status='approved', provision tenant subdomain
  - Reject → tenant.kyc_status='rejected', notify tenant with reason, allow resubmit
```

### 13.2 Required Env Vars

```
POROCHOY_API_KEY=
POROCHOY_BASE_URL=https://api.porichoy.gov.bd
SSL_WIRELESS_SIM_NID_API_KEY=
BFIU_SANCTIONS_LIST_S3_URI=s3://eventpulse-compliance/bfiu/sanctions.json
KYC_DOCS_BUCKET=eventpulse-kyc-docs-prod
KYC_DOCS_KMS_KEY_ID=
```

### 13.3 Limits Enforcement

`tenants.monthly_gmv_paisa` is updated by a nightly job. Order creation checks against tier limit:

```
tier_1   → 50_00_000 paisa per event, 2_00_00_000 paisa per month   (BDT 50k / 2L)
tier_2   → 5_00_00_000, 20_00_00_000  (BDT 5L / 20L)
tier_3   → configurable
org_a    → 25_00_00_000 per month
org_b    → 1_00_00_00_000 per month
org_c    → unlimited (still BFIU-reportable)
```

If a new order would exceed the limit, return `error.code = 'KYC_LIMIT_EXCEEDED'`.

## §14 — Settlement and Disbursement Engine

This section specifies the **most operationally consequential subsystem** in Event Pulse. Money math, fee handling, and dynamic per-tenant overrides all live here. Read it carefully before touching any order, refund, or payout code.

### 14.1 The Two Fee Components

Every paid order has two fees layered on top of the **ticket face value**:

1. **Platform fee** — Event Pulse's revenue. Default **0.25%** (25 basis points). Per-tenant override via `tenant_fee_config.platform_fee_bps`. Editable by super admin only. Onboarding is always free; only paid transactions generate platform fee.
2. **EPS gateway fee** — Charged by EPS based on the payment method (card ≈ 2.5%, MFS ≈ 1.5–1.8%). Pass-through — we do not mark this up.

Each fee is handled independently per event via two settings on `events`:

- `platform_fee_handling`: `'absorb'` or `'pass_through'`
- `eps_fee_handling`: `'absorb'` or `'pass_through'`

`absorb` = organiser eats the fee (deducted from payout at settlement).
`pass_through` = buyer pays the fee on top (visible line item at checkout).

The tenant chooses these per event in the event wizard. The tenant's default for new events comes from `tenant_fee_config.default_fee_mode`. Both default to `pass_through` for new tenants.

### 14.2 Money Math — Authoritative Examples

Ticket face value: **BDT 1,000.00** (= 100,000 paisa). Platform fee: 0.25%. EPS fee: 2.5% (illustrative).

**Mode A — Both pass-through (default, most transparent for organiser):**

```
Buyer sees:
  Ticket             1,000.00
  Platform fee           2.50
  Payment fee           25.06
  Total              1,027.56

Organiser receives (at settlement):
  1,000.00  (full face value — both fees were passed to buyer)
```

**Mode B — Both absorb (cleanest UX for buyer):**

```
Buyer sees:
  Total              1,000.00

EPS captures 1,000.00; deducts 25.00 (their 2.5% on 1,000); platform settles 975.00 to our account.
Platform fee on face value: 2.50.

Organiser receives (at settlement):
  1,000.00 − 25.00 (EPS) − 2.50 (platform) = 972.50
```

**Mode C — Platform absorb, EPS pass-through:**

```
Buyer sees:
  Ticket             1,000.00
  Payment fee           25.06   (or 25.00 depending on which side)
  Total              1,025.06

EPS captures 1,025.06; settles 1,000.00 net (their fee already deducted by EPS).
Platform fee on face value: 2.50.

Organiser receives:
  1,000.00 − 2.50 = 997.50
```

**Mode D — Platform pass-through, EPS absorb:**

```
Buyer sees:
  Ticket             1,000.00
  Platform fee           2.50
  Total              1,002.50

EPS captures 1,002.50; their fee 2.5% on this = 25.06; they settle 977.44.
Platform fee already collected (2.50).

Organiser receives:
  977.44 − 2.50 = 974.94   (organiser still bears EPS fee on face value AND on the pass-through platform fee)
```

**Important note on Mode D:** when EPS fee is absorbed but platform fee is passed through, the EPS fee is charged on the **larger** captured amount (ticket + platform fee). This is documented behaviour, not a bug. The settlement engine reflects this precisely.

### 14.3 The Money Calculation Function — Single Source of Truth

All money math goes through one pure function in `apps/api/src/domain/payments/fee-calculator.ts`. **Never duplicate this math anywhere else.** If you need a number, call the function.

```typescript
export interface FeeCalcInput {
  ticketSubtotalPaisa: bigint        // sum of (tier price × quantity)
  platformFeeBps: number             // from tenant_fee_config (e.g. 25 for 0.25%)
  epsFeeBps: number                  // estimated from payment method, or actual post-EPS
  platformFeeHandling: 'absorb' | 'pass_through'
  epsFeeHandling: 'absorb' | 'pass_through'
}

export interface FeeCalcResult {
  subtotalPaisa: bigint              // ticket face total
  platformFeePaisa: bigint           // computed on subtotal
  epsFeePaisa: bigint                // computed on what EPS will capture
  buyerTotalPaisa: bigint            // what buyer pays at checkout
  organiserNetPaisa: bigint          // what organiser receives at settlement
  platformRevenuePaisa: bigint       // what platform retains
  breakdown: BreakdownLine[]         // for receipts and reports
}

export function calculateFees(input: FeeCalcInput): FeeCalcResult { /* deterministic */ }
```

This function is the **only** place fee math lives. Unit-tested with at least 12 cases covering every combination of `(absorb, pass_through) × (absorb, pass_through)` for several edge amounts (1 paisa, 1 BDT, very large BDT, free ticket coupon → 0).

### 14.4 Dynamic Per-Tenant Fee — Super Admin Workflow

Default fee = 25 bps (0.25%). Super admin can override per tenant via `admin/tenants/:id/fee-override`.

**UI surface** (in super admin portal):

- Tenant detail page shows current `platform_fee_bps`, `default_fee_mode`, last change, and the override history table
- "Adjust fee" modal: input new bps, mandatory reason, effective-from datetime picker
- Audit: every change writes a `fee_override_log` row with old + new values, the actor, the reason, and the effective timestamp

**Behaviour rules:**

- Fee changes are **not retroactive**. Orders paid before the new effective_from continue to use the old rate.
- The `fee-calculator` reads `tenant_fee_config` at order-creation time, snapshots the bps into the order, and never re-evaluates afterward. The order is immutable on fee.
- Tenant sees their current fee in their portal under Settings → Fees & Payouts. They cannot change it.
- Anomaly alert: a fee change of more than 10 bps in either direction triggers a notification to the super admin who didn't make the change (4-eyes principle for material changes).

### 14.5 The Settlement Cycle — T+5

**Daily cron** at 02:00 BDT (`apps/api/src/workers/settlement-cron.ts`):

```
For each active tenant:
  1. Find all paid orders where:
       paid_at <= now() - 5 days
       NOT already in a disbursement_batch
       NOT refund_requested / disputed / chargeback
  2. Find all refunds processed since the last batch (debits)
  3. Find all chargebacks reversed since the last batch (debits)
  4. Compute:
       gross         = sum of order.subtotal_paisa
       platform_fee  = sum of order.platform_fee_paisa
       eps_fee       = sum of order.eps_fee_paisa
       refunds       = sum of refund.amount_paisa
       withholding   = sum of order.withholding_tax_paisa
       net           = sum of order.net_to_organiser_paisa - refunds - withholding
  5. If net > 0:
       create disbursement_batch(status='pending_review')
       attach order ids and refund ids to it
       enqueue super admin notification
  6. If net <= 0 (organiser owes platform due to refunds > paid orders in window):
       carry-forward debit on tenant ledger; do not create payout
```

### 14.6 The Settlement Engine — Code Layout

```
apps/api/src/domain/settlement/
├── fee-calculator.ts             // §14.3 above — single source of truth
├── settlement-engine.ts          // batch builder, runs in cron + manual trigger
├── disbursement-state-machine.ts // pending_review → approved → processing → paid / failed / on_hold
├── payout-adapter/
│   ├── beftn.ts                  // BEFTN file generator for bank payouts
│   ├── bkash-b2c.ts              // bKash B2C disbursement API
│   ├── nagad-disbursement.ts
│   ├── rocket-disbursement.ts
│   └── manual.ts                 // CSV export for manual handling
├── reconciliation/
│   ├── eps-settlement-importer.ts // pulls EPS daily settlement report
│   ├── match.ts                   // matches platform orders ↔ EPS settlements
│   └── mismatch-handler.ts        // flags discrepancies for admin review
└── revenue-ledger.ts             // platform-side accounting: revenue, refunds, net
```

### 14.7 Super Admin Revenue Dashboard

A first-class screen at `/admin/revenue` showing:

**Header KPIs (live, last refreshed timestamp):**
- Today's GMV (BDT)
- Today's platform revenue (BDT)
- Today's transaction count
- Today's platform fee rate (weighted average across tenants)

**Time-series charts:**
- Daily GMV, last 30 days, stacked by event type
- Daily platform revenue, last 90 days
- Take-rate trend, last 90 days (platform revenue / GMV)

**Tenant leaderboards (this month):**
- Top 20 by GMV
- Top 20 by platform revenue contribution
- Top 20 by transaction count

**Settlement queue widget:**
- Batches pending review (count + total net BDT)
- Batches in processing (count + total)
- Batches paid this week (count + total)

**Anomaly cards:**
- Tenants with abnormal refund rates
- Tenants whose fee has been adjusted in last 7 days
- EPS reconciliation mismatches outstanding

**Revenue ledger view:**
- Drillable: platform revenue → by tenant → by event → by order
- Date range picker, CSV export, monthly PDF report (auto-generated for accounting)

**Tenant-side mirror dashboard** at `/tenant/payouts` shows the same data for that tenant only — with their `platform_fee_bps` clearly visible and a "What does this mean?" link to the relevant help article.

### 14.8 Payout Execution

When super admin approves a batch:

1. Batch moves to `processing`
2. Worker picks up the batch from BullMQ queue
3. Worker reads `tenant_payout_accounts` for the tenant's primary account
4. Worker calls the appropriate payout adapter:
   - **Bank**: generate BEFTN file (Phase 1: file downloaded by admin for manual bank upload; Phase 2: API integration where available)
   - **bKash**: bKash B2C disbursement API
   - **Nagad / Rocket / Upay**: respective APIs
5. Adapter returns: success + reference, or failure + reason
6. Success → batch `paid`, reference stored, tenant notified (email + SMS)
7. Failure → batch `failed`, reason stored, support gets alert, tenant notified to verify account details

### 14.9 Edge Cases (Handled, Not Hand-Waved)

- **Order refunded after batch created but before approval**: batch is recomputed and the refund's amount is deducted from `net_paisa` before payout
- **Order refunded after batch is paid**: refund creates a tenant ledger debit; next batch's net is reduced by that amount; if next batch is also < refund, debit carries forward
- **Chargeback after disbursement**: same debit-carry-forward mechanism
- **Tenant suspended mid-disbursement**: batch moves to `on_hold`; funds remain in platform settlement account; resolution requires super admin intervention
- **Fee changed mid-event**: existing orders keep their snapshotted fee; new orders use new fee
- **EPS settlement vs platform reconciliation mismatch**: flagged in admin dashboard; manual investigation; do not auto-disburse until resolved

### 14.10 Ledger Integrity

Two invariants enforced by reconciliation job that runs after every batch:

**Invariant 1:** `Σ order.total_paisa = Σ (order.net_to_organiser_paisa + order.platform_fee_paisa + order.eps_fee_paisa + order.withholding_tax_paisa)` for every order in the batch.

**Invariant 2:** `Σ disbursement_batch.gross_paisa − refunds − withholding = Σ disbursement_batch.net_paisa` for every batch in any time window.

Any violation halts new batch creation and pages the on-call.

## §15 — Bangladesh Regulatory Compliance

### 15.1 BFIU (Bangladesh Financial Intelligence Unit)

- KYC document retention: 5 years post account closure
- Suspicious transaction reporting: detect patterns (rapid high-value events, NID reuse, name mismatches), surface in admin dashboard, manual STR submission process
- PEP/sanctions screening at KYC tier 2+

### 15.2 NBR (National Board of Revenue)

- VAT (15%) applies to platform service fee (the 0.25%) — generate Mushak 6.3 monthly per tenant
- Withholding tax (AIT): if Event Pulse is classified as a withholding agent, deduct AIT at source on tenant payouts and remit. **OPEN — get legal opinion before launch.**
- Year-end annual transaction statement per tenant, downloadable

### 15.3 Bangladesh Bank PSP/PSO

- Year 1: operate as sub-merchant aggregator under EPS's PSP licence
- Year 2: apply for own PSO licence
- Maintain client funds in designated escrow account, separate from operating account

### 15.4 Consumer Rights

- Per-event refund policy clearly displayed at checkout
- 14-day cooling-off period for digital-only events not applicable (events have a service date)
- Dispute resolution: support email + admin escalation path

## §16 — Notifications

### 16.1 Email (SES)

- Domain identity verified for `eventpulse.com.bd`
- Templates stored in `apps/api/src/infra/ses/templates/`
- Each template has English + Bangla variants
- Bounce/complaint webhooks update `notification_log`

### 16.2 SMS (SSL Wireless)

- Masked sender ID `EVENTPULSE`
- Bangla SMS supported (Unicode billing — costs more)
- Delivery receipt webhooks update `notification_log`

### 16.3 Notification Catalogue

| Event | Channels | Recipient | Template ID |
|---|---|---|---|
| `auth.magic_link` | email | requesting user | `auth_magic_link` |
| `auth.password_reset` | email | requesting user | `auth_password_reset` |
| `auth.mfa_enabled` | email | user | `auth_mfa_enabled` |
| `tenant.signup` | email | tenant | `tenant_welcome` |
| `tenant.email_verify` | email | tenant | `verify_email` |
| `tenant.kyc_approved` | email + sms | tenant | `kyc_approved` |
| `tenant.kyc_rejected` | email | tenant | `kyc_rejected` |
| `order.confirmed` | email + sms | buyer | `order_confirmed` |
| `attendee.ticket` | email (PDF attached) | attendee | `attendee_ticket` |
| `event.reminder` | email + sms | attendee | `event_reminder` |
| `order.refunded` | email | buyer | `order_refunded` |
| `disbursement.approved` | email + sms | tenant | `disbursement_approved` |
| `disbursement.paid` | email + sms | tenant | `disbursement_paid` |
| `custom_domain.active` | email | tenant | `domain_active` |
| `legal.material_change` | email | all users | `legal_material_change` |
| `subprocessor.added` | email | all tenants | `subprocessor_notice` |
| `contact.acknowledgement` | email | submitter | `contact_ack` |
| `changelog.monthly_digest` | email (opt-in) | subscribers | `changelog_digest` |

---

# PART H — INFRASTRUCTURE

## §17 — Infrastructure: Single EC2 First

### 17.1 Architecture (MVP) — One Server, Two Domains, Zero Magic

The MVP deploys to **a single AWS EC2 instance** in `ap-southeast-1`. Everything runs there: Next.js, Hono API, Postgres, Redis, BullMQ workers, Nginx, certbot. AWS services used: **EC2 + Route 53 + S3 + SES** only. No Lambda, no Aurora, no API Gateway, no ECS, no CloudFront.

This is deliberate. It keeps the architecture small enough to debug end-to-end, costs under USD 100/month, and gets us to first paying tenant fast. The migration path to multi-instance is documented in §17.12 and triggers at clear signals.

```
Internet
   │
   │  DNS: eventpulse.com.bd, *.eventpulse.com.bd, app.eventpulse.com.bd,
   │       admin.eventpulse.com.bd  →  EC2 Elastic IP (Route 53 A record)
   │
   │  Custom tenant domains  →  Cloudflare for SaaS  →  Elastic IP
   │
   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EC2 t3.large  (Ubuntu 24.04 LTS, 2 vCPU, 8 GB RAM, 100 GB gp3)    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Nginx (TLS termination, vhost routing, static caching)     │    │
│  └──────┬───────────┬──────────────┬─────────────────┬─────────┘    │
│         │           │              │                 │              │
│         ▼           ▼              ▼                 ▼              │
│   ┌──────────┐ ┌──────────┐  ┌──────────┐    ┌──────────┐           │
│   │ Next.js  │ │ Next.js  │  │ Hono API │    │ Hono API │           │
│   │  :3000   │ │  :3001   │  │  :4000   │    │  :4001   │           │
│   │ (cluster)│ │ (cluster)│  │ (cluster)│    │ (cluster)│           │
│   └──────────┘ └──────────┘  └──────────┘    └──────────┘           │
│                                                                     │
│   PM2 ecosystem: web (2 instances), api (2 instances),              │
│   workers (1 instance per queue: settlement, email, sms, pdf)       │
│                                                                     │
│   ┌──────────┐    ┌──────────┐    ┌──────────────────┐              │
│   │ Postgres │    │  Redis   │    │ BullMQ workers   │              │
│   │  :5432   │    │  :6379   │    │ (subscribe Redis)│              │
│   └──────────┘    └──────────┘    └──────────────────┘              │
│                                                                     │
│   /home/eventpulse/                                                 │
│     ├── app/                  (deployed code, git checkout)         │
│     ├── data/                                                       │
│     │   ├── postgres/         (Postgres data dir)                   │
│     │   └── redis/                                                  │
│     ├── logs/                 (pino JSON logs, rotated by pm2)      │
│     └── backups/              (nightly DB dumps before S3 upload)   │
└─────────────────────────────────────────────────────────────────────┘
        │                          │
        │                          │
        ▼                          ▼
   ┌──────────┐              ┌──────────┐
   │ AWS S3   │              │ AWS SES  │
   │ (KYC,    │              │ (email   │
   │ assets,  │              │  send,   │
   │ PDFs,    │              │  bounce, │
   │ backups) │              │ webhooks)│
   └──────────┘              └──────────┘
```

### 17.2 EC2 Server Specification

| Item | Value |
|---|---|
| Instance type | `t3.large` (2 vCPU, 8 GB RAM). Can scale up to `m6i.xlarge` if needed |
| AMI | Canonical Ubuntu 24.04 LTS |
| Storage | 100 GB gp3 EBS root volume (3000 IOPS, 125 MB/s) |
| Elastic IP | One static IP, attached at boot |
| Security group | inbound: 80, 443 from 0.0.0.0/0; 22 from bastion IP only; outbound: all |
| IAM role | EC2 instance profile with S3 write to `eventpulse-prod-*` and SES send + Secrets Manager read |
| Backup | Daily EBS snapshot retained 7 days + nightly pg_dump to S3 retained 90 days |
| Monitoring | CloudWatch Agent (CPU, memory, disk, swap) + custom Node app metrics via pino → CloudWatch Logs |

### 17.3 Software Stack on the EC2

Installed and managed via Ansible playbook in `infra/ansible/`:

```
- Node.js 22 LTS (via nvm under the eventpulse user)
- pnpm 9 (global)
- PostgreSQL 16 (apt: postgresql-16)
- Redis 7 (apt: redis-server)
- Nginx (latest stable)
- certbot + python3-certbot-dns-route53
- pm2 (global npm)
- AWS CLI v2
- CloudWatch Agent
- ufw (firewall, configured to match security group)
- fail2ban (SSH brute-force protection)
- unattended-upgrades (security patches)
```

### 17.4 Nginx Vhost Configuration

Vhosts on the same EC2 served by the same Nginx:

```nginx
# /etc/nginx/sites-enabled/eventpulse-web.conf
# Marketing site + public event pages + tenant subdomains
server {
  listen 443 ssl http2;
  server_name eventpulse.com.bd www.eventpulse.com.bd *.eventpulse.com.bd;

  ssl_certificate /etc/letsencrypt/live/eventpulse.com.bd/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/eventpulse.com.bd/privkey.pem;
  include /etc/nginx/snippets/tls-modern.conf;
  include /etc/nginx/snippets/security-headers.conf;

  # Pass Host header so Next.js middleware can route subdomains/custom domains
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
  }

  location /_next/static/ {
    proxy_pass http://127.0.0.1:3000;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}

# /etc/nginx/sites-enabled/eventpulse-app.conf  → tenant portal
server {
  listen 443 ssl http2;
  server_name app.eventpulse.com.bd;
  # ... same TLS + headers
  location / { proxy_pass http://127.0.0.1:3000; }
}

# /etc/nginx/sites-enabled/eventpulse-admin.conf  → super admin
server {
  listen 443 ssl http2;
  server_name admin.eventpulse.com.bd;
  # Extra: IP allowlist for admin
  allow <office-ip>;
  allow <bastion-ip>;
  deny all;
  location / { proxy_pass http://127.0.0.1:3000; }
}

# /etc/nginx/sites-enabled/eventpulse-api.conf  → Hono API
server {
  listen 443 ssl http2;
  server_name api.eventpulse.com.bd;
  location / { proxy_pass http://127.0.0.1:4000; }
}

# HTTP → HTTPS redirect for everything
server {
  listen 80 default_server;
  server_name _;
  return 301 https://$host$request_uri;
}
```

### 17.5 PM2 Ecosystem File

`pm2/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'web',
      script: 'apps/web/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { PORT: 3000, NODE_ENV: 'production' },
      max_memory_restart: '1G',
    },
    {
      name: 'api',
      script: 'apps/api/dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { PORT: 4000, NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    { name: 'worker-settlement', script: 'apps/api/dist/workers/settlement.js', instances: 1 },
    { name: 'worker-email',      script: 'apps/api/dist/workers/email.js',      instances: 1 },
    { name: 'worker-sms',        script: 'apps/api/dist/workers/sms.js',        instances: 1 },
    { name: 'worker-pdf',        script: 'apps/api/dist/workers/pdf.js',        instances: 1 },
    {
      name: 'cron',
      script: 'apps/api/dist/workers/cron.js',
      instances: 1,
      cron_restart: '0 2 * * *',
    },
  ],
}
```

Deploys use `pm2 reload ecosystem.config.js` for zero-downtime reload.

### 17.6 Route 53 Configuration

Single hosted zone for `eventpulse.com.bd`:

```
Type   Name                          Value                       TTL
A      eventpulse.com.bd             <EC2 Elastic IP>            300
A      www                           <EC2 Elastic IP>            300
A      app                           <EC2 Elastic IP>            300
A      admin                         <EC2 Elastic IP>            300
A      api                           <EC2 Elastic IP>            300
A      *.eventpulse.com.bd           <EC2 Elastic IP>            300   (wildcard for tenant subdomains)
A      customers                     <EC2 Elastic IP>            300   (Cloudflare for SaaS fallback origin)
MX     eventpulse.com.bd             SES MX                      3600
TXT    _dmarc                        v=DMARC1; p=quarantine; ... 3600
TXT    <SES DKIM CNAMEs>             ...                         3600
TXT    eventpulse.com.bd             v=spf1 include:amazonses.com -all   3600
```

### 17.7 TLS — Let's Encrypt Wildcard via DNS-01

```bash
certbot certonly \
  --dns-route53 \
  -d eventpulse.com.bd \
  -d '*.eventpulse.com.bd' \
  --email ops@ticonsys.com \
  --agree-tos \
  --non-interactive
```

Renewal via systemd timer `certbot.timer` running twice daily.

### 17.8 Environments

| Env | Where | DB | Domain | EPS Mode |
|---|---|---|---|---|
| Local | Developer laptop | Docker Postgres + Redis | localhost | sandbox |
| Staging | Smaller EC2 `t3.small` | Same-host Postgres | `staging.eventpulse.com.bd` | sandbox |
| Production | EC2 `t3.large` (or larger) | Same-host Postgres | `eventpulse.com.bd` | production |

### 17.9 Secrets Management

For MVP, secrets live in `/home/eventpulse/.env.production` with `chmod 600` and owner `eventpulse:eventpulse`. The file is **never committed**. It is bootstrapped from AWS Secrets Manager on instance start via a launch script that reads `eventpulse/prod/*` and writes the env file.

Secrets Manager entries:

```
eventpulse/prod/database
eventpulse/prod/eps
eventpulse/prod/cloudflare-saas
eventpulse/prod/porichoy
eventpulse/prod/ssl-wireless
eventpulse/prod/ses
eventpulse/prod/sentry
eventpulse/prod/jwt
eventpulse/prod/redis
eventpulse/prod/oauth-google
eventpulse/prod/oauth-apple
```

JWT signing key rotated quarterly with overlap; DB master semi-annually.

### 17.10 Backups

- **DB**: `pg_dump` nightly at 01:00 BDT, gzipped, uploaded to `s3://eventpulse-prod-backups/postgres/YYYY/MM/DD.sql.gz`. 90-day retention. WAL archiving enabled for point-in-time restore.
- **EBS**: daily AWS Backup snapshot, 7-day retention, encrypted with KMS.
- **S3**: versioning enabled on all prod buckets; lifecycle rules transition old versions to Glacier after 30 days.

**Restore drill**: every quarter, a backup is restored to a scratch EC2 and verified end-to-end. Documented in `docs/runbooks/restore-drill.md`.

### 17.11 Monitoring and Alerting

- CloudWatch Agent ships system metrics (CPU, mem, disk, swap)
- pino JSON logs ship to CloudWatch Logs via the agent
- Sentry for application errors (frontend + backend, with PII scrubbing)
- Uptime: external monitor (UptimeRobot or BetterStack) on `/health` endpoints
- Alerts (PagerDuty / Slack): CPU > 85% / 10 min, memory > 90% / 5 min, disk > 80%, error rate > 1% / 5 min, payment success rate < 95% / 15 min, disbursement batch failure, reconciliation invariant violation

### 17.12 Scaling Path — When to Move Off Single EC2

The single-EC2 architecture is intentional for MVP. Triggers and target architecture:

| Trigger | Move to |
|---|---|
| 50+ concurrent users sustained | Vertical scale to `m6i.xlarge` or `c6i.xlarge` |
| Sustained CPU > 60% during business hours | Split DB to RDS, keep app on EC2 |
| Postgres data > 50 GB or write IOPS sustained > 1000 | RDS Postgres (Multi-AZ standby) |
| Need zero-downtime deploys with bigger team | App tier moves to ECS Fargate behind ALB |
| Background job count > 100k/day | Move workers to dedicated EC2 or Fargate; queue moves to SQS |
| Compliance requires log immutability | CloudTrail + S3 Object Lock |

Phase 3 work item: build the full CDK stack so the migration is one-command, not a manual scramble.

## §18 — CI/CD for Single EC2

### 18.1 GitHub Actions Workflows

- **ci.yml** — runs on every PR: typecheck, lint, unit tests, RLS tests, e2e smoke against a Dockerised Postgres + Redis. Required to merge.
- **deploy-staging.yml** — on push to `main`: SSH into staging EC2 via OIDC-issued temporary credentials, `git pull`, `pnpm install --prod`, `pnpm build`, `pnpm db:migrate`, `pm2 reload ecosystem.config.js`. Run smoke tests against staging. Post status to Slack.
- **deploy-prod.yml** — manual dispatch only, with required `prod-deploy-approver` reviewer. Same flow as staging but against prod EC2 with an extra confirmation gate.

### 18.2 SSH Deploy Mechanics

- GitHub OIDC → AWS IAM role → temporary credentials to fetch SSM session
- SSM Session Manager used instead of static SSH key (no long-lived SSH keys checked into Actions secrets)
- Deploy script `infra/deploy/deploy.sh` on the EC2 does the actual work; CI just triggers it via SSM `RunCommand`
- Migrations run BEFORE `pm2 reload`; if migration fails, deploy aborts and notifies Slack
- `pm2 reload` is zero-downtime: PM2 brings up new workers, drains old ones over 30s

### 18.3 Branching

- `main` → staging on merge
- `prod` → production on tag (manual cut) or via deploy-prod.yml manual dispatch
- Feature branches: `feat/<scope>-<short>`, `fix/<scope>-<short>`
- Hot-fix branches: `hotfix/<short>`, can deploy directly to prod with explicit override

### 18.4 Rollback

- `pm2 reload` keeps last-deployed version available for quick revert
- Database: backups + WAL allow point-in-time restore; migrations always include a backward-compatible window before destructive changes
- Tag every deploy: `v0.X.Y` annotated git tag with deploy timestamp + commit SHA
- Rollback command in runbook: `infra/deploy/rollback.sh <previous-tag>`

---

# PART I — DESIGN, LEGAL & PUBLIC SURFACES

## §19 — Design System Deep-Dive

§1.5 defined tokens. This section defines how those tokens become components.

### 19.1 Component Inventory

All components live under `apps/web/src/components/` and follow shadcn/ui conventions (Radix primitives + Tailwind). The Event Pulse design system layers on top of shadcn:

- **Foundations**: Button, Input, Select, Checkbox, Radio, Toggle, Tooltip, Badge, Avatar, Card, Sheet, Dialog, Tabs, Skeleton, Toast
- **Glass primitives**: `GlassCard`, `GlassPanel`, `GlassDialog`, `GlassNavbar` — built on shadcn equivalents with glass utility classes
- **Display**: `StatCard`, `GradientStat`, `MeshHero`, `TimelineItem`, `EventCard`, `TicketTierCard`, `AttendeeRow`
- **Form**: `FormField`, `FormBuilder`, `FormRenderer`, `MultiStepForm`, `FieldPalette`, `ConditionalLogicEditor`
- **Builder**: `LandingPageBuilder`, `SectionLibrary`, `SectionEditor`, `ThemePicker`, `BrandKitEditor`
- **Data**: `DataTable` (TanStack Table), `ChartCard` (recharts), `KpiGrid`, `TrendSparkline`
- **Public event**: `HeroSection`, `AboutSection`, `ScheduleSection`, `SpeakersSection`, `TicketsSection`, `VenueSection`, `FaqSection`, `SponsorsSection`, `CountdownSection`, `FooterSection`
- **Onboarding**: `OAuthButtonGroup`, `MagicLinkForm`, `OnboardingWizard`, `KycWizard`, `EmptyState`

### 19.2 Sign-In / Sign-Up UI

```
┌─────────────────────────────────────────────────────────┐
│  [animated gradient mesh background]                     │
│                                                          │
│      ┌─────────────────────────────────────────────┐    │
│      │  [glass-strong card]                         │    │
│      │                                              │    │
│      │     Event Pulse                              │    │
│      │     Run your events. Get paid in 5 days.     │    │
│      │                                              │    │
│      │     [🍎 Continue with Apple]                 │    │
│      │     [G  Continue with Google]                │    │
│      │     ─────────  or  ─────────                 │    │
│      │     [Enter your email]   [Continue →]        │    │
│      │                                              │    │
│      │     Already have an account? Sign in         │    │
│      └─────────────────────────────────────────────┘    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- Apple and Google buttons follow each provider's brand guidelines exactly (no custom colours)
- Email field validates inline; on submit, sends magic link, swaps to "Check your email" state
- "Sign in instead" toggles to existing-user flow with same providers + password option
- The gradient mesh background animates at 0.4× speed on the auth screens to feel calm
- Bangla version (toggle at top): the entire copy is translated; provider button labels stay in their canonical brand form

### 19.3 Empty States

Every list view, dashboard, and report has a designed empty state with: an illustrative mesh-bloom graphic, a one-sentence "what this is", a single primary CTA, and a "show me an example" toggle that fills the view with realistic seed data the user can explore before committing.

### 19.4 Loading States

- Skeleton loaders pulse at 1.6s; never spinners on layouts
- Inline buttons show a subtle gradient sweep when busy
- Page-level loading uses the mesh background with a centred dim glass card containing the skeleton

### 19.5 Dark Mode

- Toggle in user menu, persisted on user row
- `prefers-color-scheme` respected for unauthenticated views
- Mesh inverts to dark navy/violet stops; glass uses `glass-dark`
- All gradients pre-tested for both modes; no element falls below WCAG AA contrast

### 19.6 Accessibility

- All interactive elements keyboard-reachable; focus rings visible (custom focus ring uses `--ep-cerulean` outline at 2px)
- Form fields have associated `<label>`; error messages linked by `aria-describedby`
- Modals trap focus, return focus on close
- Motion respects `prefers-reduced-motion`: gradient mesh falls back to static, animations disabled
- WCAG 2.1 AA target; documented in Trust Center accessibility page

---

## §20 — Trust Center

Event Pulse Trust Center is a public, indexable, version-controlled set of pages establishing what Event Pulse stands for and contractually commits to. Modelled after the TenderPulse Trust Center pattern.

### 20.1 URL Structure

```
/trust                              Trust Center landing
/privacy                            Privacy Policy
/terms                              Terms of Service
/eula                               End-User Licence Agreement
/dpa                                Data Processing Addendum
/cookies                            Cookie Policy
/refund-policy                      Refund Policy
/trust/security                     Security & Infrastructure
/trust/sub-processors               Sub-processors
/trust/security/disclosure          Vulnerability Disclosure
/trust/sla                          Service Level Agreement
/trust/acceptable-use               Acceptable Use Policy
/trust/anti-bribery                 Anti-Bribery & Anti-Corruption
/trust/ai-policy                    Responsible AI Policy
/trust/bangladesh-compliance        Bangladesh Compliance
/trust/gdpr                         GDPR Compliance
/trust/accessibility                Accessibility Statement
/trust/transparency                 Transparency Report
/trust/retention                    Data Retention Schedule
/legal/changelog                    Public changelog index
/legal/changelog/v/<version>        Per-version changelog page
/contact                            Contact us
```

### 20.2 Trust Center Landing Page

The `/trust` landing page renders two card grids:

**Legal contracts — 6 documents · signed at consent**

> The contractual foundation of your relationship with Event Pulse. Material changes trigger a one-time consent re-prompt at next login — we never silently amend a signed agreement.

| Slug | Title | One-liner |
|---|---|---|
| `privacy` | Privacy Policy | How we handle your data, what your 9 rights are, who our sub-processors are. |
| `terms` | Terms of Service | The deal between you and Event Pulse, written plainly. Pro-user framing throughout. |
| `eula` | EULA | Your licence to use Event Pulse — and confirmation you own every output, every page, every form. |
| `dpa` | Data Processing Addendum | GDPR-compliant DPA for B2B customers handling controller-to-processor obligations. |
| `cookies` | Cookie Policy | Every cookie we set, its purpose, and how to opt out. |
| `refund-policy` | Refund Policy | When buyers can get their money back, the SLA-credit schedule, the EPS chargeback path. |

**Trust artefacts — 12 published policies**

> Published policies — not contracts you sign, but standards we hold ourselves to. Updated as our practices evolve.

| Path | Title | One-liner |
|---|---|---|
| `/trust/security` | Security & Infrastructure | Cloud architecture, encryption, KMS, ISO 27001 alignment, pen-test cadence. |
| `/trust/sub-processors` | Sub-processors | Live list of every third party that touches your data, with purpose, location, and DPA link. |
| `/trust/security/disclosure` | Vulnerability Disclosure | Safe-harbour policy for security researchers. We respond within 72 hours. |
| `/trust/sla` | Service Level Agreement | Our 99.5% monthly uptime commitment and the credit schedule when we fall short. |
| `/trust/acceptable-use` | Acceptable Use Policy | What you can and can't do with Event Pulse. The suspension + appeal path. |
| `/trust/anti-bribery` | Anti-Bribery & Anti-Corruption | Our procurement-grade integrity policy. UK Bribery Act, FCPA, BD ACC Act 2004. |
| `/trust/ai-policy` | Responsible AI Policy | Which models we use, how, what we don't allow, and our no-training-on-customer-data guarantee. |
| `/trust/bangladesh-compliance` | Bangladesh Compliance | Per-clause mapping to DSA 2018 §29–§32, BTRC notice handling, ICT Act 2006. |
| `/trust/gdpr` | GDPR Compliance | Per-Article walk-through, SCCs + UK IDTA, EU representative info. |
| `/trust/accessibility` | Accessibility Statement | Our WCAG 2.1 AA conformance status, known issues, remediation timeline. |
| `/trust/transparency` | Transparency Report | Government requests received in the year, refusal rate, our gag-order disclosure approach. |
| `/trust/retention` | Data Retention Schedule | Per-data-type retention windows. KYC docs: 5 years. Invoices: 7 years. Event logs: 1 year. |

### 20.3 Page Anatomy (Each Trust Center Page)

```
[breadcrumb: Trust > <Page Title>]

# Page Title
Effective: 16 May 2026 · Version 1.0 · Material change? No

[Glass card with table of contents]

## 1. Section
... body in markdown, rendered to clean prose ...

## 2. Section
...

---
Previous version: v0.9 (10 Apr 2026) [view diff]
Next review: 16 Nov 2026
Questions about this policy? [Contact us →]
```

### 20.4 Material Change Re-Consent Flow

When `legal_documents.requires_signature = true` and a new `legal_document_versions` row is published with `material_change = true`:

1. Cron job sets `requires_reconsent = true` for all users who consented to the prior version
2. On next login, user lands in a `/legal/reconsent` interstitial that shows a clear summary of changes + side-by-side diff
3. User clicks "I accept" → new `consent_records` row is written for the current version
4. User cannot proceed to dashboard without accepting (or downloading their data and closing the account, which is offered as an option)

Non-material updates (typo fixes, link updates) do not trigger re-consent; they're noted in the page's "Previous versions" list only.

### 20.5 Storage and Rendering

Each legal/trust page is stored in `legal_document_versions` as both `body_md` (canonical) and `body_html` (pre-rendered). Editing happens through the super admin portal under `Admin → Legal & Trust → <Document>`. Versioning is enforced: publishing a new version creates a new row, never overwrites.

Public pages are rendered server-side from `body_html` and cached at the edge. Cache invalidation on new version publication is automatic.

### 20.6 Sub-Processors List — Living Document

`/trust/sub-processors` is a living table maintained by a JSON file in the repo (`docs/sub-processors.json`) plus a daily diff job. Every entry has: name, purpose, data category, location, DPA link, certifications. Adding a sub-processor requires super admin approval + 30-day customer notice (with bulk email to all tenants).

Initial entries:

| Sub-processor | Purpose | Data category | Location | DPA |
|---|---|---|---|---|
| AWS (Amazon Web Services) | Compute, storage, DNS, email | All data | Singapore + global SES | aws.amazon.com/agreements |
| EPS Bangladesh | Payment processing | Payment metadata | Bangladesh | direct |
| Cloudflare | Custom domain hosting, edge SSL | Public event page traffic | Global edge | cloudflare.com/cloudflare-customer-dpa |
| SSL Wireless | SMS delivery | Phone numbers, message content | Bangladesh | direct |
| Porichoy | NID verification | NID number, name, photo | Bangladesh | direct |
| Sentry | Error tracking | Stack traces, redacted metadata | EU | sentry.io/legal/dpa |
| Google (OAuth) | Sign-in | Email, profile | Global | google.com/cloud/terms/dpa |
| Apple (Sign-In) | Sign-in | Email (often relay), Apple ID | Global | apple.com/legal/internet-services |

---

## §21 — Legal Positioning

Event Pulse is a **SaaS platform that provides hosting space and tooling**. We do not produce, endorse, or assume liability for the events that tenants run on our platform. This positioning shapes our Terms of Service, our Acceptable Use Policy, and how we handle complaints and government requests.

### 21.1 The Hosting-Space Doctrine

Our Terms make three things clear, in plain language:

1. **Tenants are the organisers of record.** When a buyer purchases a ticket, their contract is with the tenant — not with Event Pulse. Event Pulse is the platform that facilitates the listing, registration, and payment.
2. **Tenants are fully liable for the content, conduct, safety, and outcome of their events.** This includes (without limitation) venue safety, content legality, intellectual-property compliance, accessibility for attendees, age-appropriate restrictions, refunds for cancelled events, and disputes between tenants and their attendees.
3. **Event Pulse's role is operational infrastructure.** We provide: a landing page, a registration form, payment processing via EPS, a QR ticket, a check-in tool, and a disbursement engine. We do not curate, vet, or guarantee the quality of any event.

This is documented explicitly in the Terms of Service §3 and in the EULA §2. The Refund Policy makes clear that refund obligations sit with the tenant; the platform's role is to facilitate the refund mechanic on the tenant's instruction.

### 21.2 Bangladesh Law Mapping

Event Pulse complies with applicable Bangladesh law as a SaaS platform. Key statutes and how we position to them:

**Digital Security Act 2018 (DSA 2018)** — particularly §29 (defamation), §31 (offensive content), §32 (publication of secret/confidential information):
- We operate a notice-and-takedown regime: any party can flag content via `/contact?topic=legal-takedown`
- Eligible takedown requests are reviewed within 24 hours; valid requests result in content removal pending tenant response
- Our Acceptable Use Policy prohibits DSA-violating content explicitly
- Transparency Report publishes the number and disposition of requests annually

**ICT Act 2006** — particularly §57 (now largely superseded by DSA 2018) and the underlying duty of intermediaries:
- We maintain logs as required by intermediary rules
- We respond to lawful BTRC/law-enforcement requests with proper legal process
- We require court orders for content removal beyond our own AUP enforcement

**BTRC notice handling**:
- BTRC notices addressed to Event Pulse are processed within 24 hours during business days
- We dispute notices that exceed legal scope and document this in the Transparency Report
- Tenants are notified when their content is the subject of a notice (where legally permissible)

**Personal Data Protection (forthcoming Bangladesh PDPA)**:
- Privacy Policy is structured to be PDPA-ready once enacted
- Data localisation requirements (if applicable) addressed by Singapore region + Bangladesh data subject rights

**Bangladesh Bank — PSP/PSO**:
- Operate Year 1 as a sub-merchant aggregator under EPS's PSP licence
- Client funds held in designated escrow account
- Plan to apply for own PSO licence Year 2

**NBR — VAT, withholding**:
- 15% VAT on platform service fee (the 0.25%); Mushak 6.3 generated monthly per tenant
- Withholding tax classification: **OPEN** — legal opinion required before MVP launch (see §29)

**BFIU — AML**:
- KYC documentation retained 5 years
- STR submission process documented
- PEP/sanctions screening at KYC Tier 2+

### 21.3 Host Liability Clause (Verbatim — to be lawyer-reviewed)

> Tenant acknowledges and agrees that (a) Tenant is solely responsible for the content, safety, legality, and conduct of any Event they organise using the Event Pulse Platform; (b) all contractual relationships with attendees, including ticket sales contracts and refund obligations, exist between Tenant and the attendee, not between Event Pulse and the attendee; (c) Event Pulse acts solely as a technology platform providing hosting space, registration tooling, payment processing, and disbursement services as described in the Terms; (d) Event Pulse does not endorse, vet, or guarantee any Event; (e) Tenant indemnifies and holds harmless Event Pulse, its officers, employees, and affiliates from any claims, damages, liabilities, costs, or expenses arising from the conduct or outcome of any Event organised by Tenant.

This clause appears in Terms §7. It is mirrored in the EULA. The Refund Policy operationalises it by making the tenant the refund-decision authority.

### 21.4 Limits of the Hosting-Space Doctrine

We do not hide behind the doctrine where it would be wrong to:

- We will refuse to process and will remove events that violate our Acceptable Use Policy (illegal goods, hate, exploitation of minors, etc.) — even if a tenant insists they have a right to host them
- We will cooperate with law enforcement under proper legal process
- We will protect attendees from organiser fraud through KYC, T+5 disbursement holds, and dispute escalation paths

The Acceptable Use Policy enumerates prohibited categories explicitly.

---

## §22 — Contact, Public Pages & Changelog

### 22.1 Contact Page

`/contact` is a single page with:

- Headline + warm intro
- Topic selector (radio cards with icons): Sales · Support · Legal / Compliance · Partnership · Press · Security (responsible disclosure) · Other
- Form: name, email, organisation (optional), phone (optional), subject, message
- Submission writes to `contact_submissions`, sends acknowledgement email, routes to the relevant inbox based on topic
- Map + office address: Public Pulse Agency, Dhaka (exact address from tenant config)
- Direct emails: `sales@`, `support@`, `legal@`, `security@`, `press@`, `partnerships@` (all @eventpulse.com.bd)
- SLA badges: "We respond to support within 24 hours", "Security disclosures within 72 hours"
- Honeypot field + simple rate limit (3 submissions / hour / IP) to deter spam without blocking legitimate users

### 22.2 Changelog System

Every shipped change is logged. Two surfaces:

**Public changelog** at `/legal/changelog`:
- Reverse-chronological list of all `changelog_entries WHERE audience contains 'public'`
- Each entry shows: title, version, date, category badge, short body
- Filter by category (Features, Improvements, Fixes, Breaking changes, Security, Deprecations)
- RSS feed at `/legal/changelog.rss`
- Per-version page: `/legal/changelog/v/1.4.0` shows all entries for that version

**Tenant-facing changelog** in the tenant portal (`/dashboard/whats-new`):
- Same data, filtered to `audience contains 'tenant'`
- Highlights new tenant-relevant features with screenshots and "Try it" buttons that deep-link into the feature
- Unread badge in the tenant portal navbar until viewed

**Authoring workflow**:
- Super admin creates entries in `/admin/changelog/new`
- Required fields: version, title, body (markdown), category, audience checkboxes
- Preview before publish
- Publish triggers RSS regeneration + (if audience includes tenant) bumps tenant unread counter
- Bulk subscribers can opt-in to changelog emails (monthly digest)

### 22.3 Public Marketing Pages

The marketing surface lives at the apex `eventpulse.com.bd` and includes:

- `/` — Hero, value props, social proof, CTA to sign up
- `/features` — Feature catalogue
- `/pricing` — 0.25% transparency calculator with two fee-mode toggle
- `/use-cases` — Concert · Alumni · Comedy · Conference · Workshop · Community pages
- `/customers` — Case studies (added as tenants opt in)
- `/about` — Public Pulse Agency, the team, the mission
- `/help` — Help centre (separate later, just an index for MVP)
- `/blog` — Updates, guides (MDX-rendered)

All marketing pages use the gradient mesh hero pattern and follow the design system in §19.

---

# PART J — QUALITY AND PROCESS

## §23 — Coding Standards

### 23.1 TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- No `any`. Use `unknown` and narrow.
- No non-null assertion `!` except in clearly-justified one-liners with a comment
- Discriminated unions over enums where appropriate
- Prefer `type` over `interface` unless declaration merging is needed
- Module imports: absolute via `@/` alias within an app, package imports for cross-package

### 23.2 React

- Function components with hooks; no class components
- Prefer composition over prop drilling beyond 2 levels (use Zustand for local UI state if needed)
- Lift state up only when necessary
- Memoise only after profiling — premature `useMemo`/`useCallback` is noise
- Co-locate component test next to component

### 23.3 SQL and Drizzle

- Schema changes via Drizzle migrations only; never edit `migrations/` files after they ship
- One migration per logical change; commit migration with code that uses it
- Every new table includes RLS policies in the same migration
- Indexes added in the migration that introduces the query pattern

### 23.4 Comments

- Code should be self-explanatory; comments explain *why*, not *what*
- Public function exports get TSDoc with `@param`, `@returns`, `@throws`
- Top of every file: one-line purpose comment if not obvious from the filename

### 23.5 Commits

Conventional Commits:
```
feat(events): add capacity tracking
fix(payments): handle EPS COMPLETED status alias
chore(deps): bump drizzle-orm to 0.30
test(rls): add cross-tenant order isolation test
```

## §24 — Testing Strategy

### 24.1 Pyramid

- **Unit (Vitest)** — pure functions, validators, state machines, money math, hash helpers. Fast, ~1ms each.
- **Integration (Vitest + real Postgres)** — Hono route handlers against a transactional test DB. RLS isolation tests live here.
- **E2E (Playwright)** — critical user journeys: signup → KYC → event create → publish → ticket purchase → check-in. Run in CI, hit staging-like local stack.

### 24.2 Test DB Pattern

```typescript
beforeEach(async () => {
  await db.execute(sql`BEGIN`)
})
afterEach(async () => {
  await db.execute(sql`ROLLBACK`)
})
```

### 24.3 Required Tests Per Feature

- One happy path
- One validation failure
- One auth failure
- One RLS cross-tenant test (for tenant-scoped endpoints)
- One idempotency test (for money-moving endpoints)

## §25 — Definition of Done

A unit of work is "done" when all of the following are true:

- [ ] Code merged to main via PR with at least one approval
- [ ] All CI checks green (typecheck, lint, unit, integration, RLS, e2e smoke)
- [ ] New env vars documented in `.env.example` with comments
- [ ] Migrations applied to staging and verified
- [ ] User-visible changes logged in `CHANGES.md`
- [ ] If new user-facing copy, both English and Bangla provided (for public surface)
- [ ] If new financial logic, hand-verified against spreadsheet math by Moshiur
- [ ] If new payment flow, tested in EPS sandbox with at least one success and one failure
- [ ] If new RLS policy, cross-tenant negative test green
- [ ] Logs structured, no console.log
- [ ] Sentry receives errors with request_id tags
- [ ] Documentation updated in `docs/`

---

# PART K — PHASED EXECUTION

## §26 — Sprint Plan

### 26.1 Phase 1 MVP — 8 weeks, 4 two-week sprints

**Sprint 1 — Foundation & Server**
- Day 1–2: Scaffold monorepo (Turborepo, pnpm, tsconfig, eslint, prettier, vitest, playwright). Configure design tokens, Tailwind theme with the §1.5 palette, glass utilities, and gradient mesh component.
- Day 3–4: Provision EC2 (staging first), run Ansible playbook to install Node 22, Postgres 16, Redis 7, Nginx, certbot, pm2. Configure Route 53 hosted zone + Elastic IP + wildcard cert. Verify HTTPS works on `staging.eventpulse.com.bd`, `app.staging.eventpulse.com.bd`, `admin.staging.eventpulse.com.bd`.
- Day 5–6: Drizzle schema for `tenants`, `users`, `oauth_identities`, `magic_links`, `sessions`, `tenant_users`, `super_admins`, `tenant_fee_config`. Migrations + RLS policies + seed scripts + unit + RLS tests.
- Day 7–8: Auth flows — email/password, magic link, Google OAuth, Apple OAuth (all four). Lucia adapter wired to Postgres `sessions` table. JWT issuance per audience (super-admin, tenant, attendee).
- Day 9–10: Email sending via SES (verify domain, ship `tenant_welcome`, `verify_email`, `magic_link_signin` templates). PM2 ecosystem file configured; deploy.sh + rollback.sh runbook scripts. CI green.

**Sprint 2 — KYC, Onboarding & Trust Center Skeleton**
- Day 1–3: KYC submission API; S3 bucket setup with KMS; document upload signed URLs.
- Day 4–5: Tenant portal onboarding (post-login Account-Type modal, dashboard empty state, KYC wizard for individual + org). Glass-card design system applied throughout.
- Day 6–7: Super admin KYC review queue UI + approve/reject API.
- Day 8: Porichoy NID validation integration; eTIN format checks.
- Day 9: Notification on approval/rejection; provisioning of tenant subdomain on approval.
- Day 10: Trust Center pages scaffolded — `legal_documents` + `legal_document_versions` tables seeded with v1.0 content for all 6 legal contracts + 12 trust artefacts; public routes wired; super admin "Legal & Trust" editor with version control.

**Sprint 3 — Events, Tickets, Orders, EPS, Fee Engine**
- Day 1: Fee calculator (§14.3) as the first-class deliverable. Unit tested with all four (absorb/pass_through) combinations × edge amounts.
- Day 2: Event CRUD API; event slug generation; status state machine. `tenant_fee_config` exposed in super admin tenant detail view with fee override modal + `fee_override_log` audit.
- Day 3: Fixed form template per event type (hardcoded React forms for MVP).
- Day 4: Single landing page template with brand customisation (logo, colour, banner, copy).
- Day 5: Ticket tier CRUD.
- Day 6–8: Order creation endpoint using the fee calculator; EPS init flow; redirect handling; verify on return; QR generation; ticket PDF generation; email delivery.
- Day 9: Idempotency on order creation; capacity locking via row-level lock.
- Day 10: End-to-end smoke test of buyer journey in EPS sandbox; verify all four fee modes work and accounting reconciles.

**Sprint 4 — Attendees, Check-in, Reports, Settlement, Public Marketing**
- Day 1–2: Attendee list UI; search, filter, CSV export.
- Day 3–4: Web QR scanner for check-in; offline-tolerant queue with sync.
- Day 5: Tenant sales dashboard + tenant payouts dashboard with current fee config visibility.
- Day 6: Super admin Revenue Dashboard (§14.7) — header KPIs, time-series, settlement queue widget, top 20 tenants by GMV.
- Day 7–8: Refund flow (tenant initiates, super admin approves; EPS dashboard for actual refund execution). Manual disbursement: super admin generates BEFTN file or initiates bKash B2C.
- Day 9: Marketing pages — apex `eventpulse.com.bd`, `/features`, `/pricing` with the two-fee-mode transparency calculator, `/contact` page, `/legal/changelog` index. Trust Center accessible.
- Day 10: Launch readiness — Acceptable Use Policy reviewed, host-liability clause confirmed by lawyer, security checklist passed, prod EC2 cut over, onboard first paying tenant.

### 26.2 Phase 2 — 8 weeks (4 sprints)

Sprint 5: Drag-and-drop form builder
Sprint 6: Landing page builder + templates
Sprint 7: Automated disbursement engine + super admin financial dashboard + EPS reconciliation
Sprint 8: Tenant team and RBAC + SMS notifications + custom domains base layer (Cloudflare for SaaS integration)

### 26.3 Phase 3 & 4

Listed in §2.6.

## §27 — Kick-Off Prompt for Claude Code

Once this playbook is loaded (as CLAUDE.md, pasted, or split into docs/), the first message to Claude Code is:

> Read `CLAUDE.md` end to end. Acknowledge by listing back to me, in three lines:
> 1. The five locked tech stack choices that you consider most consequential.
> 2. The five immutable rules from §1.3 that you think are most likely to be violated by mistake later.
> 3. Your understanding of the Settlement Engine fee modes from §14, in your own words, and the relationship between `tenant_fee_config`, the per-event `platform_fee_handling` and `eps_fee_handling` settings, and the `fee-calculator` function.
>
> Then create a TodoWrite with Sprint 1 tasks from §26.1 broken into atomic items (10–18 todos). Do not write code yet.
>
> When the todos are ready, ask me to confirm before you begin Day 1–2 (scaffold the monorepo + apply design tokens). When scaffolding, follow §3 exactly. After the monorepo is scaffolded with the design system tokens applied, stop, show me the resulting tree, and wait for my green light before moving to Day 3–4 (EC2 provisioning).
>
> Throughout:
> - Report blockers distinctly, never silently substitute a different library or pattern.
> - Stop and ask whenever you hit one of the OPEN decisions in §29 or anything not covered in this playbook.
> - Never write fee math anywhere except inside `apps/api/src/domain/payments/fee-calculator.ts`.
> - Never deploy to anything other than the single EC2 architecture in §17 without explicit approval.
> - Treat the host-liability clause in §21.3 as load-bearing: do not weaken it through code defaults or UX that implies platform endorsement of events.

---

# PART L — APPENDICES

## §28 — Glossary

- **AIT** — Advance Income Tax (Bangladesh withholding tax)
- **BB** — Bangladesh Bank (central bank)
- **BEFTN** — Bangladesh Electronic Funds Transfer Network (bank-to-bank)
- **BFIU** — Bangladesh Financial Intelligence Unit
- **BIN** — Business Identification Number (VAT registration)
- **BTRC** — Bangladesh Telecommunication Regulatory Commission
- **DKIM/SPF/DMARC** — email authentication standards
- **EC** — Election Commission (issues NID)
- **EPS** — Easy Payment System (Bangladesh payment gateway)
- **eTIN** — Electronic Tax Identification Number
- **GMV** — Gross Merchandise Value
- **KYC** — Know Your Customer
- **MFS** — Mobile Financial Service (bKash, Nagad, Rocket, Upay)
- **Mushak 6.3** — Bangladesh VAT invoice form
- **NBR** — National Board of Revenue
- **NID** — National ID card
- **paisa** — 1/100 of BDT (we store all money as paisa)
- **PEP** — Politically Exposed Person
- **Porichoy** — `porichoy.gov.bd`, NID verification service
- **PSO/PSP** — Payment System Operator / Provider (BB licence)
- **RLS** — Row-Level Security (Postgres feature)
- **SES** — AWS Simple Email Service
- **SSL Wireless** — Bangladesh SMS gateway provider
- **STR** — Suspicious Transaction Report (BFIU)
- **T+5** — 5 business days after transaction

## §29 — Open Decisions to Surface

Claude Code must STOP and ask before proceeding if any of these come up. Items marked ✓ are resolved by v2.0; items still open are listed below.

**Resolved in v2.0:**
- ✓ Fee mode default: per-event `platform_fee_handling` + `eps_fee_handling`, both default to `pass_through` for new tenants (§14)
- ✓ Per-tenant fee override: managed via super admin portal `tenant_fee_config`, audited in `fee_override_log` (§14.4)
- ✓ Deployment architecture: single EC2 + Route 53 for MVP, full migration triggers in §17.12
- ✓ AWS region: `ap-southeast-1`
- ✓ Custom domains: Cloudflare for SaaS
- ✓ White-label add-on pricing: BDT 2,500/month, removes "Powered by Event Pulse" footer + branded emails/PDFs
- ✓ Auth methods at MVP: email/password, magic link, Google OAuth, Apple OAuth — all four

**Still open — Claude Code asks before assuming:**

1. **Free RSVP-only events allowed at MVP?** Current default: yes (no payment flow, no platform fee, but still uses KYC if the tenant wants ticket QR + check-in).
2. **Attendee accounts at MVP?** Current default: no — guest checkout with magic-link "find my tickets" only. Full attendee accounts in Phase 3.
3. **KYC strictness for MVP.** Current default: Tier 1 individual + Tier A org accepted; higher tiers in Phase 2.
4. **Bilingual UI scope at MVP.** Current default: English-only tenant + super admin portals, bilingual public event pages and Trust Center.
5. **PSP/PSO licence path.** Current default: operate Year 1 as sub-merchant aggregator under EPS's licence; apply for own PSO in Year 2.
6. **EPS settlement reconciliation cadence.** Current default: daily import, batch-level reconciliation. May need to upgrade if EPS reporting is delayed.
7. **Refund authority for MVP.** Current default: tenant initiates from portal; super admin approves; actual refund executed manually via EPS dashboard. No tenant-initiated direct refund until EPS public refund API exists.
8. **Sub-processor change notice period.** Current default: 30 days bulk email to all tenants. Increase if a customer DPA requires longer.
9. **Withholding tax (AIT) classification.** **MUST get legal opinion before MVP launch.** Is Event Pulse a "withholding agent" under the Income Tax Ordinance for payouts to tenants?
10. **VAT (Mushak) registration model.** **MUST resolve with NBR before MVP launch.** Whether the 0.25% platform fee VAT is paid by Event Pulse on its gross fee receipt, or whether tenants are the VAT-bearing party for the service fee component.

## §30 — How to Split this Playbook (Mode C from §0)

If you want a lean CLAUDE.md instead of pasting everything every session:

**Keep in `CLAUDE.md` (the constitution, ~200 lines):**
- §0 How to Use (trimmed)
- §1 Mission, Stack, Working Agreement (with §1.5 design tokens inline)
- §3 Repo structure summary (folders only, not full tree)
- §23 Coding Standards summary
- §25 Definition of Done
- §29 Open Decisions

**Move to `docs/` and reference with `@docs/<file>.md`:**
- §2 → `docs/product.md`
- §3 (full) → `docs/repo.md`
- §4–8 → `docs/architecture.md`
- §9 → `docs/database.md`
- §10 → `docs/api.md`
- §11 → `docs/eps-integration.md`
- §12 → `docs/custom-domains.md`
- §13 → `docs/kyc-engine.md`
- §14 → `docs/settlement-engine.md`
- §15 → `docs/compliance.md`
- §16 → `docs/notifications.md`
- §17–18 → `docs/infrastructure.md`
- §19 → `docs/design-system.md`
- §20 → `docs/trust-center.md`
- §21 → `docs/legal-positioning.md`
- §22 → `docs/public-pages.md`
- §24 → `docs/testing.md`
- §26 → `docs/sprint-plan.md`
- §28 → `docs/glossary.md`

In `CLAUDE.md`, add a section:

```
## Where to look
- Product details → @docs/product.md
- Database schema → @docs/database.md
- API spec → @docs/api.md
- EPS integration → @docs/eps-integration.md
- Custom domains → @docs/custom-domains.md
- KYC engine → @docs/kyc-engine.md
- Settlement engine + fee modes → @docs/settlement-engine.md
- Infrastructure (single EC2) → @docs/infrastructure.md
- Design system → @docs/design-system.md
- Trust Center pages → @docs/trust-center.md
- Legal positioning → @docs/legal-positioning.md
- Sprint plan → @docs/sprint-plan.md
```

Claude Code will pull these in on demand. Total session context stays lean; full detail available when needed.

---

*End of playbook v2.0. Treat as a living document. Update with every architectural decision, every resolved Open item, every learned-the-hard-way gotcha. Bump version on each material change.*
