/**
 * Buyer-Terms-Lite v1.0 canonical body — the markdown that ships into
 * `legal_document_versions.body_md` at seed time.
 *
 * Source of truth: docs/legal/buyer-terms.md (the human-readable audit
 * source, includes frontmatter + sign-off chain + editing notes). This
 * file extracts ONLY the public body — the four buyer-facing sections —
 * with no authoring metadata, ready for renderLegalMarkdown() to produce
 * the cached body_html column.
 *
 * Salehin's "all good to go" sign-off (2026-05-31) applies to THIS body
 * content. Any change here must trigger a version bump (v1.1, v2.0, ...)
 * and a fresh counsel review.
 *
 * The seed (see seed-buyer-terms-v1.ts) is idempotent: re-running
 * against an existing v1.0 row is a no-op. A change to BUYER_TERMS_V1
 * without a version bump in seed-buyer-terms-v1.ts would NOT propagate
 * to the DB — by design, since silent v1.0 body drift is a legal-risk
 * pattern we won't enable.
 */

export const BUYER_TERMS_DOC_VERSION = 'v1.0' as const
export const BUYER_TERMS_DOC_SLUG = 'buyer-terms' as const
export const BUYER_TERMS_DOC_TITLE = 'Buyer Terms (Lite) — Event Pulse Checkout' as const
export const BUYER_TERMS_DOC_ONE_LINER =
  'Plain-language buyer terms for checkout: platform usage, Event Pulse’s limited role, data processing consent, and basic liability carve-outs.' as const
export const BUYER_TERMS_DOC_CANONICAL_URL_PATH = '/buyer-terms' as const

/**
 * The bilingual body, four sections per Salehin's framing. BN-primary
 * per CLAUDE.md R12; EN parallel for symmetry.
 */
export const BUYER_TERMS_V1_BODY_MD = `## ১. প্ল্যাটফর্ম ব্যবহার / Platform usage

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
`
