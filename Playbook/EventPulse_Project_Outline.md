# Event Pulse

## Bangladesh's Event Ticketing & Registration SaaS — Comprehensive Project Outline & Depth Analysis

**Prepared for:** S M Moshiur Rahman, Public Pulse Agency / TiCON System Limited
**Version:** 1.1 — Brand & White-Label Locked
**Date:** 16 May 2026

**Changelog v1.1:**
- Company name confirmed: **Event Pulse**
- Primary domain confirmed: **eventpulse.com.bd**
- White-label / custom-domain architecture promoted to a core platform capability (Shopify-style), expanded into a full deep-dive section (§7.6)
- §19 open decisions updated

---

## 1. Executive Summary

Event Pulse is a multi-tenant SaaS ticketing and event registration platform purpose-built for Bangladesh, operated by Public Pulse Agency on TiCON System Limited's cloud infrastructure. The platform enables any organisation or individual — concert promoters, alumni associations, comedy clubs, conference hosts, community organisers, NGOs, religious groups, schools — to create a branded event landing page, design a custom registration or ticket purchase form via drag-and-drop tooling, accept payment through EPS (Easy Payment System) Bangladesh, and receive automated T+5 disbursement to a bank or MFS account.

The revenue model is intentionally lean and transparent: **0.25% platform fee on every successful paid transaction**, with EPS gateway charges passed through separately (a configurable choice between buyer-borne or organiser-borne, decided per event by the tenant).

The product addresses a real gap. Today, Bangladeshi event organisers stitch together Google Forms, manual bKash transfers, Excel attendee lists, and WhatsApp coordination. There is no domestic equivalent of Eventbrite or Luma that handles registration, payment, ticketing, check-in, and disbursement in one place — with native EPS integration, BDT pricing, NID-based KYC, and BFIU/NBR-aware compliance built in.

---

## 2. Product Vision & Market Positioning

### 2.1 Vision

To become the default infrastructure layer for any paid or free event in Bangladesh, the same way Shopify became default for e-commerce in many markets — a tenant-owned brand experience on top of a shared payment, identity, and disbursement backbone.

### 2.2 Target Tenants

| Segment | Examples | Typical Event Size | Pricing Sensitivity |
|---------|----------|-------------------|--------------------|
| Concert promoters | Live music, festivals, DJ nights | 500 – 10,000 attendees | Medium — care about cash flow |
| Alumni associations | School, college, university reunions | 100 – 2,000 | Low — established trust |
| Comedy & cultural | Standup nights, theatre, poetry | 50 – 500 | High — thin margins |
| Corporate events | Conferences, summits, product launches | 100 – 1,500 | Low — care about polish |
| Educational | Workshops, training, certification courses | 20 – 300 | Medium |
| Community / religious | Iftar mahfils, milad, charity drives | 50 – 2,000 | High — often free + donation |
| Sports & gaming | Tournaments, fan meets, esports | 50 – 5,000 | Medium |
| Brand activations | Marketing events, exhibitions | Variable | Low |

### 2.3 Competitive Landscape (Bangladesh)

- **GetSetSports, ShowTime, BookMyShow.com.bd, TicketBuzz, ShowMotion** — narrow vertical focus, mostly cinema/sports, not self-serve for organisers
- **Sheba.xyz events module, Pickaboo Events** — marketplace-first, organiser tooling weak
- **Google Forms + manual bKash** — current default for 80%+ of small/medium events
- **Eventbrite, Luma, Tito** — not localised for BDT/EPS/NID; foreign card friction
- **WhatsApp Business + Sheba Pay** — informal, no ticketing

**Differentiation thesis:** organiser-first SaaS (not marketplace), full self-serve, BDT-native, EPS pass-through, T+5 disbursement, NID-grade KYC, Bangla + English UI, mobile-first attendee flow.

### 2.4 Brand & Naming — LOCKED

**Company / product name:** **Event Pulse**

**Primary domain:** **eventpulse.com.bd** (secured)

Both names align with the Public Pulse Agency product family (TenderPulse, ClientFinder, ChannelGuard) and carry the same "pulse" brand equity. Additional domains to secure as defensive registrations:

- `eventpulse.com` (international hedge)
- `eventpulse.app`
- `eventpulse.bd`
- `eventpulse.net.bd`
- Bangla transliteration: `ইভেন্টপালস.বাংলা` (.bangla IDN, optional)

Brand identity (logo, colour system, typography) to be produced in the brand workshop deliverable.

---

## 3. Three-Portal Architecture

The platform is built around three distinct user experiences, each with its own authentication context, navigation, and permission model.

### 3.1 Tenant Portal — The Event Organiser

This is where 95% of platform value lives for the customer. Modules:

**Onboarding & KYC**
- Account type selection: Organisation vs Individual
- Stepped KYC wizard with progress save
- Document upload with client-side compression
- Automated checks (NID format, eTIN format, account name match)
- Status tracking: Draft → Submitted → Under Review → Approved / Rejected (with reason)

**Event Management**
- Event wizard: type, schedule, venue, capacity, visibility (public/unlisted/private)
- Recurring event support (weekly comedy night, monthly meetup)
- Multi-session events (conferences with breakouts)
- Event status: Draft → Published → Active → Completed → Archived
- Clone existing event as template

**Form Builder** (see §6 for detail)
- Drag-and-drop canvas
- Field library: text, email, phone, NID, dropdown, multi-select, radio, checkbox, file upload, date/time, address, payment-aware ticket selector, signature, rating, custom HTML
- Conditional logic (show field X if answer to Y is Z)
- Per-ticket-tier form variations
- Validation rules per field
- Multi-page forms with progress indicator

**Landing Page Builder** (see §7 for detail)
- Template gallery per event category
- Section-based editor: hero, about, schedule, speakers, sponsors, FAQ, gallery, map, sponsors, custom HTML
- Brand kit: logo, colours, fonts, favicon
- SEO: meta title, description, OG image, slug
- Custom domain support (paid tier)
- Mobile preview toggle

**Ticket & Pricing**
- Unlimited ticket tiers (e.g., Early Bird, Regular, VIP, Student, Group)
- Per-tier capacity, price, sales window, attendee fields
- Coupon codes: percentage, fixed amount, BOGO, capped usage
- Group discounts (buy N get N% off)
- Complimentary passes (zero-price tickets with separate quota)
- Donation/pay-what-you-want tickets

**Attendee CRM**
- Searchable, filterable attendee list
- Individual attendee profile: registration data, payment status, ticket QR, check-in history
- Bulk actions: export CSV, resend QR, refund, tag, message
- Waitlist management for sold-out tiers

**Check-in System**
- Web-based QR scanner (camera permission, works offline with sync)
- Multi-staff support with per-staff scan logs
- Manual check-in (search by name/phone/NID for forgotten tickets)
- Real-time attendance count
- Re-entry rules per ticket tier

**Reporting (Tenant)**
- Sales dashboard: revenue, tickets sold by tier, conversion funnel
- Daily/hourly sales curve
- Payment method breakdown (cards, bKash, Nagad, etc. via EPS)
- Refund and chargeback summary
- Settlement dashboard: pending disbursement, in-transit, completed, with T+5 countdown
- Tax summary: gross revenue, platform fee, EPS fee, withholding tax, net payout
- Attendee demographics (if collected): age, gender, location
- Export everything to CSV/Excel/PDF

