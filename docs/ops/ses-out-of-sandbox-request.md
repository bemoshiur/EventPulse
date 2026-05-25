# SES out-of-sandbox request — DRAFT for Moshiur review

**Status:** Draft. **Not yet submitted.** Moshiur to review and submit via AWS Support Center (Support → Create case → Service Limit Increase → SES Sending Limits).

**Why this exists:** AWS Support has been treated as a homework item for the user since before Sprint 4. The build track keeps shipping; the launch gate has not moved. This draft removes the "I have to write it from scratch" friction so the case can ship today with edits, not weeks from today with research.

---

## AWS Support case fields

**Service:** SES Sending Limits

**Limit type:** Production Access

**Mail type:** Transactional

**Website URL:** `https://eventpulse.com.bd` (production not yet cut over; staging at `https://staging.eventpulse.com.bd`)

**My email-sending complies with the AWS Service Terms and AUP:** YES

**Region:** `ap-southeast-1` (Singapore)

**Use case description (paste into the form):**

> Event Pulse is a multi-tenant SaaS ticketing platform serving event organisers in Bangladesh. We use Amazon SES to send transactional emails directly tied to user-initiated actions on our platform. There are no marketing, promotional, or bulk-list emails in this request — we operate strictly on a transactional model.
>
> **Email categories we send:**
>
> 1. **Authentication & account email** — magic-link sign-in tokens, email-verification links, password-reset links, MFA confirmation. Triggered by the user clicking sign-in/sign-up on our portal. All recipients are people who just entered their own email address on our site.
> 2. **Order confirmations & tickets** — when a buyer completes a registration on a tenant's event page, we email them the order confirmation with QR-coded admission ticket. Triggered by the buyer's checkout submission. All recipients are people who just entered their own email at checkout.
> 3. **Tenant operational notifications** — KYC submission status updates (approved/rejected), payout/settlement notifications, account-status changes. Triggered by platform operations on the tenant's own account. All recipients are the tenant's verified contact email on their own account.
> 4. **Event communications** — bilingual (English + Bangla) attendee notifications about events they registered for: event reminders before the event, post-event thank-you, refund notifications when a refund is processed. Triggered by event-state changes on events the recipient registered for.
>
> **How we handle bounces and complaints:**
>
> - We subscribe to SES bounce and complaint notifications via SNS topics already configured in our account.
> - Hard bounces and complaints are written to our `notification_log` table and the recipient address is automatically suppressed from future sends.
> - Our email infrastructure (`apps/api/src/infra/ses/`) refuses to send to a suppressed address.
> - We monitor SES reputation metrics in CloudWatch and have a runbook for reputation degradation.
>
> **How we obtain recipient consent:**
>
> - Authentication emails: the recipient just entered their email on our sign-in or sign-up form (a single, immediate, user-initiated action — the email is the response to their request).
> - Ticket confirmations: the recipient just completed a paid (or free) registration on a tenant's event page (an explicit purchase / RSVP action).
> - Tenant operational emails: the recipient is the tenant's own owner-of-record on their own account, verified at sign-up.
> - Event communications: the recipient registered for the specific event being communicated about — the communication is scoped to events they are an attendee on.
> - We do not buy, rent, or share recipient lists. There is no marketing channel in this request.
>
> **How we handle unsubscribes:**
>
> - Transactional emails (auth, ticket confirmations, payout notifications) are operationally required for the service the recipient signed up for; unsubscribe is the recipient closing their account or cancelling their registration, both of which we support.
> - Event reminders & post-event communications include a clear unsubscribe link that removes the recipient from communications for that event (and propagates to a suppression list at our end so future re-imports don't override the choice).
>
> **Volume forecast:**
>
> - Initial launch (first 30 days): under 500 emails/day. Most volume is auth + ticket confirmation flows for a small number of pilot tenants.
> - Steady state (3-6 months): forecast 3,000–5,000 emails/day across all categories combined.
> - We request: production sending limit of 50,000 emails / 24 hours and 14 emails / second to match the steady-state forecast plus reasonable growth headroom. We will request further increases as our actual volume approaches these limits.
>
> **Domain authentication:**
>
> - Sending domain `eventpulse.com.bd` is verified in SES (`ap-southeast-1`) with DKIM (3 CNAME records published in Route 53), SPF (`v=spf1 include:amazonses.com -all`), and DMARC (`v=DMARC1; p=quarantine; rua=mailto:dmarc@eventpulse.com.bd`) all published and verified.
> - Per-tenant white-label email domains (Sprint 7+ feature) will go through the same SES domain-identity verification before any tenant-domain-from-address is permitted.
>
> Thank you for reviewing.

---

## Submission checklist (Moshiur)

Before submitting, verify all of the below are TRUE on the actual account:

- [ ] SES domain identity `eventpulse.com.bd` is **verified** in the AWS Console for `ap-southeast-1`. (Status: needs check; if unverified, the support case will be denied — verify the domain identity FIRST.)
- [ ] DKIM CNAMEs are published in Route 53 (3 records) and SES shows them as verified.
- [ ] SPF TXT at apex includes `v=spf1 include:amazonses.com -all`.
- [ ] DMARC TXT at `_dmarc.eventpulse.com.bd` is published (currently `p=quarantine` per CLAUDE.md §17.6).
- [ ] SNS bounce + complaint topics are configured and the application subscribes to them.
- [ ] You agree with the volume forecast above (50k/day, 14/sec); if your near-term forecast differs, edit the numbers before submitting.
- [ ] You agree with the use-case description; edit any inaccuracies above before submitting.

## After submission

- AWS typically responds within 24 hours for a well-written case (24–48 hours worst-case for SES sandbox).
- The response is usually one of: (a) approved at the requested limits, (b) approved at lower limits with a path to request increases, (c) request for more information.
- When you receive the response, paste the outcome into `.claude/memory/decisions.md` so the launch-gate state is up to date. If the request is approved at any level, the launch-gate count goes from 4 to 3.

## If anything in this draft is wrong

Edit the file before submitting. The values above are best-guesses from the playbook and the project's current shape; the actual numbers (especially the volume forecast) should match your operational expectations, not my approximation.
