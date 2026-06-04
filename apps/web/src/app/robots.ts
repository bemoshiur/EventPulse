import type { MetadataRoute } from 'next'

const SITE = 'https://eventpulse.com.bd'

/**
 * robots.txt (Next metadata route). Public marketing + public event pages are
 * crawlable; the authenticated app surfaces, auth flows, and API are not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/app/', '/admin/', '/my/'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  }
}