**Communications**
- Pre-event: confirmation email + SMS on purchase
- Reminder email/SMS (configurable: 7 days, 1 day, 1 hour before)
- Bulk message to attendees (email + SMS)
- Post-event: thank-you email, feedback survey, certificate of attendance (for workshops/conferences)
- Template library with personalisation tokens

**Team & Roles**
- Owner (full access, billing)
- Admin (full operational access, no billing)
- Editor (event creation/edit, no financial data)
- Scanner (check-in only)
- Finance (financial reports only)
- Invite via email, role assignment, activity log

### 3.2 Super Admin Portal — Platform Operator (You)

This portal is the operational nerve centre for Public Pulse Agency as the platform operator.

**Tenant Management**
- Tenant directory: search, filter by status, type, GMV, KYC tier
- Tenant detail view: profile, KYC documents, events, transactions, payouts, support tickets
- KYC review queue: documents side-by-side, approve/reject with reason
- Tenant lifecycle: pending → active → suspended → terminated
- Tier assignment for fee overrides (e.g., enterprise tenant at 0.15%)

**Financial Operations**
- Platform GMV dashboard: today, week, month, year
- Revenue dashboard: platform fees earned, broken down by tenant, event, day
- EPS reconciliation: match daily EPS settlement report against platform transaction log; flag mismatches
- Disbursement queue: T+5 batch builder, manual approval workflow, payout file export
- Refund management: tenant-initiated refund queue, manual override
- Chargeback handling: dispute log, evidence upload, resolution
- Fee structure config: default 0.25%, per-tenant overrides, promotional rates

**Operational Tools**
- Audit log: every admin and tenant action, queryable
- Fraud flag queue: high-velocity tenants, name-mismatch attempts, chargeback spikes
- Support ticket inbox (integrated or linked to external helpdesk)
- System health: API uptime, payment success rate, email/SMS delivery rate
- Bulk announcements to tenants

**Compliance**
- BFIU report generation
- NBR transaction reports
- KYC document archive with retention policy
- PEP/sanctions screening dashboard
- Data export for regulatory requests

**Platform Configuration**
- Event categories and templates
- Form field types and validation rules
- Landing page template library management
- SMS/email template management
- Country/currency settings (for future expansion)
- Maintenance mode toggle

### 3.3 Public Event Pages — Attendee / Buyer

The customer-facing surface. Every event gets a landing page rendered server-side for SEO.

**URL structure — three modes (Shopify-style)**

Every event always exists at three resolvable URLs simultaneously. The tenant chooses which one is the "primary" surface they market.

| Mode | URL pattern | Availability | Notes |
|------|-------------|--------------|-------|
| 1. Platform path | `eventpulse.com.bd/{tenant-slug}/{event-slug}` | All tenants, free, immediate | SEO benefit accrues to platform |
| 2. Tenant subdomain | `{tenant-slug}.eventpulse.com.bd/{event-slug}` | All tenants, free, immediate | Brand-leaning default for serious organisers |
| 3. Custom domain | `events.tenantbrand.com/{event-slug}` or apex | Free for verified tenants (post-KYC); white-label add-on removes "Powered by Event Pulse" footer | Full Shopify-style ownership of the brand experience |

A tenant may also assign a **dedicated custom domain to a single high-profile event** (e.g., `dhakacomedyfest2026.com` for one event), independent of the tenant-level domain. See §7.6 for full white-label architecture.

**Page experience**
- Mobile-first responsive design
- Open Graph + Twitter Card meta for social sharing
- Fast load (LCP < 2.5s on 3G) — critical for Bangladesh mobile internet
- Bangla + English content support per section
- Schema.org Event markup for Google rich snippets
- Embedded map, calendar add-to-Google/Apple buttons
- Share buttons (Facebook, WhatsApp, Messenger, copy link)

**Registration / Purchase Flow**
1. Land on event page → click "Get Tickets" or "Register"
2. Ticket selection screen (if paid) → quantity per tier
3. Custom form → fill registration fields
4. Review screen → see breakdown: ticket × qty, EPS fee, total
5. Payment → redirect to EPS checkout
6. Return to confirmation page → ticket details + QR
7. Email + SMS delivery → with PDF ticket attachment
8. Optional: add to wallet (Apple/Google) — Phase 3

**Attendee Self-Service** (Phase 2)
- Find my ticket (enter email + phone, OTP verify)
- Download QR again, view event details, request refund (if policy allows)
- Optional: persistent account for buyers who attend many events

---

## 4. KYC Framework — Complete Specification

The platform supports two account types with distinct KYC paths, each tiered by transaction limits.

### 4.1 Organisation KYC

Required for any registered entity: company, partnership, society, club, foundation, school, NGO.

**Core documents**
- Trade license (current year, image upload)
- TIN certificate
- BIN certificate (if VAT-registered)
- Incorporation certificate (for limited companies) or registration certificate (societies/NGOs)
- Authorised signatory NID (front + back)
- Authorised signatory photo
- Board resolution or authorisation letter (uploaded on organisation letterhead)
- Bank account details: name, account number, bank, branch, routing number
- Cancelled cheque or bank statement (account name must match registered entity name)
- MFS merchant account (optional, for smaller orgs): bKash Merchant, Nagad Merchant

**Verification steps**
- Trade license number format validation against issuing authority pattern
- TIN/BIN format validation
- NID validation via Porichoy.gov.bd or EC API
- Manual review of board resolution
- Phone OTP to signatory's NID-linked number

**Limits**
- Tier A (default after approval): BDT 25 lakh per month GMV
- Tier B (after 3 months clean history + financials review): BDT 1 Crore per month
- Tier C (negotiated, enterprise): Unlimited

### 4.2 Individual KYC

For private individuals organising events without a formal entity.

**Tier 1 — Light KYC (auto-approval, instant)**

Use case: small community events, alumni get-togethers, family functions, low-stakes gatherings.

| Requirement | Detail |
|------------|--------|
| Identity | Full name, DOB (18+), NID number + front/back image |
| Liveness | Selfie matched to NID photo via face match API |
| Contact | Mobile (OTP), email (link verified) |
| Address | Present address (no proof required at this tier) |
| Payout | Bank OR MFS account; account holder name must exactly match NID name |
| Profile | Profile photo |

**Caps:** BDT 50,000 per event, BDT 2 lakh per month GMV.

**Tier 2 — Standard KYC (manual review, ~24 hrs)**

Use case: regular paid ticketed events at moderate scale.

| Requirement | Detail |
|------------|--------|
| Tier 1 fields | All required |
| Tax | eTIN certificate (image + number validated against NBR format) |
| Address proof | Utility bill or rental agreement (last 3 months) |
| Source of funds | Dropdown declaration: salary / business income / freelance / savings / other |
| Volume declaration | Expected monthly transaction volume |

**Caps:** BDT 5 lakh per event, BDT 20 lakh per month GMV.

**Tier 3 — Enhanced KYC (manual review + video call)**

Use case: high-value concerts, professional event organisers operating as individuals.

| Requirement | Detail |
|------------|--------|
| Tier 2 fields | All required |
| Video KYC | 5-minute scheduled call, identity confirmation, event plans, declaration walkthrough |
| Undertaking | Signed on stamp paper, uploaded — accepts terms, indemnifies for refunds, BFIU compliance |
| Recommended | Upgrade to "Organisation" account (trade license required) |

**Caps:** Configurable per case with AML review.

### 4.3 Bangladesh-Specific Verifications

