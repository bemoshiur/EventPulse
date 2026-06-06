'use client'

/**
 * EN | বাংলা language toggle. English is un-prefixed (`/…`); Bengali is `/bn/…`.
 * Derives the current locale from the URL (the `/bn` rewrite keeps the prefix in
 * the browser path, so `usePathname()` sees it) and links to the same page in
 * the other locale.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function LanguageToggle({ className = '' }: { className?: string }) {
  const pathname = usePathname() || '/'
  const isBn = pathname === '/bn' || pathname.startsWith('/bn/')
  const logical = isBn ? pathname.slice(3) || '/' : pathname
  const enHref = logical
  const bnHref = logical === '/' ? '/bn' : `/bn${logical}`

  const base = 'rounded-full px-2.5 py-1 text-xs font-semibold transition'
  const active = 'bg-mkt-red text-white'
  const idle = 'text-mkt-slate hover:text-mkt-red'

  return (
    <div
      className={`border-mkt-line inline-flex items-center gap-0.5 rounded-full border bg-white p-0.5 ${className}`}
      aria-label="Language"
    >
      <Link
        href={enHref}
        aria-current={!isBn ? 'true' : undefined}
        className={`${base} ${!isBn ? active : idle}`}
      >
        EN
      </Link>
      <Link
        href={bnHref}
        aria-current={isBn ? 'true' : undefined}
        className={`${base} ${isBn ? active : idle} font-[family-name:var(--font-bangla)]`}
      >
        বাংলা
      </Link>
    </div>
  )
}
