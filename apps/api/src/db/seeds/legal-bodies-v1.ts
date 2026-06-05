/**
 * legal-bodies-v1 — original, Event-Pulse-specific bodies for the six binding
 * legal contracts, written from scratch for the events/ticketing product (NOT
 * copied or substituted from any other Trust Center; see decisions.md
 * "Copy-paste from other companies' Trust Centers … potential IP issues").
 *
 * These ship as the v1.0 legal_document_versions body via seed-legal-v1.ts.
 * They are good-faith, plain-language documents grounded in Event Pulse's real
 * data flows (CLAUDE.md §15 / §20 / §21). A qualified lawyer should confirm them
 * against current Bangladesh law before they are relied on in a dispute; that
 * review is an editing pass, not a rewrite.
 *
 * Any content change here MUST bump the version + add a new seed — silent body
 * drift at a fixed version is a legal-risk pattern we don't enable (mirrors the
 * buyer-terms-v1 convention).
 */

export const LEGAL_V1_VERSION = 'v1.0' as const

const EFFECTIVE = '5 June 2026'

export interface LegalBody {
  slug: string
  bodyMd: string
}

const PRIVACY = `_Effective ${EFFECTIVE}._

## 1. Who we are

Event Pulse is an event ticketing and registration platform operated by Public Pulse Agency, Dhaka, Bangladesh ("Event Pulse", "we", "us"). This Privacy Policy explains what personal data we collect, why, how we protect it, and the rights you have over it.

## 2. The data we collect

- **Account data** — your email, name, and (optionally) phone, for organisers and signed-in users.
- **Buyer data** — when you buy a ticket: name, email, phone, and any fields the organiser's registration form requests (which may include NID for regulated events).
- **KYC data** — for organisers selling paid tickets: identity and bank/MFS details required to verify you and pay you out.
- **Payment metadata** — transaction identifiers and status from EPS. We do not store full card numbers; card data is handled by the payment gateway.
- **Technical data** — IP address, device/browser information, and audit logs of state-changing actions, for security and fraud prevention.

## 3. Why we use it

To create and run your account; to process ticket purchases and payouts; to deliver tickets and notifications; to verify organisers (KYC) as Bangladesh financial rules require; to prevent fraud and abuse; and to meet legal and regulatory obligations.

## 4. Legal bases & sharing

We process data to perform our contract with you, to meet legal obligations, and on the basis of our legitimate interest in running a safe platform. We share data only with the sub-processors listed on our Sub-processors page (e.g. AWS, EPS, our email/SMS providers) and with authorities where we are legally required to. We never sell your data, and we never use it to train any third-party AI model.

## 5. Security & retention

Data is encrypted at rest with managed keys, isolated per organiser, and access-controlled. KYC documents are held in encrypted storage available only to the review process. We keep KYC records for five years after account closure as required by the Bangladesh Financial Intelligence Unit (BFIU), and other data only as long as needed for the purposes above or as the law requires.

## 6. Your rights

You may access, correct, or request deletion of your personal data, and object to certain processing, subject to legal retention requirements. To exercise any right, contact privacy@eventpulse.com.bd. We respond within a reasonable period.

## 7. Changes & contact

We will post any material change here and, where appropriate, notify you. Questions: privacy@eventpulse.com.bd.`

const TERMS = `_Effective ${EFFECTIVE}._

## 1. Agreement

These Terms govern your use of Event Pulse, operated by Public Pulse Agency. By creating an account or using the platform, you agree to them. If you use Event Pulse for an organisation, you confirm you are authorised to bind it.

## 2. What Event Pulse is

Event Pulse provides hosting space and tooling — branded event pages, registration forms, payment processing via EPS, QR tickets, check-in, and disbursement. **Event Pulse is a platform, not the organiser of any event.**

## 3. Organisers are responsible for their events

When an attendee buys a ticket, the contract for that event is between the attendee and the organiser, not Event Pulse. Organisers are solely responsible for the content, safety, legality, conduct, and outcome of their events, including venue safety, intellectual-property compliance, age restrictions, and refunds for cancelled events.

## 4. Acceptable use

You may not use Event Pulse for unlawful, fraudulent, infringing, or harmful purposes, or to host events that violate our Acceptable Use Policy. We may suspend or remove events or accounts that do, with notice where practicable.

## 5. Fees & payouts

Free events carry no fee. For paid events, Event Pulse charges a flat 0.25% platform fee per transaction; EPS gateway fees pass through at cost. Net proceeds settle to your account on the T+5 schedule described in the Refund Policy and your dashboard. You must complete KYC before selling paid tickets.

## 6. Liability

Event Pulse provides the platform "as is" to the extent permitted by law. We are not liable for the conduct or outcome of any event, for an organiser's acts or omissions, or for indirect or consequential loss. The organiser indemnifies Event Pulse against claims arising from their event. Nothing here excludes liability that cannot be excluded under Bangladesh law.

## 7. Suspension, termination & law

We may suspend or terminate access for breach of these Terms. These Terms are governed by the laws of Bangladesh, and disputes are subject to the courts of Dhaka. Questions: legal@eventpulse.com.bd.`

