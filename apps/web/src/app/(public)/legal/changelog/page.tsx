import type { Metadata } from 'next'
import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { fetchChangelogIndex } from '@/lib/changelog'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Changelog — Event Pulse',
  description:
    'Every shipped change to Event Pulse, in reverse chronological order. Features, improvements, fixes, security updates.',
}

const CATEGORY_STYLES: Record<string, { label: string; class: string }> = {
  feature: { label: 'Feature', class: 'bg-[var(--ep-violet)]/15 text-[var(--ep-violet)]' },
  improvement: {
    label: 'Improvement',
    class: 'bg-[var(--ep-cerulean)]/15 text-[var(--ep-cerulean)]',
  },
  fix: { label: 'Fix', class: 'bg-[var(--ep-mint)]/15 text-[var(--ep-mint)]' },
  breaking: { label: 'Breaking', class: 'bg-[var(--ep-rose)]/15 text-[var(--ep-rose)]' },
  security: { label: 'Security', class: 'bg-[var(--ep-amber)]/15 text-[var(--ep-amber)]' },
  deprecation: {
    label: 'Deprecation',
    class: 'bg-[var(--ep-graphite)]/15 text-[var(--ep-graphite)]',
  },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function ChangelogIndexPage() {
  const items = await fetchChangelogIndex()
  const versions = Array.from(new Set(items.map((i) => i.version)))

  return (
    <>
      <MarketingNavbar />

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
          <p className="text-xs font-semibold tracking-widest text-[var(--ep-violet)] uppercase">
            Changelog
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-5xl">
            What&rsquo;s shipped.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--ep-graphite)]">
            Every release of Event Pulse, in reverse chronological order. Features, improvements,
            fixes, security updates &mdash; transparent and dated.
          </p>
        </div>
      </section>

      {versions.length > 0 && (
        <section className="relative">
          <div className="mx-auto max-w-5xl px-6 pb-8">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-[var(--ep-graphite)]">Browse by version:</span>
              {versions.map((v) => (
                <Link
                  key={v}
                  href={`/legal/changelog/v/${v}`}
                  className="inline-flex h-8 items-center rounded-full bg-[var(--ep-paper)]/70 px-3 text-xs font-semibold text-[var(--ep-ink)] backdrop-blur transition hover:bg-[var(--ep-violet)]/10 hover:text-[var(--ep-violet)]"
                >
                  v{v}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24">
          {items.length === 0 ? (
            <GlassCard className="p-10 text-center">
              <p className="text-sm text-[var(--ep-graphite)]">
                Nothing to show yet. Check back soon.
              </p>
            </GlassCard>
          ) : (
            <ul className="space-y-6">
              {items.map((item) => {
                const cat = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.feature!
                return (
                  <li key={item.slug}>
                    <GlassCard className="p-7">
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cat.class}`}
                        >
                          {cat.label}
                        </span>
                        <span className="text-xs text-[var(--ep-graphite)]">
                          v{item.version} &middot; {formatDate(item.publishedAt)}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg font-semibold text-[var(--ep-ink)]">
                        {item.title}
                      </h2>
                      <ChangelogBody html={item.bodyHtml} />
                    </GlassCard>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

/**
 * Render the sanitized body_html of a changelog entry.
 *
 * Server-only by design. body_html has been sanitized server-side by
 * the shared `renderLegalMarkdown()` pipeline (`rehype-sanitize` with
 * the `defaultSchema` allowlist) at seed/publish time — the same
 * pipeline that produces Trust Center body_html (Decision J 2026-05-19).
 * The stored column is "the cached, known-safe-at-store output of this
 * pipeline"; we serve it directly without re-sanitizing per request.
 *
 * React's raw-HTML escape hatch is used deliberately here — the security
 * boundary is the unified pipeline, not this renderer. Widening that
 * pipeline's allowlist requires its own decisions.md entry. See
 * apps/api/src/domain/legal/render.ts + apps/web/src/components/legal/document-page.tsx
 * for the matching Trust Center pattern.
 */
function ChangelogBody({ html }: { html: string }) {
  return (
    <div
      className="prose-changelog mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]"
      // eslint-disable-next-line react/no-danger -- see ChangelogBody jsdoc; security boundary is the seed-time sanitizer
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
