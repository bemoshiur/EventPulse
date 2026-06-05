/**
 * trust-bodies-v1 — original, factual v1.0 bodies for the 12 trust artefacts.
 * These are published standards (not binding contracts) describing what Event
 * Pulse actually does, grounded in CLAUDE.md §15/§17/§20/§21. Written from
 * scratch for Event Pulse (not copied from any other Trust Center).
 *
 * Shipped via seed-legal-v1.ts alongside the binding contracts. Same version
 * convention: any change bumps the version + adds a new seed.
 */

import type { LegalBody } from './legal-bodies-v1.js'

const EFFECTIVE = '5 June 2026'
const D = `_Effective ${EFFECTIVE}._`

const SECURITY = `${D}

## Architecture

Event Pulse runs in a single AWS region — Singapore (ap-southeast-1) — with low latency to Bangladesh. Application, database, cache, and background workers run on hardened infrastructure behind a TLS-terminating reverse proxy. Shell access is via AWS Systems Manager Session Manager only; there are no public SSH ports.

## Data protection

- **Encryption at rest** with AWS KMS-managed keys; KYC documents use a dedicated key with its own blast radius.
- **Per-tenant isolation** — every organiser's data is row-level scoped, enforced at the database layer, so one organiser can never read another's records.
- **Encryption in transit** — TLS everywhere; modern ciphers only.
- **Least privilege** — access to production and to KYC data is restricted and audited.

## Operations

Every state-changing action is written to an append-only audit log (actor, target, before/after, IP, user agent). We keep encrypted database backups with point-in-time recovery and run restore drills. Payments are verified server-side with EPS; money never moves through a personal account.

## Reporting

Found a vulnerability? See our Vulnerability Disclosure page. We respond within 72 hours.`

const SUBPROCESSORS = `${D}

We use a small set of sub-processors to run Event Pulse. Each is bound by data-protection obligations, and we give notice before adding a new one.

| Sub-processor | Purpose | Data | Location |
|---|---|---|---|
| Amazon Web Services | Compute, storage, DNS, email (SES) | All platform data | Singapore + global SES |
| EPS Bangladesh | Payment processing | Payment metadata | Bangladesh |
| Cloudflare | Custom-domain hosting + edge TLS | Public page traffic | Global edge |
| SSL Wireless | SMS delivery | Phone numbers, message content | Bangladesh |
| Sentry | Error tracking (PII-scrubbed) | Redacted diagnostics | EU |

We do not sell your data and never use it to train any third-party AI model. Questions: privacy@eventpulse.com.bd.`

const DISCLOSURE = `${D}

## Safe harbour

We welcome reports from security researchers. If you make a good-faith effort to follow this policy, we will not pursue legal action against you for your research.

## In scope

The Event Pulse platform at eventpulse.com.bd and its subdomains.

## Please do

- Report what you find privately to security@eventpulse.com.bd.
- Give us reasonable time to fix before disclosing publicly.
- Avoid accessing or modifying other users' data; use only test accounts.

## Please don't

- Run denial-of-service tests, spam, or social-engineering attacks.
- Access, download, or destroy data that isn't yours.

## Our commitment

We acknowledge reports within **72 hours** and keep you updated through to a fix.`

const SLA = `${D}

## Uptime commitment

We target **99.5% monthly availability** for the Event Pulse platform, measured against successful responses to the core ticketing and checkout paths, excluding scheduled maintenance announced in advance.

## Service credits

Where monthly availability falls below 99.5% for a paying organiser, a service credit may be requested within 30 days, applied against future platform fees:

- 99.0%–99.5%: 5%
- 95.0%–99.0%: 10%
- below 95.0%: 25%

## Exclusions

Downtime caused by factors outside our control (EPS or other third-party outages, force majeure, or an organiser's own configuration) is excluded. Requests: support@eventpulse.com.bd.`

const AUP = `${D}

Event Pulse provides hosting space and tooling; organisers are responsible for their events. This policy sets the lines we enforce regardless.

## Prohibited

You may not use Event Pulse to host, sell, or promote: illegal goods or services; fraud or deceptive events; content that infringes intellectual-property rights; hate, harassment, or incitement; sexual exploitation of minors or any child-safety violation; or anything unlawful under Bangladesh law.

## Reporting & enforcement

Every public event page carries a "report" link. Reports are triaged on an SLA — 24 hours for high/critical categories. We may warn, unpublish, suspend, or terminate, and refer matters to authorities where required. Organisers receive notice and an appeal path where practicable.

## Two-strike rule

An organiser unpublished twice in 90 days gets a mandatory account review; a third triggers suspension pending appeal.`

