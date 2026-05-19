/**
 * Integration tests for /api/v1/public/legal — Sprint 2 Day 19 Item 14.
 *
 * Unauthenticated reads consumed by apps/web Server Components per
 * Decision K. DATABASE_URL-gated.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { createApp } from '../../app.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import { legalDocuments, legalDocumentVersions } from '../../db/schema/index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('/api/v1/public/legal router (Item 14)', () => {
  let docId: string
  let versionId: string
  let slug: string
  let urlPath: string

  beforeAll(async () => {
    const ts = Date.now()
    slug = `pub-test-${ts}`
    urlPath = `/pub-test/${ts}`
    await withSuperAdmin(async (db) => {
      const [doc] = await db
        .insert(legalDocuments)
        .values({
          slug,
          canonicalUrlPath: urlPath,
          category: 'legal_contract',
          title: 'Public Test Document',
          oneLiner: 'A fixture for the public legal route tests.',
          requiresSignature: true,
        })
        .returning({ id: legalDocuments.id })
      docId = doc!.id

      const [ver] = await db
        .insert(legalDocumentVersions)
        .values({
          documentId: docId,
          version: 'v0.1',
          effectiveAt: new Date(),
          bodyMd: '# Public Test\n\nHello.',
          bodyHtml: '<h1>Public Test</h1>\n<p>Hello.</p>',
          summaryOfChanges: 'fixture',
          materialChange: false,
          createdBy: null,
        })
        .returning({ id: legalDocumentVersions.id })
      versionId = ver!.id

      await db
        .update(legalDocuments)
        .set({ currentVersionId: versionId })
        .where(eq(legalDocuments.id, docId))
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      await db
        .update(legalDocuments)
        .set({ currentVersionId: null })
        .where(eq(legalDocuments.id, docId))
      await db.delete(legalDocumentVersions).where(eq(legalDocumentVersions.documentId, docId))
      await db.delete(legalDocuments).where(eq(legalDocuments.id, docId))
    })
    await resetPool()
  })

  const app = createApp()

  describe('GET /landing', () => {
    it('returns the document list including the test row', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/public/legal/landing'))
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toMatch(/public.*max-age=300/)
      const body = (await res.json()) as {
        data: Array<{ slug: string; category: string; canonicalUrlPath: string }>
      }
      const ours = body.data.find((d) => d.slug === slug)
      expect(ours).toBeDefined()
      expect(ours!.canonicalUrlPath).toBe(urlPath)
      expect(ours!.category).toBe('legal_contract')
    })
  })

  describe('GET /by-url-path', () => {
    it('returns the document for a known URL path with body_html', async () => {
      const res = await app.fetch(
        new Request(
          `http://localhost/api/v1/public/legal/by-url-path?path=${encodeURIComponent(urlPath)}`,
        ),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toMatch(/s-maxage=3600/)
      const body = (await res.json()) as {
        data: { slug: string; currentVersion: { bodyHtml: string; isDraft: boolean } }
      }
      expect(body.data.slug).toBe(slug)
      expect(body.data.currentVersion.bodyHtml).toContain('<h1>Public Test</h1>')
      expect(body.data.currentVersion.isDraft).toBe(true)
    })

    it('404 on bogus URL path', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/v1/public/legal/by-url-path?path=/bogus/path'),
      )
      expect(res.status).toBe(404)
    })

    it('400 on missing path query param', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/public/legal/by-url-path'))
      expect(res.status).toBe(400)
    })

    it('400 on malformed path (no leading /)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/v1/public/legal/by-url-path?path=privacy'),
      )
      expect(res.status).toBe(400)
    })
  })
})
