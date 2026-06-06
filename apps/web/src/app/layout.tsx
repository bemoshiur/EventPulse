import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Hind_Siliguri, Inter } from 'next/font/google'
import './globals.css'

import { OrganizationJsonLd } from '@/components/seo/structured-data'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hind-siliguri',
  display: 'swap',
})

const DESCRIPTION =
  'Run your event, get paid in 5 days. Event Pulse is the multi-tenant event ticketing platform for Bangladesh — branded event pages, custom registration forms, EPS checkout, QR check-in, and automated T+5 payouts at a transparent 0.25% fee.'

export const metadata: Metadata = {
  title: {
    default: 'Event Pulse — Run your event. Get paid in 5 days.',
    template: '%s · Event Pulse',
  },
  description: DESCRIPTION,
  metadataBase: new URL('https://eventpulse.com.bd'),
  applicationName: 'Event Pulse',
  authors: [{ name: 'Public Pulse Agency' }],
  creator: 'Public Pulse Agency',
  publisher: 'Public Pulse Agency',
  keywords: [
    'event ticketing Bangladesh',
    'sell tickets online Bangladesh',
    'event registration platform',
    'bKash ticket payment',
    'EPS checkout',
    'QR ticket check-in',
    'event management Bangladesh',
    'টিকিট বিক্রি',
    'ইভেন্ট রেজিস্ট্রেশন',
  ],
  alternates: { canonical: '/', languages: { en: '/', bn: '/bn' } },
  openGraph: {
    type: 'website',
    siteName: 'Event Pulse',
    title: 'Event Pulse — Run your event. Get paid in 5 days.',
    description: DESCRIPTION,
    url: 'https://eventpulse.com.bd',
    locale: 'en_US',
    alternateLocale: 'bn_BD',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Event Pulse — Run your event. Get paid in 5 days.',
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  category: 'technology',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${hindSiliguri.variable}`}
    >
      <body>
        {children}
        <OrganizationJsonLd />
      </body>
    </html>
  )
}
