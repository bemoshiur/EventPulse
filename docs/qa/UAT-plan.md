# Event Pulse — User Acceptance Testing (UAT) Plan

**Version:** 1.0 · 2026-06-06 · Prod build v0.4.31
**Owner:** Moshiur Rahman (Public Pulse Agency)
**Purpose:** A step-by-step plan a non-technical tester can follow to validate that Event Pulse works end-to-end before declaring it production-ready for real organisers and buyers.

---

## 1. How to run UAT

### 1.1 Environments

| Env            | URLs                                                                                                                   | Use for                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Production** | `eventpulse.com.bd` (marketing + public), `app.eventpulse.com.bd` (organiser), `admin.eventpulse.com.bd` (super admin) | The real system. **Payments are LIVE** — paid-ticket tests charge real money (use a tiny amount, e.g. ৳10–100, and refund after). |

> ⚠️ **Money is real.** Any paid-ticket test is a real EPS charge. Keep test tickets cheap, and either refund or note them. Free events cost nothing — do most testing with free events first.

### 1.2 Test accounts to prepare (before you start)

| Account         | How to create                                                                   | Role                                           |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Organiser A** | Sign up on `/sign-up` with a real email you can open                            | Tenant owner (the seller)                      |
| **Organiser B** | Sign up with a _different_ email                                                | Used only for the multi-tenant isolation tests |
| **Buyer**       | A different real email (can be the same person)                                 | Ticket purchaser                               |
| **Super Admin** | Ask the dev to grant your email a `super_admins` row, then use `/admin-sign-in` | Platform operator                              |

You need **at least 2 email inboxes** (organiser + buyer) you can open during testing, because confirmation, ticket, and reset emails must be received and clicked.

### 1.3 Defect logging

For every failure, record: **Test ID · what you did · what you expected · what actually happened · screenshot · device/browser**. Use the severity scale in §6.

### 1.4 Entry / exit criteria

- **Entry:** prod is on the latest build, you have the accounts above, and you've read §5 (known limitations) so you don't log expected gaps as bugs.
- **Exit (sign-off):** every **P0/P1** scenario passes; no open **Critical/High** defects; §7 sign-off signed.

---

## 2. Scope

**In scope:** marketing/public site, organiser onboarding (password + email verification), event creation & publishing, free + paid ticketing, EPS checkout, ticket delivery (email + PDF + QR), the post-payment receipt page, event discovery, attendee check-in, KYC, payout-account setup, refunds, super-admin KYC review + revenue, and cross-cutting concerns (multi-tenant isolation, money correctness, mobile, bilingual content, error handling, security).

**Out of scope (see §5):** the `my.eventpulse.com.bd` attendee portal, bilingual `/bn` routing, automated KYC verification, automated T+5 disbursement, MFA.

---

## 3. Test scenarios

Priority: **P0** = must pass to launch · **P1** = important · **P2** = nice-to-have.
Mark each **Pass / Fail / Blocked**.

### 3.A Organiser onboarding (password + email verification)

