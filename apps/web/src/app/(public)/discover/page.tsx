import type { Metadata } from 'next'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { DiscoverClient } from '@/components/public/discover-client'

export const metadata: Metadata = {
  title: 'Discover events in Bangladesh — concerts, comedy, conferences & more',
  description:
    'Browse and book tickets to events across Bangladesh — concerts, comedy nights, conferences, workshops, sports and community events. Filter by category and area.',
  alternates: { canonical: 'https://eventpulse.com.bd/discover' },
  openGraph: {
    title: 'Discover events in Bangladesh',
    description: 'Browse and book tickets to events across Bangladesh — by category and area.',
    url: 'https://eventpulse.com.bd/discover',
    type: 'website',
  },
}

export default function DiscoverPage() {
  return (
    <>
      <MarketingNavbar current="discover" />
      <main>
        <DiscoverClient />
      </main>
      <MarketingFooter />
    </>
  )
}
