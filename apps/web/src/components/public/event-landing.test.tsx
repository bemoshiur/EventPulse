/**
 * EventLanding component tests — Sprint 3 Day 25 Phase 2.
 *
 * Pins:
 *   - brand-slot rendering (logo, primary/accent color CSS vars)
 *   - bilingual copy (English + Bangla)
 *   - tier display (price formatting, availability text, sold-out state,
 *     complimentary rendering)
 *   - empty-tiers fallback ("Tickets coming soon")
 *   - missing brand-color fallback (no inline style chaos)
 *   - axe accessibility (per frontend test rig precedent)
 */

import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import { render, screen } from '@testing-library/react'

import { EventLanding } from './event-landing'
import type {
  PublicEventBrandWire,
  PublicEventTierWire,
  PublicEventWire,
} from '@/lib/public-events'

const baseEvent: PublicEventWire = {
  id: 'evt-1',
  slug: 'summer-sounds-2026',
  type: 'concert',
  title: 'Summer Sounds 2026',
  titleBn: null,
  description: 'A summer concert',
  descriptionBn: null,
  startsAt: '2026-06-15T14:00:00.000Z',
  endsAt: '2026-06-15T17:00:00.000Z',
  timezone: 'Asia/Dhaka',
  venue: {
    type: 'physical',
    name: 'Dhaka Auditorium',
    address: '12 Mirpur Road',
    division: 'dhaka',
    district: 'Dhaka',
  },
  capacity: 500,
  bannerImageUrl: null,
  visibility: 'public',
  status: 'on_sale',
  publishedAt: '2026-05-01T00:00:00.000Z',
}

const baseBrand: PublicEventBrandWire = {
  logoUrl: null,
  primaryColor: '#6C4FE0',
  accentColor: '#FF6F61',
  tenantName: 'PublicPulse',
}

const baseTier: PublicEventTierWire = {
  id: 'tier-1',
  name: 'General Admission',
  description: 'Standing area',
  pricePaisa: '100000',
  capacity: 100,
  sold: 25,
  salesStartAt: null,
  salesEndAt: null,
  isComplimentary: false,
  sortOrder: 0,
}

describe('<EventLanding>', () => {
  it('renders title + venue + start/end', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[baseTier]} />)
    expect(screen.getByText('Summer Sounds 2026')).toBeInTheDocument()
    expect(screen.getByText(/Dhaka Auditorium/)).toBeInTheDocument()
  })

  it('renders "Powered by Event Pulse" footer with tenant name', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[]} />)
    expect(screen.getByText(/Powered by/i)).toBeInTheDocument()
    // Tenant name appears in BOTH header (no-logo fallback) + footer;
    // assert at least one occurrence rather than a single-match selector.
    expect(screen.getAllByText('PublicPulse').length).toBeGreaterThanOrEqual(1)
  })

  it('renders brand logo when present', () => {
    const brand = { ...baseBrand, logoUrl: 'https://cdn.example/logo.png' }
    render(<EventLanding event={baseEvent} brand={brand} tiers={[]} />)
    expect(screen.getByAltText('PublicPulse logo')).toBeInTheDocument()
  })

  it('falls back to tenant name when logo missing', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[]} />)
    expect(screen.queryByAltText('PublicPulse logo')).not.toBeInTheDocument()
    expect(screen.getAllByText('PublicPulse').length).toBeGreaterThan(0)
  })

  it('renders Bangla title when present', () => {
    const event = { ...baseEvent, titleBn: 'গ্রীষ্মের সুর ২০২৬' }
    render(<EventLanding event={event} brand={baseBrand} tiers={[]} />)
    expect(screen.getByText('গ্রীষ্মের সুর ২০২৬')).toBeInTheDocument()
  })

  it('renders Bangla description alongside English when both present', () => {
    const event = {
      ...baseEvent,
      description: 'English copy',
      descriptionBn: 'বাংলা কপি',
    }
    render(<EventLanding event={event} brand={baseBrand} tiers={[]} />)
    expect(screen.getByText('English copy')).toBeInTheDocument()
    expect(screen.getByText('বাংলা কপি')).toBeInTheDocument()
  })

  it('renders empty-tickets fallback when tiers list is empty', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[]} />)
    expect(screen.getByTestId('tickets-empty')).toBeInTheDocument()
  })

  it('renders tier card with BDT-formatted price (thousands-grouped)', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[baseTier]} />)
    expect(screen.getByTestId('tier-card-tier-1')).toBeInTheDocument()
    // Day-34 BuyerForm formats with thousand-separators; 100000 paisa → "৳ 1,000.00"
    expect(screen.getByText('৳ 1,000.00')).toBeInTheDocument()
  })

  it('renders complimentary tier as "Free"', () => {
    const tier = { ...baseTier, id: 'tier-2', isComplimentary: true, pricePaisa: '0' }
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[tier]} />)
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('shows "Sold out" when sold equals capacity', () => {
    const tier = { ...baseTier, id: 'tier-so', sold: 100 }
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[tier]} />)
    expect(screen.getByText('Sold out')).toBeInTheDocument()
  })

  it('shows "Only N left" when remaining ≤ 10', () => {
    const tier = { ...baseTier, id: 'tier-low', sold: 93 }
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[tier]} />)
    expect(screen.getByText('Only 7 left')).toBeInTheDocument()
  })

  it('renders the BuyerForm submit CTA (Day 34 replaces the Day-25 placeholder)', () => {
    render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[baseTier]} />)
    // BuyerForm owns the submit button now; assert it is rendered + actionable.
    const btn = screen.getByTestId('buyer-form-submit')
    expect(btn).toBeInTheDocument()
    // No tier qty selected by default → submit is disabled (UX guard, not auth).
    expect(btn).toBeDisabled()
  })

  it('sets brand-color CSS vars on the root', () => {
    const { container } = render(<EventLanding event={baseEvent} brand={baseBrand} tiers={[]} />)
    const root = container.querySelector('[data-testid="event-landing"]') as HTMLElement
    expect(root.style.getPropertyValue('--brand-primary')).toBe('#6C4FE0')
    expect(root.style.getPropertyValue('--brand-accent')).toBe('#FF6F61')
  })

  it('falls back to platform colors when brand colors null', () => {
    const brand = { ...baseBrand, primaryColor: null, accentColor: null }
    const { container } = render(<EventLanding event={baseEvent} brand={brand} tiers={[]} />)
    const root = container.querySelector('[data-testid="event-landing"]') as HTMLElement
    expect(root.style.getPropertyValue('--brand-primary')).toBe('#6C4FE0')
    expect(root.style.getPropertyValue('--brand-accent')).toBe('#FF6F61')
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <EventLanding event={baseEvent} brand={baseBrand} tiers={[baseTier]} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
