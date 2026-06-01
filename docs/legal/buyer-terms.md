# Buyer-Terms-Lite — Event Pulse Checkout Terms (APPROVED v1.0 — ships in checkout)

> **Status:** APPROVED v1.0 — 2026-05-31 (Day 39, Phase 2). Salehin's final-check pass cleared on 2026-05-31 with "all good to go" sign-off; operator's final sign-off cleared on 2026-05-31. **This document is the canonical Buyer Terms v1.0 surface for the bKash-only launch.** Currently in flight: wire-in PR (`feat/buyer-terms-v1-consent-wire-in`) that captures `consent_records` at checkout and replaces the Day-34 link-footer pattern. The four sections below are the **public checkout body** that surfaces above the "Continue with bKash" clickwrap line.
>
> **v0.2 → v0.3 → v1.0 progression:** v0.3 was the operator-approved draft sent to Salehin for final-check (2026-05-31). Salehin returned "all good to go" — no edits required. The document promoted from `DRAFT v0.3` → `APPROVED v1.0` with no body changes between v0.3 and v1.0; v1.0 is the same body Salehin signed off on, just with the status pivot and sign-off chain updated.
>
> **v0.2 → v0.3 deltas (four edits applied — preserved here as the version history that became v1.0):**
>
> 1. **Edit 1 — §1 minor-age formulation:** verbatim wording applied per Salehin's 2026-05-31 reply (EN: "By proceeding, you confirm that you are 18 years of age or older, or that you are purchasing the ticket with the consent and under the supervision of a legal guardian who is 18 years of age or older."). BN parallel produced; BN rendering of "consent and supervision" is an interpretive call flagged for Salehin's final-check item (a).
> 2. **Edit 2 — §4 BN consequential-damages terminology:** "পরিণতিগত ক্ষতি" → "পরোক্ষ ক্ষতি" per Salehin's recommended legal-Bengali construction. EN unchanged ("indirect, consequential, or follow-on losses").
> 3. **Edit 3 — §3 fifth recipient category:** added "Fraud prevention, security, and legal/regulatory compliance partners — for protecting against unauthorized transactions, abuse, and meeting our legal obligations under Bangladeshi law." (BN parallel applied).
> 4. **Edit 4 — §4 carve-out exception list (selective adoption from Clause 6.2 of Organiser Agreement v1.3 master text):** previous six-bullet structure with prose explanations replaced by Salehin's verbatim five-exception list in his exact ordering — (a) Gross negligence or wilful misconduct, (b) Fraud or fraudulent misrepresentation, (c) Breach of fiduciary duty, (d) Death or personal injury caused by negligence, (e) Any other liability that cannot be limited or excluded by applicable law. BN parallel produced; BN rendering of (b) "fraudulent misrepresentation" is an interpretive call flagged for Salehin's final-check item (b).
>
> **v0.2 → v0.3 deliberate non-adoptions (selective adoption rationale documented):** Clause 6.2 exception list adopted verbatim per Salehin master-document text; **Clauses 6.1 cap formula and 6.3 indemnification deliberately not adopted** per Salehin's written confirmation 2026-05-31 that (a) Buyer-side cap stays "total ticket amount paid" — distinct from the Organiser Agreement's 12-month-fees cap which is B2B-appropriate and applying it to consumers would be mismatched and could create enforceability issues; (b) buyer-indemnifies-Platform clause would carry Consumer Rights Protection Act 2009 risk (such clauses can be viewed as unfair contract terms when the buyer is in a weaker bargaining position) and is inappropriate for a v1.0 consumer-facing lite document. A narrow buyer indemnity limited to fraud or wilful abuse may be revisited post-launch with transaction data per Salehin 2026-05-31; explicitly out of v1.0 scope.
>
> **Source:** `decisions.md` 2026-05-31 Day 39 "Salehin written opinion received on Buyer Terms — reading (a) primarily confirmed, Buyer-Terms-Lite required at checkout" entry, plus Salehin's 2026-05-31 follow-up reply confirming all three selective-adoption decisions in writing. Sections fixed by Salehin's framing.
>
> **Four sections (Salehin's framing, verbatim from his reply):**
>
> 1. Platform usage
> 2. Disclaimers on Event Pulse's limited role
> 3. Data processing consent
> 4. Basic liability carve-outs
>
> **Language order:** Bengali primary per CLAUDE.md R12 ("Bangla-first attendee UI"); English alongside as natural parallel, not a literal translation source. Both versions are intended to be substantively equivalent; the Bengali is written for native readability, not as a back-translation from English.
>
> **Tone:** plain-language, buyer-readable, not lawyer-readable. Direct address (আপনি / you). Short sentences. Concrete examples where helpful.
>
> **What's deliberately NOT in this lite document (per Salehin's "expand into full dedicated Buyer Terms shortly after you have initial transaction data and user feedback"):** detailed refund mechanics, chargeback procedure, dispute-resolution arbitration clause, governing-law detailed schedule, intellectual-property carve-outs, force-majeure boilerplate, termination clauses, indemnification framework. These are post-launch scope, sequenced after initial transaction-data + user-feedback inform real customer pain points.

