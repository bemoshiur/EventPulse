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
cd "$APP_DIR"
git fetch --all --prune
git reset --hard "origin/$REF"
COMMIT=$(git rev-parse --short HEAD)
echo "checked out $COMMIT"

# 2) Install. Three knobs worth their own comment:
#
#   NPM_CONFIG_PRODUCTION=false: NODE_ENV=production (set by
#   .env.staging above) makes pnpm skip devDependencies by default.
#   We need devDeps for `next build` and `tsc`. The env-var form is
#   used instead of the CLI flag because pnpm's `--prod=false` parsing
#   has version-to-version drift; NPM_CONFIG_PRODUCTION is the
#   compatibility-stable knob across pnpm 8/9/10.
#
#   HUSKY=0: the root package.json `prepare` script invokes husky to
#   wire git hooks. On a server with no developer commits there's
#   nothing for husky to wire, and husky as a devDep isn't on PATH
#   before the install completes. HUSKY=0 is husky's documented "skip
#   me" env var.
#
#   --config.confirm-modules-purge=false: when the previous install
#   left node_modules in a partial state (e.g. a prior --prod install
#   then a later --prod=false), pnpm prompts "modules directories
#   will be removed and reinstalled from scratch (Y/n)". SSM commands
#   have no TTY → the prompt hangs forever. This flag auto-confirms.
HUSKY=0 NPM_CONFIG_PRODUCTION=false \
  $PNPM install --frozen-lockfile --config.confirm-modules-purge=false

# 3) Build. NODE_OPTIONS caps the V8 heap below the t3.small (2 GB) RAM
# ceiling — next build on the default heap (~1.7 GB) can OOM on a
# t3.small with PM2 + Postgres + Redis already resident. 1536 MB is the
# largest cap that leaves comfortable headroom for the rest of the
# system. Upsize the cap proportionally if the instance type ever
# changes (the production-target t3.large in §17.2 doesn't need this).
export NODE_OPTIONS="--max-old-space-size=1536"
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

# 6) Healthcheck
sleep 3
HEALTH_API="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health)"
HEALTH_WEB="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health || true)"
echo "api /health=$HEALTH_API  web /health=$HEALTH_WEB"
if [[ "$HEALTH_API" != "200" ]]; then
  echo "ERROR: api healthcheck failed (got $HEALTH_API)"
  echo "rolling back via rollback.sh"
  exec "$APP_DIR/infra/deploy/rollback.sh"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] deploy ok ref=$REF commit=$COMMIT"
