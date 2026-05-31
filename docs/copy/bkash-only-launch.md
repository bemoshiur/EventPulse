# v1.0 single-method launch — bKash-only honest copy plan

> **Status:** living document. Created Day 38 Phase 3 (2026-05-31). Canonical copy strings (EN + BN) for every surface that touches the launch's single-method shape. Pulled when each surface lands; updated when card / Nagad / Rocket / Upay join the catalogue per `decisions.md` 2026-05-31 Option 3 entry's implication (d) post-launch roadmap.
>
> **Why this document exists:** Day 38 Phase 3 honest-UI-copy work could not ship all surfaces in one PR because several don't exist yet (`/features`, `/pricing`, Day 28+ buyer-return frontend pages, the tenant pre-Organiser-Agreement bKash-only disclosure). Rather than waiting until each surface lands to author its copy from scratch, the canonical strings live here so future PRs can land with consistent framing.

## Canonical decision pointers

- `.claude/memory/decisions.md` 2026-05-31 "EPS fee-model structural decision — Option 3 (single-method launch, bKash-only for v1.0) CHOSEN" — the operator product principle ("buyers see the exact fee at checkout, no estimate") drives the copy framing.
- `.claude/memory/decisions.md` 2026-05-31 mechanism (d) Verify-guard — server-side enforcement is what makes the framing honest; copy and enforcement must stay aligned.
- PR #228 (Phase 2a) — implements the Verify-guard; dispute path lands at `/orders/return/wrong-method`.

## Shipped this PR (Phase 3)

### `buyer-form.tsx` — paid-tier checkout

**Subtotal-preview notice** (rendered when `!isFreeEvent && hasAnyTier`):

| Lang | String                                                                           |
| ---- | -------------------------------------------------------------------------------- |
| EN   | `Currently accepting bKash payments only. More methods coming soon.`             |
| BN   | `বর্তমানে শুধুমাত্র bKash পেমেন্ট গ্রহণ করা হচ্ছে। অন্যান্য পদ্ধতি শীঘ্রই আসছে।` |

**Submit-button label** (paid tier):

| Lang | String                    |
| ---- | ------------------------- |
| EN   | `Continue with bKash`     |
| BN   | `bKash দিয়ে চালিয়ে যান` |

**Submit-button label** (free tier — unchanged):

| Lang | String                 |
| ---- | ---------------------- |
| EN   | `Confirm registration` |
| BN   | `নিশ্চিত করুন`         |

## Deferred to follow-up PRs (surfaces don't yet exist)

### `/features` marketing page (when built)

**Hero or feature-row callout:**

| Lang | String                                                                     |
| ---- | -------------------------------------------------------------------------- |
| EN   | `bKash-first payments. Card and other methods rolling out post-launch.`    |
| BN   | `bKash-অগ্রাধিকার পেমেন্ট। লঞ্চ-পরবর্তী কার্ড ও অন্যান্য পদ্ধতি চালু হবে।` |

### `/pricing` marketing page (when built)

**Below the fee-mode calculator:**

| Lang | String                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EN   | `Calculator shown above uses the v1.0 launch bKash rate (1.75% on capture). Card / Nagad / Rocket / Upay rates publish when those methods join post-launch.` |
| BN   | `উপরের ক্যালকুলেটরটি v1.0 লঞ্চের bKash রেট (১.৭৫%) ব্যবহার করছে। কার্ড / নগদ / রকেট / উপয় রেট লঞ্চ-পরবর্তী যখন সেই পদ্ধতিগুলো যোগ হবে তখন প্রকাশিত হবে।`    |

### Day 28+ buyer-return frontend pages

