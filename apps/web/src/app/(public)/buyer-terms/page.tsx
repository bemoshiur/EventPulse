import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LegalDocumentPage } from '@/components/legal/document-page'
import { fetchLegalDocumentByUrlPath } from '@/lib/legal'

// Buyer Terms — the consent document the public buyer form links to at checkout.
// DB-seeded (same source the buyer-form clickwrap fetches); render fresh.
export const dynamic = 'force-dynamic'

const URL_PATH = '/buyer-terms'

export async function generateMetadata(): Promise<Metadata> {
  const doc = await fetchLegalDocumentByUrlPath(URL_PATH)
  if (!doc) return { title: 'Buyer Terms' }
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