- **NID validation API**: Porichoy.gov.bd (preferred) or direct EC API — real-time photo, name, DOB cross-check
- **eTIN validation**: NBR format check + optional NBR API call
- **Bank account name match**: enforce at form submission, hard reject on mismatch
- **MFS account name match**: same enforcement for bKash, Nagad, Rocket, Upay
- **Mobile-NID match**: SIM-NID validation via operator APIs (Grameenphone, Robi, Banglalink) — Tier 2+
- **BFIU sanctions/PEP screening**: NID screened against published lists at Tier 2+

### 4.4 Risk Controls (All Tiers)

- One NID = one individual account (hard block on duplicate)
- Same bank/MFS account across multiple accounts → flag for manual review
- New account + first event over BDT 1 lakh in first 7 days → disbursement hold pending review
- Chargeback rate above 1.5% → auto-suspend pending review
- More than 3 new events in first 30 days → manual review for velocity fraud
- Same device fingerprint across accounts → flag

### 4.5 Individual → Organisation Upgrade Path

When an individual crosses BDT 10 lakh annual GMV or hits Tier 3, the portal prompts an upgrade flow. The upgrade preserves all event history, attendee data, and existing landing pages while adding organisation-level documents. This protects the platform from individuals running undeclared commercial ticketing operations.

### 4.6 KYC Operations & SLA

- Light KYC: instant (auto)
- Standard KYC: 24 hours (business days)
- Enhanced KYC + Org KYC: 48–72 hours
- KYC team workflow: queue → assigned reviewer → decision → tenant notification
- KYC document retention: 5 years post-account-closure (per BFIU guideline)
- Encrypted-at-rest storage in S3 with restricted IAM access

---

## 5. Payment & Settlement Architecture

### 5.1 Money Flow

```
Buyer ──(ticket + EPS fee)──> EPS Gateway ──> Platform Settlement Account
                                                       │
                                              ┌────────┴────────┐
                                              │  Hold for T+5   │
                                              └────────┬────────┘
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              ▼                        ▼                        ▼
                       Platform Fee 0.25%        EPS Fee passed         Organiser Net
                       (Platform revenue)         (already netted)       (Disbursement)
```

### 5.2 EPS Integration

EPS Bangladesh provides hosted checkout with the standard `InitializeEPS` flow and `x-hash` signature verification. Integration points:

- **Initialize**: POST to EPS with merchant key, transaction ID, amount, return URL, customer info, hash
- **Hosted checkout**: redirect buyer to EPS-hosted page; buyer chooses card, bKash, Nagad, internet banking
- **Callback (server-to-server)**: EPS POSTs transaction status with hash; platform verifies and updates order state
- **Return URL (client)**: buyer is redirected back; platform shows confirmation based on server-verified status (never trust client-side return)
- **Settlement report**: daily EPS settlement file ingested for reconciliation
- **Refund API**: platform-initiated refund flow with EPS

A payment adapter layer should wrap EPS so that bKash, SSLCommerz, and Aamarpay can be plugged in later without rewriting core payment logic.

### 5.3 Fee Structure

