/**
 * Fixed event-form templates — per-type wrappers.
 *
 * Eight thin wrappers around `EventForm`, one per CLAUDE.md §1.2 +
 * §10.2 event type. Each wrapper does nothing more than fix the `type`
 * prop — the per-type defaults + copy live in per-type-config.ts and
 * are looked up inside `EventForm` itself.
 *
 * Mapping `eventFormTemplates[type]` lets callers (e.g. the eventual
 * /(tenant)/events/new page) route by URL slug (`?type=concert`) into
 * the right wrapper without an N-case switch.
 *
 * Schema-driven form builder lands Sprint 5 (§26.2). Until then, these
 * fixed wrappers are the contract.
 */

import type { ReactElement } from 'react'

import type { EventType } from '@eventpulse/shared-types'

import { EventForm, type EventFormProps } from './event-form'

type WrapperProps = Omit<EventFormProps, 'type'>

export function ConcertEventForm(props: WrapperProps) {
  return <EventForm {...props} type="concert" />
}

export function AlumniEventForm(props: WrapperProps) {
  return <EventForm {...props} type="alumni" />
}

export function StandupEventForm(props: WrapperProps) {
  return <EventForm {...props} type="standup" />
}

export function ConferenceEventForm(props: WrapperProps) {
  return <EventForm {...props} type="conference" />
}

export function WorkshopEventForm(props: WrapperProps) {
  return <EventForm {...props} type="workshop" />
}

export function CommunityEventForm(props: WrapperProps) {
  return <EventForm {...props} type="community" />
}

export function SportsEventForm(props: WrapperProps) {
  return <EventForm {...props} type="sports" />
}

export function OtherEventForm(props: WrapperProps) {
  return <EventForm {...props} type="other" />
}

export const eventFormTemplates: Record<EventType, (props: WrapperProps) => ReactElement> = {
  concert: ConcertEventForm,
  alumni: AlumniEventForm,
  standup: StandupEventForm,
  conference: ConferenceEventForm,
  workshop: WorkshopEventForm,
  community: CommunityEventForm,
  sports: SportsEventForm,
  other: OtherEventForm,
}

export { EventForm } from './event-form'
export type { EventFormProps } from './event-form'
export { eventTypeConfig } from './per-type-config'
