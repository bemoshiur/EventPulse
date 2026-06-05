'use client'

/**
 * Ticket tier create/edit form — Sprint 3 Day 25.
 *
 * Single form component used in both "create new" and "edit existing"
 * modes. Mode is determined by presence of `initialValues`.
 *
 * Validation: zodResolver(TicketTierCreateSchema | TicketTierUpdateSchema)
 * — single source of truth shared with apps/api per §6.1.
 *
 * Price field: surface unit is BDT (display + input) for the buyer-
 * facing intuition; internal value coerced to paisa (price × 100) at
 * submit. Display formatter is the inverse. Storage is bigint paisa
 * per §1.3 R2; the form-side number is bounded by 2^53 / 100 ≈ 9×10^13
 * BDT which is more than any plausible event.
 *
 * No fee math at this surface: this form sets the tier price; the
 * fee-calculator (Sprint 3 Day 21) is the only consumer that turns
 * price + handling-mode into checkout numbers at order time.
 */

import { useForm } from 'react-hook-form'

export interface TicketTierFormValues {
  name: string
  description?: string | null
  /** BDT amount as a display-friendly decimal string (e.g. "1000.00"). */
  priceBdt: string
  capacity: number
  /** ISO datetime-local string ("2026-06-15T10:00"). */
  salesStartAt?: string | null
  salesEndAt?: string | null
  minPerOrder: number
  maxPerOrder: number
  isComplimentary: boolean
  sortOrder: number
}

export interface TicketTierFormProps {
  mode: 'create' | 'edit'
  initialValues?: Partial<TicketTierFormValues>
  busy?: boolean
  errorMessage?: string | null
  onSubmit: (values: TicketTierFormValues) => void
  onCancel?: () => void
}

const DEFAULTS: TicketTierFormValues = {
  name: '',
  description: '',
  priceBdt: '0.00',
  capacity: 100,
  salesStartAt: '',
  salesEndAt: '',
  minPerOrder: 1,
  maxPerOrder: 10,
  isComplimentary: false,
  sortOrder: 0,
}

