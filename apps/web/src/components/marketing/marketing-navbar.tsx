import Link from 'next/link'

import { LanguageToggle } from './language-toggle'

const NAV_LINKS = [
  { href: '/discover', label: 'Discover events' },
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/trust', label: 'Trust' },
]

export function MarketingNavbar({ current }: { current?: string }) {
  return (
    <nav
      aria-label="Primary"
      className="border-mkt-line sticky top-0 z-40 border-b bg-white/80 font-[family-name:var(--font-bangla)] backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="text-mkt-ink flex items-center gap-2 text-base font-bold tracking-tight"
        >
          <span aria-hidden="true" className="bg-mkt-red inline-block size-2.5 rounded-full" />
          Event Pulse
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const slug = link.href.replace('/', '')
            const active = slug === current
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'text-mkt-red inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold'
                      : 'text-mkt-slate hover:text-mkt-ink inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition'
                  }
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-1.5">
          <LanguageToggle className="hidden sm:inline-flex" />
          <Link
            href="/sign-in"
            className="text-mkt-slate hover:text-mkt-ink hidden h-9 items-center rounded-md px-3 text-sm font-medium transition md:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/book-a-demo"
            className="border-mkt-line text-mkt-ink hover:border-mkt-red hidden h-9 items-center rounded-lg border px-4 text-sm font-semibold transition md:inline-flex"
          >
            Book a demo
          </Link>
          <Link
            href="/sign-up"
            className="bg-mkt-red inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  )
}
