/**
 * Contact form service — Day 42 Sprint 4 §26.1 Day 9 part 2.
 *
 * DB-gated integration tests. Skipped cleanly in the Unit job and run
 * in the Integration + RLS job per the established describeIfDb pattern.
 *
 * Coverage:
 *   - happy path: row inserted with all fields populated
 *   - happy path: row inserted with only required fields
 *   - happy path: topic enum accepts all 7 values
 *   - schema CHECK rejects invalid topic
 *   - schema CHECK rejects invalid status
 *   - status defaults to 'new'
 *   - cleanup
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { contactSubmissions } from '../../db/schema/index.js'
import { submitContactForm, type ContactTopic } from './contact-service.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('contact-service — Day 42 §26.1 Day 9 part 2', () => {
  const testEmails = new Set<string>()

  beforeAll(() => {
    // nothing yet
  })

  afterAll(async () => {
    if (testEmails.size === 0) return
    await withSuperAdmin(async (tx) => {
      await tx.execute(sql`DELETE FROM contact_submissions WHERE email = ANY(${[...testEmails]})`)
    })
  })

  it('happy path — all fields populated', async () => {
    const email = `contact-test-all-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    testEmails.add(email)

    const result = await submitContactForm({
      name: 'Sami Rahman',
      email,
      phone: '+8801711111111',
      organisation: 'Acme Events',
      subject: 'Pricing question for a 5,000-attendee concert',
      message:
        'Hi team — we are evaluating Event Pulse for a concert in late June. Can we get the pricing breakdown for absorbed bKash mode?',
      topic: 'sales',
      ip: '203.0.113.42',
      userAgent: 'Mozilla/5.0 test',
    })

    expect(result.kind).toBe('created')
    if (result.kind === 'created') {
      expect(result.submissionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )

      const rows = await withSuperAdmin(async (tx) =>
        tx
          .select()
          .from(contactSubmissions)
          .where(eq(contactSubmissions.id, result.submissionId))
          .limit(1),
      )
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row.email).toBe(email)
      expect(row.topic).toBe('sales')
      expect(row.status).toBe('new')
      expect(row.respondedAt).toBeNull()
      expect(row.assignedTo).toBeNull()
    }
  })

  it('happy path — only required fields', async () => {
    const email = `contact-test-min-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    testEmails.add(email)

    const result = await submitContactForm({
      name: 'Minimal Person',
      email,
      subject: 'A subject',
      message: 'A message that is at least ten characters long.',
    })

    expect(result.kind).toBe('created')
  })

  it('happy path — all 7 topic enum values accepted', async () => {
    const topics: ContactTopic[] = [
      'sales',
      'support',
      'legal',
      'partnership',
      'press',
      'security',
      'other',
    ]
    for (const topic of topics) {
      const email = `contact-test-${topic}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
      testEmails.add(email)
      const result = await submitContactForm({
        name: 'Topic Test',
        email,
        subject: `Test ${topic}`,
        message: `Topic enum test for ${topic} — must be at least ten chars.`,
        topic,
      })
      expect(result.kind).toBe('created')
    }
  })

  it('CHECK constraint rejects invalid topic', async () => {
    await expect(
      withSuperAdmin(async (tx) => {
        await tx.execute(
          sql`INSERT INTO contact_submissions (name, email, subject, message, topic) VALUES ('X', 'x@example.com', 'subj', 'a message long enough', 'bogus')`,
        )
      }),
    ).rejects.toThrow()
  })

  it('CHECK constraint rejects invalid status', async () => {
    await expect(
      withSuperAdmin(async (tx) => {
        await tx.execute(
          sql`INSERT INTO contact_submissions (name, email, subject, message, status) VALUES ('X', 'x@example.com', 'subj', 'a message long enough', 'invalid_status')`,
        )
      }),
    ).rejects.toThrow()
  })

  it('status defaults to new', async () => {
    const email = `contact-test-default-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    testEmails.add(email)

    await submitContactForm({
      name: 'Default Test',
      email,
      subject: 'Subject',
      message: 'A message long enough to pass.',
    })

    const rows = await withSuperAdmin(async (tx) =>
      tx
        .select({ status: contactSubmissions.status })
        .from(contactSubmissions)
        .where(eq(contactSubmissions.email, email))
        .limit(1),
    )
    expect(rows[0]?.status).toBe('new')
  })
})
