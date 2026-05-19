#!/bin/bash
#
# Event Pulse — one-time bootstrap for the staging EC2.
#
# Run AFTER:
#   - EC2 provisioned per Sprint 1 Day 3-4 (PR #42)
#   - GitHub deploy key for this server installed on the repo (read-only)
#   - SSH config at /home/eventpulse/.ssh/config points to the deploy key
#   - GitHub host fingerprint accepted (ssh -T git@github.com OK)
#   - KYC bucket + CMK provisioned via infra/scripts/setup-kyc-bucket.sh
#     (run from a developer workstation with admin AWS perms — the EC2
#     role only has operational perms, NOT KMS/S3 create perms)
#
# Run BEFORE the first invocation of infra/deploy/deploy.sh.
#
# What it does:
#   1. Bootstrap the git checkout at /home/eventpulse/app.
#   2. Fetch JWT secrets from AWS Secrets Manager (eventpulse/staging/jwt-*).
#      If they don't exist there yet, generate them, write them to Secrets
#      Manager IMMEDIATELY, and only then materialise to .env.staging.
#      Secrets Manager is the source of truth — .env.staging is a
#      derivative file. Values NEVER appear in SSM stdout, deploy logs,
#      or anywhere observable.
#      Also fetches the KYC bucket + CMK identifiers from
#      eventpulse/staging/kyc (non-secret config; same pattern). If the
#      secret is missing, .env.staging is written with empty KYC_* values
#      so KYC routes fail loudly at runtime instead of defaulting silently.
#   3. Install + symlink the Nginx vhost config from
#      infra/nginx/eventpulse-staging.conf. `nginx -t` + reload.
#   4. Set up pm2 systemd unit so the API + web survive reboot.
#
# Idempotent: re-running is safe. Each step checks current state.
# Re-running on a fresh EC2 (or after .env.staging deletion) recovers
# the original JWT secrets from Secrets Manager — no session
# invalidation as long as Secrets Manager retains them.
#
# Usage:
#   sudo /home/eventpulse/app/infra/scripts/bootstrap-staging.sh
#
# Required env (must be set by caller — no default that makes sense):
#   PG_PASSWORD             — password for the local `eventpulse` Postgres role
#
# Required IAM (on the EC2 instance role eventpulse-staging-ec2):
#   secretsmanager:GetSecretValue + DescribeSecret on eventpulse/staging/*
#   secretsmanager:CreateSecret + TagResource (with Name = eventpulse/staging/*)
#   secretsmanager:PutSecretValue + UpdateSecret on eventpulse/staging/*

set -euo pipefail

APP_DIR="/home/eventpulse/app"
ENV_FILE="/home/eventpulse/.env.staging"
NGINX_TARGET="/etc/nginx/sites-enabled/eventpulse-staging.conf"
NGINX_SOURCE="$APP_DIR/infra/nginx/eventpulse-staging.conf"
EVENTPULSE_USER="eventpulse"
EVENTPULSE_GROUP="eventpulse"
REPO_URL="git@github.com:publicpulseagency/EventPulse.git"
REF="${REF:-main}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SM_PREFIX="eventpulse/staging"
SM_JWT_ACCESS="${SM_PREFIX}/jwt-access-secret"
SM_JWT_REFRESH="${SM_PREFIX}/jwt-refresh-secret"
SM_KYC_CONFIG="${SM_PREFIX}/kyc"
SM_OAUTH_GOOGLE="${SM_PREFIX}/oauth-google"
SM_OAUTH_APPLE="${SM_PREFIX}/oauth-apple"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (use sudo). It needs to write nginx + systemd."
  exit 1
fi

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] bootstrap: $*"; }

# ─── Secrets Manager helpers ────────────────────────────────────────────
#
# Goal: JWT secret values NEVER appear in stdout, stderr, deploy logs,
# or SSM command output. The functions below pipe values to/from
# Secrets Manager via in-memory variables only; the only thing that
# gets logged is "fetched" or "created" — never the value itself.

