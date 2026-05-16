import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Hind_Siliguri, Inter } from 'next/font/google'
import './globals.css'

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

export const metadata: Metadata = {
  title: {
    default: 'Event Pulse',
    template: '%s · Event Pulse',
  },
  description: 'Run your events. Get paid in 5 days. Ticketing built for Bangladesh.',
  metadataBase: new URL('https://eventpulse.com.bd'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${hindSiliguri.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