const EULA = `_Effective ${EFFECTIVE}._

## 1. Licence

Event Pulse grants you a limited, non-exclusive, non-transferable, revocable licence to use the platform for its intended purpose — creating and running events, or buying tickets — in accordance with our Terms of Service.

## 2. You own your content

You retain ownership of everything you create or upload: your event pages, registration forms, branding, and attendee records. You grant Event Pulse only the licence needed to host, display, and process that content to provide the service.

## 3. Restrictions

You may not copy, resell, reverse-engineer, or build a competing service from the platform; circumvent security or rate limits; or use the platform to infringe others' rights or break the law.

## 4. Availability & changes

We may update, improve, or change features over time. We aim for high availability (see our SLA) but do not guarantee uninterrupted service.

## 5. Termination

This licence ends if you stop using Event Pulse or if we terminate your account under the Terms. On termination you may export your data for a reasonable period, after which it is deleted subject to legal retention requirements.

## 6. Contact

Questions about this licence: legal@eventpulse.com.bd.`

const DPA = `_Effective ${EFFECTIVE}._

This Data Processing Addendum applies where Event Pulse processes personal data on behalf of an organiser (the "Controller") who is subject to data-protection obligations. It forms part of the Terms of Service.

## 1. Roles

For attendee data an organiser collects through Event Pulse, the **organiser is the Controller** and **Event Pulse is the Processor**. Event Pulse processes that data only on the organiser's documented instructions and to provide the service.

## 2. Our obligations as Processor

- Process personal data only as instructed and as needed to provide the service.
- Keep personal data confidential and ensure staff are bound by confidentiality.
- Apply appropriate technical and organisational security (encryption at rest, per-tenant isolation, access control, audit logging).
- Assist the Controller, so far as reasonable, with data-subject requests and security obligations.
- Notify the Controller without undue delay on becoming aware of a personal-data breach.

## 3. Sub-processors

Event Pulse uses the sub-processors listed on its Sub-processors page and imposes equivalent data-protection obligations on them. We give notice before adding a sub-processor so the Controller may object.

## 4. International transfers & retention

Data is hosted in our Singapore region (ap-southeast-1) with appropriate safeguards. On termination, Event Pulse deletes or returns personal data at the Controller's choice, save for copies required by law.

## 5. Audits & contact

Event Pulse will make available information reasonably necessary to demonstrate compliance with this DPA. Contact: dpo@eventpulse.com.bd.`

const COOKIES = `_Effective ${EFFECTIVE}._

## 1. What cookies we use

Event Pulse uses a small number of cookies and similar technologies, grouped by purpose:

- **Strictly necessary** — sign-in session, security/CSRF protection, and load balancing. The platform cannot function without these.
- **Preferences** — remembering your language (English / বাংলা) and similar choices.
- **Analytics (aggregate)** — understanding how pages are used so we can improve them. These do not identify you personally.

## 2. What we do not do

We do not use advertising or cross-site tracking cookies, and we do not sell data gathered through cookies.

## 3. Managing cookies

You can control or delete cookies through your browser settings. Blocking strictly-necessary cookies will prevent sign-in and checkout from working.

## 4. Contact

Questions: privacy@eventpulse.com.bd.`

const REFUND = `_Effective ${EFFECTIVE}._

## 1. Refunds sit with the organiser

Each event sets its own refund policy, shown at checkout before you pay. Because the ticket contract is between you and the organiser, refund decisions are the organiser's. Event Pulse provides the tooling to carry out a refund on the organiser's instruction.

## 2. How a refund is processed

When an organiser approves a refund, the amount is returned through the original EPS payment path. Refunds are reflected in the organiser's reconciliation and the next settlement. Depending on the payment method, it may take several business days for the funds to reach the buyer.

## 3. Cancelled or materially changed events

If an organiser cancels an event, or changes it materially (date, venue, or headline content), buyers are entitled to a refund of the ticket face value, subject to the organiser's stated policy and applicable consumer law.

## 4. Fees

The platform fee and gateway fees on a refunded order are handled per the event's fee mode and the settlement rules in your dashboard. Free events involve no payment and so no refund.

## 5. Disputes

If you believe a refund has been wrongly withheld, contact the organiser first. If unresolved, you may escalate to support@eventpulse.com.bd and we will review under our Acceptable Use Policy.`

export const LEGAL_BODIES_V1: LegalBody[] = [
  { slug: 'privacy', bodyMd: PRIVACY },
  { slug: 'terms', bodyMd: TERMS },
  { slug: 'eula', bodyMd: EULA },
  { slug: 'dpa', bodyMd: DPA },
  { slug: 'cookies', bodyMd: COOKIES },
  { slug: 'refund-policy', bodyMd: REFUND },
]
