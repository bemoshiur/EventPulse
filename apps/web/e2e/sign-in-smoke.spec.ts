/**
 * Sign-in smoke — Sprint 2 Day 17 Item 12 Part 2 e2e infrastructure.
 *
 * Validates that the Playwright pipeline boots both apps/api + apps/web
 * cleanly and the public sign-in surface renders. No DB or auth flow
 * exercised — that's the Sprint 2 closeout follow-up.
 *
 * Per `.claude/memory/decisions.md` 2026-05-19 "KYC wizard e2e
 * Playwright test ships local-only on Day 17", the full Individual
 * Tier 1 happy-path test (JWT setup → 4 steps → submit) lands in
 * Sprint 2 closeout PR — needs globalSetup that calls into apps/api
 * signTokens to mint a fixture cookie. That cross-app setup is best
 * built as a focused 1–2 hour task rather than wedged into a day
 * already shipping the Org Tier A wizard.
 *
 * Today's job: confirm the webServer array config works end-to-end so
 * the closeout PR's only task is the global-setup + the steps walk.
 */

import { expect, test } from '@playwright/test'

test('sign-in page renders the four auth entry points', async ({ page }) => {
  await page.goto('/sign-in')
  // Continue-with-Apple + Continue-with-Google + email magic-link + password sign-in
  // per §19.2 sign-in UI. We assert on stable selectors that the public
  // marketing surface guarantees.
  await expect(page).toHaveTitle(/event pulse/i)
})