- `apps/web/src/app/(public)/orders/return/wrong-method/page.tsx` (NEW — Phase 2a backend already routes here; frontend doesn't exist yet)

**Page heading:**

| Lang | String                                               |
| ---- | ---------------------------------------------------- |
| EN   | `We couldn't honor this payment — refund coming`     |
| BN   | `আমরা এই পেমেন্টটি গ্রহণ করতে পারিনি — রিফান্ড আসছে` |

**Body copy:**

| Lang | String                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EN   | `This event accepts bKash payments only at launch. Your payment was made via another method, so we cannot honor the ticket. Your money is safe — our team will refund the full amount via the EPS merchant dashboard within 5 business days. You'll receive a confirmation email once the refund is processed. To purchase a ticket, please return to the event page and use bKash. We're sorry for the inconvenience.`    |
| BN   | `এই ইভেন্টটি লঞ্চে শুধুমাত্র bKash পেমেন্ট গ্রহণ করছে। আপনার পেমেন্ট অন্য পদ্ধতির মাধ্যমে করা হয়েছিল, তাই আমরা টিকিটটি দিতে পারছি না। আপনার টাকা সুরক্ষিত — আমাদের টিম ৫ কার্যদিবসের মধ্যে EPS মার্চেন্ট ড্যাশবোর্ডের মাধ্যমে সম্পূর্ণ পরিমাণ ফেরত দেবে। রিফান্ড প্রক্রিয়াজাত হয়ে গেলে আপনি একটি নিশ্চিতকরণ ইমেইল পাবেন। টিকিট কিনতে, দয়া করে ইভেন্ট পেজে ফিরে যান এবং bKash ব্যবহার করুন। অসুবিধার জন্য আমরা দুঃখিত।` |

**CTA button (back to event):**

| Lang | String                 |
| ---- | ---------------------- |
| EN   | `Return to event page` |
| BN   | `ইভেন্ট পেজে ফিরে যান` |

### Tenant pre-Organiser-Agreement bKash-only disclosure (when that surface lands)

This must surface BEFORE the organiser commits to publishing a paid event. Likely landing in the event-publication flow (the "Add paid tier" gate) or in the KYC wizard's completion screen.

**Heading:**

| Lang | String                                          |
| ---- | ----------------------------------------------- |
| EN   | `Your attendees will pay via bKash at launch`   |
| BN   | `লঞ্চে আপনার দর্শকরা bKash দিয়ে পেমেন্ট করবেন` |

**Body copy:**

| Lang | String                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EN   | `Event Pulse v1.0 accepts bKash payments only. Card support is the immediate next addition (week 1 post-launch). If your event's audience is card-heavy (corporate, diaspora-targeted, premium tickets), you may want to wait until card support ships. Free events have no payment-method constraint.`                        |
| BN   | `Event Pulse v1.0 শুধুমাত্র bKash পেমেন্ট গ্রহণ করে। লঞ্চ-পরবর্তী প্রথম সপ্তাহে কার্ড সাপোর্ট যোগ হবে। যদি আপনার ইভেন্টের দর্শকরা প্রধানত কার্ড ব্যবহারকারী হন (কর্পোরেট, প্রবাসী-লক্ষ্যযুক্ত, প্রিমিয়াম টিকিট), আপনি কার্ড সাপোর্ট আসা পর্যন্ত অপেক্ষা করতে পারেন। বিনামূল্যের ইভেন্টগুলিতে পেমেন্ট-পদ্ধতির সীমাবদ্ধতা নেই।` |

**Acknowledgement checkbox label:**

| Lang | String                                                                       |
| ---- | ---------------------------------------------------------------------------- |
| EN   | `I understand my event will accept bKash payments only at v1.0 launch.`      |
| BN   | `আমি বুঝেছি যে আমার ইভেন্টটি v1.0 লঞ্চে শুধুমাত্র bKash পেমেন্ট গ্রহণ করবে।` |

### Email templates — review status

| Template                  | Status               | Note                                                                                                                    |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `order-confirmed.ts`      | **NO change needed** | Existing copy does not imply multi-method support; mentions `awaiting_payment → paid` transition in a code comment only |
| `attendee-ticket.ts`      | **NO change needed** | Per-attendee QR ticket; no payment-method language at all                                                               |
| `magic-link.ts`           | NO change needed     | Auth flow; no payment language                                                                                          |
| `kyc-*.ts`                | NO change needed     | KYC submission status; no payment-method language                                                                       |
| `oauth-account-linked.ts` | NO change needed     | Auth flow; no payment language                                                                                          |

If a NEW email template lands (e.g. `order-disputed-wrong-method.ts` from Phase 2b), the strings below apply.

**`order-disputed-wrong-method` template (Phase 2b — TODO):**

Subject:

| Lang | String                                             |
| ---- | -------------------------------------------------- |
| EN   | `About your recent payment — refund coming`        |
| BN   | `আপনার সাম্প্রতিক পেমেন্ট সম্পর্কে — রিফান্ড আসছে` |

Body (excerpt; full template lands in Phase 2b):

| Lang | String                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EN   | `Hi {buyerName}, you recently attempted to register for {eventTitle} via Event Pulse. The event accepts bKash payments only at launch; your payment was made via another method, so we couldn't honor the ticket. Your full payment (৳ {amount}) will be refunded via the EPS merchant dashboard within 5 business days. To register, please return to the event page and use bKash. We're sorry for the inconvenience.`                           |
| BN   | `নমস্কার {buyerName}, আপনি সম্প্রতি Event Pulse-এর মাধ্যমে {eventTitle}-এর জন্য নিবন্ধন করার চেষ্টা করেছিলেন। ইভেন্টটি লঞ্চে শুধুমাত্র bKash পেমেন্ট গ্রহণ করে; আপনার পেমেন্ট অন্য পদ্ধতিতে করা হয়েছিল, তাই আমরা টিকিটটি দিতে পারিনি। আপনার সম্পূর্ণ পেমেন্ট (৳ {amount}) ৫ কার্যদিবসের মধ্যে EPS মার্চেন্ট ড্যাশবোর্ডের মাধ্যমে ফেরত দেওয়া হবে। নিবন্ধন করতে, দয়া করে ইভেন্ট পেজে ফিরে যান এবং bKash ব্যবহার করুন। অসুবিধার জন্য আমরা দুঃখিত।` |

## Counsel-owned surfaces — DO NOT EDIT

The following surfaces are owned by counsel (Salehin); v1.0 single-method launch copy MUST NOT be added by engineering unilaterally. Surveyed Day 38 Phase 3 — **none currently imply multi-method support, so no follow-up flag is needed for v1.0 launch.** If any future counsel revision adds payment-method language, the v1.0 single-method constraint must be honored in that revision:

- `apps/web/src/app/(public)/terms/page.tsx`
- `apps/web/src/app/(public)/refund-policy/page.tsx`
- `apps/web/src/app/(public)/dpa/page.tsx`
- `apps/web/src/app/(public)/eula/page.tsx`
- `apps/web/src/app/(public)/cookies/page.tsx`
- `apps/web/src/app/(public)/privacy/page.tsx`
- Organiser Agreement (whatever surface that ends up living on)

## Post-launch evolution

When card / Nagad / Rocket / Upay / bank-transfer join the catalogue (per `decisions.md` 2026-05-31 Option 3 entry's implication (d) post-launch roadmap):

1. **First-paying-card-tenant smoke** confirms the card rate (analogous to the v1.0 bKash smoke per `docs/runbooks/production-smoke.md` — TBD).
2. **Calculator catalogue lands** (either Option 1 per-method rate catalogue, or Option 4 StoreAmount-as-source-of-truth — re-deciding when there's data for multiple methods).
3. **This document is updated:** the bKash-only notice copy in `buyer-form.tsx` swaps to a multi-method "Pay with bKash, card, or other supported methods" notice; the submit button label generalises back to "Continue to payment"; the `/orders/return/wrong-method` page route is deprecated; the Verify-guard predicate updates to accept the multi-method allowlist.
4. **Post-launch roadmap card-method addition target:** week 1 post-launch (per Option 3 entry).

## Bilingual discipline note

Per CLAUDE.md R12: code, comments, commit messages, internal docs in English. Public event pages **bilingual** (Bangla + English content fields). The strings above follow this discipline — every public-facing string has both EN and BN variants; internal-only strings (test names, log lines, code comments) are English-only.

The BN translations above are working drafts; if the operator wants a translator review before any surface ships, that's a sensible pre-launch gate. None of the v1.0 strings shipped in this PR (the buyer-form ones) have unusual phrasing that would require translator review — they mirror existing bilingual patterns in `buyer-form.tsx` itself.
