#!/bin/bash
#
# Event Pulse — deploy.sh
#
# Runs on the EC2 instance under user `eventpulse`. Triggered by CI via
# `aws ssm send-command` (no SSH key; OIDC + SSM only per the
# 2026-05-17 SSM-only decision in decisions.md).
#
# Steps:
#   1. Fetch + checkout the requested ref into /home/eventpulse/app
#   2. pnpm install --frozen-lockfile
#   3. Build web + api
#   4. Apply DB migrations
#   5. Reload PM2 (zero-downtime)
#   6. Health-check the API on localhost
#
# Usage (on the EC2):
#   sudo -u eventpulse /home/eventpulse/app/infra/deploy/deploy.sh <git-ref>
#
# Usage (from CI):
#   aws ssm send-command \
#     --document-name AWS-RunShellScript \
#     --instance-ids $INSTANCE_ID \
#     --parameters commands='["sudo -u eventpulse bash -lc \"/home/eventpulse/app/infra/deploy/deploy.sh $REF\""]'
#
set -euo pipefail

REF="${1:-main}"
APP_DIR="/home/eventpulse/app"
PM2="/usr/bin/pm2"
PNPM="/usr/bin/pnpm"
LOG_DIR="/home/eventpulse/logs"
DEPLOY_LOG="$LOG_DIR/deploy.log"
ENV_FILE="/home/eventpulse/.env.staging"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$DEPLOY_LOG") 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] deploy start ref=$REF"

# 0) Source env file. Required for DATABASE_URL, JWT_*, REDIS_URL etc.
# Bootstrap (one-time) writes this file via infra/scripts/bootstrap-staging.sh.
# If it's missing, fail loudly BEFORE running pnpm — much clearer than a
# midway db:migrate "DATABASE_URL not set" error.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run infra/scripts/bootstrap-staging.sh first."
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# 1) Fetch
#
# REF can be either a branch name ("main") or a 40-char commit SHA — the
# CI workflow passes ${{ github.sha }} which is always a SHA, while
# manual invocations from a runbook typically pass "main". Resolve in
# precedence order:
#   1. origin/<REF> — works when REF is a branch name
#   2. <REF> directly — works when REF is a SHA already fetched
# If neither resolves, fail loud rather than silently checking out the
# wrong commit.
cd "$APP_DIR"
git fetch --all --prune
if TARGET="$(git rev-parse --verify "origin/$REF" 2>/dev/null)"; then
  :
elif TARGET="$(git rev-parse --verify "$REF" 2>/dev/null)"; then
  :
else
  echo "ERROR: ref '$REF' does not resolve to any local-fetched commit (tried 'origin/$REF' and '$REF')"
  exit 1
fi
git reset --hard "$TARGET"
COMMIT=$(git rev-parse --short HEAD)
echo "checked out $COMMIT (from ref=$REF)"

# 2) Install. Three knobs worth their own comment:
#
#   NODE_ENV=development: .env.staging sets NODE_ENV=production (correct
#   for runtime). pnpm v9 reads NODE_ENV directly and skips devDeps
#   when it's "production" — NEITHER `--prod=false` (deploy attempt 2)
#   NOR `NPM_CONFIG_PRODUCTION=false` (deploy attempt 3) overrides it
#   in pnpm v9.x; the only reliable knob is NODE_ENV itself. We override
#   for the install command only — every step after this sources
#   .env.staging again (well, kept in the parent shell) so NODE_ENV
#   stays = production at pm2 reload time.
#
#   HUSKY=0: the root package.json `prepare` script invokes husky to
#   wire git hooks. On a server with no developer commits there's
#   nothing for husky to wire, and husky as a devDep isn't on PATH
#   before the install completes. HUSKY=0 is husky's documented "skip
#   me" env var.
#
#   --config.confirm-modules-purge=false: when the previous install
#   left node_modules in a partial state (e.g. a prior --prod install
#   then a later one that needs devDeps), pnpm prompts "modules
#   directories will be removed and reinstalled from scratch (Y/n)".
#   SSM commands have no TTY → the prompt hangs forever. This flag
#   auto-confirms.
HUSKY=0 NODE_ENV=development \
  $PNPM install --frozen-lockfile --config.confirm-modules-purge=false
# Restore NODE_ENV from env file for the rest of the deploy (build +
# migrate + pm2 reload all see production again).
NODE_ENV=production
export NODE_ENV

# 3) Build. NODE_OPTIONS caps the V8 heap below the t3.small (2 GB) RAM
# ceiling — next build on the default heap (~1.7 GB) can OOM on a
# t3.small with PM2 + Postgres + Redis already resident. 1536 MB is the
# largest cap that leaves comfortable headroom for the rest of the
# system. Upsize the cap proportionally if the instance type ever
# changes (the production-target t3.large in §17.2 doesn't need this).
export NODE_OPTIONS="--max-old-space-size=1536"
# Build workspace deps BEFORE apps/api + apps/web. @eventpulse/shared-types
# went from source-shipping to a real tsc build at the Day 21 verification
# retry (decisions.md "shared-types real tsc build" 2026-05-19); apps/api
# consumes from packages/shared-types/dist/. Without this step, apps/api
# crashes at runtime with ERR_MODULE_NOT_FOUND for shared-types/dist/index.js.
$PNPM --filter @eventpulse/shared-types build
$PNPM --filter @eventpulse/web build
$PNPM --filter @eventpulse/api build
unset NODE_OPTIONS

# 4) Migrate
$PNPM --filter @eventpulse/api db:migrate

# 5) Reload PM2 (graceful)
if $PM2 describe web >/dev/null 2>&1; then
  $PM2 reload "$APP_DIR/pm2/ecosystem.config.cjs" --update-env
else
  $PM2 start "$APP_DIR/pm2/ecosystem.config.cjs"
fi
$PM2 save

# 6) Healthcheck — retry loop with explicit failure capture.
#
# The previous shape (single curl with set -euo pipefail) had a race:
# `pm2 reload` returns before the new process has bound to :4000, the
# next `curl` exits with code 7 (connection refused), set -e aborts the
# script BEFORE reaching the if-block + rollback.sh exec — so rollback
# never fired and the script reported failure even when the new code
# was live. This loop is the load-bearing fix.
#
# The `|| echo "000"` is non-negotiable. Without it, set -e re-asserts
# its abort behaviour on curl's non-zero exit and the retry never gets
# a chance to run.
#
# Total wait: 5 attempts × 3s = 15s. Plenty for `pm2 reload` to cycle
# the api process on t3.small. If the api isn't responding 200 after
# 15s of retries, rollback fires for real.
HEALTH_API="000"
for attempt in 1 2 3 4 5; do
  sleep 3
  HEALTH_API="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health || echo "000")"
  echo "  healthcheck attempt $attempt: api /health=$HEALTH_API"
  if [[ "$HEALTH_API" == "200" ]]; then
    break
  fi
done
HEALTH_WEB="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health || echo "000")"
echo "final: api /health=$HEALTH_API  web /health=$HEALTH_WEB"
if [[ "$HEALTH_API" != "200" ]]; then
  echo "ERROR: api healthcheck failed after 5 attempts (got $HEALTH_API)"
  echo "rolling back via rollback.sh"
  exec "$APP_DIR/infra/deploy/rollback.sh"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] deploy ok ref=$REF commit=$COMMIT"
