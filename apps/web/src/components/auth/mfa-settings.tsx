'use client'

/**
 * Two-factor (TOTP) settings — enroll (QR + confirm code → recovery codes),
 * status, and disable. Lives in tenant Settings → Security.
 */

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

const INPUT =
  'border-mkt-line text-mkt-ink focus:border-mkt-red h-11 w-40 rounded-md border bg-white px-3 text-center text-lg tracking-[0.25em] focus:outline-none'

export function MfaSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [enroll, setEnroll] = useState<{ qrDataUrl: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadStatus() {
    const r = await fetch(`${apiBase()}/api/v1/auth/mfa/status`, { credentials: 'include' })
    if (r.ok) {
      const b = (await r.json()) as { data: { enabled: boolean } }
      setEnabled(b.data.enabled)
    } else {
      setEnabled(false)
    }
  }
  useEffect(() => {
    void loadStatus()
  }, [])

  async function startEnroll() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/mfa/enroll`, {
        method: 'POST',
        credentials: 'include',
      })
      if (r.ok) {
        const b = (await r.json()) as { data: { qrDataUrl: string; secret: string } }
        setEnroll(b.data)
      } else setError('Could not start setup.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/mfa/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      })
      if (r.ok) {
        const b = (await r.json()) as { data: { recoveryCodes: string[] } }
        setRecovery(b.data.recoveryCodes)
        setEnroll(null)
        setCode('')
        setEnabled(true)
      } else setError('Incorrect code. Try the current code from your app.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/mfa/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      })
      if (r.ok) {
        setEnabled(false)
        setDisabling(false)
        setCode('')
      } else setError('Incorrect code.')
    } finally {
      setBusy(false)
    }
  }

  if (enabled === null) {
    return <p className="text-mkt-slate text-sm">Loading…</p>
  }

  // Recovery codes (shown once right after enabling)
  if (recovery) {
    return (
      <div className="border-mkt-line rounded-2xl border bg-white p-5">
        <p className="text-mkt-ink flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-emerald-600" /> Two-factor is on
        </p>
        <p className="text-mkt-slate mt-2 text-sm">
          Save these recovery codes somewhere safe — each works once if you lose your authenticator.
          <strong> You won’t see them again.</strong>
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
          {recovery.map((c) => (
            <li
              key={c}
              className="border-mkt-line rounded border bg-[var(--color-mkt-soft)] px-3 py-1.5"
            >
              {c}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setRecovery(null)}
          className="bg-mkt-red mt-4 inline-flex h-10 items-center rounded-md px-5 text-sm font-semibold text-white"
        >
          I’ve saved them
        </button>
      </div>
    )
  }

  // Enrolling: QR + confirm
  if (enroll) {
    return (
      <div className="border-mkt-line rounded-2xl border bg-white p-5">
        <p className="text-mkt-ink font-semibold">Set up two-factor authentication</p>
        <p className="text-mkt-slate mt-1 text-sm">
          Scan this with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code.
        </p>
        <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qrDataUrl} alt="2FA QR code" className="size-40 rounded-lg border" />
          <div className="text-sm">
            <p className="text-mkt-slate">Or enter this key manually:</p>
            <code className="text-mkt-ink mt-1 block font-mono text-xs break-all">
              {enroll.secret}
            </code>
          </div>
        </div>
        <div className="mt-4 flex items-end gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="123456"
            className={INPUT}
          />
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="bg-mkt-red inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Verifying…' : 'Turn on 2FA'}
          </button>
        </div>
        {error && <p className="text-mkt-red mt-2 text-xs">{error}</p>}
      </div>
    )
  }

  // Status: on (disable) / off (enable)
  return (
    <div className="border-mkt-line rounded-2xl border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-mkt-ink flex items-center gap-2 font-semibold">
            {enabled ? (
              <>
                <ShieldCheck className="size-5 text-emerald-600" /> Two-factor is on
              </>
            ) : (
              <>
                <ShieldOff className="text-mkt-slate size-5" /> Two-factor is off
              </>
            )}
          </p>
          <p className="text-mkt-slate mt-1 text-sm">
            {enabled
              ? 'Your account asks for a code from your authenticator app at sign-in.'
              : 'Add a second step at sign-in with an authenticator app (recommended).'}
          </p>
        </div>
        {!enabled && !disabling && (
          <button
            type="button"
            disabled={busy}
            onClick={startEnroll}
            className="bg-mkt-red inline-flex h-10 shrink-0 items-center rounded-md px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Enable 2FA
          </button>
        )}
        {enabled && !disabling && (
          <button
            type="button"
            onClick={() => setDisabling(true)}
            className="border-mkt-line text-mkt-ink inline-flex h-10 shrink-0 items-center rounded-md border px-5 text-sm font-semibold"
          >
            Disable
          </button>
        )}
      </div>
      {disabling && (
        <div className="border-mkt-line mt-4 flex items-end gap-3 border-t pt-4">
          <div>
            <p className="text-mkt-slate text-xs">
              Enter a current code (or recovery code) to turn off 2FA.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="123456"
              className={`${INPUT} mt-1`}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={disable}
            className="bg-mkt-red inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Disabling…' : 'Disable 2FA'}
          </button>
          <button
            type="button"
            onClick={() => {
              setDisabling(false)
              setCode('')
              setError(null)
            }}
            className="text-mkt-slate h-11 text-xs hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-mkt-red mt-2 text-xs">{error}</p>}
    </div>
  )
}
