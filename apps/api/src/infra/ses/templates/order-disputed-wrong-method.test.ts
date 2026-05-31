import { describe, expect, it } from 'vitest'

import { renderOrderDisputedWrongMethod } from './order-disputed-wrong-method.js'

describe('order-disputed-wrong-method email template', () => {
  const eventUrl = 'https://acme.eventpulse.com.bd/summer-sounds-2026'
  const baseVars = {
    buyerName: 'Aminul Islam',
    eventTitle: 'Summer Sounds 2026',
    amountPaisa: 102_756n, // 1027.56 BDT — truth-gate Mode A buyer total
    eventUrl,
  } as const

  it('renders English with buyer name + event title + amount + return-to-event CTA', () => {
    const out = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'en' })
    expect(out.templateId).toBe('order_disputed_wrong_method')
    expect(out.subject).toMatch(/About your recent payment — refund coming/)
    expect(out.text).toContain('Hi Aminul Islam,')
    expect(out.text).toContain('Summer Sounds 2026')
    // BDT amount formatted with thousand-separator + two decimals
    expect(out.text).toContain('৳ 1,027.56')
    expect(out.text).toContain('bKash')
    expect(out.text).toContain('5 business days')
    expect(out.text).toContain(eventUrl)
    expect(out.html).toContain(`href="${eventUrl}"`)
    expect(out.html).toContain('Return to event page')
  })

  it('renders Bangla variant with native greeting + amount + CTA', () => {
    const out = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'bn' })
    expect(out.subject).toContain('আপনার সাম্প্রতিক পেমেন্ট')
    expect(out.text).toContain('নমস্কার Aminul Islam,')
    expect(out.text).toContain('Summer Sounds 2026')
    expect(out.text).toContain('৳ 1,027.56')
    expect(out.text).toContain('bKash')
    expect(out.text).toContain('৫ কার্যদিবসের মধ্যে')
    expect(out.text).toContain(eventUrl)
    expect(out.html).toContain('ইভেন্ট পেজে ফিরে যান')
  })

  it('formats small paisa amounts correctly (BDT 1.79 — calculator Mode A EPS fee)', () => {
    const out = renderOrderDisputedWrongMethod({
      ...baseVars,
      amountPaisa: 179n,
      locale: 'en',
    })
    expect(out.text).toContain('৳ 1.79')
  })

  it('formats large paisa amounts with thousand-separator', () => {
    const out = renderOrderDisputedWrongMethod({
      ...baseVars,
      amountPaisa: 1_234_567n, // 12,345.67 BDT
      locale: 'en',
    })
    expect(out.text).toContain('৳ 12,345.67')
  })

  it('formats zero paisa as 0.00 (edge case; should never fire in practice — free orders never go through Verify-guard)', () => {
    const out = renderOrderDisputedWrongMethod({
      ...baseVars,
      amountPaisa: 0n,
      locale: 'en',
    })
    expect(out.text).toContain('৳ 0.00')
  })

  it('English HTML body contains key user-facing strings', () => {
    const out = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'en' })
    expect(out.html).toContain('About your recent payment')
    expect(out.html).toContain('<strong>Summer Sounds 2026</strong>')
    expect(out.html).toContain('<strong>bKash</strong>')
    expect(out.html).toContain("We're sorry for the inconvenience.")
    expect(out.html).toContain('support@eventpulse.com.bd')
  })

  it('Bangla HTML body contains native phrasing', () => {
    const out = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'bn' })
    expect(out.html).toContain('আপনার পেমেন্ট সম্পর্কে')
    expect(out.html).toContain('<strong>Summer Sounds 2026</strong>')
    expect(out.html).toContain('<strong>bKash</strong>')
    expect(out.html).toContain('অসুবিধার জন্য আমরা দুঃখিত।')
    expect(out.html).toContain('support@eventpulse.com.bd')
  })

  it('templateId is stable across both locales (single canonical id)', () => {
    const en = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'en' })
    const bn = renderOrderDisputedWrongMethod({ ...baseVars, locale: 'bn' })
    expect(en.templateId).toBe('order_disputed_wrong_method')
    expect(bn.templateId).toBe('order_disputed_wrong_method')
    expect(en.templateId).toBe(bn.templateId)
  })
})