---

## ১. প্ল্যাটফর্ম ব্যবহার / Platform usage

### বাংলা

Event Pulse একটি অনলাইন প্ল্যাটফর্ম যেখান থেকে আপনি বিভিন্ন আয়োজকের (Organiser) ইভেন্টের টিকেট কিনতে পারেন। যখন আপনি কোনো টিকেট কেনেন, তখন টিকেটের আসল চুক্তিটি আপনার এবং সংশ্লিষ্ট আয়োজকের মধ্যে হয় — Event Pulse আপনার পেমেন্ট ও টিকেট ডেলিভারির কারিগরি কাজ পরিচালনা করে।

এই প্ল্যাটফর্ম ব্যবহার করার অর্থ হলো আপনি নিচের শর্তগুলিতে সম্মত আছেন:

- এগিয়ে যাওয়ার মাধ্যমে, আপনি নিশ্চিত করছেন যে আপনি ১৮ বছর বা তার বেশি বয়সী, অথবা আপনি ১৮ বছর বা তার বেশি বয়সী একজন আইনি অভিভাবকের সম্মতি ও তত্ত্বাবধানে টিকেটটি কিনছেন।
- আপনি যে তথ্য (নাম, ফোন, ইমেইল ইত্যাদি) প্রদান করছেন তা সঠিক এবং আপনার নিজস্ব।
- আপনি যে অর্থ পরিশোধ করছেন তা আপনার বৈধ উৎস থেকে এসেছে, এবং পেমেন্টের জন্য ব্যবহৃত bKash অ্যাকাউন্ট আপনার নিজের।
- আপনি Event Pulse-কে স্বাভাবিক ব্যবহারের জন্য ব্যবহার করছেন — অর্থাৎ পুনঃবিক্রির উদ্দেশ্যে বাল্ক কেনাকাটা, অন্য কারও পরিচয়ে টিকেট সংগ্রহ, বা প্রতারণামূলক কার্যকলাপের জন্য নয়।
- আপনি টিকেটটি ব্যবহার করবেন শুধুমাত্র তার উদ্দিষ্ট ইভেন্টে প্রবেশের জন্য, এবং পুনঃবিক্রয় বা স্থানান্তর সংশ্লিষ্ট আয়োজকের নিজস্ব নিয়ম অনুযায়ী হবে।

v1.0 চালুর সময়ে Event Pulse-এ পেমেন্টের একমাত্র মাধ্যম bKash। কার্ড, নগদ, রকেট, উপয়, বা ব্যাংক ট্রান্সফার পরবর্তীতে যুক্ত হবে।

আপনি যদি এই শর্তগুলোর কোনোটি লঙ্ঘন করেন, Event Pulse আপনার অর্ডার বাতিল করার বা ভবিষ্যতে আমাদের প্ল্যাটফর্ম থেকে কেনাকাটা সীমিত করার অধিকার সংরক্ষণ করে।

### English

Event Pulse is an online platform where you can buy tickets to events organised by independent Organisers. When you buy a ticket, the actual contract for the ticket is between you and the relevant Organiser — Event Pulse handles the technology side of your payment and ticket delivery.

Using this platform means you agree to the following:

