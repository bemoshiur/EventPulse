'use client'

/**
 * Fixed event-creation form — Sprint 3 Day 23 Workstream 1.
 *
 * Per CLAUDE.md §26.1 Day 3: "Fixed form template per event type
 * (hardcoded React forms for MVP)." This is the base form; per-type
 * wrappers in ./index.tsx pre-fill defaults + helper copy from
 * eventTypeConfig.
 *
 * Validation: zodResolver(EventCreateSchema) — single source of truth
 * (same schema apps/api uses to validate POST /api/v1/tenant/events
 * per §6.1). When the API rejects, the resolver re-runs locally on
 * next submit; the call site is expected to surface the API error.
 *
 * Field shape:
 *   - type (hidden — set by per-type wrapper)
 *   - title (req) + titleBn (optional)
 *   - description (optional) + descriptionBn (optional)
 *   - startsAt + endsAt (datetime-local; rendered in Asia/Dhaka)
 *   - timezone (defaults Asia/Dhaka)
 *   - venue.type discriminator (physical | online) + nested fields
 *   - capacity (optional)
 *   - visibility (defaults 'public')
 *
 * NOT included today (per the user's Day 23 scope confirmation):
 *   - banner/og image upload (URL field exists but no uploader yet)
 *   - ticket tier shape (Day 25)
 *   - refund policy editor (Phase 2 polish)
 *   - per-event fee handling override (super admin only — surfaces in
 *     the admin/tenants/[id]/fees workstream, not here)
 *
 * Per §1.3 R12: tenant-portal copy English-first; Bangla optional
 * fields surface for bilingual content.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import type { z } from 'zod'

import {
  BD_DIVISION_LABELS_EN,
  BD_DIVISIONS,
  EVENT_VISIBILITIES,
  EventCreateSchema,
  type EventCreateInput,
  type EventType,
} from '@eventpulse/shared-types'

import { ImageUpload } from '@/components/tenant/image-upload'

import { addHours, eventTypeConfig } from './per-type-config'

/** The form binds to the schema's INPUT type (strings for datetime
 *  fields since HTML `<input type="datetime-local">` returns strings).
 *  The resolver coerces to the OUTPUT type (Date) before invoking the
 *  caller's submit handler, so `onValidSubmit` receives Date instances
 *  ready to send to the API per §6.1 createEventSchema. */
type FormShape = z.input<typeof EventCreateSchema>

export interface EventFormProps {
  type: EventType
  formId?: string
  /** Caller-supplied submit handler — typically POSTs to
   *  /api/v1/tenant/events and handles success/error envelope.
   *  Receives the resolved (Date-coerced) shape. */
  onValidSubmit: (values: EventCreateInput) => void | Promise<void>
  /** Optional initial values (for "edit" use-case — Day 25+; today's
   *  callers always pass undefined for create flow). */
  initialValues?: Partial<EventCreateInput>
}

function isoLocal(d: Date): string {
  // datetime-local input wants YYYY-MM-DDTHH:mm (browser-local).
  // We render in Asia/Dhaka explicitly since EVENT_PULSE serves BD.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`
}

