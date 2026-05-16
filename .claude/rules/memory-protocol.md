# Memory Protocol — non-negotiable

Claude Code MUST follow these rules in every session for the Event Pulse project.
Memory is the single source of truth about what we've built, decided, and learned.
If memory is wrong, the project is wrong.

## Files Claude Code maintains

All under `.claude/memory/` — committed to git so teammates share them.

| File         | Purpose                                                                    | Updated when                                                   |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| MEMORY.md    | One-line index of what every other memory file contains                    | Whenever any other memory file changes                         |
| decisions.md | Append-only log of architectural and product decisions                     | Every time a decision is made or an §29 Open Decision resolves |
| progress.md  | Current sprint, what's done, what's in flight, what's blocked              | Every session end + every major task completion                |
| gotchas.md   | Things that broke, surprised us, or took >30 min to figure out             | The moment a gotcha is discovered                              |
| handoff.md   | "If a new dev opened the project right now, what would they need to know?" | At session end, always                                         |

## Format rules for memory files

- **decisions.md** entries: `## YYYY-MM-DD · <decision title>` then 3 sub-headings: **Context** (why this came up, 2-3 lines), **Decision** (what we chose, 1-2 lines), **Consequences** (what this means going forward, 2-4 lines).
- **progress.md**: three sections — `## Done`, `## In flight`, `## Blocked`. Items have a date and a one-line description. Move items between sections; do not delete.
- **gotchas.md** entries: `## <symptom>` then **Why it happens** + **Fix** + **How to avoid**.
- **handoff.md**: overwrite each session with a fresh 8-12 line "state of the project right now" note. The previous version stays in git history.

## When Claude Code MUST write to memory

1. **End of every session** (when user says "we're done for today", "let's stop here", "good night", or before /clear): update progress.md and overwrite handoff.md. Show the diff before committing.
2. **A decision is made** (we picked library X, we resolved an §29 Open item, we chose pattern Y over Z): append to decisions.md immediately, in that turn.
3. **A gotcha is hit** (EPS quirk, RLS surprise, deploy failure, money-math bug): append to gotchas.md immediately. Do not wait until end of session — you may forget the detail.
4. **A new teammate context is needed** (user says "Moshiur's brother is taking over", "the developer changed", "we have a new person"): re-read handoff.md and offer to expand it.

## When Claude Code MUST read from memory

1. **Start of every session** (before responding to the first message): read MEMORY.md, handoff.md, and the most recent 5 entries of decisions.md. Show a one-line "Loaded memory: X decisions, Y in-flight items, last session ended at <date>" summary.
2. **Before suggesting an approach to something non-trivial**: search decisions.md for prior decisions on related topics. If a relevant prior decision exists, surface it before proposing.
3. **Before declaring a task done**: check progress.md for related blocked items that may now be unblocked.

## Strict rules

- Memory is **append-mostly**, never silently deleted. If something becomes wrong, mark it superseded with a note and a link to the correcting decision.
- Money math, fee modes, settlement edge cases ALWAYS land in decisions.md when discussed, regardless of how minor.
- Anything from the §29 Open Decisions list resolves into decisions.md the moment it's decided.
- Memory files are committed in their own commits with the prefix `memory:` so they're easy to review and diff. Never bundle memory updates into feature commits.
- The user can always say "show me memory" or "what's in memory" — respond by listing the contents of MEMORY.md + a one-line summary of each file.

## Anti-patterns (forbidden)

- Writing to memory only at session end and not when a gotcha or decision happens (you forget)
- Restating CLAUDE.md content in memory files (memory is for what's NEW since the playbook)
- Treating memory as a scratchpad (it's the project's persistent brain, not your notes)
- Silently editing a past decisions.md entry (use the supersession pattern instead)
- Skipping the session-start memory read because "we just talked yesterday"
