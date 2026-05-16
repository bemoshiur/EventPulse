Pretend you are a senior engineer reviewing this PR. Be ruthless, not polite.

Read every changed file. For each, evaluate against:

**Correctness**

- Does the code do what the playbook says it should?
- Are edge cases handled? (zero amounts, null tenants, expired sessions, race conditions)
- Are state transitions valid per §2.4 / §2.5 / state machines?

**Multi-tenancy (§4)**

- Every new query is tenant-scoped or explicitly super-admin
- RLS policies on every new table, tested with cross-tenant negative test
- No raw SQL bypassing RLS without justification

**Money (§14)**

- All amounts in paisa, bigint
- Fee math only in `fee-calculator.ts`
- Idempotency on order/refund/payout endpoints

**Security (§1.3)**

- No PII in logs
- No client-trusted prices or quantities
- Auth checked on every endpoint
- Webhooks verify signature

**Testability (§24)**

- Unit test for each non-trivial function
- Integration test for each new endpoint
- RLS negative test if multi-tenant
- Happy path + at least one failure path

**Definition of Done (§25)**

- Every box ticked, with evidence

Output format:

- 🟢 Pass: <list of things that are good>
- 🟡 Issues to fix before merge: <list with file:line>
- 🔴 Blockers: <list, with rationale>
- Questions for Moshiur: <list>

Do NOT fix anything yet. Just review. I'll decide what to act on.