# Fetch a secret value to stdout. Returns 0 if found, 1 if not found.
# Caller MUST capture stdout to a variable (don't `tee` or log it).
secret_get() {
  local name="$1"
  aws secretsmanager get-secret-value \
    --secret-id "$name" \
    --region "$AWS_REGION" \
    --query 'SecretString' \
    --output text 2>/dev/null
}

# Check if a secret exists (presence-only). Returns 0 if yes, 1 if no.
# Never reads the value.
secret_exists() {
  local name="$1"
  aws secretsmanager describe-secret \
    --secret-id "$name" \
    --region "$AWS_REGION" \
    --query 'Name' \
    --output text >/dev/null 2>&1
}

# Create-or-update a secret. Value passed via a 0600 temp file referenced
# with `file://`, NOT via `--secret-string "$value"` directly — the
# direct form puts the value on argv where it's visible to `ps -ef` /
# `/proc/<pid>/cmdline` while the call is in flight. The temp file is
# unlinked the moment the call returns.
secret_put() {
  local name="$1" value="$2"
  local tmp; tmp="$(mktemp -p /home/eventpulse)"
  chmod 600 "$tmp"
  printf '%s' "$value" > "$tmp"
  if secret_exists "$name"; then
    aws secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "file://${tmp}" \
      --region "$AWS_REGION" \
      --output text --query 'VersionId' >/dev/null
    log "  secrets-manager: updated $name"
  else
    aws secretsmanager create-secret \
      --name "$name" \
      --secret-string "file://${tmp}" \
      --description "Event Pulse staging — managed by bootstrap-staging.sh" \
      --tags Key=managed-by,Value=bootstrap-staging.sh Key=env,Value=staging \
      --region "$AWS_REGION" \
      --output text --query 'Name' >/dev/null
    log "  secrets-manager: created $name"
  fi
  rm -f "$tmp"
}

# ─── 0) Postgres superuser prep — must run BEFORE migration 0001 ─────
#
# The migration runner connects as the non-superuser `eventpulse` role.
# That role can CREATE ROLE (it has CREATEROLE on staging) but it CANNOT
# `GRANT eventpulse_app TO CURRENT_USER WITH ADMIN OPTION` for a role it
# just created — Postgres requires ADMIN OPTION on the target role, and
# the creator does NOT automatically get ADMIN OPTION (PG 16 semantics).
# This caught us during Sprint 2 Day 11 Item 5 (8 deploy attempts; one
# of the operator fixes was running this manually as `postgres` via psql).
# See `.claude/memory/gotchas.md` "Postgres `eventpulse` user lacks
# ADMIN OPTION → migration 0001 GRANT fails".
#
# The fix has to happen as the `postgres` superuser, via local socket.
# This step is idempotent: re-running just re-applies grants that already
# exist (Postgres treats re-granting as a no-op).
#
# Additionally, on a fresh EC2 the public-schema tables that already
# exist (from a manual setup or a prior bootstrap) need eventpulse
# ownership so the migration runner can ALTER them. This is the
# ownership half of the carry from Day 11 (gotchas.md "Postgres tables
# pre-existed without migration history").

log "step 0: Postgres superuser prep"
sudo -u postgres /usr/lib/postgresql/16/bin/psql -d eventpulse_staging -v ON_ERROR_STOP=1 <<'PGEOF'
-- Idempotent role creation. Migration 0001 also has this guard, but
-- doing it here as superuser means the WITH ADMIN OPTION grant below
-- can land BEFORE migration 0001 ever runs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eventpulse_app') THEN
    CREATE ROLE eventpulse_app WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eventpulse_admin') THEN
    CREATE ROLE eventpulse_admin WITH NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- WITH ADMIN OPTION so the migration runner can re-issue the GRANTs
