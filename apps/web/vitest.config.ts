import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * apps/web test config — jsdom + RTL + jest-dom matchers + vitest-axe.
 *
 * Sprint 2 Day 15 Item 11 landed the frontend test rig (RTL +
 * user-event + jsdom + jest-dom + vitest-axe + v8 coverage). The jsdom
 * environment is scoped to this package only; apps/api stays on the
 * default `node` environment because backend tests do not need a DOM
 * and jsdom would slow them down with unrelated globals.
 *
 * Conventions for tests authored on this rig:
 *   - Every interactive component test includes one axe assertion via
 *     `expect(await axe(container)).toHaveNoViolations()` for cheap
 *     a11y regression coverage.
 *   - Use `@testing-library/user-event` (not raw `fireEvent`) for
 *     keyboard + focus interactions; it models the real event
 *     sequence (focus → keydown → keypress → input → keyup) that
 *     accessibility behaviour depends on.
 *   - Coverage available locally via `pnpm --filter @eventpulse/web test --coverage`;
 *     not a CI gate at MVP.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig path aliases so RTL + Vitest can resolve `@/...` imports.
      '@': resolve(__dirname, 'src'),
    },
  },
  // esbuild handles JSX during Vitest's transform step. `automatic` uses
  // React 17+'s new JSX transform so test files do not need to import
  // React at the top — matching the production Next.js build's behaviour.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
})
