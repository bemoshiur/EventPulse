# Event Pulse

Multi-tenant SaaS ticketing and event registration platform for Bangladesh at **eventpulse.com.bd**.

Three portals share one codebase: tenant (`app.eventpulse.com.bd`), super admin (`admin.eventpulse.com.bd`), and public event pages.

## Start here

- **[CLAUDE.md](./CLAUDE.md)** — the authoritative playbook (v2.0). Mission, locked tech stack, immutable rules, full database schema, API spec, settlement engine, sprint plan. Read end-to-end before touching code.
- **[Playbook/](./Playbook/)** — original playbook source and the companion project outline.

## How this project remembers itself

The `.claude/` folder is the project's persistent brain. It is committed to git so the whole team shares the same memory.

- **[.claude/rules/](./.claude/rules/)** — operating protocols:
  - `memory-protocol.md` — how memory is maintained
  - `session-protocol.md` — what happens at session start and end
  - `handoff-protocol.md` — multi-developer awareness
- **[.claude/memory/](./.claude/memory/)** — the shared memory:
  - `MEMORY.md` — index
  - `decisions.md` — append-only architectural decisions log
  - `progress.md` — current sprint state (Done / In flight / Blocked)
  - `gotchas.md` — things learned the hard way
  - `handoff.md` — last session exit state (first thing to read on a new session)

If you are new to the repo, open `.claude/memory/handoff.md` first — it tells you exactly where work stopped and what the next concrete step is.

## Who runs this

Built and maintained by [Public Pulse Agency](https://publicpulse.com.bd) / TiCON System Limited. Founder: Moshiur Rahman.