-- (no-op when already granted, but errors without ADMIN OPTION).
GRANT eventpulse_app   TO eventpulse WITH ADMIN OPTION;
GRANT eventpulse_admin TO eventpulse WITH ADMIN OPTION;

-- Reassign ownership of any pre-existing public-schema tables that are
-- still owned by `postgres` (typical of out-of-band manual setup).
-- Tables owned by eventpulse are skipped. Required for migrations that
-- ALTER TABLE / CREATE POLICY against existing tables (only the table
-- owner can do that, regardless of GRANT level). This was discovered
-- during Sprint 2 Day 11 Item 5 deploy attempt 7. Idempotent — if the
-- table is already eventpulse-owned the ALTER is a no-op.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tableowner = 'postgres'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO eventpulse', t.schemaname, t.tablename);
  END LOOP;
END
$$;
PGEOF
log "  postgres prep complete (roles, ADMIN OPTION, ownership)"

# ─── 1) git checkout ────────────────────────────────────────────────────

log "step 1: git checkout"
if [[ -d "$APP_DIR/.git" ]]; then
  log "  $APP_DIR is already a git checkout — fetching + resetting to $REF"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" fetch --all --prune
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" reset --hard "origin/$REF"
else
  log "  initialising fresh checkout at $APP_DIR"
  sudo -u "$EVENTPULSE_USER" mkdir -p "$APP_DIR"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" init
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" remote add origin "$REPO_URL"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" fetch origin "$REF"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" reset --hard "origin/$REF"
fi
sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" config --local pull.ff only
COMMIT=$(sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" rev-parse --short HEAD)
log "  checked out $COMMIT"

# ─── 2) .env.staging ────────────────────────────────────────────────────

log "step 2: JWT secrets + .env.staging"
: "${PG_PASSWORD:?must be set in caller env (eventpulse Postgres role password)}"

# Fetch-or-create the JWT secrets in Secrets Manager. Order matters:
# Secrets Manager is the source of truth, .env.staging is derivative.
# Re-running this script on a fresh EC2 (or after .env.staging deletion)
# re-uses the existing secrets — sessions stay valid.
JWT_ACCESS_SECRET=""
JWT_REFRESH_SECRET=""

if secret_exists "$SM_JWT_ACCESS"; then
  log "  fetching $SM_JWT_ACCESS from Secrets Manager"
  JWT_ACCESS_SECRET="$(secret_get "$SM_JWT_ACCESS")"
else
  log "  generating new $SM_JWT_ACCESS"
  JWT_ACCESS_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"
  secret_put "$SM_JWT_ACCESS" "$JWT_ACCESS_SECRET"
fi

if secret_exists "$SM_JWT_REFRESH"; then
  log "  fetching $SM_JWT_REFRESH from Secrets Manager"
  JWT_REFRESH_SECRET="$(secret_get "$SM_JWT_REFRESH")"
else
  log "  generating new $SM_JWT_REFRESH"
  JWT_REFRESH_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"
  secret_put "$SM_JWT_REFRESH" "$JWT_REFRESH_SECRET"
fi

# KYC bucket + CMK identifiers (non-secret, but canonical in Secrets
# Manager so a fresh EC2 reads the same shape JWT secrets do). Created
# upstream by `infra/scripts/setup-kyc-bucket.sh` from a developer
# workstation — the EC2 instance role does NOT have KMS/S3 create perms.
KYC_BUCKET_NAME=""
KYC_KMS_KEY_ID=""
KYC_KMS_KEY_ARN=""
KYC_KMS_KEY_ALIAS=""

if secret_exists "$SM_KYC_CONFIG"; then
  log "  fetching $SM_KYC_CONFIG from Secrets Manager"
  KYC_CONFIG_JSON="$(secret_get "$SM_KYC_CONFIG")"
  # One python3 invocation, four newline-separated values read into bash —
  # avoids spawning four subprocesses and avoids eval (defence vs. shell
  # metachars in values, even though AWS bucket/key identifiers are safe ASCII).
  { read -r KYC_BUCKET_NAME
    read -r KYC_KMS_KEY_ID
    read -r KYC_KMS_KEY_ARN
    read -r KYC_KMS_KEY_ALIAS
  } < <(printf '%s' "$KYC_CONFIG_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in ("bucket_name", "kms_key_id", "kms_key_arn", "kms_key_alias"):
    print(d[k])
')
  unset KYC_CONFIG_JSON
  log "  KYC config materialised (bucket=$KYC_BUCKET_NAME, alias=$KYC_KMS_KEY_ALIAS)"
else
  log "  WARN: $SM_KYC_CONFIG missing — KYC upload code will fail at runtime."
  log "        Run infra/scripts/setup-kyc-bucket.sh from a workstation with admin AWS perms first."
fi

# OAuth secrets (Day 20). Two JSON-shaped secrets:
#   eventpulse/staging/oauth-google : {"client_id": "...", "client_secret": "..."}
#   eventpulse/staging/oauth-apple  : {"client_id": "...", "team_id": "...",
#                                       "key_id": "...", "private_key": "..."}
#
# Created by a developer with admin AWS perms via `aws secretsmanager
# create-secret` after the Google Cloud / Apple Developer credentials are
# obtained — credentials NEVER come from this script. If a secret is
# missing, the matching env vars are left unset; the API's `start` route
# returns 503 OAUTH_NOT_CONFIGURED cleanly per
# `apps/api/src/auth/oauth.ts isOAuthProviderConfigured()`.
GOOGLE_OAUTH_CLIENT_ID=""
GOOGLE_OAUTH_CLIENT_SECRET=""
APPLE_OAUTH_CLIENT_ID=""
APPLE_OAUTH_TEAM_ID=""
APPLE_OAUTH_KEY_ID=""
APPLE_OAUTH_PRIVATE_KEY=""

if secret_exists "$SM_OAUTH_GOOGLE"; then
  log "  fetching $SM_OAUTH_GOOGLE from Secrets Manager"
  OAUTH_GOOGLE_JSON="$(secret_get "$SM_OAUTH_GOOGLE")"
  { read -r GOOGLE_OAUTH_CLIENT_ID
    read -r GOOGLE_OAUTH_CLIENT_SECRET
  } < <(printf '%s' "$OAUTH_GOOGLE_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in ("client_id", "client_secret"):
    print(d.get(k, ""))
')
  unset OAUTH_GOOGLE_JSON
  log "  Google OAuth materialised (client_id=${GOOGLE_OAUTH_CLIENT_ID:0:12}…)"
else
  log "  INFO: $SM_OAUTH_GOOGLE missing — Google sign-in will return 503 OAUTH_NOT_CONFIGURED."
  log "        Populate via: aws secretsmanager create-secret --name $SM_OAUTH_GOOGLE \\"
  log "                        --secret-string '{\"client_id\":\"...\",\"client_secret\":\"...\"}'"
fi

if secret_exists "$SM_OAUTH_APPLE"; then
  log "  fetching $SM_OAUTH_APPLE from Secrets Manager"
  OAUTH_APPLE_JSON="$(secret_get "$SM_OAUTH_APPLE")"
  # Apple's `private_key` is a PEM with embedded newlines; python's json
  # round-trips them as `\n` in the wire format and back to literal
  # newlines in the parsed value. We base64 the value on its way through
  # the bash boundary to keep embedded newlines from corrupting the
  # `read` reader, then base64 -d on the consumer side at API boot.
  { read -r APPLE_OAUTH_CLIENT_ID
    read -r APPLE_OAUTH_TEAM_ID
    read -r APPLE_OAUTH_KEY_ID
    read -r APPLE_OAUTH_PRIVATE_KEY
  } < <(printf '%s' "$OAUTH_APPLE_JSON" | python3 -c '
import json, sys, base64
d = json.load(sys.stdin)
print(d.get("client_id", ""))
print(d.get("team_id", ""))
print(d.get("key_id", ""))
# Encode the multi-line PEM as base64 to survive the bash boundary;
# decoded back on the API side via Buffer.from(env, "base64").toString().
pk = d.get("private_key", "")
print(base64.b64encode(pk.encode("utf-8")).decode("ascii") if pk else "")
')
  unset OAUTH_APPLE_JSON
  log "  Apple OAuth materialised (client_id=${APPLE_OAUTH_CLIENT_ID})"
else
  log "  INFO: $SM_OAUTH_APPLE missing — Apple sign-in will return 503 OAUTH_NOT_CONFIGURED."
  log "        Populate via: aws secretsmanager create-secret --name $SM_OAUTH_APPLE \\"
  log "                        --secret-string '{\"client_id\":\"...\",\"team_id\":\"...\",\"key_id\":\"...\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\\\n...\"}'"
fi

# Sanity check — non-empty, ≥ 32 chars (jwt.ts secret() enforces this).
if [[ -z "$JWT_ACCESS_SECRET" || ${#JWT_ACCESS_SECRET} -lt 32 ]]; then
  log "ERROR: JWT_ACCESS_SECRET empty or too short"; exit 1
fi
if [[ -z "$JWT_REFRESH_SECRET" || ${#JWT_REFRESH_SECRET} -lt 32 ]]; then
  log "ERROR: JWT_REFRESH_SECRET empty or too short"; exit 1
fi

# Materialise .env.staging from in-memory values. Atomic write (umask
# 077 + mv) so a partial write never leaves a world-readable file.
log "  writing $ENV_FILE"
TMP_ENV="$(mktemp -p /home/eventpulse --suffix=.env.staging)"
chmod 600 "$TMP_ENV"
cat > "$TMP_ENV" <<EOF
# Event Pulse — staging environment file.
# Owner: eventpulse:eventpulse, chmod 600. NEVER commit.
# Generated by infra/scripts/bootstrap-staging.sh from Secrets Manager.

NODE_ENV=production

# Postgres — local cluster, eventpulse role per Sprint 1 Day 3-4
DATABASE_URL=postgresql://eventpulse:${PG_PASSWORD}@localhost:5432/eventpulse_staging

# Redis — local
REDIS_URL=redis://localhost:6379

# JWT — sourced from $SM_PREFIX in Secrets Manager
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# OAuth — sourced from \$SM_OAUTH_GOOGLE + \$SM_OAUTH_APPLE in Secrets
# Manager. Empty values are fine: \`isOAuthProviderConfigured()\` in the
# API turns the corresponding \`start\` route into a clean 503
# OAUTH_NOT_CONFIGURED response (no crash). Other auth routes
# (password/login, magic-link/*) are unaffected by OAuth absence.
#
# APPLE_OAUTH_PRIVATE_KEY is base64-encoded here (Apple's PEM has
# multi-line newlines that don't survive a flat env file); the API
# auto-decodes both forms.
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}
GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}
APPLE_OAUTH_CLIENT_ID=${APPLE_OAUTH_CLIENT_ID}
APPLE_OAUTH_TEAM_ID=${APPLE_OAUTH_TEAM_ID}
APPLE_OAUTH_KEY_ID=${APPLE_OAUTH_KEY_ID}
APPLE_OAUTH_PRIVATE_KEY=${APPLE_OAUTH_PRIVATE_KEY}

# Email — staging stays in dry-run until SES sandbox-exit lands.
MAIL_DRY_RUN=1
SES_FROM_ADDRESS=no-reply@eventpulse.com.bd

# Base URLs
EVENTPULSE_API_BASE_URL=https://api.staging.eventpulse.com.bd
EVENTPULSE_WEB_BASE_URL=https://staging.eventpulse.com.bd

# KYC documents bucket — sourced from $SM_KYC_CONFIG in Secrets Manager.
# Empty values mean setup-kyc-bucket.sh has not been run yet; KYC upload
# routes will fail at runtime (intentional — fail loudly, never default).
KYC_BUCKET_NAME=${KYC_BUCKET_NAME}
KYC_KMS_KEY_ID=${KYC_KMS_KEY_ID}
KYC_KMS_KEY_ARN=${KYC_KMS_KEY_ARN}
KYC_KMS_KEY_ALIAS=${KYC_KMS_KEY_ALIAS}
EOF
mv "$TMP_ENV" "$ENV_FILE"
chown "$EVENTPULSE_USER:$EVENTPULSE_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
# Clear in-memory secrets from this shell — defence in depth even though
# the shell exits right after. KYC_* values are non-secret (bucket name +
# key ARN) but unset for cleanliness.
unset JWT_ACCESS_SECRET JWT_REFRESH_SECRET PG_PASSWORD \
      KYC_BUCKET_NAME KYC_KMS_KEY_ID KYC_KMS_KEY_ARN KYC_KMS_KEY_ALIAS \
      GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET \
      APPLE_OAUTH_CLIENT_ID APPLE_OAUTH_TEAM_ID APPLE_OAUTH_KEY_ID APPLE_OAUTH_PRIVATE_KEY
log "  $ENV_FILE written (chmod 600 owner $EVENTPULSE_USER:$EVENTPULSE_GROUP)"
log "  verify Secrets Manager presence: aws secretsmanager describe-secret --secret-id $SM_JWT_ACCESS"
log "  verify Secrets Manager presence: aws secretsmanager describe-secret --secret-id $SM_JWT_REFRESH"
log "  verify Secrets Manager presence: aws secretsmanager describe-secret --secret-id $SM_KYC_CONFIG"

# ─── 3) Nginx vhost ─────────────────────────────────────────────────────

log "step 3: Nginx vhost"
if [[ ! -f "$NGINX_SOURCE" ]]; then
  log "  ERROR: $NGINX_SOURCE missing (repo checkout out of date?)"
  exit 1
fi
# Replace any prior vhost (placeholder from Sprint 1 Day 3-4 or older
# version of this file). Symlink lets future `git pull` propagate
# config changes via the same path.
ln -sf "$NGINX_SOURCE" "$NGINX_TARGET"
# Ensure ep-security-headers snippet exists (it does post-Sprint 1 Day 3-4)
if [[ ! -f /etc/nginx/snippets/ep-security-headers.conf ]]; then
  log "  warn: /etc/nginx/snippets/ep-security-headers.conf missing — creating minimal stub"
  mkdir -p /etc/nginx/snippets
  cat > /etc/nginx/snippets/ep-security-headers.conf <<EOF
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF
fi
nginx -t
systemctl reload nginx
log "  nginx config loaded + reloaded"

# ─── 4) pm2 systemd ─────────────────────────────────────────────────────

log "step 4: pm2 systemd unit"
PM2_SERVICE_FILE="/etc/systemd/system/pm2-${EVENTPULSE_USER}.service"
if [[ -f "$PM2_SERVICE_FILE" ]]; then
  log "  pm2 systemd unit already present"
else
  # `pm2 startup` emits a systemctl command for the appropriate init
  # system; we capture its suggested command and run it. Idempotent.
  STARTUP_CMD=$(sudo -u "$EVENTPULSE_USER" /usr/bin/pm2 startup systemd -u "$EVENTPULSE_USER" --hp "/home/$EVENTPULSE_USER" 2>&1 \
    | grep -E '^sudo env' | head -1 || true)
  if [[ -n "$STARTUP_CMD" ]]; then
    log "  running: $STARTUP_CMD"
    bash -c "$STARTUP_CMD"
  else
    log "  could not derive pm2 startup command from pm2 output — manual setup needed"
  fi
fi

log "bootstrap complete. Next:"
log "  sudo -u $EVENTPULSE_USER $APP_DIR/infra/deploy/deploy.sh main"
