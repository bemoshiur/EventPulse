/**
 * QR image rendering — unit tests.
 *
 * Pinned behaviour:
 *
 *   1. URL wrapping: token is wrapped as `{base}/scan/{token}`.
 *   2. Trailing slash on base is normalised (no `//scan/`).
 *   3. PNG output is a non-empty Buffer with PNG magic bytes.
 *   4. Two different tokens produce two different PNG buffers
 *      (the QR encodes the URL → different URL → different image).
 *   5. Same token produces the same QR image (deterministic).
 *   6. Missing EVENTPULSE_API_BASE_URL → throws (fail-fast).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildScanUrl, renderQrPng } from './qr-image.js'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ORIGINAL_API_BASE = process.env['EVENTPULSE_API_BASE_URL']

beforeEach(() => {
  process.env['EVENTPULSE_API_BASE_URL'] = 'https://api.staging.eventpulse.com.bd'
})

afterEach(() => {
  if (ORIGINAL_API_BASE === undefined) {
    delete process.env['EVENTPULSE_API_BASE_URL']
  } else {
    process.env['EVENTPULSE_API_BASE_URL'] = ORIGINAL_API_BASE
  }
})

describe('buildScanUrl', () => {
  it('wraps a token as {base}/scan/{token}', () => {
    expect(buildScanUrl('abcDEF123_-')).toBe(
      'https://api.staging.eventpulse.com.bd/scan/abcDEF123_-',
    )
  })

  it('normalises a trailing slash on the base', () => {
    expect(buildScanUrl('tok', 'https://api.example.com/')).toBe('https://api.example.com/scan/tok')
  })

  it('normalises multiple trailing slashes on the base', () => {
    expect(buildScanUrl('tok', 'https://api.example.com///')).toBe(
      'https://api.example.com/scan/tok',
    )
  })

  it('throws when EVENTPULSE_API_BASE_URL is unset', () => {
    delete process.env['EVENTPULSE_API_BASE_URL']
    expect(() => buildScanUrl('tok')).toThrowError(/EVENTPULSE_API_BASE_URL is unset/)
  })

  it('accepts an explicit override (for tests)', () => {
    delete process.env['EVENTPULSE_API_BASE_URL']
    expect(buildScanUrl('tok', 'https://override.example.com')).toBe(
      'https://override.example.com/scan/tok',
    )
  })
})

describe('renderQrPng', () => {
  it('produces a PNG buffer with valid PNG magic bytes', async () => {
    const { png, url } = await renderQrPng({ qrToken: 'a'.repeat(43) })
    expect(png).toBeInstanceOf(Buffer)
    expect(png.length).toBeGreaterThan(100)
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true)
    expect(url).toBe(`https://api.staging.eventpulse.com.bd/scan/${'a'.repeat(43)}`)
  })

  it('different tokens produce different PNG output', async () => {
    const a = await renderQrPng({ qrToken: 'a'.repeat(43) })
    const b = await renderQrPng({ qrToken: 'b'.repeat(43) })
    expect(a.png.equals(b.png)).toBe(false)
  })

  it('same token produces deterministic PNG output', async () => {
    const a = await renderQrPng({ qrToken: 'X'.repeat(43) })
    const b = await renderQrPng({ qrToken: 'X'.repeat(43) })
    expect(a.png.equals(b.png)).toBe(true)
  })

  it('respects the apiBaseUrl override', async () => {
    const { url } = await renderQrPng({
      qrToken: 't'.repeat(43),
      apiBaseUrl: 'https://api.example.com',
    })
    expect(url).toBe(`https://api.example.com/scan/${'t'.repeat(43)}`)
  })
})