**Per transaction (from buyer's BDT 1,000 ticket as example):**

| Line item | Amount | Notes |
|-----------|--------|-------|
| Ticket face value | BDT 1,000 | Set by organiser |
| EPS gateway fee | BDT ~25–30 | EPS rate varies by method (card 2.5%, MFS 1.5–1.8%) |
| Platform fee | BDT 2.50 | 0.25% of face value |
| **Buyer pays** | **BDT 1,025–1,030** | If EPS fee is buyer-borne |
| **Organiser receives (T+5)** | **BDT 997.50** | Face value minus platform fee |

**EPS fee handling — your decision:**
- **Option A (recommended)**: Buyer pays EPS fee on top — transparent line item at checkout. Industry-standard in Bangladesh.
- **Option B**: Organiser absorbs EPS fee — deducted from payout. Cleaner buyer experience, eats organiser margin.
- **Option C**: Per-event configurable by organiser — most flexibility, slight UI complexity.

Recommendation: launch with **Option C** but default to **Option A** for new events.

### 5.4 T+5 Disbursement

**Why T+5:** Industry standard for Bangladesh aggregator platforms. Aligns with EPS settlement timing, allows chargeback window, gives operations time to verify.

**Disbursement engine:**
- Cron job daily at 02:00 BDT
- Scans transactions with status = SUCCESS and payment_date ≤ today − 5
- Groups by tenant, calculates net payable
- Creates `DisbursementBatch` record per tenant in status PENDING_REVIEW
- Super admin reviews batches in dashboard, approves
- Approved batches generate payout file (bank-specific format) and trigger payouts:
  - Bank: BEFTN file generation or API push (depending on bank)
  - bKash: bKash B2C API
  - Nagad: Nagad disbursement API
  - Rocket: similar
- Webhook/callback updates batch status to PAID
- Email + SMS to tenant on completion

**Edge cases:**
- Refund mid-T+5: amount deducted from pending batch
- Chargeback after disbursement: balance owed by tenant, deducted from next batch
- Tenant suspension: disbursements paused, funds held
- Failed payout: retry queue with notification to tenant to verify account details

### 5.5 Escrow Compliance

The platform settlement account must operate as a designated escrow / collection account under Bangladesh Bank's payment service provider (PSP) or payment system operator (PSO) guidelines. Options:

- **Operate under EPS's licence** (EPS is BB-licensed PSP) — platform acts as merchant aggregator, no separate licence needed initially
- **Apply for own PSP/PSO licence** — long-term play, gives more flexibility and direct settlement
- **Partner with a bank** as the escrow holder — common arrangement

Recommended: launch under EPS's licence as a sub-merchant aggregator. Apply for own PSO licence in Year 2 once GMV justifies it.

### 5.6 Refund Policy Framework

Platform-level rules (configurable per tenant):
- Refund window: defaults to "no refunds after purchase" but tenants can enable a window (e.g., 48 hours before event)
- Refund initiator: tenant only (default), or attendee self-service within policy window
- Platform fee on refund: non-refundable by default (the 0.25% stays with platform)
- EPS fee on refund: non-refundable (EPS does not refund their fee)
- Partial refund: supported for partial cancellations

---

## 6. Form Builder Engine — Deep Dive

### 6.1 Architecture

The form builder is a JSON-schema-driven system. The builder UI manipulates a JSON document; a renderer reads that JSON and generates the form at runtime on event pages.

```json
{
  "form_id": "frm_abc123",
  "event_id": "evt_xyz",
  "version": 3,
  "pages": [
    {
      "page_id": "p1",
      "title": "Your Details",
      "fields": [
        {
          "field_id": "fld_name",
          "type": "text",
          "label": "Full Name",
          "label_bn": "পুরো নাম",
          "required": true,
          "validation": {"min": 2, "max": 100}
        },
        {
          "field_id": "fld_dietary",
          "type": "dropdown",
          "label": "Dietary Preference",
          "options": ["Veg", "Non-veg", "Halal", "No preference"],
          "required": false,
          "conditional": {
            "show_if": {"field_id": "fld_meal", "equals": "yes"}
          }
        }
      ]
    }
  ]
}
```

### 6.2 Field Types

| Type | Use Case | Validation Options |
|------|----------|-------------------|
| text | Name, organisation, free text | min/max length, regex |
| email | Email address | RFC 5322 |
| phone | Mobile number | BD format (+880 or 01XXXXXXXXX) |
| nid | NID number | 10/13/17 digit BD NID format |
| dropdown | Single choice from list | required, default |
| multi-select | Multiple choices | min/max selections |
| radio | Single choice (visible) | required |
| checkbox | Single yes/no or multiple | required |
| file-upload | CV, image, document | size limit, type whitelist, max 10MB |
| date | Date picker | min/max date |
| datetime | Date + time | timezone-aware |
| address | Street, city, district, postal | structured |
| ticket-selector | Embedded ticket purchase | tier-aware |
| signature | Drawn signature | required |
| rating | 1–5 or 1–10 stars | scale |
| custom-html | Rich text, instructions, images | sanitised |
| section-break | Visual separator | n/a |
| hidden | UTM, referral code | server-set |

### 6.3 Conditional Logic

- Show field X if field Y has value Z
- Hide field X if field Y is empty
- Require field X if field Y is checked
- Skip page if condition met
- Stored as JSON expression evaluated at runtime

### 6.4 Per-Ticket-Tier Variations

Different ticket tiers can collect different fields (e.g., VIP tier asks for dietary preference and seating choice; regular tier only collects basic info). Handled by `applies_to_tiers: ["tier_vip", "tier_premium"]` on each field.

### 6.5 Form Submission Flow

1. Buyer fills form on event landing page (client validates per JSON schema)
2. Submit → server re-validates against authoritative JSON schema (never trust client)
3. Server creates `Order` record in status PENDING_PAYMENT
4. Server initialises EPS transaction
5. On EPS success callback, order moves to PAID, attendee records created, QR generated, email/SMS sent
6. Form submission data stored as JSON in `attendee_submissions` table, queryable

### 6.6 Builder UI Stack

- React with `react-dnd` for drag-and-drop
- `react-hook-form` for form state management within the builder preview
- `zod` for schema validation
- Live preview pane showing rendered form
- Undo/redo with command history
- Auto-save every 10 seconds to draft

---

## 7. Landing Page Builder — Deep Dive

### 7.1 Approach: Section-Based JSON Schema

Like the form builder, the landing page is a JSON document — a list of sections with content. Renderer outputs server-side HTML for SEO.

```json
{
  "page_id": "pg_abc",
  "event_id": "evt_xyz",
  "theme": {
    "primary": "#2E2A7A",
    "accent": "#FF6B35",
    "font_heading": "Inter",
    "font_body": "Inter"
  },
  "sections": [
    {"type": "hero", "content": {...}},
    {"type": "about", "content": {...}},
    {"type": "schedule", "content": {...}},
    {"type": "speakers", "content": {...}},
    {"type": "tickets", "content": {...}},
    {"type": "venue_map", "content": {...}},
    {"type": "faq", "content": {...}},
    {"type": "sponsors", "content": {...}},
    {"type": "footer", "content": {...}}
  ]
}
```

### 7.2 Section Library

- **Hero**: banner image, event name, date, location, primary CTA
- **About**: rich text description, optional video embed
- **Schedule**: timeline of sessions with times, speakers, descriptions
- **Speakers**: grid of speaker cards with photo, name, title, bio
- **Tickets**: embedded ticket selector with tiers and pricing
- **Venue**: address, embedded Google Map, directions
- **FAQ**: collapsible Q&A list
- **Sponsors**: logo grid with tiers (platinum, gold, silver)
- **Gallery**: image grid with lightbox
- **Testimonials**: from past events
- **Countdown**: time until event
- **Custom HTML**: sanitised free-form
- **Newsletter signup**: capture leads for future events
- **Social embeds**: Instagram, Facebook, YouTube
- **Footer**: organiser info, contact, terms, refund policy

### 7.3 Templates by Event Category

Pre-built templates as starting points:

- Concert / Music Festival
- Conference / Summit
- Alumni Reunion
- Standup Comedy / Open Mic
- Workshop / Training
- Charity / Fundraiser
- Iftar / Religious Gathering
- Wedding / Reception
- Sports Tournament
- Product Launch / Brand Activation

### 7.4 Customisation Layers

- **Layer 1**: pick template, change text only (90% of users)
- **Layer 2**: change colours, fonts, swap images (50% of users)
- **Layer 3**: add/remove sections, reorder (20% of users)
- **Layer 4**: custom CSS, custom HTML sections (5% of power users)

### 7.5 SEO & Performance

- Server-rendered (Next.js App Router with `generateStaticParams` for published events)
- Image optimisation via Next.js Image (S3 → CloudFront → Next.js)
- Schema.org Event JSON-LD injected
- Sitemap auto-generated for all public events
- Meta tags + Open Graph configurable per event
- Critical CSS inlined, JS deferred
- Target Lighthouse score: 90+ on mobile

### 7.6 White-Label & Custom Domain Architecture — Deep Dive

This is a **core platform capability**, not a fringe paid feature. Event Pulse follows the Shopify model: the platform powers the commerce, but the tenant owns the brand surface end-to-end. This section specifies the full architecture.

#### 7.6.1 Domain Mode Hierarchy

Every tenant operates in one of three domain modes simultaneously, and can move up the hierarchy at any time without losing event history, SEO equity, or attendee data.

**Mode 1 — Platform Path (default, instant, free)**

- Pattern: `eventpulse.com.bd/{tenant-slug}/{event-slug}`
- Available the moment a tenant signs up, before KYC
- Useful for draft events, test runs, low-stakes community events
- SEO equity accrues to `eventpulse.com.bd`
- "Powered by Event Pulse" footer always present

**Mode 2 — Tenant Subdomain (free, post-KYC)**

- Pattern: `{tenant-slug}.eventpulse.com.bd`
- Auto-provisioned on KYC approval
- Wildcard SSL covers all `*.eventpulse.com.bd` subdomains via a single ACM certificate
- Branded enough for most small/mid organisers
- "Powered by Event Pulse" footer present
- Event URLs become `{tenant}.eventpulse.com.bd/{event-slug}`

**Mode 3 — Custom Domain (free for KYC-verified tenants)**

- Pattern: any tenant-owned domain — `events.tenantbrand.com`, `tickets.tenantbrand.com`, `tenantbrand.events`, or apex `tenantbrand.com`
- Tenant brings their own domain (already owned)
- Platform handles DNS verification, SSL provisioning, edge routing
- "Powered by Event Pulse" footer **still present** by default
- Multiple custom domains allowed per tenant (e.g., one per major event)
- Event URLs become `events.tenantbrand.com/{event-slug}` or apex `tenantbrand.com/{event-slug}`

**Mode 3+ — Full White-Label (premium add-on)**

- Everything in Mode 3
- "Powered by Event Pulse" footer removed
- Branded transactional emails (sent from tenant's own domain via verified DKIM/SPF)
- Branded SMS sender ID (where SSL Wireless allows custom sender IDs)
- Optional: white-label PDF tickets (no Event Pulse logo on QR ticket)
- Optional: white-label confirmation page (no Event Pulse branding anywhere in the buyer flow)

The free Mode 3 makes Event Pulse very attractive for serious organisers (free custom domain is a wedge against competitors). The paid Mode 3+ unlocks Event Pulse's premium tier without gating the basic value proposition.

#### 7.6.2 Pricing Model for White-Label

| Feature | Free | White-Label Add-on |
|---------|------|-------------------|
| Mode 1 platform path | ✓ | ✓ |
| Mode 2 tenant subdomain | ✓ (post-KYC) | ✓ |
| Mode 3 custom domain | ✓ (post-KYC, unlimited domains) | ✓ |
| "Powered by Event Pulse" footer | shown | removed |
| Branded transactional email | platform sender | tenant domain sender |
| Branded SMS sender ID | platform sender | tenant sender (subject to SSL Wireless approval) |
| White-label PDF tickets | platform branded | tenant branded |
| White-label confirmation page | platform footer | fully tenant branded |
| Pricing | Free | BDT 2,000–3,000/month per tenant, or BDT 25,000/year |

Custom domains being free for all KYC-verified tenants is intentional — it drives competitive differentiation against legacy ticketing platforms and Google Forms. The 0.25% transaction fee remains the dominant revenue stream; the white-label add-on is a margin booster for serious organisers who want full brand ownership.

#### 7.6.3 Technical Architecture — Recommended

Two production-grade approaches, with a clear recommendation.

**Option A — Cloudflare for SaaS (RECOMMENDED)**

The industry standard for multi-tenant custom domains. Used by Webflow, Vercel, Notion, and dozens of SaaS platforms.

How it works:

1. Event Pulse origin sits on AWS (CloudFront + Lambda + Aurora as planned)
2. Tenant's apex/subdomain points to a Cloudflare-provided `CNAME` (e.g., `customers.eventpulse.com.bd`)
3. Cloudflare for SaaS handles per-domain certificate provisioning (DigiCert-backed, auto-renewing)
4. Cloudflare terminates TLS at the edge, forwards to Event Pulse origin with the original Host header
5. Event Pulse's edge router (CloudFront function or Lambda@Edge) reads `Host`, looks up tenant/event mapping, renders

Advantages:
- Per-domain certs at scale (no AWS ACM 2,500-cert limit problem)
- Native DNS verification flow
- DDoS protection included
- Performance: Cloudflare's edge is faster than AWS CloudFront in some regions
- Pricing: starts ~$2/month per custom hostname (cheap at scale)
- Battle-tested SaaS pattern

Disadvantages:
- Adds Cloudflare to the stack (one more vendor)
- Slight architectural complexity (origin behind Cloudflare)

**Option B — AWS-native (CloudFront + ACM + Lambda@Edge)**

Stay fully within AWS.

How it works:

1. Tenant adds CNAME record pointing to a tenant-specific CloudFront distribution OR to the shared distribution with SNI routing
2. Platform uses AWS ACM to provision a certificate per custom domain (DNS-validated, automatic renewal)
3. Lambda@Edge reads incoming Host header and routes to the right origin/path

Advantages:
- Single-vendor (AWS-only)
- Tighter integration with the rest of the stack
- No external dependency

Disadvantages:
- ACM has limits: 2,500 certs per account by default (raisable to ~10,000). Hitting limits at scale means architectural surgery.
- DNS validation requires the tenant to add a TXT record (extra step in setup wizard)
- CloudFront has a 100 distribution limit per account by default (shared distribution + Lambda@Edge routing avoids this but adds complexity)
- More moving parts to operate

**Recommendation:** Launch with **Cloudflare for SaaS** in Phase 2 when custom domain shipping is on the roadmap. The cert lifecycle and DNS verification flow are battle-tested; we save weeks of engineering.

#### 7.6.4 Tenant-Facing Setup Wizard

What the tenant sees when they click "Connect a Custom Domain" in their portal.

**Step 1 — Domain entry**
- Input: `events.tenantbrand.com` or apex `tenantbrand.com`
- Validation: domain syntax, not already claimed by another tenant
- Choose: subdomain or apex (apex requires `A` or `ALIAS` record at DNS provider — not all providers support apex CNAME-flattening)

**Step 2 — DNS configuration**
- Platform shows tenant the exact DNS records to add at their DNS provider:
  ```
  Type:    CNAME
  Name:    events
  Value:   customers.eventpulse.com.bd
  TTL:     3600
  ```
- For apex, alternative records (Cloudflare-flattened ALIAS or AWS Route 53 ALIAS)
- Helpful "How to add this at GoDaddy / Namecheap / Route 53 / Hostinger / Cloudflare" guides linked

**Step 3 — Verification**
- Tenant clicks "Verify" — platform polls DNS, validates CNAME, kicks off SSL provisioning
- Verification typically completes in 30 seconds – 5 minutes
- Status: Pending → Verifying DNS → Provisioning SSL → Active
- If verification fails, clear error message and retry

**Step 4 — Set as primary (optional)**
- Tenant chooses whether to make this the default URL for new events
- Existing events: choose per-event which domain serves as the primary

**Step 5 — Optional: white-label add-on prompt**
- After successful custom domain setup, prompt: "Want to remove the 'Powered by Event Pulse' footer and send branded emails? Upgrade to White-Label for BDT 2,500/month."

#### 7.6.5 SSL & Renewal

- Certificates auto-renewed by the certificate authority (DigiCert via Cloudflare, or ACM)
- Tenant never has to manually renew
- 24-hour-prior renewal failure alerts: if renewal fails (usually because tenant changed DNS), the platform notifies tenant via email + in-app and gives them 7 days to fix before the domain falls back to Mode 2 subdomain

#### 7.6.6 Email White-Labeling

Transactional emails (order confirmation, ticket QR, reminders) by default come from `notifications@eventpulse.com.bd`. White-label add-on enables sending from tenant's domain.

**Setup flow:**
1. Tenant enters their email sending domain (e.g., `tenantbrand.com`)
2. Platform shows DKIM, SPF, and DMARC records to add
3. AWS SES domain identity verification kicks off
4. Once verified, emails sent from `tickets@tenantbrand.com` (configurable local part)

**Important:** the From address is the tenant's; the platform handles deliverability, bounce processing, complaint handling, and feedback loops via SES.

#### 7.6.7 SMS White-Labeling

In Bangladesh, masked SMS sender IDs are tightly controlled by BTRC. Custom sender IDs require:
- Tenant's trade license + BIN
- BTRC registration of the sender ID (handled by SSL Wireless on tenant's behalf)
- Per-sender-ID monthly fee paid to SSL Wireless

For tenants who don't have or don't want their own sender ID, SMS continues to come from the platform's sender ID (`EVENTPULSE` or similar) regardless of white-label tier.

#### 7.6.8 Multiple Custom Domains per Tenant

A tenant may have:
- A tenant-wide domain (`events.tenantbrand.com`) — used for most events
- Event-specific domains (`dhakacomedyfest2026.com`, `alumnireunion2026.com`) — pinned to single events

The tenant portal's domain manager handles this: "Add Domain → Assign to Tenant (all events) or Pin to Event (one event)."

#### 7.6.9 Edge Routing Logic

When a request arrives at `events.tenantbrand.com/dhaka-fest`:

1. Cloudflare/CloudFront receives request, terminates TLS using the per-domain cert
2. Edge router reads `Host: events.tenantbrand.com`
3. Looks up `custom_domains` table → resolves to `tenant_id = T123`
4. Looks up `events` table for `tenant_id = T123, slug = 'dhaka-fest'` → resolves to event
5. Calls origin with rewritten path `/render-event?event_id=E456&domain_mode=custom&tenant_id=T123`
6. Origin renders SSR landing page with white-label flag set
7. Response cached at edge with cache key including Host + path

Cache invalidation on event update or landing-page-schema change is event-scoped (cheap).

#### 7.6.10 SEO Considerations

- Sitemap per custom domain (e.g., `events.tenantbrand.com/sitemap.xml`) auto-generated
- `robots.txt` per domain (tenant-controllable in white-label tier)
- Canonical URLs: if the same event is reachable at three URLs (path, subdomain, custom), platform sets `<link rel="canonical">` to the tenant's primary chosen URL — preserves SEO equity in one place
- Open Graph and Twitter Card meta use the canonical URL

#### 7.6.11 Database Additions for Custom Domains

```
custom_domains
  id
  tenant_id
  domain                  -- e.g. "events.tenantbrand.com"
  type                    -- 'tenant_wide' | 'event_specific'
  pinned_event_id         -- nullable, set for event-specific
  status                  -- 'pending_dns' | 'verifying' | 'provisioning_ssl'
                           -- | 'active' | 'failed' | 'expired'
  is_primary              -- boolean, marks the tenant's default surface
  ssl_provider            -- 'cloudflare_saas' | 'acm'
  ssl_expires_at
  dns_verified_at
  ssl_activated_at
  created_at
  updated_at

white_label_settings
  tenant_id (pk)
  enabled                 -- boolean
  email_sender_domain     -- e.g. "tenantbrand.com"
  email_sender_local      -- e.g. "tickets" → tickets@tenantbrand.com
  email_dkim_verified     -- boolean
  email_spf_verified      -- boolean
  email_dmarc_verified    -- boolean
  sms_sender_id           -- e.g. "TENANTBRAND"
  remove_footer           -- boolean
  white_label_pdf         -- boolean
  white_label_emails      -- boolean
  subscription_active     -- boolean
  subscription_renews_at
```

#### 7.6.12 Phase Placement

Custom domain functionality (Mode 3 base) ships in **Phase 2** alongside the form/page builders. White-label add-on (Mode 3+) ships in **Phase 3** once the base is stable and there is paying-tenant demand to justify the additional engineering (email DKIM flow, SMS sender ID coordination with SSL Wireless, white-label PDF rendering).

---

## 8. Technical Architecture

### 8.1 Stack Summary

Aligned with Public Pulse Agency's existing stack (TenderPulse pattern):

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 15 (App Router) | SSR for landing pages, SSG for marketing pages |
| UI | Tailwind + shadcn/ui | Custom design tokens |
| State | Zustand (light), TanStack Query | Server state via React Query |
| Forms | react-hook-form + zod | Builder + runtime |
| DnD | react-dnd / dnd-kit | Form and page builder |
| API | Hono on AWS Lambda | Behind API Gateway |
| Auth | JWT + refresh tokens, custom or Lucia | Separate contexts for super admin / tenant / attendee |
| DB | PostgreSQL (Aurora Serverless v2) | Row-level multi-tenancy with RLS |
| Cache | Redis (ElastiCache) | Sessions, rate limits, hot data |
| Queue | SQS + Lambda workers | Disbursement, email, SMS, webhooks |
| File storage | S3 | Event banners, KYC docs, QR PDFs |
| CDN | CloudFront | Static assets, event pages |
| Search | Postgres FTS for MVP, Meilisearch in Phase 2 | Attendee search, event discovery |
| Email | AWS SES + transactional template service | Domain verified for ticketing |
| SMS | SSL Wireless or Banglalink Enterprise | Cost-optimised bulk |
| Payments | EPS Bangladesh (primary), adapter for future | bKash, SSLCommerz as adapters |
| NID verification | Porichoy.gov.bd API | Real-time validation |
| Monitoring | CloudWatch + Sentry | Logs, errors, performance |
| Infra-as-code | AWS CDK or Terraform | Reproducible environments |
| CI/CD | GitHub Actions | Deploy to AWS |

### 8.2 Multi-Tenancy Strategy

**Recommended: Row-level multi-tenancy with `tenant_id`**

- Every domain table has `tenant_id` foreign key
- Postgres Row-Level Security (RLS) policies enforce tenant isolation at DB level
- API middleware sets `current_tenant_id` per request based on JWT claim
- Super admin context bypasses RLS via separate role

**Why not schema-per-tenant:** at scale (1000+ tenants), schema-per-tenant becomes operationally painful (migrations, backups, connection pooling). Row-level scales to millions of tenants with proper indexing.

### 8.3 AWS Region & Hosting

Recommended: **ap-southeast-1 (Singapore)** — same as your TiCON deployments. Lower latency than Mumbai for Bangladesh users on most ISPs, mature services, better service availability than ap-south-1.

### 8.4 Environments

- `dev` — engineers' shared development
- `staging` — pre-prod, mirrors production
- `prod` — production
- `sandbox` — EPS sandbox + test data, for tenant onboarding demos

---

## 9. Database Schema (Conceptual)

Core entities — full SQL DDL to be produced in next phase.

```
tenants
  id, type (org/individual), name, slug, status, kyc_tier, kyc_status,
  fee_override_pct, owner_user_id, created_at

users
  id, email, phone, password_hash, full_name, locale, mfa_enabled

tenant_users
  tenant_id, user_id, role (owner/admin/editor/scanner/finance), invited_at

kyc_submissions
  id, tenant_id, type, documents (jsonb), status, reviewer_id, decision_at

events
  id, tenant_id, slug, type, title, title_bn, status, visibility,
  starts_at, ends_at, timezone, venue (jsonb), capacity, settings (jsonb)

ticket_tiers
  id, event_id, name, price_bdt, capacity, sales_start, sales_end,
  applies_to_form_fields (jsonb), sort_order

forms
  id, event_id, version, schema (jsonb), published_at

landing_pages
  id, event_id, version, schema (jsonb), theme (jsonb), seo (jsonb),
  custom_domain, published_at

orders
  id, event_id, tenant_id, buyer_email, buyer_phone, buyer_name,
  subtotal_bdt, eps_fee_bdt, platform_fee_bdt, total_bdt,
  status, eps_transaction_id, paid_at

attendees
  id, order_id, ticket_tier_id, attendee_email, attendee_phone,
  submission_data (jsonb), qr_code, checked_in_at, checked_in_by

coupons
  id, event_id, code, type (pct/fixed), value, max_uses, used_count,
  starts_at, expires_at

refunds
  id, order_id, amount_bdt, reason, initiated_by, status, processed_at

disbursement_batches
  id, tenant_id, period_start, period_end, gross_bdt, platform_fee_bdt,
  refunds_bdt, net_bdt, status, approved_by, paid_at, payout_reference

eps_settlements
  id, settlement_date, eps_reference, amount_bdt, fee_bdt,
  reconciliation_status

audit_logs
  id, actor_type, actor_id, action, entity_type, entity_id,
  metadata (jsonb), ip, user_agent, created_at
```

Add indexes on: `tenant_id` (all tables), `event_id`, `buyer_email`, `buyer_phone`, `eps_transaction_id`, `status` columns, `created_at` for time-series queries.

---

## 10. API Surface (High-Level)

API design: REST + JSON. GraphQL is overkill for this scope.

**Public APIs (no auth or attendee auth)**
- `GET /events/:slug` — fetch published event for landing page
- `POST /events/:slug/orders` — create order, get EPS init URL
- `GET /orders/:id/status` — poll order status post-redirect
- `POST /attendees/:token/check-status` — find ticket by email + OTP

**Tenant APIs (tenant auth)**
- `/tenant/profile` (GET, PATCH)
- `/tenant/kyc` (POST, GET)
- `/tenant/events` (CRUD)
- `/tenant/events/:id/form` (GET, PUT — JSON schema)
- `/tenant/events/:id/landing` (GET, PUT — JSON schema)
- `/tenant/events/:id/tickets` (CRUD)
- `/tenant/events/:id/attendees` (GET, search, export)
- `/tenant/events/:id/checkin` (POST — QR scan)
- `/tenant/events/:id/reports/*`
- `/tenant/disbursements` (GET)
- `/tenant/team` (CRUD)

**Super Admin APIs (admin auth)**
- `/admin/tenants` (list, view, suspend)
- `/admin/kyc-queue` (review queue)
- `/admin/disbursements/batches` (review, approve)
- `/admin/eps/reconciliation`
- `/admin/reports/*`
- `/admin/audit-logs`

**Webhooks (incoming)**
- `/webhooks/eps/callback` — EPS payment status
- `/webhooks/eps/settlement` — daily settlement file
- `/webhooks/bank/payout-status` — payout confirmation

---

## 11. Security & Compliance

### 11.1 Security Practices

- TLS 1.3 everywhere (CloudFront enforces)
- HSTS, CSP, X-Frame-Options headers
- Password hashing: Argon2id
- JWT with short access tokens (15 min) + refresh tokens (7 days, rotated)
- Rate limiting per IP and per user
- API Gateway WAF rules (OWASP Top 10)
- Secrets in AWS Secrets Manager (rotated)
- KYC documents in S3 with bucket policy restricting access to KYC reviewer role
- Encrypted at rest: S3 SSE-KMS, RDS encrypted with KMS
- Encrypted in transit: TLS for all DB connections
- MFA for all super admin users (TOTP)
- IP allowlist option for super admin portal

### 11.2 Audit & Logging

- Every state-changing action logged with actor, target, before/after, IP
- Logs retained 1 year hot, 5 years cold (S3 Glacier)
- Immutable log stream via CloudTrail for infrastructure changes

### 11.3 Regulatory Compliance

- **BFIU**: AML programme, suspicious transaction reporting, KYC retention
- **NBR**: transaction reporting if required, withholding tax mechanics, Mushak 6.3 records
- **Bangladesh Bank PSP/PSO rules**: operate under EPS aggregator licence in Year 1
- **Data Protection Act (Bangladesh)**: consent capture on registration, right to access/delete
- **Consumer Rights Protection Act**: clear refund policies, dispute resolution

### 11.4 Tax Handling

- **VAT**: 15% VAT on platform service fee (0.25%) — small absolute amounts, handled in Mushak
- **Withholding tax**: if platform is deemed withholding agent under NBR rules, deduct AIT from organiser payouts and remit. Needs explicit legal opinion before launch.
- **Tax invoices**: auto-generate Mushak 6.3 for each tenant monthly, downloadable from portal
- **Tenant tax docs**: at year-end, generate annual transaction statement per tenant for their own tax filing

---

## 12. Notifications & Communications

### 12.1 Channels

- Email (AWS SES)
- SMS (SSL Wireless masked SMS — use organiser brand name as sender ID where allowed)
- In-app notifications (tenant portal bell icon)
- Webhook (for enterprise tenants who want to integrate)

### 12.2 Notification Catalogue (subset)

| Event | Channels | Recipient |
|-------|----------|-----------|
| Tenant signup | Email | Tenant + super admin |
| KYC approved/rejected | Email + SMS | Tenant |
| Event published | Email | Tenant |
| New order | Email + In-app | Tenant |
| Order confirmed | Email + SMS | Buyer |
| Ticket QR | Email (with PDF) | Buyer |
| Event reminder | Email + SMS | Attendee |
| Check-in confirmation | SMS (optional) | Attendee |
| Disbursement approved | Email + SMS | Tenant |
| Disbursement paid | Email + SMS | Tenant |
| Refund processed | Email + SMS | Buyer |
| Chargeback notice | Email + In-app | Tenant + super admin |

---

## 13. Analytics & Reporting

### 13.1 Tenant Dashboards

- Sales overview (today, 7-day, 30-day, custom)
- Sales funnel (page views → form starts → form complete → payment success)
- Revenue by ticket tier with sparkline
- Top traffic sources (UTM tracking)
- Geographic distribution of buyers (district-level)
- Payment method breakdown
- Refund and chargeback rate
- Settlement timeline (T+5 visualisation)
- Per-event comparison

### 13.2 Super Admin Dashboards

- Platform KPIs: GMV, take rate, active tenants, new tenants, churn
- Tenant cohort analysis
- Top 20 tenants by GMV
- Revenue forecasting based on event calendar
- EPS reconciliation health
- KYC queue health (avg time to decision)
- Fraud signals dashboard
- System performance: API latency, error rates, success rates

### 13.3 Data Warehouse (Phase 2)

- Daily ETL from operational Postgres to analytics warehouse (Redshift Serverless or DuckDB + S3 Parquet)
- Metabase or Lightdash for BI access for ops team
- Self-serve cohort and funnel analysis

---

## 14. Phased Roadmap

### Phase 1 — MVP (8 weeks)

**Goal:** ship a working platform with one paying tenant by end of week 8.

- Auth + tenant onboarding (light KYC for individual, basic KYC for org)
- Single-event creation with fixed form template per event type
- Single landing page template with brand customisation (colours, logo, banner)
- Ticket tiers and pricing
- EPS hosted checkout integration with sandbox testing
- QR ticket generation + email delivery
- Basic attendee CRM and CSV export
- Web QR check-in
- Tenant sales dashboard
- Manual disbursement (super admin generates payout file)
- Super admin KYC review queue
- Refund flow (manual)

### Phase 2 — Builder Era (8 weeks)

**Goal:** unlock self-serve customisation, automate disbursement.

- Full drag-and-drop form builder
- Landing page builder with 5 templates
- Coupon codes
- Conditional form logic
- Per-tier form variations
- Automated T+5 disbursement engine
- Super admin financial dashboard with EPS reconciliation
- Tenant team & roles
- SMS notifications
- Bulk messaging
- Per-event refund policies
- Tier 2 individual KYC + Tier B org KYC

### Phase 3 — Scale (12 weeks)

- Custom domain support (paid tier)
- Email campaign tool
- Attendee accounts (find my tickets)
- Discovery page (eventpulse.com.bd home)
- Apple Wallet + Google Wallet passes
- Check-in mobile app (React Native, iOS + Android)
- Advanced analytics with funnels and cohorts
- Bangla UI for all attendee flows
- Multi-session conference support
- Recurring events
- Waitlist management

### Phase 4 — Platform (12 weeks)

- Discovery marketplace with search and filters
- Recommendation engine for buyers
- Fraud detection ML model
- Alternative gateways (bKash, SSLCommerz adapters live)
- White-label tier for enterprise tenants
- API + webhooks for tenant integrations
- Data warehouse + self-serve BI
- Apply for own PSO licence with Bangladesh Bank

---

## 15. Team & Resourcing

### 15.1 MVP Team (8 weeks)

| Role | Count | Notes |
|------|-------|-------|
| Product / PM | 1 | Likely you (Moshiur) initially |
| Backend engineer | 2 | Node/TypeScript, AWS, Postgres |
| Frontend engineer | 2 | Next.js, React, Tailwind |
| Full-stack (form/page builder) | 1 | Strong React + DnD experience |
| Designer | 1 | UX + visual; templates and brand |
| QA | 1 | Functional + payment edge cases |
| DevOps (part-time) | 0.5 | AWS infra, CI/CD |
| KYC ops (part-time) | 0.5 | Manual review during MVP |

Total MVP: ~7 FTE for 8 weeks.

### 15.2 Steady-State (Post-Phase 2)

- Engineering: 5
- Product/Design: 2
- Ops (KYC + Disbursement + Support): 3
- Sales/BD: 2
- Marketing: 1

---

## 16. Cost Estimate

### 16.1 AWS Infrastructure (Monthly, Steady State)

| Component | Estimate (USD) |
|-----------|---------------|
| Aurora Serverless v2 (1-4 ACU avg) | $80–250 |
| Lambda + API Gateway | $50–200 |
| CloudFront + S3 | $30–100 |
| SES (50k emails/mo) | $5 |
| ElastiCache Redis (small) | $30 |
| CloudWatch + Sentry | $40 |
| Route 53 + ACM | $5 |
| Misc (Secrets Manager, KMS) | $20 |
| **Subtotal AWS** | **$260–650** |

### 16.2 External Services (Monthly)

| Service | Estimate |
|---------|----------|
| SSL Wireless SMS (50k SMS) | BDT 12,000–18,000 |
| Porichoy.gov.bd (NID API) | BDT 5–10 per call |
| Sentry (error tracking) | $25 |
| Domain + SSL | minimal |

### 16.3 Development Cost (MVP)

7 FTE × 8 weeks at blended Bangladesh rates ≈ BDT 35–50 lakh for MVP. Could be lower if leveraging existing TiCON team capacity.

### 16.4 Unit Economics

If average event GMV is BDT 5 lakh:
- Platform fee: BDT 1,250 per event
- Variable costs (EPS settlement, SMS, email): ~BDT 100 per event
- Contribution margin: ~BDT 1,150 per event

Break-even on monthly fixed costs (~BDT 8–10 lakh fully loaded) at ~700–900 events/month, which is achievable in Year 2 if the platform captures even a small share of Dhaka's mid-market event activity.

---

## 17. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| EPS integration issues at scale | Medium | High | Sandbox testing rigorously; add SSLCommerz as backup gateway Phase 2 |
| Fraud (fake organisers, chargebacks) | High | High | Tiered KYC, velocity controls, manual review queue, T+5 hold period |
| Regulatory shift (BB tightens PSP rules) | Medium | High | Operate under EPS licence Year 1; apply for own licence Year 2 |
| Tenant cash-flow complaints (T+5 feels slow) | Medium | Medium | Educate clearly; offer T+1 premium for verified Tier 3 tenants in Phase 3 |
| Form/page builder UX falls short | Medium | Medium | Heavy user testing in Phase 2; ship 5 strong templates so most users never touch builder |
| Free tier abuse (events that never happen) | Medium | Low | Flag patterns; auto-archive events with zero registrations after 30 days |
| Customer support load | High | Medium | Self-serve docs, in-app chatbot, Bangla support during business hours |
| Competition from international (Eventbrite enters BD) | Low | High | Move fast; build local moat via EPS, NID, BDT pricing, T+5 disbursement, Bangla UI |
| KYC documents leak | Low | Catastrophic | KMS encryption, strict IAM, MFA, audit logs, pen-test before launch |
| EPS settlement delays / disputes | Medium | Medium | Daily reconciliation, manual override capability, contingency cash buffer |

---

## 18. Success Metrics & KPIs

**North-star metric:** Monthly GMV processed.

**Acquisition**
- New tenant signups per week
- KYC approval rate
- Time from signup to first event published

**Activation**
- % of approved tenants who publish first event within 14 days
- % of published events that receive their first registration within 7 days

**Retention**
- % of tenants who run a second event
- Months-active per tenant cohort

**Revenue**
- GMV per month
- Take rate (0.25% baseline, blended with any premium tier fees)
- Revenue per active tenant

**Operational health**
- Payment success rate (target >97%)
- Refund rate (target <3%)
- Chargeback rate (target <0.5%)
- Avg KYC decision time (target <24 hrs for standard)
- Avg disbursement payout time (target T+5 strict)

**Customer**
- NPS from tenants (quarterly survey)
- Support ticket volume per active tenant
- Time-to-resolution for support tickets

---

## 19. Open Decisions Before Build Starts

### 19.1 RESOLVED (locked in v1.1)

- ✅ **Brand & domain:** Event Pulse, eventpulse.com.bd
- ✅ **Custom domains:** Shopify-style white-labeling is a core platform capability, not an afterthought (see §7.6 for full architecture)
- ✅ **Custom domains pricing:** free for all KYC-verified tenants; "Powered by Event Pulse" footer removal + branded emails/PDFs offered as paid White-Label add-on

### 19.2 STILL OPEN

1. **EPS fee handling:** buyer-borne, organiser-borne, or per-event configurable? *(Recommend: configurable, default buyer-borne.)*
2. **Free events:** allow RSVP-only events with no payment? *(Recommend: yes, drives adoption.)*
3. **Attendee accounts:** required, optional, or guest-only at MVP? *(Recommend: guest-only at MVP, accounts in Phase 3.)*
4. **AWS region:** ap-southeast-1 (Singapore) or ap-south-1 (Mumbai)? *(Recommend: Singapore, matches your TiCON pattern.)*
5. **KYC strictness for MVP:** ship with light/standard tiers only, or all three? *(Recommend: light + org Tier A for MVP, expand in Phase 2.)*
6. **Launch market:** Dhaka-only or nationwide? *(Recommend: nationwide soft launch, Dhaka-focused marketing.)*
7. **Bilingual UI:** Bangla + English from day one or English-first? *(Recommend: English-first for tenant portal, Bangla on attendee landing pages from day one — bilingual everywhere by Phase 3.)*
8. **Edge architecture for custom domains:** Cloudflare for SaaS or AWS-native (CloudFront + ACM + Lambda@Edge)? *(Recommend: Cloudflare for SaaS — battle-tested for SaaS multi-tenant cert lifecycle.)*
9. **White-Label add-on pricing:** BDT 2,500/month (~USD 23) or other? *(Recommend: BDT 2,500/month or BDT 25,000/year — annual prepay discount drives commitment.)*
10. **PSP/PSO licence:** confirm operating under EPS aggregator licence for Year 1, plan own licence application in Year 2?
11. **Pricing-tier structure:** is 0.25% fee + White-Label add-on the only revenue at MVP, or introduce paid tiers (advanced analytics, priority disbursement, dedicated support) immediately?

---

## 20. Next Steps

Pending your sign-off on this outline, the immediate next deliverables are:

1. **Database schema (full SQL DDL)** with indexes, constraints, RLS policies
2. **API specification (OpenAPI 3.1 YAML)** for all endpoints
3. **Wireframes for tenant portal** — onboarding, event wizard, form builder, landing builder, dashboard
4. **Wireframes for super admin portal** — KYC queue, disbursement queue, financial dashboard
5. **Wireframes for event landing pages** — three template directions for design review
6. **EPS integration spec** with sandbox test plan
7. **Detailed MVP sprint plan** — 8 weeks, 2-week sprints, with deliverables per sprint
8. **Brand identity workshop** — name confirmation, logo, colours, typography

This blueprint is intended to be a living document. As decisions are made on the open questions in §19, this outline should be versioned and updated to reflect what's locked in.

---

*End of document.*
