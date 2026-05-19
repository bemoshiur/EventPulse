import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LegalDocumentPage } from '@/components/legal/document-page'
import { fetchLegalDocumentByUrlPath } from '@/lib/legal'

export const revalidate = 3600

const URL_PATH = '/cookies'

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
