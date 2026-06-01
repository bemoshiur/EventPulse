/**
 * Public contact form endpoint — Day 42 Sprint 4 §26.1 Day 9 part 2.
 *
 *   POST /api/v1/public/contact   — submit a contact form
 *
 * Auth: none (public). Defence layers:
 *
 *   1. Honeypot field `website` — bots fill it; humans don't see it.
 *      Non-empty submissions are silently accepted (HTTP 200) so the
 *      bot doesn't learn the heuristic, but nothing is persisted.
 *   2. Per-IP rate limit — 3 submissions/hour/IP per §22.1.
 *   3. Zod-validated payload — types + length bounds + email shape.
 *
 * The endpoint deliberately returns the same success envelope shape
 * (with a non-meaningful submission_id) for both honeypot-flagged and
 * real submissions so attackers can't probe the difference.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { createRateLimiter } from '../../lib/rate-limit.js'
import { logger } from '../../lib/logger.js'
import { submitContactForm } from '../../services/contact/contact-service.js'

export const publicContactRoutes = new Hono()

// 3 submissions per IP per hour per §22.1.
const limiter = createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 })

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  phone: z.string().max(40).optional().nullable(),
  organisation: z.string().max(200).optional().nullable(),
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(5000),
  topic: z
    .enum(['sales', 'support', 'legal', 'partnership', 'press', 'security', 'other'])
    .optional(),
  /** Honeypot — must be empty/undefined for legitimate submissions. */
  website: z.string().max(0).optional(),
})

function envelope<T>(data: T) {
  return { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return { error: { code, message, request_id: requestId } }
}

publicContactRoutes.post('/', zValidator('json', contactSchema), async (c) => {
  const body = c.req.valid('json')
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const userAgent = c.req.header('user-agent') ?? null

  // Honeypot: bots fill the website field; humans don't see it. Return a
  // success-shaped envelope so the bot doesn't learn the heuristic.
  if (body.website && body.website.length > 0) {
    logger.warn({ ip_prefix: ip.split('.').slice(0, 2).join('.') }, 'contact.honeypot.tripped')
    return c.json(
      envelope({ submissionId: '00000000-0000-0000-0000-000000000000', accepted: true }),
      201,
    )
  }

  // Rate limit per IP.
  if (!limiter.check(ip)) {
    return c.json(
      errorEnvelope(
        'RATE_LIMITED',
        'Too many contact submissions from this IP. Please try again later.',
        requestId,
      ),
      429,
    )
  }

  const result = await submitContactForm({
    name: body.name,
    email: body.email,
    phone: body.phone,
    organisation: body.organisation,
    subject: body.subject,
    message: body.message,
    topic: body.topic ?? null,
    ip,
    userAgent,
  })

  if (result.kind === 'failed') {
    return c.json(
      errorEnvelope('INTERNAL_ERROR', 'Could not save your message; please try again.', requestId),
      500,
    )
  }

  return c.json(envelope({ submissionId: result.submissionId, accepted: true }), 201)
})

/** For tests — reset the in-memory rate limiter. */
export function __resetContactRateLimiter(): void {
  limiter.reset()
}
