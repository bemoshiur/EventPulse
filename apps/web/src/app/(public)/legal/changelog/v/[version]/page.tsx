import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { GlassCard } from '@/components/ui/glass-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { fetchChangelogByVersion } from '@/lib/changelog'

export const revalidate = 300

interface Props {
  params: Promise<{ version: string }>
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params
  return {
    title: `Changelog v${version} — Event Pulse`,
    description: `What shipped in Event Pulse v${version}.`,
  }
}

export default async function ChangelogVersionPage({ params }: Props) {
  const { version } = await params
  const items = await fetchChangelogByVersion(version)
  if (items.length === 0) {
    notFound()
  }

  return (
    <>
      <MarketingNavbar />

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
          <p className="text-xs font-semibold tracking-widest text-[var(--ep-violet)] uppercase">
            Changelog
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-5xl">
            v{version}
          </h1>
          <p className="mt-3 text-sm text-[var(--ep-graphite)]">
            {formatDate(items[0]!.publishedAt)}
          </p>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24">
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

          <div className="mt-10 text-center">
            <Link
              href="/legal/changelog"
              className="text-sm text-[var(--ep-violet)] hover:underline"
            >
              ← All releases
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

/**
 * Render the sanitized body_html of a changelog entry.
 *
 * Server-only by design. See the matching `ChangelogBody` in
 * apps/web/src/app/(public)/legal/changelog/page.tsx for the trust-model
 * rationale (Decision J 2026-05-19 — same `renderLegalMarkdown` pipeline
 * the Trust Center uses).
 */
function ChangelogBody({ html }: { html: string }) {
  return (
    <div
      className="prose-changelog mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]"
      // eslint-disable-next-line react/no-danger -- body_html sanitized at seed/publish time via shared renderer
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
