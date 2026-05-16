We are entering focused execution mode on a specific task. Before writing any code:

1. Confirm the task by quoting it back to me in one sentence
2. Confirm which playbook section(s) govern this work (cite §X.Y)
3. Identify dependencies in `decisions.md` and `gotchas.md` — quote any that change how you'd approach this
4. Build a TodoWrite with 3–10 atomic items
5. Show me your plan
6. WAIT for my "go"

Once I say "go":

- Work the TodoWrite top-to-bottom
- Move items In Progress → Done as you go
- After every 3 items completed, pause and show me a status update
- Stop immediately if you hit: an §29 Open Decision, a contradiction with `decisions.md`, an RLS policy you can't justify, money math anywhere outside `fee-calculator.ts`, anything not covered in the playbook
- Run tests after each meaningful chunk; don't accumulate red CI

When the TodoWrite is done:

- Run full `pnpm typecheck && pnpm lint && pnpm test`
- Show me the diff of changed files
- Wait for my "ship it" before committing
