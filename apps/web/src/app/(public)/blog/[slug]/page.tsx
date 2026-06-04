import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BlogCard } from '@/components/marketing/blog-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { BLOG_CATEGORY_LABEL, formatBlogDate, getAllBlogPosts, getBlogPost } from '@/lib/blog'

export function generateStaticParams() {
  return getAllBlogPosts().map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) return { title: 'Blog' }
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: 'article', title: post.title, description: post.excerpt },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) notFound()

  const related = getAllBlogPosts()
    .filter((p) => p.slug !== post.slug && p.category === post.category)
    .slice(0, 3)

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { '@type': 'Organization', name: 'Event Pulse' },
    publisher: { '@type': 'Organization', name: 'Event Pulse' },
    mainEntityOfPage: `https://eventpulse.com.bd/blog/${post.slug}`,
  }

  return (
    <>
      <MarketingNavbar />

      <article>
        <header className="mkt-hero border-b border-[var(--color-mkt-line)]">
          <div className="mx-auto max-w-3xl px-6 py-14 md:py-20">
            <Link href="/blog" className="text-mkt-red text-sm font-semibold hover:underline">
              ← All guides
            </Link>
            <div className="text-mkt-slate mt-4 flex flex-wrap items-center gap-3 text-xs">
              <span className="border-mkt-line text-mkt-ink inline-flex items-center rounded-full border bg-white px-2 py-[2px] text-[10px] font-semibold tracking-wider uppercase">
                {BLOG_CATEGORY_LABEL[post.category]}
              </span>
              <span>{formatBlogDate(post.date)}</span>
              <span>· {post.readMinutes} min read</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">{post.title}</h1>
            <p className="text-mkt-slate mt-4 text-lg leading-relaxed">{post.excerpt}</p>
          </div>
        </header>

        <div className="bg-white">
          <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
            {post.body.map((section, i) => (
              <section key={i} className="mb-8 last:mb-0">
                {section.heading ? (
                  <h2 className="text-mkt-ink mb-3 text-xl font-bold tracking-tight">
                    {section.heading}
                  </h2>
                ) : null}
                {section.paragraphs.map((p, j) => (
                  <p key={j} className="text-mkt-slate mb-4 text-[15px] leading-relaxed last:mb-0">
                    {p}
                  </p>
                ))}
                {section.bullets ? (
                  <ul className="mt-3 space-y-2">
                    {section.bullets.map((b) => (
                      <li key={b} className="text-mkt-ink flex items-start gap-2 text-[15px]">
                        <span className="bg-mkt-red/10 text-mkt-red mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                          ✓
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}

            <div className="border-mkt-line mt-12 flex flex-col items-center gap-3 rounded-2xl border bg-[var(--color-mkt-soft)] p-8 text-center sm:flex-row sm:justify-between sm:text-left">
              <div>
                <p className="text-mkt-ink text-lg font-semibold">Ready to run your event?</p>
                <p className="text-mkt-slate mt-1 text-sm">Free events publish in 90 seconds.</p>
              </div>
              <Link
                href="/sign-up"
                className="bg-mkt-red inline-flex h-11 shrink-0 items-center rounded-lg px-6 text-sm font-semibold text-white transition hover:bg-[var(--color-mkt-red-dark)]"
              >
                Start free
              </Link>
            </div>
          </div>
        </div>
      </article>

      {related.length > 0 ? (
        <section className="bg-mkt-soft border-t border-[var(--color-mkt-line)]">
          <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
            <h2 className="mb-6 text-xl font-bold tracking-tight">
              More {BLOG_CATEGORY_LABEL[post.category]}
            </h2>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <li key={p.slug}>
                  <BlogCard post={p} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <MarketingFooter />
    </>
  )
}
