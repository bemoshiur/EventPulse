# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-05 — **Day 48 (cont).** Prod on **v0.4.18** (+ v0.4.19 OG-fix merging). Driver: Claude Code (Opus 4.8). $30/mo AWS ceiling. Prod is the only env — single EC2 `i-0c41fae1286527654`, SSM-only, deploy via `deploy-prod.yml --ref prod` (OIDC). API host `api.eventpulse.com.bd`; web `app.`/apex. Org `The-Public-Pulse-Agency/EventPulse`.

## ✅ Shipped today (v0.4.8 → v0.4.18, all LIVE + verified)
- **v0.4.8** — login "Network error" fixed: apex origin was missing from API CORS allow-list (`DEFAULT_PORTAL_ORIGINS` in `apps/api/src/middleware/cors.ts`). TiCON System Limited removed project-wide → "Public Pulse Agency". `/glossary` + `/customers` built.
- **v0.4.9–0.4.12** — 18 legal/trust pages live with REAL v1.0 content I authored (`apps/api/src/db/seeds/legal-bodies-v1.ts` + `trust-bodies-v1.ts` + `seed-legal-v1.ts`, run via deploy.sh). Fixed legal-page ISR cache staleness (force-dynamic pages + `cache:'no-store'`).
- **v0.4.13/14** — **FULL authenticated-app re-theme** violet/glass/GradientMesh (§1.5) → red/white marketing system (`mkt-*` tokens). Tenant portal (16 files) + admin portal + KYC wizard + residual utility-token cleanup. Whole app is now ONE theme. `event-landing` stays tenant-branded (`--brand-*`).
- **v0.4.15** — Edit-event page `/events/[id]/edit` (reuses EventForm + PATCH; "Edit details" on the manage hub).
- **v0.4.16** — Cover-image URL field on create+edit (renders as the event hero; event-landing already rendered `bannerImageUrl`).
- **v0.4.17** — Handle/slug rename: `services/handles` (`renameTenantHandle` + `resolveHandleRedirect`, 7 integration tests), `PATCH /tenant/me/handle`, `/settings` page + dashboard link, public-page **30-day `handle_history` redirect**.
- **v0.4.18** — (a) Event-slug rename (`EventUpdateSchema.slug` + per-tenant uniqueness → `EventSlugConflictError`; "Event link" field on edit; **NO redirect yet** — UI warns). Also fixed a latent bug: edit sent full `EventCreateInput` incl `type` → `.strict()` would reject → now sends explicit allowed-field patch. (b) Branding: `PATCH /tenant/me/brand` (logo URL + hex colours) + Settings Branding section (colour pickers + live hero preview). (c) **Per-event SEO**: `lib/event-seo.ts` — full metadata (title, generated/real description, keywords, authors, canonical, OpenGraph, Twitter, robots) + **Schema.org Event JSON-LD** (date, Place/VirtualLocation, organiser, ticket Offers). 9 unit tests. JSON-LD `<` escaped (XSS guard).
- **v0.4.19 (merging)** — fix: dropped the `og-default.png` og:image fallback (it 404'd for cover-less events); og:image now only set when a real banner/logo exists.

## Gotchas hit this session
- **DB integration tests MUST use `describeIfDb`** (`describe.skip` when no `DATABASE_URL`) or they run + fail in the no-DB "Unit tests" CI job. Cost a CI round on #325.
- Edit-event sent `type` → `EventUpdateSchema.strict()` rejects → send explicit allowed fields.
- The `var(--ep-*)` sweep MISSED utility-class forms (`text-ep-ink`, `bg-ep-paper`, `bg-black/30`) — needed a second cleanup pass. Tailwind v4: utility `text-mkt-ink`; raw var is `var(--color-mkt-X)` WITH the `color-` prefix.
- `/api/*` on `app.eventpulse.com.bd` returns the web app's HTML — the API is on `api.eventpulse.com.bd` (`NEXT_PUBLIC_API_BASE_URL`).

## ⏭ Remaining (operator's "all" list — NOT done)
- **Auth pages like TenderPulse** — restyle sign-in/sign-up. Not started.
- **Real file-upload** for cover/logo — needs a NEW public assets S3 bucket = **prod infra change → confirm with operator before building**. Today cover/logo are URL paste.
- **Event-slug redirects** — old event links break on rename (handles DO redirect). Add `event_slug_history` if wanted.
- **Dynamic OG image** (`opengraph-image.tsx`) — branded social card for cover-less events; nice-to-have.

## Next step
Operator said "ok done" after SEO. Resume with the **auth-page restyle** or the **assets bucket** (infra-gated) when they return. Confirm v0.4.19 (OG fix) merged + deployed first.
