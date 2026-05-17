#!/bin/bash
#
# Event Pulse — rollback.sh
#
# Reverts to the previous git commit + reloads PM2. PM2 keeps the
# last-running version of each app in memory for graceful rollback, so
# a `pm2 reload` against the rolled-back checkout takes effect in <30s.
#
# Migrations are NOT auto-reverted — Drizzle migrations are
# forward-only; backward-compat windows are enforced at PR review per
# CLAUDE.md §18.4. If a deploy broke because of a migration, the
# operator follows the runbook (drop + recreate from backup, or write
# a corrective forward migration).
#
# Usage:
#   sudo -u eventpulse /home/eventpulse/app/infra/deploy/rollback.sh [git-ref]
#
# Defaults to HEAD~1.

set -euo pipefail

REF="${1:-HEAD~1}"
APP_DIR="/home/eventpulse/app"
PM2="/usr/bin/pm2"
LOG_DIR="/home/eventpulse/logs"
DEPLOY_LOG="$LOG_DIR/deploy.log"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$DEPLOY_LOG") 2>&1
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] rollback start to=$REF"

cd "$APP_DIR"
TARGET=$(git rev-parse --short "$REF")
git reset --hard "$REF"
echo "rolled back to $TARGET"

# Reinstall (last-deployed lockfile) + rebuild. Knobs match deploy.sh —
# rationale documented there (NODE_ENV=development for the install only;
# back to production for everything after; HUSKY=0; auto-confirm purge).
# Heap cap matches deploy.sh — same OOM-on-t3.small concern.
HUSKY=0 NODE_ENV=development \
  /usr/bin/pnpm install --frozen-lockfile --config.confirm-modules-purge=false
NODE_ENV=production
export NODE_ENV
export NODE_OPTIONS="--max-old-space-size=1536"
/usr/bin/pnpm --filter @eventpulse/web build
/usr/bin/pnpm --filter @eventpulse/api build
unset NODE_OPTIONS

$PM2 reload "$APP_DIR/pm2/ecosystem.config.cjs" --update-env

sleep 3
HEALTH_API="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health)"
echo "post-rollback api /health=$HEALTH_API"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] rollback ok at=$TARGET"
