# Event Pulse — Decisions Log

Append-only. Most recent at the top. If a decision is superseded, add a new entry on top with `Supersedes: <date of old decision>` and add a note to the old one with `Superseded by: <date of new decision>`.

---

## 2026-05-16 · Default fee handling mode: pass_through

**Context:** CLAUDE.md §14.1 said both fees default to `pass_through` for new tenants; the schema in §9.12 had `tenant_fee_config.default_fee_mode DEFAULT 'absorb'`. The contradiction surfaced during session-one playbook acknowledgement and was logged to gotchas.md.

**Decision:** Both `platform_fee_handling` and `eps_fee_handling` default to `pass_through` for new tenants. The schema is the side that changes; §9.12 has been updated to match §14.1.

**Consequences:**

- First-time organisers price at round numbers (500/1000/2500 BDT) and net exactly that figure — what-you-see-is-what-you-get prevents the inevitable post-first-payout support ticket.
- Matches the dominant international pattern (Eventbrite, Ti.to, Hopin) so tenants with prior tool experience find Event Pulse intuitive.
- Premium-event organisers (corporate galas, ticketed concerts where total clarity matters) can flip to `absorb` per-event in the event wizard — a deliberate choice rather than a default they fell into.
- Cash-positive for the platform: buyer covers fees up front, no absorb-cost timing gap to carry.
- `fee-calculator.ts` test matrix must cover both modes; default-creation fixtures for new tenants should assert `pass_through`.

---

## 2026-05-16 · Project bootstrap on playbook v2.0

**Context:** Starting fresh. Playbook v2.0 is loaded as CLAUDE.md.

**Decision:** Build to the v2.0 playbook exactly. All §29 items marked ✓ are settled; the remaining open items will be resolved as we hit them.

**Consequences:** Claude Code defers to the playbook on any conflict. Any deviation requires an entry here before being implemented.
