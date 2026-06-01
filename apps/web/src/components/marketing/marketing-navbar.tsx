import Link from 'next/link'

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/trust', label: 'Trust' },
  { href: '/contact', label: 'Contact' },
]

export function MarketingNavbar({
  current,
}: {
  current?: 'features' | 'pricing' | 'trust' | 'contact'
}) {
  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-40 border-b border-[var(--ep-line)]/40 bg-[var(--ep-paper)]/60 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display flex items-center gap-2 text-base font-semibold text-[var(--ep-ink)]"
        >
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-gradient-to-br from-[var(--ep-violet)] to-[var(--ep-cerulean)]"
          />
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
                      ? 'inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold text-[var(--ep-violet)]'
                      : 'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-[var(--ep-graphite)] transition hover:text-[var(--ep-ink)]'
                  }
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-[var(--ep-graphite)] transition hover:text-[var(--ep-ink)] md:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-9 items-center rounded-md bg-gradient-to-r from-[var(--ep-violet)] to-[var(--ep-indigo)] px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  )
}
