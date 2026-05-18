/**
 * Local augmentation that extends Vitest's underlying Chai assertion
 * surface with vitest-axe's `toHaveNoViolations` matcher. The package's
 * shipped `extend-expect.d.ts` only augments `namespace Vi.Assertion`,
 * but Vitest 2.x derives `expect(...)` from `Chai.Assertion`, so the
 * shipped augmentation isn't picked up at call sites and tsc errors
 * with "Property 'toHaveNoViolations' does not exist on type
 * 'Assertion<AxeResults>'".
 *
 * This file fixes that by augmenting both namespaces with the same
 * `AxeMatchers` interface that the runtime `expect.extend(axeMatchers)`
 * call in `test-setup.ts` installs.
 */

import type { AxeMatchers } from 'vitest-axe/matchers'

declare global {
  namespace Chai {
    /* eslint-disable @typescript-eslint/no-empty-object-type */
    interface Assertion extends AxeMatchers {}
    interface AsymmetricMatchersContaining extends AxeMatchers {}
    /* eslint-enable @typescript-eslint/no-empty-object-type */
  }
  // Vitest 2.x's own namespace (used by `expect.poll`, `expect.soft`, etc).
  // Augmenting both surfaces is belt-and-braces — drop the Vi block when
  // the upstream package ships proper Chai augmentation.
  namespace Vi {
    /* eslint-disable @typescript-eslint/no-empty-object-type */
    interface Assertion extends AxeMatchers {}
    interface AsymmetricMatchersContaining extends AxeMatchers {}
    /* eslint-enable @typescript-eslint/no-empty-object-type */
  }
}

export {}
