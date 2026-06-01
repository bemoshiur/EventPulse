/**
 * v1.0 launch changelog seed — Day 42 Sprint 4 §26.1 Day 9 part 3.
 *
 * Seeds the public `/legal/changelog` index with the v1.0-launch
 * highlight reel. Each entry is idempotent via the UNIQUE slug;
 * re-running upserts on slug.
 *
 * Entries are dated relative to the 2026-06-10 launch target. Versions
 * use sprint-aligned semver: v1.0.0 is the launch.
 *
 * body_html is rendered server-side at seed time via the shared
 * `renderLegalMarkdown()` pipeline (Decision J 2026-05-19 — the same
 * `rehype-sanitize`-bounded `defaultSchema` allowlist that produces
 * Trust Center body_html). The renderer is a security boundary; the
 * stored body_html is "the cached, known-safe-at-store output of this
 * pipeline" — public pages serve it directly via dangerouslySetInnerHTML
 * without re-sanitizing per request.
 *
 * Run pattern mirrors `seed-buyer-terms-v1.ts`: `run()` is the entry
 * point; CLI shim at bottom; deploy.sh calls `pnpm --filter
 * @eventpulse/api db:seed:changelog-v1` post-migrate, pre-pm2-reload.
 */

import { renderLegalMarkdown } from '../../domain/legal/render.js'

export type ChangelogCategory =
  | 'feature'
  | 'improvement'
  | 'fix'
  | 'breaking'
  | 'security'
  | 'deprecation'

export interface ChangelogSeedEntry {
  slug: string
  version: string
  title: string
  bodyMd: string
  category: ChangelogCategory
  audience: ReadonlyArray<'public' | 'tenant'>
  publishedAt: string
}

export const CHANGELOG_V1_SEED: ReadonlyArray<ChangelogSeedEntry> = [
  {
    slug: '2026-06-10-v1-0-0-launch',
    version: '1.0.0',
    title: 'Event Pulse v1.0 — launch',
    bodyMd:
      'Event Pulse v1.0 ships today. Multi-tenant ticketing platform for Bangladesh: ' +
      'branded landing pages, custom registration forms, bKash checkout via EPS, ' +
      'web-based QR check-in, automated T+5 disbursement, and a flat 0.25% platform fee.',
    category: 'feature',
    audience: ['public', 'tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-bkash-payment-method',
    version: '1.0.0',
    title: 'bKash checkout at launch',
    bodyMd:
      'Buyers pay via bKash through EPS hosted checkout. Card and other methods rolling out ' +
      'week 1 post-launch. Free events skip payment entirely. The published bKash fee rate ' +
      'is 1.75% on capture; the Pricing page calculator walks through every fee mode.',
    category: 'feature',
    audience: ['public', 'tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-tenant-refund-workflow',
    version: '1.0.0',
    title: 'Refund flow: tenant request, super-admin approval',
    bodyMd:
      'Tenants initiate refund requests from the order detail view. Super-admin reviews, ' +
      'approves or rejects, processes the refund via the EPS merchant dashboard, and marks ' +
      'the refund processed on the platform. v1.0 supports full refunds only.',
    category: 'feature',
    audience: ['tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-trust-center-launch',
    version: '1.0.0',
    title: 'Trust Center: 6 legal contracts + 12 trust artefacts',
    bodyMd:
      'Privacy Policy, Terms of Service, EULA, DPA, Cookie Policy, Refund Policy — plus ' +
      'twelve trust artefacts including security, sub-processors, accessibility, Bangladesh ' +
      'compliance, GDPR, transparency, and the responsible-disclosure policy.',
    category: 'feature',
    audience: ['public', 'tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-web-qr-check-in',
    version: '1.0.0',
    title: 'Web QR check-in — no app required',
    bodyMd:
      'Any modern browser is a QR scanner. Offline-tolerant: scans queue locally when the ' +
      'gate has spotty connectivity and sync resumes automatically when the device reconnects.',
    category: 'feature',
    audience: ['tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-attendee-list-csv-export',
    version: '1.0.0',
    title: 'Attendee CRM with search, filter, and CSV export',
    bodyMd:
      'Find any attendee by name, email, or phone. Filter by tier, check-in state, or sale ' +
      'date. Export to CSV for offline use; every export writes a single audit row with ' +
      'row count and filters applied.',
    category: 'feature',
    audience: ['tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-tenant-sales-dashboard',
    version: '1.0.0',
    title: 'Sales dashboard + payouts view',
    bodyMd:
      'Headline KPIs (GMV, ticket count, conversion), a 30-day time series with stacked ' +
      'event-type breakdown, and a read-only payouts view showing the snapshot fee at the ' +
      'time of each order alongside the current fee config.',
    category: 'feature',
    audience: ['tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-buyer-terms-lite',
    version: '1.0.0',
    title: 'Buyer Terms Lite consent at checkout',
    bodyMd:
      'Every order — paid or free — captures the buyer’s Buyer-Terms-Lite consent in ' +
      'consent_records, bilingually (EN + BN). Order creation rolls back if consent capture fails.',
    category: 'feature',
    audience: ['public'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
  {
    slug: '2026-06-10-ses-bounce-complaint-suppression',
    version: '1.0.0',
    title: 'Bounce + complaint suppression-list',
    bodyMd:
      'Every outbound email checks the global suppression list before SES SendEmail. ' +
      'SNS-fed bounces and complaints poison no other tenant’s reputation. Permanent ' +
      'failures suppress forever; soft failures expire after their suppressed_until window.',
    category: 'security',
    audience: ['tenant'],
    publishedAt: '2026-06-10T00:00:00Z',
  },
] as const

export async function run(): Promise<void> {
  const renderedEntries: Array<ChangelogSeedEntry & { bodyHtml: string }> = []
  for (const entry of CHANGELOG_V1_SEED) {
    const bodyHtml = await renderLegalMarkdown(entry.bodyMd)
    renderedEntries.push({ ...entry, bodyHtml })
  }

  if (!process.env['DATABASE_URL']) {
    // eslint-disable-next-line no-console
    console.log(
      `changelog v1.0: ${renderedEntries.length} entries validated + rendered (DATABASE_URL not set; skipping insert)`,
    )
    return
  }

  const { withSuperAdmin, resetPool } = await import('../client.js')
  const { sql } = await import('drizzle-orm')

  let inserted = 0
  let updated = 0

  try {
    await withSuperAdmin(async (tx) => {
      for (const entry of renderedEntries) {
        const result = await tx.execute(sql`
          INSERT INTO changelog_entries
            (slug, version, title, body_md, body_html, category, audience, published_at)
          VALUES
            (${entry.slug}, ${entry.version}, ${entry.title}, ${entry.bodyMd}, ${entry.bodyHtml},
             ${entry.category}, ${entry.audience as unknown as string[]}, ${entry.publishedAt})
          ON CONFLICT (slug) DO UPDATE SET
            version = EXCLUDED.version,
            title = EXCLUDED.title,
            body_md = EXCLUDED.body_md,
            body_html = EXCLUDED.body_html,
            category = EXCLUDED.category,
            audience = EXCLUDED.audience,
            published_at = EXCLUDED.published_at
          RETURNING (xmax = 0) AS was_inserted
        `)
        const rows = result.rows as Array<{ was_inserted: boolean }>
        if (rows[0]?.was_inserted) inserted += 1
        else updated += 1
      }
    })
    // eslint-disable-next-line no-console
    console.log(`changelog v1.0: ${inserted} inserted, ${updated} updated`)
  } finally {
    await resetPool()
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  run().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('changelog v1.0 seed failed:', err)
    process.exit(1)
  })
}
