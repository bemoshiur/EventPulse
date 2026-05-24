/**
 * Per-event-type form configuration — Sprint 3 Day 23 Workstream 1.
 *
 * Per CLAUDE.md §26.1 Day 3: "Fixed form template per event type
 * (hardcoded React forms for MVP)." Schema-driven form builder ships
 * Sprint 5 (per §26.2); this is the MVP path.
 *
 * All 8 types share the same EventCreateSchema field set — the
 * variations are surface-level:
 *
 *   - default values (e.g. concert defaults to 4-hour duration,
 *     conference defaults to full-day)
 *   - placeholders + helper copy in venue/title fields tuned to the
 *     type's mental model (a concert venue prompts for "arena, club";
 *     a workshop venue prompts for "training center")
 *   - small description prompts to nudge organisers toward content
 *     buyers will find useful for that event type
 *
 * Field SET stays identical so the rendered form code is one component;
 * per-type values are looked up by `eventTypeConfig[type]` and spread
 * into defaultValues + placeholder props at render time.
 */

import type { EventType } from '@eventpulse/shared-types'

export interface PerTypeConfig {
  /** Hours from start to end at the default (used to compute endsAt from startsAt at render). */
  defaultDurationHours: number
  /** Tagline displayed below the form heading (bilingual). */
  taglineEn: string
  taglineBn: string
  /** Title field placeholder. */
  titlePlaceholderEn: string
  /** Venue physical/name field placeholder. */
  venueNamePlaceholderEn: string
  /** Description prompt nudging the organiser toward useful content. */
  descriptionPromptEn: string
}

export const eventTypeConfig: Record<EventType, PerTypeConfig> = {
  concert: {
    defaultDurationHours: 4,
    taglineEn: 'Live music for your audience',
    taglineBn: 'আপনার দর্শকদের জন্য লাইভ মিউজিক',
    titlePlaceholderEn: 'e.g. Winter Beats 2026',
    venueNamePlaceholderEn: 'Arena, club, or open-air venue',
    descriptionPromptEn: 'Lineup, doors-open time, age restrictions, special acts.',
  },
  alumni: {
    defaultDurationHours: 5,
    taglineEn: 'Bring your batch back together',
    taglineBn: 'আপনার ব্যাচকে আবার একসাথে আনুন',
    titlePlaceholderEn: 'e.g. NSU Alumni Reunion — Batch 2010',
    venueNamePlaceholderEn: 'Hotel ballroom, alumni hall, club',
    descriptionPromptEn: 'Batch/department, programme, dinner details, dress code, special guests.',
  },
  standup: {
    defaultDurationHours: 2,
    taglineEn: 'Comedy night, ticketed seating',
    taglineBn: 'কমেডি নাইট — টিকিটেড আসন',
    titlePlaceholderEn: 'e.g. Saturday Standup Showcase',
    venueNamePlaceholderEn: 'Theatre, comedy club, hotel hall',
    descriptionPromptEn:
      'Comics performing, doors-open time, age restrictions, language (Bangla / English).',
  },
  conference: {
    defaultDurationHours: 8,
    taglineEn: 'Multi-track conference',
    taglineBn: 'বহুমুখী কনফারেন্স',
    titlePlaceholderEn: 'e.g. Dhaka Tech Summit 2026',
    venueNamePlaceholderEn: 'Convention center, hotel ballroom',
    descriptionPromptEn:
      'Tracks/themes, keynote speakers, schedule overview, refreshments included.',
  },
  workshop: {
    defaultDurationHours: 3,
    taglineEn: 'Hands-on workshop session',
    taglineBn: 'হাতে-কলমে ওয়ার্কশপ',
    titlePlaceholderEn: 'e.g. Intro to Photography — Saturday Workshop',
    venueNamePlaceholderEn: 'Training center, co-working space, studio',
    descriptionPromptEn:
      'What attendees will learn, prerequisites, materials provided, instructor bio.',
  },
  community: {
    defaultDurationHours: 3,
    taglineEn: 'Community gathering or meetup',
    taglineBn: 'কমিউনিটি গ্যাদারিং / মিটআপ',
    titlePlaceholderEn: 'e.g. Dhaka Cyclists Monthly Meetup',
    venueNamePlaceholderEn: 'Park, café, community hall, members’ club',
    descriptionPromptEn: 'Who should attend, agenda, what to bring, accessibility notes.',
  },
  sports: {
    defaultDurationHours: 4,
    taglineEn: 'Sports event or tournament',
    taglineBn: 'স্পোর্টস ইভেন্ট / টুর্নামেন্ট',
    titlePlaceholderEn: 'e.g. Dhaka 5K Charity Run',
    venueNamePlaceholderEn: 'Stadium, sports complex, route start point',
    descriptionPromptEn:
      'Format, eligibility, kit/equipment requirements, prizes, support facilities.',
  },
  other: {
    defaultDurationHours: 3,
    taglineEn: 'Custom event',
    taglineBn: 'কাস্টম ইভেন্ট',
    titlePlaceholderEn: 'e.g. Our 2026 Launch Party',
    venueNamePlaceholderEn: 'Venue name',
    descriptionPromptEn: 'Describe your event — what attendees should know.',
  },
}

/** Returns a Date `hours` after `base`. */
export function addHours(base: Date, hours: number): Date {
  const d = new Date(base)
  d.setHours(d.getHours() + hours)
  return d
}
