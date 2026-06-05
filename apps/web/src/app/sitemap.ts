import type { MetadataRoute } from 'next'

import { getAllBlogPosts } from '@/lib/blog'

const SITE = 'https://eventpulse.com.bd'

// Public, indexable marketing + trust + legal routes. Bilingual EN/বাংলা is
// rendered inline today (no locale prefix), so each URL is a single entry;
// when locale routing lands (Phase 6) this gains /en + /bn alternates.
const ROUTES: {
  path: string
  priority: number
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
}[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/features', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/demo', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/how-it-works', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/faq', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/glossary', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/customers', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/book-a-demo', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.6, changeFrequency: 'yearly' },
  { path: '/trust', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/legal/changelog', priority: 0.5, changeFrequency: 'weekly' },
  // Trust artefacts
  { path: '/trust/security', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/trust/security/disclosure', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/sub-processors', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/trust/sla', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/acceptable-use', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/anti-bribery', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/trust/ai-policy', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/bangladesh-compliance', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/trust/gdpr', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/accessibility', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/trust/transparency', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/trust/retention', priority: 0.3, changeFrequency: 'yearly' },
  // Legal contracts
  { path: '/terms', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.6, changeFrequency: 'yearly' },
  { path: '/eula', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/dpa', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/cookies', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/refund-policy', priority: 0.5, changeFrequency: 'yearly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const blog: MetadataRoute.Sitemap = getAllBlogPosts().map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.date,
    changeFrequency: 'yearly',
    priority: 0.5,
  }))
  return [
    ...ROUTES.map((r) => ({
      url: `${SITE}${r.path === '/' ? '' : r.path}`,
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    })),
    ...blog,
  ]
}
