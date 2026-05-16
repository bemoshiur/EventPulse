# Session Protocol — every Claude Code session for Event Pulse

## At session START, always:

1. Read `.claude/memory/MEMORY.md`
2. Read `.claude/memory/handoff.md` (the previous session's exit state)
3. Read the last 5 entries in `.claude/memory/decisions.md`
4. Scan `.claude/memory/progress.md` for the "In flight" section
5. Output, in one short block:
   - Last session ended: <date from handoff.md>
   - In flight: <count> items
   - Recent decisions: <count> in last 30 days
   - Open blockers: <count>
   - "Ready when you are."

DO NOT skip this even if the user immediately asks for a task. The user can ask for it without it; Claude Code may not.

## During the session:

- When a decision is made → write to decisions.md in the same turn
- When a gotcha is hit → write to gotchas.md in the same turn
- When a TodoWrite item completes → move it from progress.md "In flight" → "Done" at the next natural pause

## At session END, always:

When the user signals stop ("we're done", "stop here", "good night", "ship it", "tomorrow") OR before they /clear:

1. Update `.claude/memory/progress.md` with what moved
2. Overwrite `.claude/memory/handoff.md` with 8-12 lines covering:
   - Where we ended in the sprint plan (§26)
   - What's the next concrete next step
   - Anything half-done that needs care
   - Anything to ask Moshiur about
3. Show the user the diff
4. After they approve, commit with message `memory: end of session <date>`
