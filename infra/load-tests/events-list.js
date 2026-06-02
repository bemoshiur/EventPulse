/**
 * k6 load-test script — public events + changelog reads.
 *
 * Sprint 4 Day 43 §24.4 Sprint-4-close scaffold.
 *
 * Two scenarios run concurrently for ~30 seconds at the MVP-scale target
 * (20 RPS combined, weighted 70/30 toward events vs changelog). The
 * script exercises the public read paths that survive a single-EC2 + Nginx
 * + Hono + Postgres stack at MVP scale. No money-moving endpoints, no
 * auth-gated endpoints, no state mutation.
 *
 * Run locally against staging:
 *   BASE_URL=https://api.staging.eventpulse.com.bd k6 run events-list.js
 *
 * Run against a one-off baseline target:
 *   BASE_URL=http://localhost:4000 k6 run events-list.js
 *
 * The script emits standard k6 summary output. The CI workflow at
 * .github/workflows/load-test.yml reads the summary JSON and compares
 * against budgets.json. See README.md for the operator-baseline workflow.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000'
const VERBOSE = __ENV.VERBOSE === '1'

// Per-scenario metrics. We don't reuse k6's default http_req_duration because
// we want budget assertions scoped per endpoint, not blended.
const eventsListLatency = new Trend('events_list_latency_ms', true)
const changelogLatency = new Trend('changelog_latency_ms', true)
const eventsListErrors = new Rate('events_list_error_rate')
const changelogErrors = new Rate('changelog_error_rate')

export const options = {
  scenarios: {
    events_list: {
      executor: 'constant-arrival-rate',
      rate: 14, // 14 RPS — 70% of 20 RPS combined
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'eventsList',
    },
    changelog: {
      executor: 'constant-arrival-rate',
      rate: 6, // 6 RPS — 30% of 20 RPS combined
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 5,
      maxVUs: 15,
      exec: 'changelog',
    },
  },
  // Soft thresholds — the script won't fail on these; the CI workflow
  // computes the real budget check against budgets.json after the run.
  // These are sanity-floor protections only (server obviously broken).
  thresholds: {
    events_list_error_rate: ['rate<0.10'], // <10% errors (clearly-broken)
    changelog_error_rate: ['rate<0.10'],
  },
}

export function eventsList() {
  const url = `${BASE_URL}/api/v1/public/events?status=on_sale&limit=20`
  const r = http.get(url, { tags: { scenario: 'events_list' } })
  eventsListLatency.add(r.timings.duration)
  eventsListErrors.add(r.status >= 400)
  const ok = check(r, {
    'events_list status is 2xx': (res) => res.status >= 200 && res.status < 300,
    'events_list returns data array': (res) => {
      try {
        const body = res.json()
        return Array.isArray(body.data)
      } catch {
        return false
      }
    },
  })
  if (!ok && VERBOSE) {
    console.log(`events_list FAIL status=${r.status} body=${r.body.slice(0, 200)}`)
  }
  sleep(0.05)
}

export function changelog() {
  const url = `${BASE_URL}/api/v1/public/changelog`
  const r = http.get(url, { tags: { scenario: 'changelog' } })
  changelogLatency.add(r.timings.duration)
  changelogErrors.add(r.status >= 400)
  const ok = check(r, {
    'changelog status is 2xx': (res) => res.status >= 200 && res.status < 300,
    'changelog returns data array': (res) => {
      try {
        const body = res.json()
        return Array.isArray(body.data)
      } catch {
        return false
      }
    },
  })
  if (!ok && VERBOSE) {
    console.log(`changelog FAIL status=${r.status} body=${r.body.slice(0, 200)}`)
  }
  sleep(0.05)
}

/**
 * handleSummary emits a JSON file the CI workflow's budget-check step
 * reads to compute pass/fail. Output filename is fixed for the workflow
 * to find it deterministically.
 */
export function handleSummary(data) {
  const summary = {
    base_url: BASE_URL,
    timestamp_ms: Date.now(),
    scenarios: {
      events_list: {
        p95_ms: data.metrics.events_list_latency_ms?.values?.['p(95)'] ?? null,
        p99_ms: data.metrics.events_list_latency_ms?.values?.['p(99)'] ?? null,
        median_ms: data.metrics.events_list_latency_ms?.values?.med ?? null,
        error_rate_pct: (data.metrics.events_list_error_rate?.values?.rate ?? 0) * 100,
        request_count: data.metrics.events_list_latency_ms?.values?.count ?? 0,
      },
      changelog: {
        p95_ms: data.metrics.changelog_latency_ms?.values?.['p(95)'] ?? null,
        p99_ms: data.metrics.changelog_latency_ms?.values?.['p(99)'] ?? null,
        median_ms: data.metrics.changelog_latency_ms?.values?.med ?? null,
        error_rate_pct: (data.metrics.changelog_error_rate?.values?.rate ?? 0) * 100,
        request_count: data.metrics.changelog_latency_ms?.values?.count ?? 0,
      },
    },
  }
  return {
    stdout: textSummary(data),
    'load-test-results.json': JSON.stringify(summary, null, 2),
  }
}

function textSummary(data) {
  const lines = [
    '',
    '=== Load test summary ===',
    '',
    `events_list  p95: ${fmt(data.metrics.events_list_latency_ms?.values?.['p(95)'])}ms  errors: ${pct(data.metrics.events_list_error_rate?.values?.rate)}  count: ${data.metrics.events_list_latency_ms?.values?.count ?? 0}`,
    `changelog    p95: ${fmt(data.metrics.changelog_latency_ms?.values?.['p(95)'])}ms  errors: ${pct(data.metrics.changelog_error_rate?.values?.rate)}  count: ${data.metrics.changelog_latency_ms?.values?.count ?? 0}`,
    '',
  ]
  return lines.join('\n')
}

function fmt(v) {
  if (v == null) return '-'
  return Math.round(v).toString()
}
function pct(v) {
  if (v == null) return '-'
  return `${(v * 100).toFixed(2)}%`
}
