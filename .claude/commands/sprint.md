We're transitioning between sprints. This is bigger than a normal session end.

1. Summarise everything shipped in this sprint with reference to §26 acceptance criteria
2. Identify what didn't ship and propose: defer to next sprint / cut entirely / split
3. Run a retro:
   - What worked well?
   - What didn't?
   - What gotcha caught us most?
   - What single change would have saved the most time?
4. Propose three things to do differently next sprint
5. Cut a release: tag the commit `v0.<sprint>.0`, generate release notes from `changelog_entries`, push tag
6. Update `progress.md` for next sprint: move scope into In Flight as Planned
7. Update `handoff.md` to reflect sprint boundary
8. Open a GitHub Issue titled "Sprint <N+1> kick-off" with the proposed scope
9. Commit as `chore: end of sprint <N>` + push the tag

Sprint boundaries are when patterns either lock in or drift. Take this seriously.