- By proceeding, you confirm that you are 18 years of age or older, or that you are purchasing the ticket with the consent and under the supervision of a legal guardian who is 18 years of age or older.
- The information you provide (name, phone, email, etc.) is accurate and your own.
- The money you pay comes from a legitimate source you own, and the bKash account used is yours.
- You are using Event Pulse for normal use — not for bulk purchases intended for resale, collecting tickets under someone else's identity, or fraudulent activity.
- You will use the ticket only to enter the event it is intended for, and resale or transfer follows the Organiser's own rules.

At v1.0 launch, Event Pulse accepts bKash payments only. Card, Nagad, Rocket, Upay, and bank transfer will be added later.

If you breach any of these conditions, Event Pulse reserves the right to cancel your order or restrict your future use of the platform.

---

## ২. Event Pulse-এর সীমাবদ্ধ ভূমিকা / Event Pulse's limited role

### বাংলা

Event Pulse আয়োজকদের জন্য একটি **প্রকাশিত এজেন্ট (disclosed agent) ও পেমেন্ট ফেসিলিটেটর** হিসেবে কাজ করে — অর্থাৎ আমরা আপনার থেকে আয়োজকের পক্ষে অর্থ গ্রহণ করি, এবং টিকেট পৌঁছানোর কারিগরি ব্যবস্থা পরিচালনা করি। বাংলাদেশ চুক্তি আইন, ১৮৭২-এর ১৮২ ধারা অনুযায়ী প্রকাশিত-এজেন্সি কাঠামোতে:

- **আয়োজক হলেন প্রধান (principal)** — টিকেটের আসল বিক্রেতা।
- **Event Pulse আয়োজকের এজেন্ট** — যিনি ইভেন্ট আয়োজন, কনটেন্ট, ক্যানসেলেশন, রিফান্ড নীতি, এবং ইভেন্টের গুণমানের জন্য দায়ী, তিনি হলেন আয়োজক।

বাস্তবে এর মানে:

- ইভেন্টের সময়, স্থান, কনটেন্ট, বা যেকোনো পরিবর্তনের তথ্য Event Pulse-এর নয়, আয়োজকের। যেকোনো আপডেটের জন্য আয়োজকের নিজস্ব যোগাযোগের চ্যানেল প্রাথমিক উৎস।
- আপনার টিকেট সংক্রান্ত মূল চুক্তি (ইভেন্টে কী অন্তর্ভুক্ত, কী নয়, কখন রিফান্ডযোগ্য, ইত্যাদি) আয়োজকের নিজস্ব ইভেন্ট-শর্ত অনুসরণ করে।
- Event Pulse আয়োজকের ইভেন্টের গুণমান, নিরাপত্তা, সময়সূচী মেনে চলা, বা প্রতিশ্রুত কনটেন্টের জন্য দায়বদ্ধ নয়। ইভেন্ট সংক্রান্ত যেকোনো অভিযোগ প্রথমে আয়োজকের কাছে নিতে হবে।
- যদি আয়োজক রিফান্ডের সিদ্ধান্ত নেন, Event Pulse প্রসেসিংয়ে সহায়তা করবে — তবে রিফান্ডের সিদ্ধান্ত আয়োজকের, আমাদের নয়।

Event Pulse-এর ভূমিকা টেকনিক্যাল ও আর্থিক প্রসেসিংয়ে সীমিত। আমরা ইভেন্টের জন্য কোনো অনুমোদন, নিশ্চয়তা, বা সুপারিশ প্রদান করি না।

### English

Event Pulse acts as a **disclosed agent and payment facilitator** for Organisers — meaning we receive money from you on the Organiser's behalf and handle the technology side of delivering your ticket. Under the disclosed-agency framework described in Section 182 of the Bangladesh Contract Act, 1872:

- **The Organiser is the principal** — the actual seller of the ticket.
- **Event Pulse is the Organiser's agent** — the party responsible for organising the event, its content, cancellation, refund policy, and event quality is the Organiser, not Event Pulse.

In practice, this means:

- Information about the event's time, location, content, or any changes comes from the Organiser, not Event Pulse. The Organiser's own communication channels are the primary source for updates.
- Your ticket-related primary contract (what's included in the event, what's not, when refundable, etc.) follows the Organiser's own event terms.
- Event Pulse is not responsible for the Organiser's event quality, safety, adherence to schedule, or promised content. Any event-related complaint should first go to the Organiser.
- If the Organiser decides to issue a refund, Event Pulse will help process it — but the refund decision is the Organiser's, not ours.

Event Pulse's role is limited to technical and financial processing. We do not endorse, guarantee, or recommend any event.

---

## ৩. তথ্য প্রক্রিয়াকরণে সম্মতি / Data processing consent

### বাংলা

টিকেট কিনতে গেলে আমরা আপনার কিছু ব্যক্তিগত তথ্য সংগ্রহ করি — আপনার নাম, ফোন নম্বর, ইমেইল ঠিকানা, এবং পেমেন্ট সংক্রান্ত তথ্য। এই তথ্য আমরা ব্যবহার করি নিচের উদ্দেশ্যে:

- আপনার অর্ডার প্রক্রিয়াকরণ ও টিকেট ডেলিভারি;
- পেমেন্ট গেটওয়ের সাথে নিরাপদ লেনদেন সম্পন্ন করা;
- ইভেন্ট সম্পর্কিত আপডেট, রিমাইন্ডার, এবং রিসিট পাঠানো;
- আয়োজককে অংশগ্রহণকারীদের তালিকা সরবরাহ করা যাতে তিনি ইভেন্টে আপনাকে প্রবেশ করতে দিতে পারেন;
- প্রতারণা প্রতিরোধ ও আইনি বাধ্যবাধকতা পূরণ।

আমরা আপনার তথ্য **বিক্রি করি না** এবং তৃতীয় পক্ষের কাছে বিপণন উদ্দেশ্যে স্থানান্তর করি না। আমরা শুধু সেই তৃতীয় পক্ষগুলোর সাথে তথ্য শেয়ার করি যারা সেবা প্রদানে অপরিহার্য:

- পেমেন্ট গেটওয়ে (EPS) — আপনার পেমেন্ট প্রক্রিয়াকরণের জন্য;
- ইমেইল ডেলিভারি (Amazon SES) — টিকেট ও নোটিফিকেশন পাঠানোর জন্য;
- ক্লাউড হোস্টিং অবকাঠামো (AWS, সিঙ্গাপুর রিজিয়ন) — প্ল্যাটফর্মের সার্ভার পরিচালনা ও আপনার তথ্য সংরক্ষণের জন্য;
- সংশ্লিষ্ট আয়োজক — ইভেন্টে আপনার প্রবেশের অনুমতি দেওয়ার জন্য;
- প্রতারণা প্রতিরোধ, নিরাপত্তা, এবং আইনি/নিয়ন্ত্রক সম্মতি অংশীদার — অননুমোদিত লেনদেন ও অপব্যবহারের বিরুদ্ধে সুরক্ষা প্রদান এবং বাংলাদেশের আইনের অধীনে আমাদের আইনি বাধ্যবাধকতা পূরণের জন্য।

কী তথ্য সংগ্রহ করা হয়, কতদিন সংরক্ষিত থাকে, এবং আপনার অধিকার (অ্যাক্সেস, সংশোধন, মুছে ফেলা) সম্পর্কে বিস্তারিত আমাদের [প্রাইভেসি পলিসি](/privacy)-তে আছে।

আপনি যখন এই পেজে "Continue with bKash" বাটনে ক্লিক করেন, তখন আপনি এই তথ্য সংগ্রহ ও প্রক্রিয়াকরণে সম্মতি প্রদান করছেন। বাংলাদেশ সরকার যদি আইনি প্রক্রিয়ার মাধ্যমে আপনার তথ্য চায়, আমরা প্রযোজ্য আইন অনুযায়ী সাড়া দেব এবং, যেখানে অনুমোদিত ও উপযুক্ত, আপনাকে জানাব।

### English

When you buy a ticket, we collect some personal information — your name, phone number, email address, and payment-related details. We use this information for:

- Processing your order and delivering your ticket;
- Completing the secure transaction with the payment gateway;
- Sending event-related updates, reminders, and receipts;
- Providing the attendee list to the Organiser so they can let you into the event;
- Fraud prevention and meeting our legal obligations.