export function EventForm({ type, formId, onValidSubmit, initialValues }: EventFormProps) {
  const cfg = eventTypeConfig[type]
  // Default starts_at: tomorrow noon BDT. endsAt: starts + per-type duration.
  const tomorrowNoonBdt = new Date()
  tomorrowNoonBdt.setUTCHours(6, 0, 0, 0) // 12:00 Asia/Dhaka = 06:00 UTC
  tomorrowNoonBdt.setUTCDate(tomorrowNoonBdt.getUTCDate() + 1)
  const defaultEndsAt = addHours(tomorrowNoonBdt, cfg.defaultDurationHours)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormShape>({
    mode: 'onBlur',
    // Cast: zodResolver returns the schema's OUTPUT shape (Date-coerced),
    // but the form binds to the INPUT shape (string from datetime-local
    // inputs). The runtime works correctly — resolver coerces on submit
    // before our handler runs — but the two Resolver type instantiations
    // (one per shape) don't structurally unify in TS. Cast tells TS the
    // shapes are interchangeable at this seam.
    resolver: zodResolver(EventCreateSchema) as unknown as Resolver<FormShape>,
    defaultValues: {
      type,
      title: initialValues?.title ?? '',
      titleBn: initialValues?.titleBn ?? '',
      description: initialValues?.description ?? '',
      descriptionBn: initialValues?.descriptionBn ?? '',
      bannerImageUrl: initialValues?.bannerImageUrl ?? '',
      startsAt: (initialValues?.startsAt ?? tomorrowNoonBdt).toISOString(),
      endsAt: (initialValues?.endsAt ?? defaultEndsAt).toISOString(),
      timezone: initialValues?.timezone ?? 'Asia/Dhaka',
      visibility: initialValues?.visibility ?? 'public',
      capacity: initialValues?.capacity ?? null,
      venue:
        initialValues?.venue ??
        ({
          type: 'physical',
          name: '',
          address: '',
          division: 'dhaka',
          district: 'Dhaka',
        } as const),
    } as FormShape,
  })

  const venueType = watch('venue.type')

  return (
    <form
      id={formId ?? `event-form-${type}`}
      onSubmit={handleSubmit((values) => {
        // Resolver has coerced strings → Dates per the schema pipe;
        // cast through unknown lets the type narrow to EventCreateInput
        // (the OUTPUT shape). zodResolver guarantees the shape; the
        // cast is a typing bridge between react-hook-form's input type
        // and the API's output type.
        return onValidSubmit(values as unknown as EventCreateInput)
      })}
      className="space-y-5"
      noValidate
    >
      <header>
        <h2 className="text-mkt-ink text-2xl font-semibold">{cfg.taglineEn}</h2>
        <p className="text-mkt-slate text-sm">{cfg.taglineBn}</p>
      </header>

      <input type="hidden" {...register('type')} />

      <div>
        <label htmlFor="event-title" className="text-mkt-ink block text-sm font-medium">
          Title <span className="opacity-70">· শিরোনাম</span>
        </label>
        <input
          id="event-title"
          type="text"
          placeholder={cfg.titlePlaceholderEn}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'event-title-error' : undefined}
          {...register('title')}
          className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
        />
        {errors.title ? (
          <p id="event-title-error" className="text-mkt-red mt-1 text-xs">
            {errors.title.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="event-title-bn" className="text-mkt-ink block text-sm font-medium">
          Title (Bangla, optional) <span className="opacity-70">· বাংলা শিরোনাম</span>
        </label>
        <input
          id="event-title-bn"
          type="text"
          {...register('titleBn')}
          className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="event-description" className="text-mkt-ink block text-sm font-medium">
          Description <span className="opacity-70">· {cfg.descriptionPromptEn}</span>
        </label>
        <textarea
          id="event-description"
          rows={4}
          {...register('description')}
          className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="event-banner" className="text-mkt-ink block text-sm font-medium">
          Cover image <span className="opacity-70">· কভার ছবি (ঐচ্ছিক)</span>
        </label>
        <div className="mt-1">
          <ImageUpload
            kind="cover"
            value={watch('bannerImageUrl') ?? ''}
            onChange={(url) =>
              setValue('bannerImageUrl', url === '' ? undefined : url, { shouldValidate: true })
            }
          />
        </div>
        <input
          id="event-banner"
          type="url"
          inputMode="url"
          placeholder="…or paste an image URL"
          aria-invalid={errors.bannerImageUrl ? true : undefined}
          {...register('bannerImageUrl', { setValueAs: (v) => (v === '' ? undefined : v) })}
          className="border-mkt-line focus:border-mkt-red mt-2 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
        />
        <p className="text-mkt-slate mt-1 text-xs">
          Upload an image (PNG/JPG/WebP/SVG) or paste a URL. Leave blank for the default gradient.
        </p>
        {errors.bannerImageUrl ? (
          <p className="text-mkt-red mt-1 text-xs">{errors.bannerImageUrl.message}</p>
        ) : null}
      </div>

      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="event-starts-at" className="text-mkt-ink block text-sm font-medium">
            Starts at <span className="opacity-70">· শুরু</span>
          </label>
          <input
            id="event-starts-at"
            type="datetime-local"
            defaultValue={isoLocal(tomorrowNoonBdt)}
            aria-invalid={errors.startsAt ? true : undefined}
            {...register('startsAt')}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
          />
          {errors.startsAt ? (
            <p className="text-mkt-red mt-1 text-xs">{errors.startsAt.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="event-ends-at" className="text-mkt-ink block text-sm font-medium">
            Ends at <span className="opacity-70">· শেষ</span>
          </label>
          <input
            id="event-ends-at"
            type="datetime-local"
            defaultValue={isoLocal(defaultEndsAt)}
            aria-invalid={errors.endsAt ? true : undefined}
            {...register('endsAt')}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
          />
          {errors.endsAt ? (
            <p className="text-mkt-red mt-1 text-xs">{errors.endsAt.message}</p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="border-mkt-line space-y-3 rounded-lg border p-4">
        <legend className="text-mkt-ink px-1 text-sm font-medium">
          Venue <span className="opacity-70">· ভেন্যু</span>
        </legend>

        <div className="flex gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" value="physical" {...register('venue.type')} /> Physical
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" value="online" {...register('venue.type')} /> Online
          </label>
        </div>

        {venueType === 'online' ? (
          <div className="space-y-3">
            <div>
              <label className="text-mkt-ink block text-sm font-medium">
                Platform <span className="opacity-70">· প্ল্যাটফর্ম</span>
              </label>
              <input
                type="text"
                placeholder="Zoom, Google Meet, etc."
                {...register('venue.platform')}
                className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-mkt-ink block text-sm font-medium">
                Join URL <span className="opacity-70">· জয়েন URL</span>
              </label>
              <input
                type="url"
                placeholder="https://..."
                {...register('venue.url')}
                className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-mkt-ink block text-sm font-medium">
                Venue name <span className="opacity-70">· ভেন্যুর নাম</span>
              </label>
              <input
                type="text"
                placeholder={cfg.venueNamePlaceholderEn}
                {...register('venue.name')}
                className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-mkt-ink block text-sm font-medium">
                Address <span className="opacity-70">· ঠিকানা</span>
              </label>
              <input
                type="text"
                {...register('venue.address')}
                className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-mkt-ink block text-sm font-medium">
                  Division <span className="opacity-70">· বিভাগ</span>
                </label>
                <select
                  {...register('venue.division')}
                  className="border-mkt-line mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm"
                >
                  {BD_DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {BD_DIVISION_LABELS_EN[d]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-mkt-ink block text-sm font-medium">
                  District <span className="opacity-70">· জেলা</span>
                </label>
                <input
                  type="text"
                  {...register('venue.district')}
                  className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-mkt-ink block text-sm font-medium">
            Capacity (optional) <span className="opacity-70">· ধারণক্ষমতা</span>
          </label>
          <input
            type="number"
            min={1}
            {...register('capacity', { valueAsNumber: true })}
            className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-mkt-ink block text-sm font-medium">
            Visibility <span className="opacity-70">· দৃশ্যমানতা</span>
          </label>
          <select
            {...register('visibility')}
            className="border-mkt-line mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm"
          >
            {EVENT_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-mkt-red inline-flex h-11 items-center rounded-md px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </form>
  )
}