| ID     | P   | Steps                                                                                                       | Expected result                                                                                 |
| ------ | --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ONB-01 | P0  | Go to `/sign-up`. Enter name, email, password (8+ chars). Submit.                                           | "Check your email" screen. **No** auto-login.                                                   |
| ONB-02 | P0  | Open the inbox. Find "Confirm your email · Event Pulse". Click the button.                                  | Lands on `/verify-email`, shows "Email confirmed", then redirects to the dashboard (logged in). |
| ONB-03 | P0  | Try to sign in on `/sign-in` with the password **before** clicking the email link (use a 2nd fresh signup). | Blocked with "Please confirm your email…" + a **Resend confirmation** option.                   |
| ONB-04 | P1  | On `/sign-in`, click "Resend confirmation" for an unverified account.                                       | A new confirmation email arrives; clicking it verifies + logs in.                               |
| ONB-05 | P0  | After verifying, sign out, then sign in on `/sign-in` with email + password.                                | Logged in, lands on dashboard.                                                                  |
| ONB-06 | P0  | `/forgot-password` → enter your email → open the "Reset your password" email → set a new password.          | Logged in after reset. **Old** password no longer works; **new** one does.                      |
| ONB-07 | P1  | Sign up again with an email that **already** has an account.                                                | Friendly "already exists — sign in" message (no crash, no duplicate).                           |
| ONB-08 | P1  | Click an **expired or already-used** confirmation/reset link.                                               | "This link is invalid or expired" + a path back to sign-in / request a new one.                 |
| ONB-09 | P2  | `/forgot-password` with an email that has **no** account.                                                   | Same "check your email" screen (no hint that the account doesn't exist — anti-enumeration).     |

### 3.B Account type + organiser context

| ID     | P   | Steps                                  | Expected result                                                                        |
| ------ | --- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| ACC-01 | P0  | First dashboard load after onboarding. | Account-Type modal asks Organisation vs Individual; can't dismiss without choosing.    |
| ACC-02 | P1  | Choose a type, reload.                 | Type persists; modal doesn't reappear. Changing it later requires support (by design). |

### 3.C Event creation, editing & publishing

| ID     | P   | Steps                                                                                                     | Expected result                                                                   |
| ------ | --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| EVT-01 | P0  | `/events/new` → fill title, type/category, date/time, venue (name + division + district + address). Save. | Event created as **Draft**; lands on the event page.                              |
| EVT-02 | P0  | Add a **free** ticket tier (price 0) with a capacity.                                                     | Tier saved; shows ৳0 / Free.                                                      |
| EVT-03 | P0  | Add a **paid** ticket tier (e.g. ৳50) with capacity + sales window.                                       | Tier saved with the price.                                                        |
| EVT-04 | P0  | Publish the event.                                                                                        | Status → Published; a public URL is shown (`eventpulse.com.bd/{handle}/{event}`). |
| EVT-05 | P1  | Upload a **cover image** (PNG/JPG/WebP).                                                                  | Image uploads + shows on the event + as the OG image. (SVG should be rejected.)   |
| EVT-06 | P1  | Edit the event: change title, then change the **event slug**; visit the **old** URL.                      | Old URL 301-redirects to the new one.                                             |
| EVT-07 | P1  | Rename your **handle** in Settings; visit an old `/{old-handle}/{event}` URL.                             | Redirects to the new handle (30-day window).                                      |
| EVT-08 | P1  | Set brand colour + logo in Settings.                                                                      | Reflected on the public event page + ticket PDF header.                           |
| EVT-09 | P2  | Try to publish an event with **no** ticket tiers.                                                         | Sensible block/message (can't sell nothing).                                      |

### 3.D Discovery (BookMyShow-style)

| ID     | P   | Steps                                                                        | Expected result                                                                                  |
| ------ | --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| DSC-01 | P0  | Open `/discover` (also linked in the top nav).                               | Your published, **future**, public event appears as a card (banner/title/date/venue/from-price). |
| DSC-02 | P0  | Click a category chip (e.g. Concerts).                                       | Grid filters to that category only.                                                              |
| DSC-03 | P1  | Pick an **area** from the dropdown (your event's district).                  | Grid filters to that area.                                                                       |
| DSC-04 | P1  | Type the event title / venue in search.                                      | Matching events show (debounced).                                                                |
| DSC-05 | P1  | Confirm a **draft / private / past** event does **NOT** appear in discovery. | Only public + published + not-ended events are listed.                                           |
| DSC-06 | P2  | Click an event card.                                                         | Opens the public event page.                                                                     |

### 3.E Public event page + FREE ticket purchase

| ID     | P   | Steps                                                                              | Expected result                                                                                           |
| ------ | --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| FRE-01 | P0  | As a **buyer** (signed out), open the public event URL.                            | Page renders: banner, title, date, venue, description, ticket tiers, buyer form. Bilingual content shows. |
| FRE-02 | P0  | Select a **free** ticket, fill buyer name/email/phone, accept Buyer Terms, submit. | Immediate success — no payment step. Lands on the success/receipt page.                                   |
| FRE-03 | P0  | Check the buyer's inbox.                                                           | Ticket email arrives with a **QR** + PDF attachment.                                                      |
| FRE-04 | P1  | On the success page, click **Download tickets (PDF)**.                             | A PDF with the QR downloads.                                                                              |
| FRE-05 | P1  | Open the Buyer Terms link from the checkout.                                       | `/buyer-terms` renders (no 404).                                                                          |

### 3.F PAID ticket purchase (LIVE EPS — real money)

| ID     | P   | Steps                                                                  | Expected result                                                                                       |
| ------ | --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PAY-01 | P0  | Buy a **cheap paid** ticket. Fill buyer info, accept terms, "Pay now". | Redirects to EPS hosted checkout showing **multiple methods** (card, bKash, Nagad, Rocket…).          |
| PAY-02 | P0  | Complete payment with a real method.                                   | Returns to `/orders/return/success`, shows a **receipt** (subtotal/fees/total) + ticket confirmation. |
| PAY-03 | P0  | Check the buyer inbox.                                                 | Paid ticket email + QR + PDF arrive.                                                                  |
| PAY-04 | P0  | On the success page, **Download tickets (PDF)**.                       | PDF downloads (`200 application/pdf`).                                                                |
| PAY-05 | P1  | Start a payment then **cancel** on EPS.                                | Returns to a cancel/fail page; **no** ticket issued; no charge (or auto-refund).                      |
| PAY-06 | P1  | Refresh the success page / re-open the order URL.                      | Status is consistent (paid stays paid); no double-charge, no duplicate tickets.                       |
| PAY-07 | P2  | Inspect the organiser dashboard after a sale.                          | Sale + revenue reflect the order with correct fee math (0.25% platform fee).                          |

### 3.G Attendee check-in

| ID     | P   | Steps                                                                    | Expected result                                          |
| ------ | --- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| CHK-01 | P0  | As organiser, open `/events/{id}/checkin`. Scan/enter a valid ticket QR. | Marked checked-in; shows attendee name; success state.   |
| CHK-02 | P0  | Scan the **same** QR again.                                              | "Already checked in" — not a second check-in.            |
| CHK-03 | P1  | Enter an invalid / foreign QR.                                           | Rejected cleanly (not found / wrong event).              |
| CHK-04 | P1  | View attendees list `/events/{id}/attendees`; export CSV.                | List shows buyers; CSV downloads with the right columns. |

### 3.H KYC + payouts (KYC-at-disbursement)

| ID     | P   | Steps                                                                                            | Expected result                                                                           |
| ------ | --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| KYC-01 | P0  | As an **unverified** organiser, open `/payouts`.                                                 | "Verify your identity to receive payouts" CTA → links to `/kyc`. **No** account form yet. |
| KYC-02 | P0  | Try `POST` a payout account before approval (via the form once KYC'd, or confirm the gate).      | Blocked until KYC approved (403 KYC_NOT_APPROVED).                                        |
| KYC-03 | P0  | Complete the KYC wizard (`/kyc`) and submit.                                                     | Submission saved; `/payouts` now shows "under review".                                    |
| KYC-04 | P0  | As **super admin**, open `/admin/kyc`, find the submission, review the fields/docs, **approve**. | Tenant `kyc_status` → approved; approval email sent to the organiser.                     |
| KYC-05 | P0  | Back as organiser, `/payouts` now shows the **Add account** form. Add a bank/MFS account.        | Account saved; number shows **masked** (last-4); first account is Primary.                |
| KYC-06 | P1  | As super admin, **reject** a different submission with a typed reason.                           | Tenant `kyc_status` → rejected; rejection email with the reason; organiser can resubmit.  |
| KYC-07 | P1  | Confirm an organiser can still **publish free + paid events and sell** without KYC.              | Selling works; only **payout setup** is gated.                                            |

### 3.I Refunds

| ID     | P   | Steps                                           | Expected result                                                                         |
| ------ | --- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| REF-01 | P1  | As organiser, request a refund on a paid order. | Refund request created (status pending).                                                |
| REF-02 | P1  | As super admin, approve the refund.             | Refund recorded; buyer notified; (actual money movement is via EPS dashboard — see §5). |

### 3.J Super-admin surfaces

| ID     | P   | Steps                                                   | Expected result                                                                      |
| ------ | --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ADM-01 | P0  | `/admin-sign-in` with a super-admin account (password). | Logged into admin portal. A **non**-super-admin must NOT get in (403).               |
| ADM-02 | P1  | `/admin/revenue`.                                       | GMV / revenue / take-rate KPIs render (zeros if no sales).                           |
| ADM-03 | P1  | `/admin/kyc` queue.                                     | Pending submissions listed, ordered, openable.                                       |
| ADM-04 | P2  | `/admin/tenants/{id}/fees`.                             | Can view + adjust a tenant's fee with a reason; change is audited + not retroactive. |
| ADM-05 | P2  | `/admin/legal-trust`.                                   | Legal/trust docs are editable + versioned.                                           |

### 3.K Cross-cutting (security, money, isolation, UX)

| ID     | P   | Steps                                                                                                                                                    | Expected result                                                              |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| SEC-01 | P0  | While signed in as **Organiser A**, try to open **Organiser B's** event/attendee/payout data (guess a URL / API id).                                     | Denied / not-found — **never** see another tenant's data (RLS).              |
| SEC-02 | P0  | Hit any protected API without a session (e.g. open `api.eventpulse.com.bd/api/v1/tenant/me`).                                                            | `401` (not 200, not 500).                                                    |
| SEC-03 | P0  | Sign out, then open `app.eventpulse.com.bd/dashboard`.                                                                                                   | Redirected to sign-in (not left on a usable dashboard).                      |
| MON-01 | P0  | For a known ticket price, verify the buyer total = ticket + the displayed fees, and the receipt math is internally consistent (subtotal + fees = total). | Numbers add up; amounts in BDT with 2 decimals; never negative/odd rounding. |
| UX-01  | P1  | Run the core journeys on a **phone** (375px) + tablet.                                                                                                   | Layouts are responsive; nothing overflows/overlaps; buttons tappable.        |
| UX-02  | P1  | Trigger error states (wrong password, network off mid-action, invalid form).                                                                             | Clear messages, no white screen, no raw error/stack.                         |
| UX-03  | P2  | Keyboard-only + check focus rings on forms; check colour contrast.                                                                                       | Reachable + visible focus; AA contrast.                                      |
| UX-04  | P1  | Spot-check bilingual content on public pages (EN + বাংলা both present + legible).                                                                        | Bangla renders correctly (Hind Siliguri), no tofu/boxes.                     |
| LNK-01 | P1  | Click every nav + footer link (and a sample of trust/legal pages).                                                                                       | All resolve (no 404). (Automated sweep already passed 30 routes.)            |

---

## 4. Suggested execution order

1. **ONB** (onboarding) → you need a verified organiser for everything else.
2. **ACC + EVT** (account type + create/publish a **free** event).
3. **DSC** (see it in discovery).
4. **FRE** (buy a free ticket as a buyer → confirm email + PDF).
5. **EVT** paid tier + **PAY** (one cheap real purchase, end-to-end).
6. **CHK** (check the buyer in).
7. **KYC + payouts** (verify → add payout account).
8. **ADM** (super-admin review surfaces).
9. **REF** (refund).
10. **SEC / MON / UX** (cross-cutting) throughout.

---

## 5. Known limitations — do NOT log these as bugs

These are deliberate scope decisions for this build:

1. **No attendee portal** — `my.eventpulse.com.bd/tickets` 404s. Buyers receive tickets by **email**; there's no "log in to see my tickets" page yet (Phase 2).
2. **No `/bn` language toggle** — pages show EN + বাংলা **inline**; there are no separate `/bn` URLs or a language switcher yet.
3. **KYC is reviewed 100% manually** — no automated NID/eTIN/sanctions checks; a super admin reads every submission.
4. **Disbursement is manual** — the platform records "what's owed"; the actual T+5 payout is run by an operator via EPS/bank, not automated yet.
5. **Refund execution is via the EPS dashboard** — the app records the refund decision; the money is moved by an operator.
6. **No MFA / 2FA** on accounts yet (the column exists, not wired).
7. **Discovery shows nothing until you publish** a public, future-dated event — that's correct behaviour, not a bug.

---

## 6. Defect severity

| Severity          | Meaning                                                                           | Example                                                     |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Critical (P0)** | Money wrong, data leak across tenants, auth bypass, can't complete a core journey | Buyer charged but no ticket; Tenant A sees Tenant B's sales |
| **High (P1)**     | Core journey works but a key step is broken/confusing                             | Confirmation email never arrives; PDF won't download        |
| **Medium (P2)**   | Noticeable issue with a workaround                                                | A filter mislabels; minor layout break on mobile            |
| **Low**           | Cosmetic / copy                                                                   | Typo; spacing                                               |

---

## 7. Sign-off

| Item                                | Criteria         | Status |
| ----------------------------------- | ---------------- | ------ |
| All **P0** scenarios                | Pass             | ☐      |
| All **P1** scenarios                | Pass or accepted | ☐      |
| Open Critical/High defects          | None             | ☐      |
| Real paid-payment smoke (PAY-01→04) | Pass             | ☐      |
| Multi-tenant isolation (SEC-01)     | Pass             | ☐      |

**UAT lead:** ********\_\_\_\_******** **Date:** ****\_\_****
**Decision:** ☐ Go-live ☐ Go-live with caveats ☐ Hold

---

_Maintained under `docs/qa/`. Update the build version + re-run P0 after every release that touches auth, payments, KYC, or money math._
