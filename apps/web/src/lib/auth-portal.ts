/**
 * Portal helpers for the magic-link consume page — browser-auth integration
 * (Day 46, Option B, step 5). Pure functions so the consume page's redirect +
 * error copy are unit-testable without a DOM/network round-trip.
 *
 * Audience travels in the magic link; the API's #267 grant check is the
 * authority (requesting an audience you don't hold → 403, surfaced below).
 */

/** Where a freshly-authenticated session lands, by audience. */
export function consumeHomePath(audience: string): string {
  switch (audience) {
    case 'super-admin':
      return '/admin/kyc'
    case 'tenant':
      return '/dashboard'
    case 'attendee':
      // The tenant portal signs users in with an attendee magic link (the
      // request flow can't mint a tenant session — it has no tenantId), so a
      // freshly-signed-in tenant user arrives here as `attendee`. Land them on
      // the tenant picker (decisions.md 2026-06-04 "always show a picker"); it
      // lists their tenants and the chosen one mints the tenant session. A user
      // with no tenants sees the picker's empty state. When the attendee portal
      // (my.eventpulse.com.bd) ships in Phase 2 this branches by portal.
      return '/choose-tenant'
    // Anything unexpected → marketing/root.
    default:
      return '/'
  }
}

/** Human-facing copy for a failed consume, by HTTP status. */
export function consumeErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'This link has expired or was already used. Request a new one.'
    case 403:
      return "You don't have access to this area with this account."
    case 404:
      return 'No account was found for this link.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
