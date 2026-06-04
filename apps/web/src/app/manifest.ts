import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Event Pulse — event ticketing for Bangladesh',
    short_name: 'Event Pulse',
    description:
      'Run your event. Get paid in 5 days. Branded pages, EPS checkout, QR check-in, and automated T+5 payouts.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#d32f2f',
    lang: 'en',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
