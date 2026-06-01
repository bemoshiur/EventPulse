/**
 * Changelog read queries — Day 42 Sprint 4 §26.1 Day 9 part 3.
 *
 * Backs:
 *   - GET /api/v1/public/changelog          → list published 'public' entries
 *   - GET /api/v1/public/changelog/by-slug  → single entry by slug
 *   - GET /api/v1/public/changelog/by-version/:version → list entries for version
 *
 * Runs under withSuperAdmin BYPASSRLS (the table is platform-wide and
 * does not have RLS enabled). Audience filtering is application-side.
 *
 * Cache discipline: published changelog is static enough to cache at
 * the edge. The route layer sets `Cache-Control: public, max-age=300,
 * s-maxage=3600` matching the Trust Center pattern.
 */

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { changelogEntries } from '../../db/schema/index.js'

export type ChangelogAudience = 'public' | 'tenant'

export interface ChangelogListItem {
  slug: string
  version: string
  title: string
  category: string
  bodyHtml: string
  publishedAt: Date
}

export async function listPublishedChangelog(
  audience: ChangelogAudience,
): Promise<ChangelogListItem[]> {
  const rows = await withSuperAdmin((tx) =>
    tx
      .select({
        slug: changelogEntries.slug,
        version: changelogEntries.version,
        title: changelogEntries.title,
        category: changelogEntries.category,
        bodyHtml: changelogEntries.bodyHtml,
        publishedAt: changelogEntries.publishedAt,
      })
      .from(changelogEntries)
      .where(
        and(
          isNotNull(changelogEntries.publishedAt),
          sql`${audience} = ANY(${changelogEntries.audience})`,
        ),
      )
      .orderBy(desc(changelogEntries.publishedAt)),
  )

  return rows
    .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
    .map((r) => ({
      slug: r.slug,
      version: r.version,
      title: r.title,
      category: r.category,
      bodyHtml: r.bodyHtml,
      publishedAt: r.publishedAt,
    }))
}

export async function getChangelogEntryBySlug(
  slug: string,
  audience: ChangelogAudience,
): Promise<ChangelogListItem | null> {
  const rows = await withSuperAdmin((tx) =>
    tx
      .select({
        slug: changelogEntries.slug,
        version: changelogEntries.version,
        title: changelogEntries.title,
        category: changelogEntries.category,
        bodyHtml: changelogEntries.bodyHtml,
        publishedAt: changelogEntries.publishedAt,
      })
      .from(changelogEntries)
      .where(
        and(
          eq(changelogEntries.slug, slug),
          isNotNull(changelogEntries.publishedAt),
          sql`${audience} = ANY(${changelogEntries.audience})`,
        ),
      )
      .limit(1),
  )

  const row = rows[0]
  if (!row || row.publishedAt === null) return null
  return {
    slug: row.slug,
    version: row.version,
    title: row.title,
    category: row.category,
    bodyHtml: row.bodyHtml,
    publishedAt: row.publishedAt,
  }
}

export async function listChangelogByVersion(
  version: string,
  audience: ChangelogAudience,
): Promise<ChangelogListItem[]> {
  const rows = await withSuperAdmin((tx) =>
    tx
      .select({
        slug: changelogEntries.slug,
        version: changelogEntries.version,
        title: changelogEntries.title,
        category: changelogEntries.category,
        bodyHtml: changelogEntries.bodyHtml,
        publishedAt: changelogEntries.publishedAt,
      })
      .from(changelogEntries)
      .where(
        and(
          eq(changelogEntries.version, version),
          isNotNull(changelogEntries.publishedAt),
          sql`${audience} = ANY(${changelogEntries.audience})`,
        ),
      )
      .orderBy(desc(changelogEntries.publishedAt)),
  )

  return rows
    .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
    .map((r) => ({
      slug: r.slug,
      version: r.version,
      title: r.title,
      category: r.category,
      bodyHtml: r.bodyHtml,
      publishedAt: r.publishedAt,
    }))
}