We **do not sell** your information and we do not pass it to third parties for marketing purposes. We share data only with third parties who are essential to providing the service:

- **Payment gateway (EPS)** — for processing your payment;
- **Email delivery (Amazon SES)** — for sending tickets and notifications;
- **Cloud hosting infrastructure (AWS, Singapore region)** — for running the platform's servers and storing your data;
- **The relevant Organiser** — for granting you entry to the event;
- **Fraud prevention, security, and legal/regulatory compliance partners** — for protecting against unauthorized transactions, abuse, and meeting our legal obligations under Bangladeshi law.

Full details about what we collect, how long we keep it, and your rights (access, correction, deletion) are in our [Privacy Policy](/privacy).

When you click the "Continue with bKash" button on this page, you consent to this collection and processing. If the Government of Bangladesh requests your information through a lawful process, we will respond as required by applicable law and, where permitted and appropriate, notify you.

---

## ৪. মৌলিক দায় সীমাবদ্ধতা / Basic liability carve-outs

### বাংলা

আইন যতদূর অনুমতি দেয়, Event Pulse-এর কাছে আপনার টিকেট কেনার সাথে সম্পর্কিত আমাদের সর্বাধিক দায়বদ্ধতা আপনার পরিশোধিত মোট টিকেট মূল্যের সমান। আমরা পরোক্ষ ক্ষতির (যেমন: ভ্রমণ ব্যয়, বাতিল হওয়া হোটেল রিজার্ভেশন, হারানো সময়, আবেগিক কষ্ট) জন্য দায়ী নই — কারণ আপনার ইভেন্টে অংশগ্রহণ আয়োজকের ব্যবস্থাপনার অধীনে।

**তবে নিচের ক্ষেত্রে এই সীমাবদ্ধতা প্রযোজ্য নয়** — এই ব্যতিক্রমগুলি আইনি কারণে অ-সীমাবদ্ধ (non-limitable) হিসাবে রাখা হয়েছে এবং আমাদের প্রধান Organiser Agreement-এর Clause 6.2 কাঠামো অনুসরণ করে:

- (ক) গুরুতর অবহেলা বা ইচ্ছাকৃত অসদাচরণ (gross negligence or wilful misconduct);
- (খ) প্রতারণা বা প্রতারণামূলক উপস্থাপনা (fraud or fraudulent misrepresentation);
- (গ) বিশ্বাসগত দায়িত্বের লঙ্ঘন (breach of fiduciary duty);
- (ঘ) অবহেলার ফলে মৃত্যু বা ব্যক্তিগত আঘাত (death or personal injury caused by negligence);
- (ঙ) প্রযোজ্য আইন অনুযায়ী যা সীমাবদ্ধ বা বাদ দেওয়া যায় না — এমন যেকোনো অন্য দায়বদ্ধতা (any other liability that cannot be limited or excluded by applicable law)।

ইভেন্ট সংক্রান্ত যেকোনো ক্ষতি — যেমন ইভেন্ট বাতিল, পরিবর্তন, বা গুণমান সংক্রান্ত অভিযোগের জন্য — আপনার প্রাথমিক প্রতিকার আয়োজকের কাছে, যিনি ইভেন্টের প্রধান বিক্রেতা ও দায়িত্বশীল ব্যক্তি।

পেমেন্ট সংক্রান্ত যেকোনো বিরোধ (যেমন: ভুল পরিমাণ চার্জ, ডুপ্লিকেট চার্জ) Event Pulse তদন্ত করবে এবং উপযুক্ত হলে রিফান্ড প্রক্রিয়া শুরু করবে।

### English

To the extent permitted by law, Event Pulse's maximum liability to you relating to your ticket purchase is limited to the total ticket amount you paid. We are not liable for indirect, consequential, or follow-on losses (such as travel costs, cancelled hotel bookings, lost time, emotional distress) — because your participation in the event is under the Organiser's management.

**However, the following exceptions are NOT capped** — these are non-limitable by law and follow Clause 6.2 of our master Organiser Agreement:

