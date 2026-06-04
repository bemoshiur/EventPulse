/**
 * Event Pulse blog — hand-authored field guides for organisers in Bangladesh.
 * Structured data (not MDX) so posts render as server components with no extra
 * pipeline. All content is original Event Pulse (events/ticketing) material.
 */

export type BlogCategory = 'guides' | 'payments' | 'operations' | 'product'

export const BLOG_CATEGORY_LABEL: Record<BlogCategory, string> = {
  guides: 'Guides',
  payments: 'Payments',
  operations: 'Operations',
  product: 'Product',
}

export interface BlogSection {
  heading?: string
  paragraphs: string[]
  bullets?: string[]
}

export interface BlogPost {
  slug: string
  title: string
  category: BlogCategory
  date: string // ISO
  readMinutes: number
  excerpt: string
  body: BlogSection[]
}

const POSTS: BlogPost[] = [
  {
    slug: 'sell-event-tickets-online-bangladesh',
    title: 'How to sell event tickets online in Bangladesh',
    category: 'guides',
    date: '2026-06-01',
    readMinutes: 6,
    excerpt:
      'A practical walkthrough — from a branded event page to bKash checkout to a payout that lands in five days — without a single spreadsheet.',
    body: [
      {
        paragraphs: [
          'Selling tickets in Bangladesh has historically meant a Google Form, a personal bKash number, and a WhatsApp group to track who actually paid. It works until it doesn’t — usually the night before the event, when nobody can agree on the final guest list.',
          'Here’s the modern version: one branded page, one checkout, one clean payout. This guide walks the whole flow.',
        ],
      },
      {
        heading: '1. Create a branded event page',
        paragraphs: [
          'Start with your event’s essentials — title, date, venue — and your logo and colours. The public page is generated for you, in both English and বাংলা, so every buyer reads it in the language they prefer.',
        ],
      },
      {
        heading: '2. Design the registration you need',
        paragraphs: [
          'Collect exactly what your event requires: names, phone numbers, NID for regulated events, dietary needs for a dinner, t-shirt sizes for a run. Conditional fields keep the form short for each buyer.',
        ],
      },
      {
        heading: '3. Open ticket sales',
        paragraphs: [
          'Add ticket tiers with prices, capacity, and a sales window. The moment you add a paid tier, a quick KYC step verifies you to handle money — then publish and share your link.',
        ],
      },
      {
        heading: '4. Get paid in five days',
        paragraphs: [
          'Buyers pay through EPS (bKash and more). You scan QR tickets at the gate, and net proceeds settle to your bank or MFS account five business days later — with a full statement of every fee.',
        ],
      },
    ],
  },
  {
    slug: 'free-vs-paid-events-when-kyc-kicks-in',
    title: 'Free vs paid events: when KYC actually kicks in',
    category: 'guides',
    date: '2026-05-28',
    readMinutes: 4,
    excerpt:
      'You can publish a free RSVP event with zero verification. KYC only appears the moment you decide to charge — here’s exactly when and why.',
    body: [
      {
        paragraphs: [
          'One of the most common questions from new organisers: “Do I have to do KYC just to make an event page?” The answer is no — and the rule is simple.',
        ],
      },
      {
        heading: 'Free events: instant, no verification',
        paragraphs: [
          'If every ticket tier is free, you can publish immediately. No KYC, no fees, no waiting. You still get a branded page, QR tickets, and web check-in — money is simply never involved.',
        ],
      },
      {
        heading: 'Paid events: KYC at the money moment',
        paragraphs: [
          'The first time you add a tier with a price above zero, we ask you to verify yourself. This is because we’re about to handle real money on your behalf, and Bangladesh’s financial rules require it.',
        ],
        bullets: [
          'Individual organisers: a quick Tier-1 KYC + a payout account.',
          'Organisations: organisation KYC with the relevant documents.',
          'Once approved, your paid tiers unlock and sales open.',
        ],
      },
    ],
  },
  {
    slug: 'understanding-t-plus-5-payouts-and-the-fee',
    title: 'Understanding T+5 payouts and the transparent 0.25%',
    category: 'payments',
    date: '2026-05-24',
    readMinutes: 5,
    excerpt:
      'What “T+5” means, how the 0.25% platform fee works, and why you always know exactly what will land in your account.',
    body: [
      {
        paragraphs: [
          'Money is the part of an event you can’t get wrong. Event Pulse is built so every taka is tracked from checkout to payout, and so you always know what you’ll receive before a single ticket sells.',
        ],
      },
      {
        heading: 'What T+5 means',
        paragraphs: [
          'Net proceeds settle to your bank account (BEFTN) or MFS wallet five business days after each transaction. Funds sit in escrow until then — separate from any personal account — and each payout comes with a statement of gross sales, fees, and refunds.',
        ],
      },
      {
        heading: 'The 0.25% platform fee',
        paragraphs: [
          'Event Pulse charges a flat 0.25% per paid transaction — published, predictable, no setup fee or monthly minimum. EPS gateway fees pass through at cost; we never mark them up. Free events cost nothing.',
        ],
      },
      {
        heading: 'Absorb or pass-through',
        paragraphs: [
          'Per event, you decide who carries the fees. Absorb deducts them from your payout so the buyer sees one clean price; pass-through adds them at checkout so you keep the full face value. The pricing calculator shows every combination.',
        ],
      },
    ],
  },
  {
    slug: 'eps-checkout-how-buyers-pay',
    title: 'EPS checkout: how buyers pay, and how you get paid',
    category: 'payments',
    date: '2026-05-20',
    readMinutes: 4,
    excerpt:
      'A look at the payment flow — why money never touches a personal wallet, and why we always verify with EPS instead of trusting the redirect.',
    body: [
      {
        paragraphs: [
          'When a buyer checks out on Event Pulse, the payment runs through EPS hosted checkout — bKash at launch, with more methods to follow. The money goes into the platform’s settlement flow, never a personal wallet.',
        ],
      },
      {
        heading: 'Why we verify server-side',
        paragraphs: [
          'After a buyer pays and returns to the success page, it would be easy — and wrong — to trust the redirect. Event Pulse always calls the EPS verify API server-side to confirm the real payment status before marking an order paid and issuing a ticket. It’s the difference between a ticket and a screenshot.',
        ],
      },
      {
        heading: 'Reconciliation built in',
        paragraphs: [
          'Every day, EPS settlement reports are matched against your orders. Discrepancies are flagged before any payout is released, so the numbers always tie out.',
        ],
      },
    ],
  },
  {
    slug: 'qr-check-in-without-an-app',
    title: 'QR check-in without an app: running a clean gate',
    category: 'operations',
    date: '2026-05-16',
    readMinutes: 4,
    excerpt:
      'How to check thousands of attendees in from any phone browser — offline-tolerant, de-duplicated, and gate-by-gate.',
    body: [
      {
        paragraphs: [
          'The gate is where events fall apart: a printed list, a slow queue, and screenshot “tickets” being passed around. Event Pulse turns any phone browser into a scanner — no app to install, no hardware to buy.',
        ],
      },
      {
        heading: 'Scan from any browser',
        paragraphs: [
          'Open the check-in page on a phone, point it at the attendee’s QR, and they’re in. Each scan is instant and de-duplicated, so a forwarded ticket can’t be used twice.',
        ],
      },
      {
        heading: 'Offline-tolerant + multi-gate',
        paragraphs: [
          'If the venue Wi-Fi is patchy, scans queue locally and sync when the connection returns. Tag each scan with a gate label, and your post-event report shows exactly who came in through which door.',
        ],
      },
    ],
  },
  {
    slug: 'custom-registration-forms-that-collect-what-you-need',
    title: 'Custom registration forms that collect exactly what you need',
    category: 'product',
    date: '2026-05-12',
    readMinutes: 3,
    excerpt:
      'From a simple RSVP to a multi-field delegate form — how to capture the right data without scaring buyers off.',
    body: [
      {
        paragraphs: [
          'The best registration form asks for everything you need and nothing you don’t. Event Pulse gives you the field types and the logic to hit that balance.',
        ],
      },
      {
        heading: 'The field types',
        paragraphs: [
          'Text, email, phone, NID, file upload, dropdowns, radio, dates — the same engine powers both the form you design and the one your buyer fills.',
        ],
      },
      {
        heading: 'Conditional logic + per-tier forms',
        paragraphs: [
          'Show fields only when they’re relevant, and vary the form by ticket tier — a delegate form for VIPs, a lighter form for general admission. Buyers see a short, clear form; you still get the structured data you need.',
        ],
      },
    ],
  },
]

export function getAllBlogPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug)
}

export function getBlogCategories(): BlogCategory[] {
  return Array.from(new Set(POSTS.map((p) => p.category)))
}

export function formatBlogDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}
