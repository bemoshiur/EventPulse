import { NextResponse, type NextRequest } from 'next/server'

/**
 * Bilingual `/bn` prefix (TenderPulse-style). English is the default, served
 * un-prefixed at `/…`. A request to `/bn/…` is REWRITTEN to the same page at
 * `/…` (the marketing/public pages already render EN + বাংলা inline, so the
 * Bengali route shows the same bilingual content — no separate page tree, no
 * mixed-language state). The browser URL stays `/bn/…` so it's bookmarkable +
 * `usePathname()` (used by LanguageToggle) sees the `/bn` prefix.
 *
 * A `NEXT_LOCALE` cookie tracks the preference. No `headers()` read in the root
 * layout, so static generation of the marketing pages is preserved.
 */

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const isBn = pathname === '/bn' || pathname.startsWith('/bn/')

  if (isBn) {
    const url = req.nextUrl.clone()
    url.pathname = pathname === '/bn' ? '/' : pathname.slice(3)
    const res = NextResponse.rewrite(url)
    res.cookies.set('NEXT_LOCALE', 'bn', { path: '/', maxAge: 31_536_000, sameSite: 'lax' })
    return res
  }

  const res = NextResponse.next()
  res.cookies.set('NEXT_LOCALE', 'en', { path: '/', maxAge: 31_536_000, sameSite: 'lax' })
  return res
}

export const config = {
  // Run on page routes only — skip Next internals, API, and files with an extension.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.).*)'],
}
