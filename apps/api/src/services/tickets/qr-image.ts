/**
 * QR image rendering — Sprint 3 Day 28 Phase 2.
 *
 * Wraps a QR token (from `services/attendees/qr-token.ts`) in a
 * check-in URL, then renders the URL as a PNG image suitable for
 * embedding in a PDF ticket.
 *
 * ════════════════════════════════════════════════════════════════════
 * What the QR encodes (and why):
 * ════════════════════════════════════════════════════════════════════
 *
 * The QR image carries the URL `${API_BASE}/scan/{token}`, not the
 * bare token. Reasons:
 *
 *   1. **Universal scanner support.** Camera apps + iOS Camera +
 *      Android Camera all recognise URLs and offer "open this link"
 *      out of the box. A bare opaque token doesn't trigger that
 *      affordance — the user has to launch a custom scanner app.
 *   2. **Phase 1 MVP needs no custom app.** Door staff can scan with
 *      their phone camera and tap the URL to hit the scanner web
 *      endpoint (Sprint 4 Day 3-4). Native scanner app is Phase 3.
 *   3. **Wrapping is just framing.** The TOKEN inside is still 256
 *      bits of opaque random; the wrapper just makes it discoverable.
 *      Forgery resistance is unchanged.
 *
 * ════════════════════════════════════════════════════════════════════
 * Error correction level (ECC):
 * ════════════════════════════════════════════════════════════════════
 *
 * Using `M` (medium, ~15% recovery). Trade-off: higher ECC = denser
 * QR (more modules) = harder to scan when printed small / at angle.
 * `M` is the standard QR-on-ticket choice and matches what most
 * ticketing services use. Bumping to `Q` (25%) or `H` (30%) would
 * help if the print medium is unreliable (creased PDFs, low-DPI
 * thermal printers) — defer until we see real-world issues.
 *
 * ════════════════════════════════════════════════════════════════════
 * API base URL source:
 * ════════════════════════════════════════════════════════════════════
 *
 * Reads `EVENTPULSE_API_BASE_URL` env var. Mirrors the OAuth callback
 * pattern (Day 24) + the EVENTPULSE_WEB_BASE_URL pattern (Day 27
 * redirects). Throws if unset — fail-fast at first call rather than
 * shipping a relative URL into a QR (which would break scanning from
 * a phone camera that has no concept of "current page").
 */

import QRCode from 'qrcode'

export interface RenderQrInput {
  /** The 43-char base64url QR token from `mintQrToken()`. */
  qrToken: string
  /** Optional override for tests; production reads from env. */
  apiBaseUrl?: string
}

export interface RenderedQr {
  /** PNG bytes — embed directly into PDF via doc.image(). */
  png: Buffer
  /** The check-in URL the QR encodes — useful for debugging + logging. */
  url: string
}

/**
 * Build the check-in URL from a token. Exposed for tests + for use
 * by future scanner endpoint wiring.
 */
export function buildScanUrl(qrToken: string, apiBaseUrl?: string): string {
  const base = apiBaseUrl ?? process.env['EVENTPULSE_API_BASE_URL']
  if (!base || base.length === 0) {
    throw new Error(
      'EVENTPULSE_API_BASE_URL is unset; refusing to render a QR without an absolute URL',
    )
  }
  // Strip any trailing slash so we don't produce `//scan/...`.
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}/scan/${qrToken}`
}

/**
 * Render the QR image as a PNG Buffer. Suitable for embedding in
 * a PDF via pdfkit's `doc.image(buffer, x, y, opts)`.
 *
 * Resolution: 400×400 pixels at default density. Larger than strictly
 * needed for screen-scanning (200×200 would work) but ensures crisp
 * rendering when the PDF is zoomed or printed at moderate DPI.
 */
export async function renderQrPng(input: RenderQrInput): Promise<RenderedQr> {
  const url = buildScanUrl(input.qrToken, input.apiBaseUrl)
  const png = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: 400,
    margin: 1,
  })
  return { png, url }
}
