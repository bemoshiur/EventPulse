import Link from 'next/link'

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/legal/changelog', label: 'What’s new' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/contact', label: 'Contact' },
      { href: '/trust', label: 'Trust Center' },
      { href: '/trust/security/disclosure', label: 'Security disclosure' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refund-policy', label: 'Refund Policy' },
      { href: '/cookies', label: 'Cookie Policy' },
    ],
  },
] as const

export function MarketingFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--mkt-line)]/60 bg-[var(--white)]/40 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-12 md:grid-cols-4">
          <div>
            <Link
              href="/"
              className="font-display flex items-center gap-2 text-base font-semibold text-[var(--mkt-ink)]"
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-full bg-gradient-to-br from-[var(--color-mkt-red)] to-[var(--mkt-red)]"
              />
              Event Pulse
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
              Built for Bangladesh. Hosted by Public Pulse Agency &middot; TiCON System Limited.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold tracking-widest text-[var(--color-mkt-slate)] uppercase">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--color-mkt-slate)] transition hover:text-[var(--mkt-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--mkt-line)]/60 pt-6 text-xs text-[var(--color-mkt-slate)] md:flex-row">
          <span>&copy; 2026 Public Pulse Agency &middot; TiCON System Limited</span>
          <span>Dhaka, Bangladesh</span>
        </div>
      </div>
    </footer>
  )
}
