import type { Metadata } from 'next'

import { ContactForm } from '@/components/marketing/contact-form'
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
          <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">Contact</p>
          <h1 className="text-mkt-ink mt-3 text-3xl font-semibold md:text-5xl">
            Tell us what you need.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Sales questions, support, legal compliance, partnership ideas, or security disclosures —
            pick the topic that fits and send a note.
          </p>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
            <div className="mkt-card p-8 md:p-10">
              <ContactForm />
            </div>

            <div className="space-y-6">
              <div className="mkt-card p-6">
                <h3 className="text-mkt-ink text-sm font-semibold">Direct emails</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {DIRECT_EMAILS.map((row) => (
                    <li key={row.email} className="flex flex-col">
                      <span className="text-mkt-slate text-xs">{row.topic}</span>
                      <a
                        href={`mailto:${row.email}`}
                        className="text-mkt-ink hover:text-mkt-red font-mono text-sm transition"
                      >
                        {row.email}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mkt-card p-6">
                <h3 className="text-mkt-ink text-sm font-semibold">Office</h3>
                <p className="text-mkt-slate mt-3 text-sm leading-relaxed">
                  Public Pulse Agency
                  <br />
                  TiCON System Limited
                  <br />
                  Dhaka, Bangladesh
                </p>
              </div>

              <div className="mkt-card p-6">
                <h3 className="text-mkt-ink text-sm font-semibold">Response times</h3>
                <ul className="text-mkt-slate mt-3 space-y-2 text-sm">
                  <li>Support &mdash; within 24 hours</li>
                  <li>Sales &mdash; within 1 business day</li>
                  <li>Security disclosures &mdash; within 72 hours</li>
                  <li>Legal &amp; press &mdash; within 3 business days</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}
