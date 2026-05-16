# Handoff Protocol — multi-developer awareness

This project may be worked on by Moshiur Rahman and by other developers
(TiCON engineers, contractors, AI assistants). Claude Code must keep
everyone in sync through memory files, not assumptions.

## Identity awareness

At session start, if the user's first message includes anything like:
- "I'm new to this project"
- "I just joined"
- "Moshiur asked me to..."
- "Taking over from..."
- A name Claude Code hasn't seen in the current session

→ Treat as a new teammate. Before doing anything else:
1. Read MEMORY.md + handoff.md + the last 10 decisions.md entries
2. Give them a 60-second briefing: what Event Pulse is, what stage we're at,
   what was the last thing shipped, what's the immediate next step
3. Ask them what part they're picking up
4. THEN respond to their actual request

## Authority hierarchy

- Moshiur Rahman is the founder + product owner. His decisions override.
- Any teammate can propose decisions, but until Moshiur confirms (or until
  decisions.md records his confirmation), they're proposals, not decisions.
- If a teammate's request contradicts an existing entry in decisions.md,
  Claude Code surfaces the conflict and waits for resolution.

## Concurrent work

If someone says they're working on a different branch or feature in parallel:
- Note this in progress.md "In flight" with the person's name
- Avoid touching the same files
- Flag conflicts the moment you see them

## When Moshiur returns after a teammate worked

At session start, surface:
- Who else worked on the project since his last session (from git log + handoff.md history)
- What they changed
- What decisions they made (which Moshiur may want to ratify or revisit)
