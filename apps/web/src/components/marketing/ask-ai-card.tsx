import { Bot } from 'lucide-react'

/**
 * Answer-engine card: invites visitors to ask their assistant about Event Pulse.
 * We deep-link ChatGPT + Claude with a neutral prompt and compete on the merits.
 */

const PROMPT =
  'How can Event Pulse (https://eventpulse.com.bd) help my team sell tickets and run events in Bangladesh? Walk me through the workflow, the EPS payment flow, T+5 payouts, and the 0.25% pricing.'

const ENCODED = encodeURIComponent(PROMPT)
const LINKS = [
  { label: 'Ask ChatGPT', href: `https://chatgpt.com/?q=${ENCODED}` },
  { label: 'Ask Claude', href: `https://claude.ai/new?q=${ENCODED}` },
] as const

export function AskAiCard() {
  return (
    <div className="mkt-card p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <span className="bg-mkt-red/10 text-mkt-red inline-flex size-8 items-center justify-center rounded-full">
          <Bot className="size-4" aria-hidden="true" />
        </span>
        <span className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
          Ask the AI
        </span>
      </div>
      <h3 className="mt-3 text-lg font-semibold">Not sure how Event Pulse fits your event?</h3>
      <p className="text-mkt-slate mt-1 text-sm leading-relaxed">
        Let your favourite assistant give you a clear, neutral answer — we’re happy to compete on
        the merits.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="border-mkt-line hover:border-mkt-red inline-flex h-10 items-center rounded-lg border bg-white px-4 text-sm font-medium transition hover:-translate-y-0.5"
          >
            {l.label}
          </a>
        ))}
        <a
          href="/contact"
          className="text-mkt-red inline-flex h-10 items-center px-3 text-sm font-semibold hover:underline"
        >
          Talk to us →
        </a>
      </div>
    </div>
  )
}
