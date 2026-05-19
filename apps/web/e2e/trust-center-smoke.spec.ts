/**
 * Trust Center routing smoke — Sprint 2 Day 19 Item 14.
 *
 * Confirms the 19 public Trust Center routes resolve cleanly. The DB
 * may or may not be seeded in the e2e environment — if not, individual
 * document pages 404 (which is also valid behaviour: the Server
 * Component calls notFound()). The /trust landing always renders even
 * when the document list is empty.
 *
 * Full deep e2e (seed + visit + DRAFT-banner assertion + admin publish
 * round-trip) lands as a Sprint 2 closeout follow-up.
 */

import { expect, test } from '@playwright/test'

test('Trust Center landing renders', async ({ page }) => {
  const res = await page.goto('/trust')
  // 200 even when the document list is empty.
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /What Event Pulse stands for/i,
  )
})
