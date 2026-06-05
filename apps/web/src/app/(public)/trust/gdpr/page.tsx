import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LegalDocumentPage } from '@/components/legal/document-page'
import { fetchLegalDocumentByUrlPath } from '@/lib/legal'

// Legal/trust content is DB-seeded; render fresh so updates show immediately
// (the prior 1h ISR served stale placeholders for up to an hour after a content seed).
export const dynamic = 'force-dynamic'

const URL_PATH = '/trust/gdpr'

export async function generateMetadata(): Promise<Metadata> {
  const doc = await fetchLegalDocumentByUrlPath(URL_PATH)
  if (!doc) return { title: 'Not found' }
  return {
    title: doc.title,
    description: doc.oneLiner,
  }
}

export default async function Page() {
  const doc = await fetchLegalDocumentByUrlPath(URL_PATH)
  if (!doc) notFound()
  return <LegalDocumentPage doc={doc} />
}
