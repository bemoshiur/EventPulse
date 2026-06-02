# First paying tenant — onboarding pack (operator-runnable)

> **Status:** operator-runnable pack. Created Day 44 (2026-06-02) per `docs/runbooks/launch-readiness.md` §5 (the 13-item checklist for first-paying-tenant identification + onboarding). The runbook lists WHAT to do; this pack supplies the actual emails to send, the meeting agendas, the in-app messages, and the post-launch check-in cadence.
>
> **Posture:** drafts ready for operator review. No content is sent automatically by any service — every email here is operator-composed-and-sent from the operator's personal inbox (or `support@eventpulse.com.bd` once that mailbox is live; SES inbound + S3 + Lambda forwarder is scheduled for Sprint 3 per `.claude/memory/handoff.md`).
>
> **Why drafts not finals:** the actual first-paying-tenant identity is operator-decided. The drafts here are placeholders the operator personalises (tenant name, event details, dates) per the §5.identification criteria in the launch-readiness runbook. Once a candidate is selected, operator copies the relevant section, fills `{{placeholders}}`, sends.

## Cross-references

- `docs/runbooks/launch-readiness.md` §5 — the 13-item operator checklist this pack supports
- `.claude/memory/decisions.md` 2026-05-31 "Day 39 AM" — Path B incorporation + Salehin's 4-6 week novation window (operator is the contracting party until Pvt Ltd certificate issues)
- `docs/legal/buyer-terms.md` — buyer-terms v1.0 (Salehin-approved 2026-05-31)
- `docs/copy/bkash-only-launch.md` — v1.0 single-method honest copy (referenced in §3 / §6 below)
- `docs/runbooks/production-smoke.md` — BDT-100 production smoke (must run BEFORE first paying tenant's first sale)

## Pre-flight (operator runs before any outreach)

Confirm ALL of the following before contacting any candidate tenant. If any is FALSE, halt outreach and resolve first.

- [ ] EPS production credentials in `eventpulse/prod/eps` Secrets Manager entry (Pre-launch track #1)
- [ ] Production EC2 cutover ceremony complete (Pre-launch track #4)
- [ ] BDT-100 production EPS smoke PASS within 5% of calculator's 175 bps assumption (Pre-launch track #2)
- [ ] AWS Budget alarm live ($25 actual / $30 forecast)
- [ ] Trust Center v0.1 placeholders + Buyer-Terms-Lite v1.0 live in checkout consent capture
- [ ] Operator's calendar clear for 5 consecutive business days (the comms cadence in §7 below requires hourly attention on day 1, daily check-ins through day 5)
- [ ] Candidate tenant identified per §5.identification criteria in the launch-readiness runbook (free events + paid tier with BDT 100-500 face value + Bangladeshi attendee base + design-partner mindset)

## §1 — Initial outreach email (operator → candidate)

**Subject:** Event Pulse — would you partner with us on a launch test?

**Body:**

```text
Hi {{first_name}},

I'm writing from Event Pulse, a new ticketing platform we're launching
for Bangladesh. We're going live on 2026-06-10 with bKash checkout,
custom-branded event pages, web-based QR check-in, and automated T+5
disbursement to your bank account.

I'd love to invite {{tenant_organisation_or_personal_name}} to be one
of our first 3-5 design-partner tenants. Concretely, that means:

1. You run {{event_name}} on Event Pulse (we'd target an event in the
   2026-06-{{date}} window with ticket faces in the BDT 100-500 range
   so we can keep the financial blast radius small for both sides)
2. I'm on call for you directly — text/WhatsApp/email — for the entire
   event lifecycle, hourly during day 1 of sales
3. You give us blunt feedback on what's broken or confusing within 24
   hours of noticing it
4. In exchange, we waive the 0.25% platform fee for your first event,
   we feature your event on our launch announcements, and you get
   one-call founder support throughout the partnership window

A few realities I want to flag upfront before you decide:

- v1.0 only accepts bKash payments. Card / Nagad / Rocket / Upay land
  week 1 post-launch. If your audience is card-heavy, we should talk
  about waiting for card support to ship.
- We've operated 100+ tenants in private testing but you'd be our
  first paid public event. Things will be rough at the edges.
- The platform is run by me personally until our Pvt Ltd
  incorporation completes (early August 2026). That means you're
  contracting with me as an individual; the platform service contract
  novates to the Pvt Ltd entity when it's ready.

If this interests you, can we get on a 30-minute call this week?
I can walk you through the platform live and answer questions.

Thank you for considering,
Moshiur Rahman
+880 {{operator_phone}}
moshiur@publicpulse.com.bd
```

**Send via:** operator's personal inbox (not platform SES) — this is a 1-on-1 partnership ask, not a transactional message.

**Expected response window:** 48 hours. If no reply in 72 hours, send the §2 nudge.

## §2 — 72-hour nudge (operator → candidate)

**Subject:** Re: Event Pulse — would you partner with us on a launch test?

**Body:**

```text
Hi {{first_name}},

Just floating this back to the top of your inbox in case it got lost.
No pressure — if it's not the right time, I'll move on; if you want
to chat, I'm flexible on timing this week or next.

Thanks,
Moshiur
```

**Send via:** same thread as §1. Single nudge only — no repeat nudges.

## §3 — Discovery call agenda (operator runs the call)

30 minutes, video preferred. Operator drives.

| Time      | Topic                           | What operator does                                                                                                                                                                                                                                                              |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:05 | Intro + tenant context          | Listen. Capture their event type, expected audience size, ticket-price range, payment method mix                                                                                                                                                                                |
| 0:05-0:15 | Platform walkthrough (live)     | Share screen. Show tenant portal → create event → ticket tier → publish → public page → simulated check-in scan                                                                                                                                                                 |
| 0:15-0:20 | bKash-only realness             | Explicitly state v1.0 is bKash only. Refer to Pricing page (https://eventpulse.com.bd/pricing) for the honest disclosure. Ask: "is your audience mostly bKash users?"                                                                                                           |
| 0:20-0:25 | KYC + payout setup expectations | KYC takes ~5 minutes; documents needed (NID for individual / RJSC + Trade Licence + BIN for organisation); bank or bKash B2C account for payouts. Set expectation: KYC review is manual + super-admin-attended for v1.0; typical turnaround under 24 hours during business days |
| 0:25-0:30 | Partnership terms + next steps  | Walk through §4 partnership-terms one-pager. If they say yes: send §5 onboarding email same day                                                                                                                                                                                 |

**Notes-template to fill during call** (operator records to a private doc):

```text
Tenant name: ___
Event type: ___
Expected audience: ___ people
Ticket face: BDT ___ to ___
Audience payment-method mix (their best guess): ___% bKash / ___% card / ___% other
Event date: ___ 2026
KYC type expected (individual / organisation): ___
Their primary concern / blocker: ___
Decision: yes / no / thinking-about-it
Follow-up date if thinking: ___
```

## §4 — Partnership terms (operator hands tenant)

```text
DESIGN PARTNER ARRANGEMENT — EVENT PULSE LAUNCH
Version 1.0, 2026-06-02

This is a partnership outline, not a binding legal contract. The
contractual obligations are governed by Buyer Terms (signed at
sign-up by all attendees) and the Organiser Agreement (signed by you
at tenant registration). This document describes the design-partner
arrangement that supplements those.

WHO YOU ARE CONTRACTING WITH

Until Public Pulse Agency Pvt Ltd incorporation completes (target
2026-07-22), your service contract is with Moshiur Rahman in his
personal capacity, doing business as Public Pulse Agency. On
incorporation, the contract novates to the Pvt Ltd entity. The
novation is one-time, requires your written acknowledgement
(provided as part of this design-partner arrangement), and changes
nothing about the service or your rights.

WHAT YOU GET

- 0% platform fee on your first event (we waive the 0.25%; you still
  pay EPS's gateway fee at cost per Bangladesh banking-rail standard)
- Direct founder access for the entire partnership window — text,
  WhatsApp, email — operator responds within 24 hours minimum,
  hourly on day 1 of sales
- Featured placement in our launch announcement(s) — your event gets
  a callout in the Event Pulse changelog (https://eventpulse.com.bd/legal/changelog)
- Priority KYC + subdomain provisioning (typically under 4 hours
  during business days)
- Free white-label add-on for the first event (footer removal,
  branded email sender — Phase 2 feature but we'll set it up
  manually for you)

WHAT WE ASK

- Run {{event_name}} on Event Pulse with a real, public-facing sales
  window of at least 7 days
- Report any issue you notice within 24 hours of noticing it — via
  any channel (text/WhatsApp/email/call). No issue is too small.
- Participate in a 30-minute end-of-event retrospective call
- Let us feature {{tenant_organisation_or_personal_name}} as a
  launch partner in our public marketing materials (Trust Center
  customer-list, blog posts, social media) — you have approval
  rights over the specific copy + visuals before we publish

REALITIES WE'RE NOT HIDING

- v1.0 only accepts bKash payments. Card support arrives week 1
  post-launch. If your buyers want to pay with a card during your
  event window, they cannot. Free events have no payment-method
  constraint.
- Manual disbursement at v1.0 — operator generates the BEFTN file
  from your event data + uploads to bank. Disbursement target is T+5
  business days but the manual step means timing variance up to ±1
  business day.
- If a buyer disputes a charge or you need to refund a buyer, the
  process today is: you request a refund from the tenant portal →
  operator reviews + approves → operator issues the refund via the
  EPS merchant dashboard out-of-band → operator marks the refund
  processed on the platform. Refunds happen but the loop is manual
  + can take up to 48 hours.
- The full Trust Center legal corpus is at v0.1 placeholder content;
  v1.0 documents arrive from counsel over the coming weeks. You
  accept that the placeholders bind via the same consent mechanic
  as v1.0 will, and that you'll re-acknowledge the final v1.0 docs
  when counsel returns them.

THIS ENDS WHEN

The first of the following occurs:

- Both parties agree the partnership window is complete (typically
  4-6 weeks after the event date)
- Either party gives 30 days written notice
- A material change to the platform's terms requires re-consent and
  you decline

Either party may exit early without penalty.

YOUR ACKNOWLEDGEMENT

Signed: ________________________  Date: ________________________

Print name: ________________________
Role: ________________________
Organisation: ________________________
```

**Distribution:** PDF the operator personally produces from this text. Sign by exchange of scanned signatures or in-person.

## §5 — Welcome / onboarding instructions email (operator → tenant after they accept)

**Subject:** Welcome to Event Pulse — let's get you set up

**Body:**

```text
Hi {{first_name}},

Thank you for partnering with us. Here's the path to going live:

STEP 1 — Sign up at https://app.eventpulse.com.bd/sign-up

Use the email address you want to receive payout confirmations at.
You can sign up with Google, Apple, or email — your choice. After
sign-up, the post-login Account Type modal asks "organisation or
individual" — pick whichever matches {{tenant_organisation_or_personal_name}}.

STEP 2 — Complete KYC

The KYC wizard walks you through 5-6 fields + 2-3 document uploads.
For individual KYC: NID front + back, address proof. For organisation
KYC: RJSC certificate, Trade Licence, BIN/VAT certificate, signatory
NID. Allow ~5 minutes. We'll review within 4 hours during business
days; once approved, your subdomain `{{tenant_slug}}.eventpulse.com.bd`
provisions automatically.

STEP 3 — Create your event

In the tenant portal, click "New event". Fill out the event details,
venue, banner image, and at least one ticket tier. For your launch
event we recommend ticket faces in the BDT 100-500 range — see the
partnership terms for context. Set the fee mode to "absorb" or
"pass-through" per your preference; the Pricing page calculator at
https://eventpulse.com.bd/pricing shows exactly what each mode does
to your payout.

STEP 4 — Add bKash payout account

Settings → Fees & Payouts → Add payout account. For v1.0, we'll
provision a bank account (BEFTN). Have your bank name + branch +
account number + account holder name ready.

STEP 5 — Tell me before you publish

Send me a one-line WhatsApp or email when you're ready to publish.
I'll do a 5-minute walkthrough of the event page with you live, just
to make sure nothing looks off. Then you publish.

STEP 6 — Send a test purchase yourself

Before opening sales publicly, buy a ticket yourself with your own
bKash account. I'll refund it via the EPS dashboard immediately
(zero cost to you). This confirms the buyer journey works end-to-end
on YOUR specific event, not just our synthetic tests.

STEP 7 — Open sales publicly + I monitor hourly for day 1

You announce the event on your channels. I monitor the platform
hourly for the first 24 hours. Any issue I see, I report to you
within 5 minutes of seeing it. Any issue you notice, you report to
me within 24 hours.

STEP 8 — Check-in at the gate

Web QR scanner at https://{{tenant_slug}}.eventpulse.com.bd/checkin —
any modern browser works (no app to install). Offline-tolerant: scans
queue locally if the gate has spotty connectivity and sync when
reconnected. Multiple staff can scan in parallel without conflicts.

STEP 9 — Post-event payout

We disburse T+5 business days after the last paid sale. I'll text you
the day the BEFTN goes out + the bank reference number. Confirm
arrival in your bank and let me know.

STEP 10 — Retro call

30 minutes within 5 business days of the event. Honest feedback. I
take notes; we figure out what to change for the next event.

Questions before you start? Text any time.

Talk soon,
Moshiur
+880 {{operator_phone}}
moshiur@publicpulse.com.bd
```

## §6 — Day-1-of-sales monitoring template (operator runs hourly)

Every hour for the first 24 hours of public sales, operator runs this
check + records to a private log:

```text
TIME: 2026-06-{{date}} {{hour}}:00 BDT

GMV so far: BDT ___
Ticket count so far: ___
Failed orders count: ___ (acceptable: 0; investigate if >0)
Refund requests so far: ___

/health response: 200 / 503
DB ms: ___ (acceptable: <50; alert if >200)
pm2 restart count last hour: 0 / >0

Any tenant report: ___
Any internal anomaly: ___

Action taken: ___
```

If anything in this template trips the "alert" or "investigate" threshold, operator pings the tenant directly within 5 minutes, takes screenshots, opens a `.claude/memory/gotchas.md` entry within the hour.

## §7 — Communications cadence (operator → tenant)

| When                            | Channel          | What                                                                 |
| ------------------------------- | ---------------- | -------------------------------------------------------------------- |
| Hourly for first 24h of sales   | WhatsApp or text | "All clean, X tickets sold" + any alert                              |
| Daily at 09:00 for days 2-5     | WhatsApp         | "Daily check: X tickets total, no issues" + any alert                |
| Day of event                    | WhatsApp         | "Check-in is live, X attendees on the door" + any alert              |
| Day after event                 | WhatsApp         | "Disbursement queued for {{date}}, you'll see BDT {{net}} via BEFTN" |
| T+5 day                         | WhatsApp         | "Payout sent, bank ref \_\_\_, please confirm arrival"               |
| Within 5 business days of event | Call             | Retro                                                                |

## §8 — Anything goes wrong: operator action matrix

| Symptom                                                        | Operator immediate action                                                                                                                            | Within 24h                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tenant reports buyer can't complete purchase                   | Open EPS merchant dashboard; verify the merchantTransactionId; check api logs for `STAGING_PAYMENT_BLOCK` (should be 0 on prod)                      | Stamp the cause + remediation in decisions.md as a Day-NN incident entry           |
| Tenant reports refund didn't process                           | Open EPS dashboard, look up the refund manually; if EPS shows refunded but platform doesn't reflect, mark the refund processed via super-admin route | Same                                                                               |
| `/health` returns 503                                          | SSM into prod EC2; check pm2 status; check `/proc/<api-pid>/environ` for env-var drift; check Postgres connection                                    | Same                                                                               |
| Suppression-list growth abnormal                               | Query `email_suppression_list` for new rows; check SES bounce dashboard; confirm DKIM + SPF still aligned                                            | Same                                                                               |
| Tenant complains about the manual-disbursement timing variance | Acknowledge; offer to expedite by manually preparing the BEFTN one business day early (within reason)                                                | Update partnership-arrangement doc with the specific commitment for future tenants |

## §9 — Retro template (operator records during retro call)

```text
EVENT RETRO — {{tenant_name}} / {{event_name}} / 2026-06-{{date}}

What went well (tenant's view): ___
What went wrong (tenant's view): ___
What surprised them (positive or negative): ___

What we caught + fixed during the event: ___
What we caught + decided to defer: ___
What we MISSED that the tenant caught: ___

NPS (1-10): ___
Would they pay 0.25% next event? yes / no / depends
Would they recommend us? yes / no / depends

Three specific changes we'll make based on this retro: ___

Next event date (if any): ___
```

## When this pack is out of date

This pack is canonical at Day 44 close. Update with every actual first-paying-tenant cycle's learnings; the second paying tenant's onboarding inherits the lessons. Surfaces of likely change between Day 44 and the launch:

- §1 outreach email — operator may rewrite tone after the first 2-3 attempts based on what feels natural
- §4 partnership terms — counsel may want to review before the second tenant signs
- §7 communications cadence — may relax after we know the platform survives day 1 of real load
- §8 action matrix — grows with each new failure mode discovered

**The §5 step-by-step onboarding email is the load-bearing artefact.** Everything else supports that flow.
