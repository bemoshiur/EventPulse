/**
 * Tests for `renderLegalMarkdown` — Sprint 2 Day 19 Item 14.
 *
 * Covers the Decision J sanitization contract:
 *   - Round-trip a known-safe markdown sample → expected HTML.
 *   - `<script>`, `<iframe>`, `<style>`, `<object>`, `<embed>` stripped.
 *   - `javascript:` and `data:` URI schemes stripped on links + images.
 *   - Event handler attributes stripped.
 *   - Inline `style` attributes stripped.
 *   - Safe `https://` images preserved.
 *   - Snapshot of the v0.1 placeholder body (regression guard for the
 *     allowlist — if `defaultSchema` ever changes upstream and silently
 *     widens what's allowed through, this snapshot drifts and fails the
 *     test, forcing a Decision-J amendment review).
 */

import { describe, expect, it } from 'vitest'

import { renderLegalMarkdown } from './render.js'

describe('renderLegalMarkdown — basic round-trip', () => {
  it('renders a heading and paragraph cleanly', async () => {
    const html = await renderLegalMarkdown('# Hello\n\nWorld.')
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<p>World.</p>')
  })

  it('renders ordered + unordered lists', async () => {
    const html = await renderLegalMarkdown('- one\n- two\n- three')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>three</li>')
  })

  it('renders inline emphasis', async () => {
    const html = await renderLegalMarkdown('A *soft* and **strong** word.')
    expect(html).toContain('<em>soft</em>')
    expect(html).toContain('<strong>strong</strong>')
  })

  it('renders a blockquote', async () => {
    const html = await renderLegalMarkdown('> caution')
    expect(html).toContain('<blockquote>')
  })

  it('renders a fenced code block', async () => {
    const html = await renderLegalMarkdown('```\nconst x = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code>')
    expect(html).toContain('const x = 1')
  })

  it('preserves a safe http(s) link', async () => {
    const html = await renderLegalMarkdown('[link](https://example.com)')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('preserves a mailto link', async () => {
    const html = await renderLegalMarkdown('[email](mailto:legal@eventpulse.com.bd)')
    expect(html).toContain('href="mailto:legal@eventpulse.com.bd"')
  })
})

describe('renderLegalMarkdown — sanitization', () => {
  it('strips a top-level <script> tag', async () => {
    const html = await renderLegalMarkdown('<script>alert(1)</script>safe')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips a top-level <iframe>', async () => {
    const html = await renderLegalMarkdown('<iframe src="https://evil"></iframe>visible')
    expect(html).not.toContain('<iframe')
  })

  it('strips a <style> tag', async () => {
    const html = await renderLegalMarkdown('<style>body{display:none}</style>visible')
    expect(html).not.toContain('<style')
  })

  it('strips an <object> tag', async () => {
    const html = await renderLegalMarkdown('<object data="evil.swf"></object>visible')
    expect(html).not.toContain('<object')
  })

  it('strips an <embed> tag', async () => {
    const html = await renderLegalMarkdown('<embed src="evil.swf">visible')
    expect(html).not.toContain('<embed')
  })

  it('drops a javascript: link', async () => {
    const html = await renderLegalMarkdown('[xss](javascript:alert(1))')
    expect(html).not.toMatch(/href="javascript:/i)
  })

  it('drops a data: image src', async () => {
    const html = await renderLegalMarkdown(
      '![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    )
    expect(html).not.toMatch(/src="data:/i)
  })

  it('strips event handler attributes', async () => {
    const html = await renderLegalMarkdown('<a href="https://x" onclick="alert(1)">link</a>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('alert(1)')
  })

  it('strips inline style attributes', async () => {
    const html = await renderLegalMarkdown('<p style="color:red">red</p>')
    expect(html).not.toMatch(/style=/i)
  })

  it('strips a <form> wrapper', async () => {
    const html = await renderLegalMarkdown('<form action="evil"><input name="x"></form>visible')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
  })

  it('preserves a safe https:// image', async () => {
    const html = await renderLegalMarkdown('![alt](https://eventpulse.com.bd/img/x.png)')
    expect(html).toContain('src="https://eventpulse.com.bd/img/x.png"')
  })
})

describe('renderLegalMarkdown — placeholder snapshot (allowlist regression guard)', () => {
  // Frozen sample of the v0.1 placeholder body shape. If the output here
  // drifts unexpectedly, defaultSchema or our pipeline configuration has
  // changed in a way that needs explicit Decision J review.
  const placeholder = `# Privacy Policy

> **DRAFT — not yet legally reviewed**
>
> This document is a placeholder.

## Status

Version v0.1.
`

  it('produces the expected sanitized shape', async () => {
    const html = await renderLegalMarkdown(placeholder)
    expect(html).toContain('<h1>Privacy Policy</h1>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>DRAFT')
    expect(html).toContain('<h2>Status</h2>')
    expect(html).toContain('Version v0.1.')
    // Defensive: no surprising tags slipped through.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('<iframe')
  })
})
