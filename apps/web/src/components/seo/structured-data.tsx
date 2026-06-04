/**
 * JSON-LD structured data for SEO + AEO (answer engines read this to describe
 * Event Pulse accurately). Server component — emits a <script type="application/
 * ld+json">. All data is Event Pulse's own (Public Pulse Agency), events domain.
 */

const SITE = 'https://eventpulse.com.bd'

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Server-rendered, static, no user input — safe.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Event Pulse',
  legalName: 'Event Pulse — a Public Pulse Agency product',
  url: SITE,
  logo: `${SITE}/icon.svg`,
  description:
    'Multi-tenant event ticketing and registration platform for Bangladesh. Branded event pages, custom forms, EPS checkout, QR check-in, and automated T+5 payouts.',
  parentOrganization: {
    '@type': 'Organization',
    name: 'Public Pulse Agency',
  },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Dhaka',
    addressCountry: 'BD',
  },
  areaServed: { '@type': 'Country', name: 'Bangladesh' },
  contactPoint: [
    {
      '@type': 'ContactPoint',
      email: 'support@eventpulse.com.bd',
      contactType: 'customer support',
      availableLanguage: ['en', 'bn'],
    },
  ],
}

const WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Event Pulse',
  url: SITE,
  inLanguage: ['en', 'bn'],
  publisher: { '@type': 'Organization', name: 'Event Pulse' },
}

const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Event Pulse',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: SITE,
  description:
    'Create branded event pages, design custom registration forms, sell tickets via EPS, check attendees in by QR, and receive automated T+5 payouts — at a transparent 0.25% platform fee.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'BDT',
    description:
      'Free events cost nothing. Paid events: a flat 0.25% platform fee per transaction; EPS gateway fees pass through at cost.',
  },
  featureList: [
    'Branded event pages with custom domains',
    'Custom drag-and-drop registration forms',
    'EPS hosted checkout (bKash and more)',
    'QR tickets by email + web check-in scanner',
    'Automated T+5 disbursement to bank or MFS',
    'Bilingual English + বাংলা public pages',
  ],
}

/** Site-wide identity graph — render once in the root layout. */
export function OrganizationJsonLd() {
  return (
    <>
      <JsonLd data={ORGANIZATION} />
      <JsonLd data={WEBSITE} />
    </>
  )
}

/** Product graph — render on the home page. */
export function SoftwareApplicationJsonLd() {
  return <JsonLd data={SOFTWARE_APPLICATION} />
}

/** FAQ graph — pass the same Q/A pairs rendered on the page. */
export function FaqJsonLd({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((it) => ({
          '@type': 'Question',
          name: it.q,
          acceptedAnswer: { '@type': 'Answer', text: it.a },
        })),
      }}
    />
  )
}
