/**
 * Shared Trust Center document page — Sprint 2 Day 19 Item 14
 * (Decision K 2026-05-19).
 *
 * Renders a single legal document (one of 18) with title, version
 * metadata, optional DRAFT banner, and the pre-rendered body_html.
 *
 * Server-only by design. The body_html is already sanitized server-side
 * by the unified pipeline at publish time (Decision J, see
 * apps/api/src/domain/legal/render.ts) so React's raw-HTML escape hatch
 * here is the documented architecture — the security boundary is the
 * pipeline, not this component.
 */

import Link from 'next/link'

import type { LegalDocumentRender } from '@/lib/legal'
import { DraftBanner } from './draft-banner'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function LegalDocumentPage({ doc }: { doc: LegalDocumentRender }) {
  const v = doc.currentVersion
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <nav aria-label="Breadcrumb" className="text-mkt-slate mb-6 text-sm">
        <Link href="/trust" className="hover:text-mkt-red">
          Trust Center
        </Link>
        <span aria-hidden="true" className="px-2">
          ·
        </span>
        <span className="text-mkt-ink">{doc.title}</span>
      </nav>

      <h1 className="text-mkt-ink text-3xl font-semibold md:text-4xl">{doc.title}</h1>
      <p className="text-mkt-slate mt-3 text-sm">
        Effective {formatDate(v.effectiveAt)} · Version {v.version}
        {v.materialChange ? ' · Material change' : ''}
      </p>

      {v.isDraft ? (
        <div className="mt-8">
          <DraftBanner version={v.version} />
        </div>
      ) : null}

      <BodyHtml html={v.bodyHtml} />

      <hr className="border-mkt-line mt-16" />
      <p className="text-mkt-slate mt-8 text-sm">
        Questions about this document?{' '}
        <Link href="/contact" className="text-mkt-red hover:underline">
          Contact us →
        </Link>
      </p>
    </article>
  )
}

function BodyHtml({ html }: { html: string }) {
  // body_html has been sanitized server-side by rehype-sanitize with
  // the defaultSchema allowlist at publish time (Decision J). React's
  // raw-HTML escape hatch is used deliberately here — the security
  // boundary is the unified pipeline, not this renderer.
  const props = {
    className:
      'prose prose-neutral mt-8 max-w-none text-mkt-ink prose-headings:text-mkt-ink prose-a:text-mkt-red',
    dangerouslySetInnerHTML: { __html: html },
  }
  return <div {...props} />
}
