import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration flows that do two argon2 ops (signup hash + login verify)
    // plus DB round-trips run ~5s on CI runners — right at vitest's 5000ms
    // default, causing flaky timeouts (Day-45). argon2 is deliberately slow;
    // give the suite headroom. A genuinely hung test still fails, just later.
    testTimeout: 20000,
  },
})
