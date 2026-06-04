import { ArrowRight, Calendar, Clock } from 'lucide-react'
import Link from 'next/link'

import { BLOG_CATEGORY_LABEL, formatBlogDate, type BlogPost } from '@/lib/blog'

/** Gradient thumbnail keyed off the slug so each post gets a stable, distinct look. */
function Thumb({ post, className }: { post: BlogPost; className?: string }) {
  const seed = post.slug.length % 4
  const grads = [
    'from-[var(--color-mkt-red)] to-[#ff8a65]',
    'from-[#ff6f61] to-[var(--color-mkt-red-dark)]',
    'from-[var(--color-mkt-red)] to-[#f4426d]',
    'from-[#ffa45b] to-[var(--color-mkt-red)]',
  ]
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${grads[seed]} ${className ?? ''}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:16px_16px] opacity-20" />
      <span className="absolute bottom-3 left-4 font-[family-name:var(--font-bangla)] text-2xl font-bold text-white/90">
        {BLOG_CATEGORY_LABEL[post.category]}
      </span>
    </div>
  )
}

function Meta({ post }: { post: BlogPost }) {
  return (
    <div className="text-mkt-slate flex flex-wrap items-center gap-3 text-xs">
      <span className="border-mkt-line text-mkt-ink inline-flex items-center rounded-full border bg-white px-2 py-[2px] text-[10px] font-semibold tracking-wider uppercase">
        {BLOG_CATEGORY_LABEL[post.category]}
      </span>
      <span className="inline-flex items-center gap-1">
        <Calendar className="size-3.5" /> {formatBlogDate(post.date)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" /> {post.readMinutes} min read
      </span>
    </div>
  )
}

/** Large featured card — image left, text right. */
export function BlogFeatureCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="border-mkt-line hover:border-mkt-red group block overflow-hidden rounded-3xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="grid lg:grid-cols-[1.2fr_1fr]">
        <Thumb post={post} className="aspect-[16/10] lg:aspect-auto lg:min-h-[320px]" />
        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8 lg:p-10">
          <Meta post={post} />
          <h2 className="group-hover:text-mkt-red text-2xl font-bold tracking-tight transition-colors sm:text-3xl">
            {post.title}
          </h2>
          <p className="text-mkt-slate line-clamp-3 text-sm leading-relaxed sm:text-base">
            {post.excerpt}
          </p>
          <span className="text-mkt-red inline-flex items-center gap-1 text-sm font-semibold">
            Read the guide
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/** Standard grid card. */
export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="border-mkt-line hover:border-mkt-red group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Thumb post={post} className="aspect-[16/10]" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Meta post={post} />
        <h3 className="group-hover:text-mkt-red text-lg font-semibold tracking-tight transition-colors">
          {post.title}
        </h3>
        <p className="text-mkt-slate line-clamp-2 text-sm leading-relaxed">{post.excerpt}</p>
        <span className="text-mkt-red mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold">
          Read more
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
