# Event Pulse — Gotchas

Things that broke, surprised us, or took >30 min to figure out. Add the moment you learn them, not at session end.

---

## CLAUDE.md §14.1 contradicts schema §9.12 on default fee mode

**Status:** RESOLVED 2026-05-16 — see `decisions.md` → "Default fee handling mode: pass_through". §9.12 was updated to match §14.1.

**Why it happens:** §14.1 ("Both default to `pass_through` for new tenants") and §9.12 (`tenant_fee_config.default_fee_mode text NOT NULL DEFAULT 'absorb'`) disagreed on what a brand-new tenant's default fee mode should be. The prose section and the DDL were edited at different times and drifted.

**Fix:** Schema DDL in §9.12 changed from `DEFAULT 'absorb'` to `DEFAULT 'pass_through'`. Prose in §14.1 was already correct.

**How to avoid:** Whenever the schema and the prose section for the same subsystem are edited, diff them for default values, enum members, and required-vs-optional flags. The fee engine is the riskiest place for this kind of drift — make it part of the §25 Definition of Done checklist whenever §9 or §14 is touched.

---

## GitHub Free plan blocks branch protection on private repos

**Status:** OPEN — deferred 2026-05-16. Add protection once a paid plan is in place.

**Why it happens:** `gh api -X PUT /repos/{owner}/{repo}/branches/{branch}/protection` returns `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` when the owning account is on GitHub Free and the repo is private. Same restriction applies to rulesets. Documented at <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>.

**Fix:** Either (a) upgrade `publicpulseagency` to GitHub Pro ($4/month), (b) convert the user account to an Organization and pay for GitHub Team ($4/user/month) — also unlocks team-based push restrictions for prod — or (c) keep the repo public (rejected: exposes the playbook + decisions log).

**Current state of main and prod branches:** UNPROTECTED. Direct pushes work; nothing enforces PR-based review or required CI checks. The Sprint 1 commits already on `main` are fine, but anything pushed straight to `main` from now until a paid plan exists bypasses every quality gate. Mitigation while unprotected: discipline only.

**How to avoid:** Pick a plan at the start of any new project. The cost ($4/mo) is dwarfed by one bad force-push. Tracked in handoff.md "Open questions" until resolved.

---

## AWS credentials accidentally pasted in chat during Day 3-4 bootstrap

**Status:** RESOLVED 2026-05-16 — both exposed keys deleted, CloudTrail audit clean (zero events on either key in ap-southeast-1 or us-east-1), replacement key never pasted.

**Symptom:** Two `eventpulse-cli` access keys (`AKIA2YICANXVR4KILEOZ`, `AKIA2YICANXVWVKCAE7Q`) exposed in chat via terminal output paste during initial AWS setup on 2026-05-16.

**Why it happens:** Shell command blocks with embedded `#` comments and multi-line structure caused zsh parse errors that scrambled terminal state; credential JSON output (which contains `AccessKeyId` + `SecretAccessKey`) got bundled into subsequent terminal log shares without being noticed in the moment.

**Fix:** Both compromised keys deleted from IAM. Third access key created for `eventpulse-cli`, never pasted anywhere. Root access key deleted entirely (programmatic root access is now impossible). `default` profile removed from `~/.aws/credentials` and `~/.aws/config`. CloudTrail audit performed across both regions for both key IDs — zero events on either key, no unauthorised use, no unfamiliar source IPs.

**How to avoid:**

1. **Never paste credential output** — AWS access keys, EPS hash keys, JWT signing keys, OAuth client secrets, KMS key material, anything sensitive — into any chat, screenshot, email, document, or log file. The only places credentials belong are `~/.aws/credentials` (or equivalent secrets file with `chmod 600`) and a password manager.
2. **Shell commands shared in prompts should be one command per line** with no `#` comments inside copy-paste blocks. zsh parses comments differently than bash and can leak surrounding text into the next visible line.
3. **When verifying setup, share only the minimum** — for `aws sts get-caller-identity` that's the `Arn` line via `--query 'Arn' --output text`, not the full JSON. For `aws iam create-access-key`, output goes straight to `aws configure --profile <name>` via piping or manual paste into the secrets file, never to stdout that gets captured.
4. **Treat any pasted credential as compromised even if the chat is private.** Rotate immediately. Run a CloudTrail audit for unauthorised use. Document the incident here.
