/**
 * apps/web global test setup — Sprint 2 Day 15 Item 11.
 *
 * - Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument,
 *   toHaveAttribute, toBeDisabled, etc.) so component assertions read
 *   naturally without spelling out attribute lookups every time.
 * - Extends `expect` with vitest-axe's `toHaveNoViolations` matcher so
 *   any component test can include a single line a11y regression check:
 *     `expect(await axe(container)).toHaveNoViolations()`
 * - Wires `cleanup` from RTL to fire after every test (no DOM leakage
 *   between tests in the same file).
 */

import '@testing-library/jest-dom/vitest'
// Augments Vitest's `expect` type with `toHaveNoViolations` so
// `expect(await axe(container)).toHaveNoViolations()` type-checks.
import 'vitest-axe/extend-expect'

import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'

// Runtime install of the matcher implementations (the import above only
// brings the type augmentation; this line wires the actual assertion fn).
expect.extend(axeMatchers)

afterEach(() => {
  cleanup()
})
