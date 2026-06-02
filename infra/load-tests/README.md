# Load tests — k6 scaffold

> **Status:** scaffold. Created Day 43 (2026-06-02). Closes the k6 half of CLAUDE.md §24.4 Sprint-4-close requirement: _"k6 or artillery against staging — fail PR if p95 regresses > 20%"_.
>
> **Posture:** **NOT YET A BLOCKING PR GATE.** The scripts + workflow + budget file are wired and runnable, but the GitHub Actions workflow ships as `workflow_dispatch`-only (manual run). The operator runs a baseline once, records the observed p95 numbers in `budgets.json`, then flips the workflow trigger to `pull_request` to enable the gate.
>
> This matches the build-track-owns-drafts pattern (decisions.md 2026-05-26 Day-35): drafts that need an operator-only baseline don't get auto-enabled — they ship as ready-to-trigger artefacts so the operator can flip them with one commit.

## What lives here

| File                                    | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `README.md`                             | this file                                                               |
| `events-list.js`                        | k6 script — public event landing reads + changelog reads                |
| `budgets.json`                          | per-endpoint p95 + error-rate budgets (currently scaffold placeholders) |
| `../../.github/workflows/load-test.yml` | manual-dispatch CI workflow that runs the script + checks budgets       |

## Test design

Two public-facing endpoints exercised:

1. **`GET /api/v1/public/events?status=on_sale&limit=20`** — DB-backed list; the hottest read path during ticket-sales windows
2. **`GET /api/v1/public/changelog`** — edge-cacheable static-ish read; useful as a "baseline cost of going through Nginx + Hono" measurement

Each runs as a separate scenario so the budget per endpoint is independent. The 20-req/sec target reflects MVP-scale traffic (10-20 concurrent buyers on a hot event launch); revisit at Phase 2 when revenue justifies fleet sizing.

The script does NOT:

- Hit any money-moving endpoint (`POST /orders`) — STAGING_PAYMENT_BLOCK=1 would refuse + the test would not exercise the real EPS path
- Hit any auth-gated endpoint — no auth tokens in this scaffold
- Mutate state — pure GETs only

## Budget shape (budgets.json)

```json
{
  "events_list": { "p95_ms": 0, "error_rate_pct": 0.0, "throughput_rps_target": 20 },
  "changelog": { "p95_ms": 0, "error_rate_pct": 0.0, "throughput_rps_target": 20 }
}
```

`p95_ms = 0` means "no baseline yet — fail open". The workflow has a guard that detects this and skips the assertion step with a `::warning::` annotation. Once the operator runs a baseline and updates the file with real numbers, the guard auto-disables and budgets become enforced.

CLAUDE.md §24.4 says "fail PR if p95 regresses > 20%". That maps to:

- A new p95 above `p95_ms * 1.20` → FAIL
- A new error rate above `error_rate_pct + 0.5` (50 bps absolute) → FAIL
- Throughput below `throughput_rps_target * 0.95` → FAIL

The thresholds are encoded in the workflow's check step, not in k6 itself — k6 only emits the raw measurements.

## How to baseline (operator)

```bash
# 1. Install k6 locally (or use the Docker image) — see https://k6.io/docs
brew install k6  # macOS

# 2. Run against staging
BASE_URL=https://api.staging.eventpulse.com.bd k6 run infra/load-tests/events-list.js

# 3. Read the summary block at the end:
#    Look for `http_req_duration{scenario:events_list}` p(95)
#    Look for `http_req_duration{scenario:changelog}`   p(95)
#
# 4. Update budgets.json with the observed values rounded up to the next 10ms.
#
# 5. Open a PR that updates budgets.json + flips load-test.yml's
#    `on:` block from `workflow_dispatch` to `pull_request: [main]`.
#
# 6. From the next PR onward, the load-test job runs on every PR and
#    fails if p95 regresses >20% from the baseline.
```

## When to revisit

- After the BDT-100 production smoke confirms EPS production rate
- After prod EC2 cutover (re-baseline against prod, not staging)
- At each Sprint close (§24.4 evolution discipline)
- If user-reported latency starts trending up — re-baseline + check the new budget vs the old

## Cost discipline

Per the Day-42 standing $30/month AWS cost ceiling:

- k6 runs against staging EC2 — no new AWS resources added
- Each manual run produces ~2 minutes of HTTP traffic — billable data transfer is sub-cent
- CI runners are free (GitHub-hosted)
- **Net AWS cost impact of this scaffold: $0**

## Future work (post-launch)

- Add an order-creation scenario that hits `POST /api/v1/public/orders` with `STAGING_PAYMENT_BLOCK=0` against a dedicated load-test-isolated env
- Add an attendee-check-in scenario (Sprint 4 Day 31-32 work was the gate-side hot path)
- Wire a Grafana dashboard from k6 metrics output
