import type { Metadata } from 'next'

import { ContactForm } from '@/components/marketing/contact-form'
import { GlassCard } from '@/components/ui/glass-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Contact — Event Pulse',
  description:
    'Reach the Event Pulse team for sales, support, legal, partnership, press, or security disclosures. We respond within 24 hours for support and 72 hours for security.',
}

const DIRECT_EMAILS = [
  { topic: 'Sales', email: 'sales@eventpulse.com.bd' },
  { topic: 'Support', email: 'support@eventpulse.com.bd' },
  { topic: 'Legal / Compliance', email: 'legal@eventpulse.com.bd' },
  { topic: 'Partnerships', email: 'partnerships@eventpulse.com.bd' },
  { topic: 'Press', email: 'press@eventpulse.com.bd' },
  { topic: 'Security disclosure', email: 'security@eventpulse.com.bd' },
] as const

export default function ContactPage() {
  return (
    <>
      <MarketingNavbar current="contact" />

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
          <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
            Contact
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--color-mkt-ink)] md:text-5xl">
            Tell us what you need.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-mkt-slate)]">
            Sales questions, support, legal compliance, partnership ideas, or security disclosures —
            pick the topic that fits and send a note.
          </p>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
            <GlassCard variant="strong" className="p-8 md:p-10">
              <ContactForm />
            </GlassCard>

            <div className="space-y-6">
              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">Direct emails</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {DIRECT_EMAILS.map((row) => (
                    <li key={row.email} className="flex flex-col">
                      <span className="text-xs text-[var(--color-mkt-slate)]">{row.topic}</span>
                      <a
                        href={`mailto:${row.email}`}
                        className="font-mono text-sm text-[var(--color-mkt-ink)] transition hover:text-[var(--color-mkt-red)]"
                      >
                        {row.email}
                      </a>
                    </li>
                  ))}
                </ul>
              </GlassCard>

              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">Office</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                  Public Pulse Agency
                  <br />
                  TiCON System Limited
                  <br />
                  Dhaka, Bangladesh
                </p>
              </GlassCard>

              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                  Response times
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-[var(--color-mkt-slate)]">
                  <li>Support &mdash; within 24 hours</li>
                  <li>Sales &mdash; within 1 business day</li>
                  <li>Security disclosures &mdash; within 72 hours</li>
                  <li>Legal &amp; press &mdash; within 3 business days</li>
                </ul>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}