const ANTIBRIBERY = `${D}

Event Pulse and Public Pulse Agency are committed to conducting business with integrity. We prohibit bribery and corruption in all forms.

- We do not offer, give, solicit, or accept bribes, kickbacks, or improper payments, whether to public officials or private parties.
- Staff and contractors must avoid conflicts of interest and disclose any that arise.
- Facilitation payments are not permitted.

This commitment aligns with the Bangladesh Anti-Corruption Commission Act 2004 and comparable international standards. Concerns can be raised confidentially to legal@eventpulse.com.bd.`

const AIPOLICY = `${D}

## How we use AI

Where Event Pulse uses AI features, we do so to assist operators — not to make unaccountable decisions about people.

## Our commitments

- **No training on your data.** Your event, attendee, and KYC data is never used to train any third-party AI model.
- **Human in the loop.** KYC review and trust-and-safety actions are decided by people, not automated rejection.
- **Transparency.** Where an AI feature materially affects you, we tell you.

Questions: privacy@eventpulse.com.bd.`

const BDCOMPLIANCE = `${D}

Event Pulse operates as a SaaS platform under Bangladesh law and cooperates with lawful process.

- **Intermediary role** — we provide tooling; organisers are responsible for their events. We operate a notice-and-takedown process for unlawful content, reviewed within 24 hours for serious categories.
- **Financial rules** — KYC follows BFIU requirements; KYC records are retained for five years. We operate under EPS's payment licence as a sub-merchant aggregator at launch.
- **Lawful requests** — we respond to valid BTRC and law-enforcement requests through proper legal process and require court orders for content removal beyond our own Acceptable Use enforcement.
- **Transparency** — we publish an annual count of requests received and their disposition.

Questions: legal@eventpulse.com.bd.`

const GDPR = `${D}

While Event Pulse is built for Bangladesh, we apply equivalent protections where the GDPR is relevant (for example, an EU-based attendee or organiser).

- **Roles** — for attendee data an organiser collects, the organiser is the controller and Event Pulse is the processor; see our Data Processing Addendum.
- **Lawful basis** — contract performance, legal obligation, and legitimate interests in a safe platform.
- **Rights** — access, rectification, erasure, restriction, portability, and objection, subject to legal retention.
- **Transfers** — data is hosted in our Singapore region with appropriate safeguards.

To exercise a right or ask a question: dpo@eventpulse.com.bd.`

const ACCESSIBILITY = `${D}

We want everyone to be able to buy a ticket and run an event on Event Pulse.

## Our target

We aim for **WCAG 2.1 AA** conformance across the platform: semantic markup, keyboard navigability, visible focus states, sufficient colour contrast, labelled form fields, and respect for reduced-motion preferences.

## Known work

Accessibility is ongoing; some areas are still being improved, and we test new surfaces against automated and manual checks before release.

## Tell us

If you hit a barrier, email accessibility@eventpulse.com.bd and we'll work to fix it.`

const TRANSPARENCY = `${D}

Once Event Pulse has been operating for a full reporting period, we will publish an annual Transparency Report here covering:

- the number of government and law-enforcement requests received, and how many we complied with or refused;
- the number of Acceptable-Use reports received, by category, and the actions taken; and
- our average response time against the trust-and-safety SLAs.

As a newly launched platform, the first report will be published after our first full year. Questions: legal@eventpulse.com.bd.`

const RETENTION = `${D}

We keep personal data only as long as needed for the purpose it was collected, or as the law requires.

| Data | Retention |
|---|---|
| KYC documents & records | 5 years after account closure (BFIU) |
| Transaction & invoice records | 7 years (tax/accounting) |
| Attendee & order records | Life of the organiser's account, then deleted on request subject to the above |
| Audit logs | Retained for security and compliance |
| Operational/technical logs | Short-term, rotated |

On account closure you may export your data for a reasonable period before deletion. Questions: privacy@eventpulse.com.bd.`

export const TRUST_BODIES_V1: LegalBody[] = [
  { slug: 'security', bodyMd: SECURITY },
  { slug: 'sub-processors', bodyMd: SUBPROCESSORS },
  { slug: 'security-disclosure', bodyMd: DISCLOSURE },
  { slug: 'sla', bodyMd: SLA },
  { slug: 'acceptable-use', bodyMd: AUP },
  { slug: 'anti-bribery', bodyMd: ANTIBRIBERY },
  { slug: 'ai-policy', bodyMd: AIPOLICY },
  { slug: 'bangladesh-compliance', bodyMd: BDCOMPLIANCE },
  { slug: 'gdpr', bodyMd: GDPR },
  { slug: 'accessibility', bodyMd: ACCESSIBILITY },
  { slug: 'transparency', bodyMd: TRANSPARENCY },
  { slug: 'retention', bodyMd: RETENTION },
]
