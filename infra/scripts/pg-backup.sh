#!/bin/bash
#
# Event Pulse — nightly logical Postgres backup to S3 (§17.10).
#
# Installed at /usr/local/bin/eventpulse-pg-backup.sh on the EC2 and invoked by
# a root cron at 19:00 UTC (= 01:00 BDT). Env-aware via /home/eventpulse/.eventpulse-env
# (the same marker deploy.sh reads): writes to `eventpulse-<env>-backups`, which has
# default SSE-KMS (general CMK) + a 90-day expiry lifecycle. The EC2 instance role
# supplies S3 PutObject (S3ProdBuckets: eventpulse-prod-*) + KMS GenerateDataKey
# (KmsEnvelopeEncryption on the general CMK) — no extra creds needed.
#
# Restore:  aws s3 cp s3://eventpulse-prod-backups/postgres/YYYY/MM/DD/HHMMSS.sql.gz - \
#             | gunzip | sudo -u postgres psql -d eventpulse_prod
#
# This covers LOGICAL (pg_dump) backups. WAL archiving / PITR + EBS snapshots are
# separate layers (tracked follow-ups per §17.10).
#
# Idempotent to install; safe to run ad-hoc for an immediate backup.

set -euo pipefail

# The .eventpulse-env marker holds the env-FILE name ("production"|"staging"),
# but DB + bucket names use the short resource suffix ("prod"|"staging") — the
# recurring prod/production split (also bit the OIDC trust + setup scripts). Map it.
MARKER="$(cat /home/eventpulse/.eventpulse-env 2>/dev/null || echo staging)"
case "$MARKER" in
  production) ENV=prod ;;
  *)          ENV="$MARKER" ;;
esac
DB="eventpulse_${ENV}"
BUCKET="eventpulse-${ENV}-backups"
REGION="${AWS_REGION:-ap-southeast-1}"
KEY="postgres/$(date -u +%Y/%m/%d/%H%M%S).sql.gz"
LOGDIR=/home/eventpulse/logs
mkdir -p "$LOGDIR"
LOG="$LOGDIR/pg-backup.log"

{
  echo "[$(date -u +%FT%TZ)] start env=$ENV db=$DB -> s3://$BUCKET/$KEY"
  set -o pipefail
  if sudo -u postgres pg_dump --no-owner --no-privileges "$DB" \
       | gzip -9 \
       | aws s3 cp - "s3://${BUCKET}/${KEY}" --region "$REGION" --only-show-errors; then
    SZ="$(aws s3api head-object --bucket "$BUCKET" --key "$KEY" --region "$REGION" \
            --query ContentLength --output text 2>/dev/null || echo '?')"
    echo "[$(date -u +%FT%TZ)] OK -> s3://$BUCKET/$KEY (${SZ} bytes)"
  else
    rc=$?
    echo "[$(date -u +%FT%TZ)] FAILED (exit $rc)"
    exit "$rc"
  fi
} >>"$LOG" 2>&1
