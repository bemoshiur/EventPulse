import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — Sprint 2 Day 16 scaffold + Day 17 Item 12 Part 2 e2e wiring.
 *
 * Per `.claude/memory/decisions.md` 2026-05-19 "KYC wizard e2e Playwright
 * test ships local-only on Day 17":
 *
 *   - `webServer` array spins up both apps/api (port 4000) AND apps/web
 *     (port 3000). The API runs with `KYC_S3_DRY_RUN=1` so signed-URL
 *     issuance returns synthetic URLs without an actual AWS call.
 *   - JWT_ACCESS_SECRET + JWT_REFRESH_SECRET are pinned to test values
 *     so a future global-setup can mint cookies that the API trusts.
 *   - DATABASE_URL inherits from the environment (CI sets it to the
 *     Postgres service container; locally devs set their own).
 *
 * Day 17 ships the Playwright infrastructure + a smoke test that asserts
 * the public surface loads. The full Individual Tier 1 happy-path test
 * (sign-in → 4 steps → submit) is queued as a Sprint 2 closeout PR —
 * needs a globalSetup that mints a tenant JWT via the API's signTokens
 * helper, which crosses the apps/api ↔ apps/web boundary in a way that's
 * best built as a focused 1-2 hour task rather than wedged into a day
 * already shipping the Org Tier A wizard.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API server — drafts router needs this to validate PATCH bodies
      // and the future happy-path test's signed-URL issuance runs
      // through it. KYC_S3_DRY_RUN=1 avoids an AWS call per the
      // 2026-05-19 e2e local-only decision.
      command: 'pnpm --filter @eventpulse/api dev',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        PORT: '4000',
        KYC_S3_DRY_RUN: '1',
        KYC_BUCKET_NAME: process.env['KYC_BUCKET_NAME'] ?? 'eventpulse-kyc-test',
        KYC_KMS_KEY_ARN:
          process.env['KYC_KMS_KEY_ARN'] ??
          'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id',
        JWT_ACCESS_SECRET: process.env['JWT_ACCESS_SECRET'] ?? 'x'.repeat(64),
        JWT_REFRESH_SECRET: process.env['JWT_REFRESH_SECRET'] ?? 'y'.repeat(64),
        DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      },
    },
    {
      command: 'pnpm --filter @eventpulse/web dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        PORT: '3000',
        // Frontend hits the local API; same-origin would work too, but
        // explicit base URL matches the staging vhost split.
        NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4000',
      },
    },
  ],
})
