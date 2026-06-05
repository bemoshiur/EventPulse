# Event Pulse — Bangladesh Tax & Regulatory Position (adopted)

**Status:** Adopted company position · **Effective:** 5 June 2026 · **Owner:** Public Pulse Agency
**Scope:** Resolves §29 Open Decisions #9 (AIT withholding classification) and #10 (VAT/Mushak registration model), plus the consolidated regulatory posture for MVP launch.

> This is Event Pulse's adopted operating position, reasoned from the cited Bangladesh statutes and our operating model. It governs how the platform behaves at MVP. It is reviewed when the operating model materially changes (own PSO licence, cross-border settlement, or a specific NBR marketplace ruling).

---

## 1. Operating model (this drives every tax answer below)

Event Pulse is a multi-tenant SaaS **ticketing facilitator**, not the seller of the events. The economic substance of every paid order is:

1. An **attendee** buys a ticket from an **organiser** (the tenant). The sale contract is attendee ↔ organiser (Terms §3, host-liability doctrine §21).
2. Payment is captured through **EPS**, a Bangladesh Bank-licensed Payment Service Provider. For Year 1 Event Pulse operates as a **sub-merchant aggregator under EPS's PSP licence**; client funds sit in a designated settlement account, separate from operating funds, and are not held beyond the **T+5** settlement window.
3. Event Pulse retains a **0.25% platform fee** (its only revenue from the transaction) and **remits the balance** (the organiser's own sales proceeds) to the organiser at T+5.

The platform therefore handles two economically distinct money flows: **(a)** the organiser's ticket revenue, which merely passes through, and **(b)** Event Pulse's own 0.25% service fee, which is genuine income to Event Pulse. The tax treatment of each follows from this distinction.

---

## 2. Advance Income Tax / deduction at source (§29 #9 — RESOLVED)

**Governing law:** the deduction-at-source (withholding) regime of the **Income Tax Act 2023** (আয়কর আইন, ২০২৩), successor to §§52–53 of the Income Tax Ordinance 1984. The regime binds a "specified person" who **makes a payment** on account of the **supply of goods, execution of a contract, or services rendered to that person** to deduct tax at source.

**Adopted classification: Event Pulse is NOT a withholding agent on settlements to organisers.**

Reasoning: the T+5 settlement is a **remittance of the attendee's own funds** to the organiser — the organiser's ticket revenue passing through the platform — **not a payment by Event Pulse for any supply made to Event Pulse**. The organiser is not Event Pulse's contractor, supplier, or service provider; the organiser is an independent principal selling to attendees. The deduction-at-source trigger ("payment for a supply _to the specified person_") is therefore not met on the settlement leg. A facilitator remitting third-party marketplace proceeds is not procuring a supply for itself.

Where withholding **does** apply, and what we do:

- **Event Pulse's own income (the 0.25% fee).** This is taxable corporate income of Event Pulse and is brought to charge through Event Pulse's own corporate return / advance tax — it is not a source-deduction event on the organiser.
- **Event Pulse's own vendor payments.** On domestic supplier/contractor payments above statutory thresholds (e.g. local services), Event Pulse withholds and deposits per the standard rules as a payer.
- **The organiser's own income tax.** Organisers are responsible for declaring and paying income tax on their ticket revenue; Event Pulse provides complete sales + settlement reports so the organiser can meet that obligation.

**Operational consequence:** `orders.withholding_tax_paisa` remains **0** at MVP; the settlement engine does **not** deduct AIT from organiser payouts. **Trigger to revisit:** (i) NBR issues a specific e-commerce / marketplace-facilitator source-deduction rule (a clear policy trend), or (ii) Event Pulse obtains its **own PSO licence** and ceases to be a pass-through aggregator. Either event re-opens this classification before the next settlement cycle.

---

## 3. VAT / Mushak (§29 #10 — RESOLVED)

**Governing law:** the **Value Added Tax and Supplementary Duty Act 2012** (মূল্য সংযোজন কর ও সম্পূরক শুল্ক আইন, ২০১২), in force from 1 July 2019; standard VAT rate **15%**; tax invoice is **Mushak 6.3**; registration identifier is the **e-BIN** (13 digits since 30 Nov 2019).

**Adopted model: Event Pulse is the VAT-bearing party only on its 0.25% platform fee; organisers bear VAT on the ticket face value.**

1. **Platform fee (Event Pulse's supply).** The 0.25% fee is a **taxable supply of an electronic/standardised service** by Event Pulse to the organiser. Event Pulse **registers for VAT** (obtains an e-BIN — its turnover from fees crosses the registration threshold), charges **15% VAT on the fee**, issues **Mushak 6.3** to the tenant monthly, and deposits the output VAT. Default treatment: the platform fee is quoted exclusive of VAT and the 15% is shown as a distinct line in the settlement statement, so the VAT base is transparent and auditable per tenant.
2. **Ticket face value (the organiser's supply).** VAT on the event/ticket itself is the **organiser's liability**, determined by the organiser's own VAT registration status and the nature of the event. Certain categories (genuinely cultural, educational, or charitable events) may attract exemption or a reduced rate — that determination belongs to the organiser. Event Pulse does **not** assume, collect, or remit VAT on the face value; it furnishes the sales data the organiser needs to comply.

**Operational consequence:** the fee calculator and revenue ledger treat the 0.25% as Event Pulse's VATable turnover; a monthly Mushak 6.3 per tenant is generated for the fee. The organiser's face-value VAT is out of scope for the platform's own returns. **Trigger to revisit:** an NBR ruling that deems marketplace facilitators the VAT collection agent for the underlying supply (some jurisdictions have moved this way) — that would shift face-value VAT collection onto the platform and is monitored.

---

## 4. Bangladesh Bank — payment-system licensing

Year 1: operate as a **sub-merchant aggregator under EPS's PSP licence**. Client (attendee) funds are held in a **designated settlement account, ring-fenced from operating funds**, and disbursed within the T+5 window — Event Pulse does not warehouse client money. Apply for **Event Pulse's own PSO licence** in Year 2 if transaction volume and the business case justify it; that step also re-opens the AIT classification in §2.

---

## 5. AML / BFIU

KYC documentation retained **5 years** post account closure; **STR** (suspicious-transaction) escalation path in the super-admin tooling; **PEP / sanctions screening** from KYC Tier 2 (manual reviewer judgement at MVP, per the platform-wide manual-verification policy). High-velocity / NID-reuse / name-mismatch patterns surface to the reviewer queue.

---

## 6. Content / intermediary law

Event Pulse operates the **hosting-space doctrine** (§21): organisers are the organisers of record and bear liability for their events; Event Pulse provides tooling only. Notice-and-takedown under **DSA 2018 §§29–32** and the intermediary duties of the **ICT Act 2006**; BTRC / law-enforcement requests handled with proper legal process and surfaced in the annual Transparency Report; AUP triage queue enforces prohibited-category removals.

---

## 7. Consumer protection

Each event displays its **refund policy at checkout**; the organiser is the refund-decision authority and Event Pulse operationalises the mechanic. Dispute path: support → super-admin escalation. Payment status is always taken from the **EPS Verify** API, never the redirect (R3), protecting the buyer against false "paid" states.

---

## 8. The six binding contracts

Privacy, Terms, EULA, DPA, Cookies, and the Refund Policy are **live at v1.0** and authored in-house. The company has elected to proceed on these adopted drafts; a material-change re-consent flow is in place so any future amendment re-prompts consent. These positions and the contracts together constitute Event Pulse's launch-stage legal foundation.

---

_Adopted 5 June 2026. Supersedes the "OPEN — get legal opinion" placeholders in §15.2 / §21.2 and closes §29 Open Decisions #9 and #10._
