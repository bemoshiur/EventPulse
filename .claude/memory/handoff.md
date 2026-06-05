# Event Pulse — Handoff (session exit state)

**Last update:** 2026-06-05 — **Day 48 (cont 2).** Prod on **v0.4.22**. Driver: Claude Code (Opus 4.8). $30/mo AWS ceiling. Single EC2 `i-0c41fae1286527654`, SSM-only, deploy via `deploy-prod.yml` (checks out the **release tag**, NOT the prod branch). API host `api.eventpulse.com.bd`; web `app.`/apex. Org `The-Public-Pulse-Agency/EventPulse`. AWS acct `739275468267`, role `eventpulse-prod-ec2`.

## ✅ Shipped this session (v0.4.20 → v0.4.22, all LIVE + verified)
- **v0.4.20** — three backlog items: (a) **Auth pages** richer chrome (floating-pill header + "Visit homepage" + brand micro-banner + trust strip + back-home footer in `(auth)/layout.tsx`; page cards unchanged). (b) **Event-slug redirects** — migration 0019 adds `events.previous_slugs` (text[] + GIN); `updateEvent` records the old slug on rename; `resolveEventSlugRedirect` + `GET /api/v1/public/events/resolve` + public-page 404 wiring → old `{tenant}/{old-event}` URLs 301 (parity with handle redirects). (c) **Dynamic OG image** — `opengraph-image.tsx` (next/og) branded card; metadata `openGraph.images` overrides it so cover events keep their banner, cover-less get the card. Verified `200 image/png`.
- **v0.4.21** — **File-upload for covers + logos.** Public-read S3 bucket `eventpulse-assets-prod-739275468267` (public GET on `assets/*` only, public ACLs blocked, CORS for app origins; EC2 role gets `s3:PutObject` on `assets/*`). `infra/s3/assets.ts` (presigned PUT, per-tenant key, raster allow-list) + `POST /tenant/me/assets/upload-url` + `ImageUpload` component on the event cover field + Settings logo (URL paste kept as fallback). Infra captured in `infra/scripts/setup-assets-bucket.sh`. `ASSETS_BUCKET_NAME` env defaults to the prod bucket in code (single-env; no prod env change needed).
- **v0.4.22** — **SECURITY:** removed SVG from the asset upload allow-list (server `ASSET_CONTENT_TYPES` + client `ACCEPT`). Commit security review flagged SVG-on-public-bucket = stored XSS (SVG can carry `<script>`, served as image/svg+xml). PNG/JPG/WebP only now.

## Gotchas hit this session (see gotchas.md)
- **`prod` git branch had silently drifted** to an old commit (`e09f582`, leftover from the prior session's memory episode) — `main:prod` pushes were rejected non-fast-forward and I didn't notice for several deploys. HARMLESS because `deploy-prod.yml` checks out the **release tag** (`ref: ${{ inputs.release_tag }}`), not the prod branch head. Reconciled prod→main with `--force-with-lease`. Lesson: deploys follow tags; the prod branch is cosmetic — but keep it reconciled.
- **DB integration tests need `describeIfDb`** (carried from earlier) — `events.test.ts` slug-rename tests use it.
- Memory commits must go via a **PR** (pre-push hook blocks direct main/prod pushes); deploys use `--no-verify` on `main:prod` which is the documented exception.

## ⏭ Open / nice-to-haves (none blocking)
- Asset uploads: optionally front the bucket with **CloudFront + a custom domain** (e.g. `assets.eventpulse.com.bd`) for prettier URLs + header control — offered, operator chose public-read bucket for now.
- Event-slug redirects have no expiry (permanent) — intentional (better UX); handle redirects keep the 30-day window.
- The whole operator backlog (theme, edit, cover, handle/slug rename, branding, SEO, auth, redirects, OG, uploads) is **done + live**. No outstanding feature asks.

## Next step
Operator's full backlog is complete. Resume on whatever they raise next; nothing is half-built. Prod = main = v0.4.22.
