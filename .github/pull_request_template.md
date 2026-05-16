<!--
Title must follow Conventional Commits (§23.5):
  type(scope?)!?: subject
  feat(events): add capacity tracking
  fix(payments): handle EPS COMPLETED status alias
  memory: end of session 2026-05-20
-->

> ⚠ **Solo project — no second reviewer.** Branch protection isn't enforceable on a GitHub Free private repo, so the merge bar is **you, honest with yourself**. Tick every Definition-of-Done box below only after verifying — never as wishful thinking. If something can't be ticked, open an issue capturing what's deferred and link it here rather than skipping the line. See `decisions.md` 2026-05-16 "GitHub free plan — branch protection via local hooks + CI".

## What changed

<!-- One-liner — bias toward the "why", let the diff speak to the "what". -->

## Why

<!-- Link the driving need: progress.md item, decisions.md entry, issue, sprint goal in §26. -->

- progress.md item: `...`
- decisions.md (if applicable): `YYYY-MM-DD · ...`
- Issue: `#`

## How tested

<!-- Concrete commands and what they proved. "Tests pass" is not enough. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e` (if UI-visible)
- [ ] Manual check in browser at `http://localhost:3000/...` (if UI-visible)
- [ ] EPS sandbox: one success + one failure (if payment-flow)

## Definition of Done (§25)

- [ ] All new code TypeScript with `strict: true`, no `any` (use `unknown`)
- [ ] All new functions unit-tested where they have non-trivial logic
- [ ] All new API endpoints have at least one integration test against real Postgres
- [ ] **RLS** policies tested with a "wrong tenant cannot read" test case
- [ ] `pnpm typecheck` and `pnpm lint` pass with zero errors
- [ ] No `console.log` left in source (use `logger.info`)
- [ ] No raw PII in logs (R5) — use deterministic hashes
- [ ] New env vars added to `.env.example` with comments
- [ ] Migrations include RLS policies in the **same** commit (R11)
- [ ] If money math: lives **only** in `apps/api/src/domain/payments/fee-calculator.ts` (§14.3)
- [ ] If payment flow: status comes from EPS Verify API, never the redirect (R3)
- [ ] If money-moving endpoint: requires `Idempotency-Key` (R6)
- [ ] User-visible change logged in `CHANGES.md`
- [ ] If public surface: both English and Bangla copy provided (R12)

## Solo-review ritual (when no teammate yet)

If you're the only reviewer:

- [ ] Opened as **Draft** while writing
- [ ] Re-read the full diff before "Ready for review"
- [ ] Every checklist box above was ticked **after** verifying, not as wishful thinking
- [ ] Squash-merge to `main` with a clean Conventional Commits subject

## Risk + rollback

<!-- What breaks if this is wrong? How do you roll back? -->
