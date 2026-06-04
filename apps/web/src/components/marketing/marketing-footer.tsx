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
    <footer className="border-mkt-line bg-mkt-soft border-t font-[family-name:var(--font-bangla)]">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-12 md:grid-cols-4">
          <div>
            <Link
              href="/"
              className="text-mkt-ink flex items-center gap-2 text-base font-bold tracking-tight"
            >
              <span aria-hidden="true" className="bg-mkt-red inline-block size-2.5 rounded-full" />
              Event Pulse
            </Link>
            <p className="text-mkt-slate mt-4 text-sm leading-relaxed">
              Built for Bangladesh. Hosted by Public Pulse Agency &middot; TiCON System Limited.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-mkt-slate text-xs font-semibold tracking-[0.18em] uppercase">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-mkt-slate hover:text-mkt-red text-sm transition"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-mkt-line text-mkt-slate mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 text-xs md:flex-row">
          <span>&copy; 2026 Public Pulse Agency &middot; TiCON System Limited</span>
          <span>Dhaka, Bangladesh 🇧🇩</span>
        </div>
      </div>
    </footer>
  )
}
