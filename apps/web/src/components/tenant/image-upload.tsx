'use client'

/**
 * ImageUpload — drag/click to upload a cover or logo to the public assets
 * bucket. Asks the API for a presigned PUT, uploads the file straight to S3,
 * and calls onChange with the permanent public URL. Used by the event cover
 * field and the Settings branding section. Falls back gracefully: callers can
 * still keep a URL text input alongside it.
 */

import { useRef, useState } from 'react'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 5 * 1024 * 1024

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

export function ImageUpload({
  value,
  kind,
  onChange,
}: {
  value: string
  kind: 'cover' | 'logo'
  onChange: (url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (!ACCEPT.includes(file.type)) {
      setError('Use a PNG, JPG, WebP or SVG image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be under 5 MB.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`${apiBase()}/api/v1/tenant/me/assets/upload-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind, contentType: file.type }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Could not start the upload.')
        setBusy(false)
        return
      }
      const { data } = (await res.json()) as { data: { uploadUrl: string; publicUrl: string } }
      const put = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      })
      if (!put.ok) {
        setError('Upload failed. Please try again.')
        setBusy(false)
        return
      }
      onChange(data.publicUrl)
      setBusy(false)
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="border-mkt-line flex items-center gap-3 rounded-md border bg-white p-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className={
              kind === 'logo'
                ? 'border-mkt-line size-12 rounded-md border object-contain'
                : 'border-mkt-line h-12 w-20 rounded-md border object-cover'
            }
          />
        ) : (
          <div className="border-mkt-line text-mkt-slate flex size-12 items-center justify-center rounded-md border border-dashed text-[10px]">
            none
          </div>
        )}

        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="border-mkt-line text-mkt-ink hover:border-mkt-red inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition disabled:opacity-50"
          >
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload image'}
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              disabled={busy}
              className="text-mkt-slate hover:text-mkt-red inline-flex h-9 items-center px-1 text-sm transition disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-mkt-red mt-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}
