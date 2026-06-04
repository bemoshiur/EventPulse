import type { Metadata } from 'next'

import { BlogCard, BlogFeatureCard } from '@/components/marketing/blog-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { BLOG_CATEGORY_LABEL, getAllBlogPosts, getBlogCategories } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog — field guides for event organisers',
  description:
    'Practical guides on selling tickets, EPS payments, T+5 payouts, KYC, QR check-in, and running events in Bangladesh.',
  alternates: { canonical: '/blog' },
}

export default function BlogIndexPage() {
  const posts = getAllBlogPosts()
  const [featured, ...rest] = posts
  const categories = getBlogCategories()

  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            Blog · <span lang="bn">ব্লগ</span>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Field guides for event organisers.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            {posts.length} practical guides on ticketing, payments, and running events in Bangladesh
            — written by the team building Event Pulse.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12 md:py-16 lg:px-10">
          {/* category chips */}
          <ul className="mb-8 flex flex-wrap gap-2">
            {categories.map((c) => (
              <li
                key={c}
                className="border-mkt-line text-mkt-slate rounded-full border bg-white px-4 py-1.5 text-sm font-medium"
              >
                {BLOG_CATEGORY_LABEL[c]}
              </li>
            ))}
          </ul>

          {featured ? (
            <div className="mb-10">
              <BlogFeatureCard post={featured} />
            </div>
          ) : null}

          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <li key={p.slug}>
                <BlogCard post={p} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}
