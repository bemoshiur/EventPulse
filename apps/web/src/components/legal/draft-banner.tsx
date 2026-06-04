/**
 * Non-dismissable DRAFT banner — Sprint 2 Day 19 Item 14.
 *
 * Per `.claude/memory/decisions.md` "Trust Center v0.1 placeholders —
 * skeleton-only, no AI-generated full text" (2026-05-17, load-bearing):
 * every v0.x version of a legal document MUST render a prominent,
 * non-dismissable banner stating the document is a draft with no legal
 * effect. The banner stops rendering automatically once counsel
 * publishes a v1.0.0 (the `isDraft` flag in LegalDocumentRender flips
 * to false; the Server Component only mounts this component when it's
 * true).
 *
 * Server-only by design — no `'use client'`, no dismiss button, no
 * localStorage interaction. The banner is a permanent part of the
 * page until a v1.0+ version ships.
 */

export function DraftBanner({ version }: { version: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="text-mkt-ink mb-8 rounded-2xl border border-[var(--ep-amber)]/60 bg-[var(--ep-amber)]/10 p-5"
    >
      <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">
        Draft · {version}
      </p>
      <p className="text-mkt-slate mt-2 text-sm leading-relaxed">
        This document is a structural placeholder. Final legal content will be drafted by counsel
        before MVP launch. <strong>No legal effect is intended or implied</strong> by the version
        currently published here.
      </p>
    </div>
  )
}
