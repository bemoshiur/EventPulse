'use client'

/**
 * Publish-new-version form — Sprint 2 Day 19 Item 15.
 *
 * Textarea-based markdown editor. Per Decision J the server is the
 * sanitization boundary — the form only accepts body_md, never HTML.
 * On submit, POSTs to /api/v1/admin/legal/documents/:slug/versions; the
 * server runs the unified pipeline + stores body_html.
 *
 * Material-change checkbox flagged carefully — it triggers re-consent
 * broadcasts in Sprint 3+. Today (Decision L) the broadcast doesn't
 * fire, but the flag persists for future use.
 */

import { useState, type FormEvent } from 'react'

import { usePublishVersion } from '@/hooks/use-admin-legal'

interface Props {
  slug: string
  currentVersion: string
  onPublished: () => void
}

export function PublishVersionForm({ slug, currentVersion, onPublished }: Props) {
  const [version, setVersion] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [summary, setSummary] = useState('')
  const [material, setMaterial] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = usePublishVersion(slug)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLocalError(null)
    if (!version.trim() || !bodyMd.trim()) {
      setLocalError('Version and body are required.')
      return
    }
    try {
      await mutation.mutateAsync({
        version: version.trim(),
        bodyMd,
        ...(summary.trim() ? { summaryOfChanges: summary.trim() } : {}),
        materialChange: material,
      })
      setVersion('')
      setBodyMd('')
      setSummary('')
      setMaterial(false)
      onPublished()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Publish failed.')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6"
    >
      <div>
        <h3 className="text-base font-semibold text-[var(--ep-ink)]">Publish new version</h3>
        <p className="mt-1 text-sm text-[var(--ep-graphite)]">
          Current version is <code>{currentVersion}</code>. New version must be unique for this
          document.
        </p>
      </div>

      <div>
        <label htmlFor="legal-version" className="block text-xs font-medium text-[var(--ep-ink)]">
          Version
        </label>
        <input
          id="legal-version"
          type="text"
          required
          placeholder="e.g. v1.0.0"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)] focus:border-[var(--ep-violet)] focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="legal-body" className="block text-xs font-medium text-[var(--ep-ink)]">
          Body (markdown)
        </label>
        <textarea
          id="legal-body"
          required
          rows={16}
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--ep-line)] bg-white px-3 py-2 font-mono text-sm text-[var(--ep-ink)] focus:border-[var(--ep-violet)] focus:outline-none"
        />
        <p className="mt-1 text-xs text-[var(--ep-graphite)]">
          HTML is sanitized server-side. Inline scripts, event handlers, and unsafe URI schemes are
          stripped.
        </p>
      </div>

      <div>
        <label htmlFor="legal-summary" className="block text-xs font-medium text-[var(--ep-ink)]">
          Summary of changes (optional)
        </label>
        <input
          id="legal-summary"
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)] focus:border-[var(--ep-violet)] focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="legal-material"
          className="flex items-center gap-2 text-sm text-[var(--ep-ink)]"
        >
          <input
            id="legal-material"
            type="checkbox"
            checked={material}
            onChange={(e) => setMaterial(e.target.checked)}
            className="size-4"
          />
          Material change (will trigger re-consent broadcast once Sprint 3 ships the consent gate)
        </label>
      </div>

      {localError ? (
        <div
          role="alert"
          className="rounded-lg border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 px-3 py-2 text-sm text-[var(--ep-ink)]"
        >
          {localError}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-[var(--ep-violet)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--ep-indigo)] disabled:opacity-50"
        >
          {mutation.isPending ? 'Publishing…' : 'Publish version'}
        </button>
      </div>
    </form>
  )
}
