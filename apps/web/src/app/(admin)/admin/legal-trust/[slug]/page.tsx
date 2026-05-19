/**
 * Super admin Legal & Trust editor — single document detail — Sprint 2
 * Day 19 Item 15.
 *
 * Shows current version body + version history + publish-new-version
 * form. Client-side render via TanStack hooks (the page wrapper passes
 * the slug param down to the client component).
 */

import { LegalTrustDocumentDetail } from '@/components/admin-legal/document-detail'

export default async function LegalTrustDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <LegalTrustDocumentDetail slug={slug} />
}
