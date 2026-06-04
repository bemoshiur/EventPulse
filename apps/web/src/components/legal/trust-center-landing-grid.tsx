/**
 * Trust Center landing — Sprint 2 Day 19 Item 14.
 *
 * Renders the two card grids per §20.2: 6 legal contracts + 12 trust
 * artefacts. Each card links to the document's canonical_url_path
 * (Decision M.3) and surfaces a DRAFT badge while the document is at
 * v0.x.
 *
 * Server-only.
 */

import type { LegalDocumentLandingRow } from '@/lib/legal'

interface Props {
  rows: LegalDocumentLandingRow[]
}

export function TrustCenterLandingGrid({ rows }: Props) {
  const contracts = rows.filter((r) => r.category === 'legal_contract')
  const artefacts = rows.filter((r) => r.category === 'trust_artefact')

  return (
    <div className="mx-auto max-w-5xl space-y-16">
      <Section
        eyebrow="Legal contracts · signed at consent"
        title="The contractual foundation"
        intro="Material changes trigger a one-time consent re-prompt at next login — we never silently amend a signed agreement."
        rows={contracts}
      />
      <Section
        eyebrow="Trust artefacts · published policies"
        title="Standards we hold ourselves to"
        intro="Published policies — not contracts you sign, but standards we hold ourselves to. Updated as our practices evolve."
        rows={artefacts}
      />
    </div>
  )
}

function Section({
  eyebrow,
  title,
  intro,
  rows,
}: {
  eyebrow: string
  title: string
  intro: string
  rows: LegalDocumentLandingRow[]
}) {
  return (
    <section>
      <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
      <h2 className="text-mkt-ink mt-2 text-2xl font-semibold md:text-3xl">{title}</h2>
      <p className="text-mkt-slate mt-3 max-w-2xl text-sm leading-relaxed">{intro}</p>

      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.slug}>
            <a
              href={row.canonicalUrlPath}
              className="block transition hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="mkt-card h-full p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-mkt-ink text-base font-semibold">{row.title}</h3>
                  {row.currentVersion.isDraft ? (
                    <span className="bg-mkt-red/10 text-mkt-red rounded-full px-2 py-0.5 text-xs font-medium">
                      Draft
                    </span>
                  ) : null}
                </div>
                <p className="text-mkt-slate mt-2 text-sm leading-relaxed">{row.oneLiner}</p>
                <p className="text-mkt-slate mt-3 text-xs">Version {row.currentVersion.version}</p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