- (a) Gross negligence or wilful misconduct;
- (b) Fraud or fraudulent misrepresentation;
- (c) Breach of fiduciary duty;
- (d) Death or personal injury caused by negligence;
- (e) Any other liability that cannot be limited or excluded by applicable law.

For any event-related harm — like event cancellation, change, or quality complaints — your primary remedy is with the Organiser, who is the principal seller of the ticket and the responsible party for the event itself.

For payment-related disputes (e.g. wrong amount charged, duplicate charges), Event Pulse will investigate and, where appropriate, initiate a refund.

---

## Editing notes (for operator + Salehin review)

### Where this document lives in checkout (intended wiring)

When approved, this document will be presented at checkout immediately above the "Continue with bKash" button. The buyer's `Continue with bKash` click registers consent via the platform's existing `consent_records` capture path (built into the buyer-form per PR #228 Verify-guard scope; currently using the Day-34 link-footer pattern, which this document upgrades to real consent capture).

A single line above the button will read (Bengali primary):

> "Continue with bKash" বাটনে ক্লিক করে আপনি Event Pulse-এর Buyer Terms (যা এই পেজে উপরে দেখানো হয়েছে) এবং প্রাইভেসি পলিসিতে সম্মত হচ্ছেন।
>
> By clicking "Continue with bKash" you agree to Event Pulse's Buyer Terms (shown above on this page) and Privacy Policy.

### v0.1 → v0.2 — Operator preliminary decisions on flagged items (kept for record)

The four items surfaced for operator decision at v0.1 review and resolved during the v0.1 → v0.2 pass. Kept for the record so Salehin and future reviewers can see what was decided at each stage:

| #   | Item                                              | Operator decision (v0.2)                                                                                                                                                            |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §1 bulk-purchase / resale framing                 | KEEP soft ("follows Organiser's rules") — platform shouldn't assert authority over the agency relationship                                                                          |
| 2   | §3 third-party data-sharing list                  | APPLIED — reframed as recipient-categories-with-purposes; added cloud hosting infrastructure (AWS, Singapore region); Sentry confirmed NOT wired in prod and intentionally excluded |
| 3   | §4 liability cap formula                          | KEEP "total ticket amount you paid" — cleanest, transactional-relationship-appropriate; Salehin invited to propose alternative if he prefers                                        |
| 4   | Bengali calques ("প্রকাশিত এজেন্ট", "ফেসিলিটেটর") | KEEP both — operator's native-speaker view: legal calques are standard in Bangladeshi legal Bengali, "ফেসিলিটেটর" is acceptable in Bangladeshi business Bengali                     |

### v0.2 → v0.3 — Salehin-attention items: now ✅ resolved (Day 39, 2026-05-31)

All four items the operator flagged in v0.2 for Salehin's specific attention have been resolved by Salehin's written replies on 2026-05-31. Resolution captured below with citation to Salehin's reply for each item:

| #   | v0.2 flag                                                      | v0.3 resolution                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §1 minor-age formulation                                       | ✅ RESOLVED per Salehin 2026-05-31 — verbatim wording supplied: "By proceeding, you confirm that you are 18 years of age or older, or that you are purchasing the ticket with the consent and under the supervision of a legal guardian who is 18 years of age or older." Applied to EN; BN parallel produced.                                  |
| 2   | §4 "consequential damages" Bengali ("পরিণতিগত ক্ষতি")          | ✅ RESOLVED per Salehin 2026-05-31 — "পরোক্ষ ক্ষতি" applied as the preferred legal-Bengali construction (single-term replaces the three-term v0.2 rendering "পরোক্ষ, ফলাফলগত, বা পরিণতিগত ক্ষতি"). EN unchanged.                                                                                                                                |
| 3   | §3 data-sharing list granularity vs. PDPA-readiness            | ✅ RESOLVED per Salehin 2026-05-31 — fifth recipient category added ("Fraud prevention, security, and legal/regulatory compliance partners — for protecting against unauthorized transactions, abuse, and meeting our legal obligations under Bangladeshi law"). The categorical recipient-with-purpose list is the right granularity for v1.0. |
| 4   | §4 carve-out exception ordering vs. master Organiser Agreement | ✅ RESOLVED per Salehin 2026-05-31 — Clause 6.2 verbatim five-exception list applied in Salehin's exact ordering. **Selective adoption:** Clauses 6.1 (cap formula) and 6.3 (indemnification) deliberately not adopted per Salehin's written confirmation 2026-05-31. See "Documented selective-adoption note" below for full rationale.        |

### v0.3 — New items flagged for Salehin's final-check pass

Items where the operator has applied Salehin's verbatim text but the BN parallel involves interpretive rendering that Salehin should validate or substitute in his final-check pass:

(a) **§1 BN rendering of "consent and supervision under a legal guardian"** — applied as "সম্মতি ও তত্ত্বাবধানে" within the bullet "এগিয়ে যাওয়ার মাধ্যমে, আপনি নিশ্চিত করছেন যে আপনি ১৮ বছর বা তার বেশি বয়সী, অথবা আপনি ১৮ বছর বা তার বেশি বয়সী একজন আইনি অভিভাবকের সম্মতি ও তত্ত্বাবধানে টিকেটটি কিনছেন।" The BN construction is the operator's interpretive choice — "সম্মতি" for consent and "তত্ত্বাবধান" for supervision are formal/legal-Bengali constructions appropriate to the document register. Please confirm or substitute if you have a preferred legal-Bengali phrasing for the consent-and-supervision concept under Bangladeshi contract law's treatment of minors.

(b) **§4 (b) BN rendering of "fraudulent misrepresentation"** — applied as "প্রতারণা বা প্রতারণামূলক উপস্থাপনা" in the carve-out exception list. "প্রতারণামূলক উপস্থাপনা" is the operator's natural-Bengali rendering of "fraudulent misrepresentation"; if you have a preferred legal-Bengali term-of-art for this concept (a phrase used in similar Bangladeshi contract drafting), please substitute.

### Documented selective-adoption note (from Salehin's Clause 6 master text)

Selective adoption from Salehin's Clause 6 master text from Organiser Agreement v1.3, as confirmed by Salehin in writing on 2026-05-31:

- **Clause 6.2 exception list — ✅ ADOPTED VERBATIM** in §4 carve-out list. Salehin's exact ordering and wording preserved: (a) Gross negligence or wilful misconduct, (b) Fraud or fraudulent misrepresentation, (c) Breach of fiduciary duty, (d) Death or personal injury caused by negligence, (e) Any other liability that cannot be limited or excluded by applicable law.
- **Clause 6.1 (cap formula: "total fees received from the Organiser during 12 months preceding") — ❌ DELIBERATELY NOT ADOPTED.** Salehin confirmed in writing 2026-05-31 that the Organiser Agreement's 12-month-fees cap is B2B-appropriate; applying the same formula to buyers would be mismatched and could create enforceability issues in a consumer context. Different caps for B2B and B2C relationships are standard and acceptable. The v0.3 Buyer-side cap stays as the v0.2 formula: "total ticket amount you paid".
- **Clause 6.3 (Organiser-indemnifies-Platform) — ❌ DELIBERATELY NOT ADOPTED.** Salehin confirmed in writing 2026-05-31 that introducing a buyer-indemnifies-Platform clause analogous to 6.3 would carry Consumer Rights Protection Act 2009 risk — such clauses can be viewed as unfair contract terms when the buyer is in a weaker bargaining position. The lightweight platform-level document at soft-launch stage stays clean and buyer-friendly. No indemnification clause introduced into the Buyer document.

### Out-of-v1.0 scope — narrow buyer indemnity (per Salehin 2026-05-31)

A narrow buyer indemnity limited to fraud or wilful abuse may be revisited post-launch with transaction data per Salehin 2026-05-31. **Explicitly deferred from v1.0 scope.** When this is revisited:

- Surface real customer-pattern data from launch + first 30 days (fraud incident rate, account-abuse pattern frequency, dispute classification)
- Salehin to draft the narrow indemnity clause based on observed patterns
- Apply as a new edit in a future Buyer-Terms revision (v1.x or the full Buyer Terms expansion per Salehin's "expand into full dedicated Buyer Terms shortly after you have initial transaction data and user feedback")

This deferral is intentional and aligned with the lite-document philosophy: capture the load-bearing legal anchors at v1.0, expand on real customer-pain-point data later.

### Bengali quality (general gate)

The Bengali drafting is Claude's modern Bangladeshi Bengali at the formal-but-accessible register. A native human review for natural flow, idiomatic accuracy, and any awkward word-choice is part of the gate before final ship. The operator's review has confirmed acceptance of the calque pattern ("প্রকাশিত এজেন্ট (disclosed agent)" on first use) + "ফেসিলিটেটর" as borrowed-but-acceptable. Salehin's review may surface additional native-speaker refinements.

### Boundary of this draft

This is the lightweight, launch-window version per Salehin's "we can keep this version concise for the June 10 soft launch and expand it into full dedicated Buyer Terms shortly after you have initial transaction data and user feedback." Full Buyer Terms (refund mechanics detail / chargeback procedure / arbitration / IP / force majeure / termination / indemnification) is post-launch scope, sequenced after real customer data informs the expansion.

### Sign-off chain

1. ✅ **Operator review v0.1 → v0.2 — COMPLETED 2026-05-31 Day 39.** Three direct edits applied (§3 data-list reframe + AWS Singapore added + Sentry excluded; §3 law-enforcement clause softened to "where permitted and appropriate"; editing notes restructured with operator-resolved status + 4 items flagged for Salehin's specific attention). Operator-approved v0.2 for sending to Salehin.
2. ✅ **Salehin review of v0.2 — ROUND 1 COMPLETE 2026-05-31.** Salehin delivered substantive written review on 2026-05-31; all four v0.2-flagged Salehin-attention items addressed (§1 verbatim minor-age wording supplied; §4 BN "পরোক্ষ ক্ষতি" recommended; §3 fraud-prevention category recommended; §4 carve-out exceptions sent via verbatim Clause 6 of Organiser Agreement v1.3 master text).
   2.5. ✅ **Operator selective-adoption clarification — COMPLETE 2026-05-31.** Operator clarified selective-adoption boundary with Salehin (Clause 6.2 only, not 6.1 or 6.3); Salehin confirmed all three decisions in writing 2026-05-31 — (a) Buyer-side cap stays "total ticket amount paid" because different caps for B2B and B2C are standard and the 12-month-fees cap would be mismatched in a consumer context; (b) no buyer indemnification appropriate at v1.0 because it would carry Consumer Rights Protection Act 2009 risk; (c) narrow buyer indemnity limited to fraud or wilful abuse may be revisited post-launch with transaction data.
3. ✅ **Salehin final-check pass on v0.3 — COMPLETED 2026-05-31.** Salehin reviewed v0.3 (with the four edits applied and the two BN-rendering items (a)+(b) flagged for his attention) and returned "all good to go" in writing on 2026-05-31. No further edits requested. The two BN renderings ("সম্মতি ও তত্ত্বাবধানে" for "consent and supervision" + "প্রতারণা বা প্রতারণামূলক উপস্থাপনা" for "fraud or fraudulent misrepresentation") confirmed acceptable as drafted.
4. ✅ **Operator final sign-off — COMPLETED 2026-05-31.** With Salehin's "all good to go" in hand, operator cleared the v0.3 → v1.0 promotion. Document promoted from `DRAFT v0.3` (operator-approved-for-Salehin) to `APPROVED v1.0` (ships in checkout) with no body changes between v0.3 and v1.0 — the v1.0 body is the same body Salehin signed off on, just with the status pivot and sign-off chain update.
5. ⏳ **Wire into checkout — IN FLIGHT.** PR `feat/buyer-terms-v1-consent-wire-in` (Day 39 Phase 2): adds the `consent_records` table (migration 0015), seeds Buyer Terms v1.0 into `legal_documents` + `legal_document_versions`, captures consent inside the existing `withSuperAdmin` order-creation transaction (consent INSERT failure rolls back the whole tx → no order → no EPS Initialize call), and replaces the Day-34 link-footer with a bilingual clickwrap line above the "Continue with bKash" button.

**Steps 1–4 all ✅ as of 2026-05-31.** Step 5 ships as this PR; once merged + deployed, the buyer-terms surface is live in checkout.