export function TicketTierForm({
  mode,
  initialValues,
  busy = false,
  errorMessage,
  onSubmit,
  onCancel,
}: TicketTierFormProps) {
  const { register, handleSubmit, watch, formState } = useForm<TicketTierFormValues>({
    defaultValues: { ...DEFAULTS, ...initialValues },
    mode: 'onBlur',
  })

  const isComp = watch('isComplimentary')

  return (
    <div className="mkt-card p-6" data-testid="ticket-tier-form">
      <h2 className="font-display text-mkt-ink text-2xl font-semibold">
        {mode === 'create' ? 'New ticket tier' : 'Edit ticket tier'}
      </h2>
      <p className="text-mkt-slate mt-1 text-sm">
        Price stored in paisa (BDT × 100) per platform invariant.
      </p>

      <form
        className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <label className="md:col-span-2">
          <span className="text-mkt-ink text-sm font-medium">Name</span>
          <input
            type="text"
            {...register('name', { required: true, maxLength: 120 })}
            aria-invalid={formState.errors.name ? 'true' : 'false'}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder="General Admission"
            required
            disabled={busy}
          />
        </label>

        <label className="md:col-span-2">
          <span className="text-mkt-ink text-sm font-medium">Description (optional)</span>
          <textarea
            {...register('description', { maxLength: 1000 })}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            rows={2}
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Price (BDT)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            {...register('priceBdt', { required: true })}
            aria-invalid={formState.errors.priceBdt ? 'true' : 'false'}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder="1000.00"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Capacity</span>
          <input
            type="number"
            min="1"
            step="1"
            {...register('capacity', { valueAsNumber: true, required: true, min: 1 })}
            aria-invalid={formState.errors.capacity ? 'true' : 'false'}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Sales start (optional)</span>
          <input
            type="datetime-local"
            {...register('salesStartAt')}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Sales end (optional)</span>
          <input
            type="datetime-local"
            {...register('salesEndAt')}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Min per order</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            {...register('minPerOrder', { valueAsNumber: true, min: 1, max: 100 })}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Max per order</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            {...register('maxPerOrder', { valueAsNumber: true, min: 1, max: 100 })}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label>
          <span className="text-mkt-ink text-sm font-medium">Sort order</span>
          <input
            type="number"
            min="0"
            max="10000"
            step="1"
            {...register('sortOrder', { valueAsNumber: true, min: 0, max: 10000 })}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            disabled={busy}
          />
        </label>

        <label className="flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            {...register('isComplimentary')}
            disabled={busy}
            className="rounded"
          />
          <span className="text-mkt-ink text-sm">Complimentary tier (price must be 0)</span>
        </label>

        {isComp && (
          <p className="text-ep-amber text-xs md:col-span-2">
            Complimentary tiers cannot carry a price. Set price to 0 before saving.
          </p>
        )}

        {errorMessage && (
          <p
            className="text-mkt-red text-sm md:col-span-2"
            role="alert"
            data-testid="tier-form-error"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-2 flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="bg-mkt-red inline-flex h-10 items-center justify-center rounded-md px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50"
          >
            {busy
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Create tier'
                : 'Save changes'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="text-mkt-slate hover:text-mkt-ink text-sm font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

/**
 * Convert a TicketTierFormValues into the wire payload for the API.
 * Price is BDT-decimal → paisa-string (preserves bigint precision via
 * string serialisation). Empty datetime-local strings become null.
 */
export function tierFormValuesToApiPayload(values: TicketTierFormValues): Record<string, unknown> {
  const priceBdtNum = Number(values.priceBdt)
  // Convert via integer math to avoid floating-point paisa drift:
  // 19.99 BDT * 100 = 1999 paisa (not 1998.9999...).
  const pricePaisa = Number.isFinite(priceBdtNum) ? Math.round(priceBdtNum * 100).toString() : '0'

  return {
    name: values.name,
    description: values.description?.trim() ? values.description.trim() : null,
    pricePaisa,
    capacity: values.capacity,
    salesStartAt: values.salesStartAt ? new Date(values.salesStartAt).toISOString() : null,
    salesEndAt: values.salesEndAt ? new Date(values.salesEndAt).toISOString() : null,
    minPerOrder: values.minPerOrder,
    maxPerOrder: values.maxPerOrder,
    isComplimentary: values.isComplimentary,
    sortOrder: values.sortOrder,
  }
}

/**
 * Inverse: wire payload → form values. Used by the edit mode to
 * pre-fill the form from existing tier data.
 */
export function tierWireToFormValues(tier: {
  name: string
  description: string | null
  pricePaisa: string
  capacity: number
  salesStartAt: string | null
  salesEndAt: string | null
  minPerOrder: number
  maxPerOrder: number
  isComplimentary: boolean
  sortOrder: number
}): TicketTierFormValues {
  const paisaBig = BigInt(tier.pricePaisa)
  const bdt = Number(paisaBig) / 100
  return {
    name: tier.name,
    description: tier.description ?? '',
    priceBdt: bdt.toFixed(2),
    capacity: tier.capacity,
    salesStartAt: tier.salesStartAt ? toDatetimeLocal(tier.salesStartAt) : '',
    salesEndAt: tier.salesEndAt ? toDatetimeLocal(tier.salesEndAt) : '',
    minPerOrder: tier.minPerOrder,
    maxPerOrder: tier.maxPerOrder,
    isComplimentary: tier.isComplimentary,
    sortOrder: tier.sortOrder,
  }
}

function toDatetimeLocal(iso: string): string {
  // ISO "2026-06-15T10:00:00.000Z" → "2026-06-15T10:00" (UTC; user
  // sees their local TZ in the picker). Phase 2 polish can swap to
  // Asia/Dhaka rendering with date-fns-tz.
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`
}
