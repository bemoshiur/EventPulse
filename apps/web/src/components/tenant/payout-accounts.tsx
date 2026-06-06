'use client'

/**
 * Payout-account setup — the disbursement entry point. KYC-at-disbursement:
 * if the tenant isn't KYC-approved we show a "verify to get paid" CTA instead
 * of the form. Once approved, the tenant can add a bank / MFS account.
 */

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Landmark, ShieldCheck, Plus } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface Account {
  id: string
  accountType: string
  accountName: string
  accountNumberLast4: string
  bankName: string | null
  isPrimary: boolean
}

const ACCOUNT_TYPES = [
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'upay', label: 'Upay' },
  { value: 'bank', label: 'Bank account' },
] as const

const INPUT =
  'border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-11 w-full rounded-md border bg-white px-3 text-sm focus:outline-none'

export function PayoutAccounts() {
  const [kyc, setKyc] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    accountType: 'bkash',
    accountName: '',
    accountNumber: '',
    bankName: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [meRes, acctRes] = await Promise.all([
        fetch(`${apiBase()}/api/v1/tenant/me`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${apiBase()}/api/v1/tenant/payout-accounts`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ])
      if (meRes.ok) {
        const b = (await meRes.json()) as { data: { tenant: { kycStatus: string } } }
        setKyc(b.data.tenant.kycStatus)
      }
      if (acctRes.ok) {
        const b = (await acctRes.json()) as { data: Account[] }
        setAccounts(b.data)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/tenant/payout-accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountType: form.accountType,
          accountName: form.accountName.trim(),
          accountNumber: form.accountNumber.trim(),
          ...(form.accountType === 'bank' && form.bankName
            ? { bankName: form.bankName.trim() }
            : {}),
        }),
      })
      if (r.ok) {
        setAdding(false)
        setForm({ accountType: 'bkash', accountName: '', accountNumber: '', bankName: '' })
        await load()
        return
      }
      const b = await r.json().catch(() => ({}))
      setError(
        b?.error?.code === 'KYC_NOT_APPROVED'
          ? 'Verify your identity before adding a payout account.'
          : (b?.error?.message ?? 'Could not add the account.'),
      )
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="border-mkt-line text-mkt-slate rounded-2xl border bg-white p-6 text-sm">
        Loading…
      </div>
    )
  }

  // ─── KYC gate ───
  if (kyc !== 'approved') {
    const submitted = kyc === 'submitted' || kyc === 'under_review'
    return (
      <div className="border-mkt-line rounded-2xl border bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="bg-mkt-red/10 text-mkt-red flex size-11 shrink-0 items-center justify-center rounded-full">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-mkt-ink font-semibold">Verify your identity to receive payouts</h3>
            <p className="text-mkt-slate mt-1 text-sm">
              You can sell tickets right away. To withdraw your earnings we need to verify you (KYC)
              — a Bangladesh Bank / BFIU requirement for handling money on your behalf.
            </p>
            {submitted ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Your verification is under review. We’ll email you when it’s approved.
              </p>
            ) : (
              <Link
                href="/kyc"
                className="bg-mkt-red mt-4 inline-flex h-10 items-center justify-center rounded-md px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Start verification
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── Approved: accounts + add form ───
  return (
    <div className="border-mkt-line rounded-2xl border bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-mkt-ink font-semibold">Payout accounts</h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-mkt-red inline-flex items-center gap-1 text-sm font-semibold hover:underline"
          >
            <Plus className="size-4" /> Add account
          </button>
        )}
      </div>

      {accounts.length === 0 && !adding && (
        <p className="text-mkt-slate mt-3 text-sm">
          No payout account yet. Add a bank or mobile-money account to receive your settlements.
        </p>
      )}

      <p className="text-mkt-slate mt-3 rounded-md border border-[var(--color-mkt-line)] bg-[var(--color-mkt-soft)] px-3 py-2 text-xs leading-relaxed">
        How payouts work: settlements are released <strong>5 business days (T+5)</strong> after each
        paid event and reviewed by our finance team before the transfer is sent to your primary
        account. You’ll be emailed when a payout is on its way.
      </p>

      <ul className="mt-4 space-y-2">
        {accounts.map((a) => (
          <li
            key={a.id}
            className="border-mkt-line flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <Landmark className="text-mkt-slate size-4" />
              <span className="text-mkt-ink font-medium capitalize">{a.accountType}</span>
              <span className="text-mkt-slate">
                {a.accountName} ····{a.accountNumberLast4}
              </span>
            </span>
            {a.isPrimary && (
              <span className="bg-mkt-red/10 text-mkt-red rounded-full px-2 py-0.5 text-xs font-semibold">
                Primary
              </span>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <form
          onSubmit={submit}
          className="border-mkt-line mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"
        >
          <select
            value={form.accountType}
            onChange={(e) => setForm({ ...form, accountType: e.target.value })}
            className={INPUT}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className={INPUT}
            placeholder="Account holder name"
            value={form.accountName}
            onChange={(e) => setForm({ ...form, accountName: e.target.value })}
            required
            minLength={2}
          />
          <input
            className={INPUT}
            placeholder={form.accountType === 'bank' ? 'Account number' : 'Mobile number'}
            value={form.accountNumber}
            onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
            required
            minLength={4}
          />
          {form.accountType === 'bank' && (
            <input
              className={INPUT}
              placeholder="Bank name"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          )}
          {error && (
            <p role="alert" className="text-mkt-red text-xs sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-mkt-red inline-flex h-10 items-center rounded-md px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              className="border-mkt-line text-mkt-ink inline-flex h-10 items-center rounded-md border px-5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
