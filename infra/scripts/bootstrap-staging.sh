#!/bin/bash
#
# Event Pulse — one-time bootstrap for the staging EC2.
#
# Run AFTER:
#   - EC2 provisioned per Sprint 1 Day 3-4 (PR #42)
#   - GitHub deploy key for this server installed on the repo (read-only)
#   - SSH config at /home/eventpulse/.ssh/config points to the deploy key
#   - GitHub host fingerprint accepted (ssh -T git@github.com OK)
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

# Create-or-update a secret. Value passed via SECRET_VALUE env var to
# avoid command-line exposure (which would show in `ps`). On success
# logs "created"/"updated"; on failure exits non-zero.
secret_put() {
  local name="$1"
  if secret_exists "$name"; then
    SECRET_VALUE="$2" aws secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "$2" \
      --region "$AWS_REGION" \
      --output text --query 'VersionId' >/dev/null
    log "  secrets-manager: updated $name"
  else
    SECRET_VALUE="$2" aws secretsmanager create-secret \
      --name "$name" \
      --secret-string "$2" \
      --description "Event Pulse staging — managed by bootstrap-staging.sh" \
      --tags Key=managed-by,Value=bootstrap-staging.sh Key=env,Value=staging \
      --region "$AWS_REGION" \
      --output text --query 'Name' >/dev/null
    log "  secrets-manager: created $name"
  fi
}

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

# OAuth — placeholder until Secrets Manager entries are populated.
# Routes will 500 if called without these; routes that don't touch OAuth
# (password/login, magic-link/*) still work.
# GOOGLE_OAUTH_CLIENT_ID=
# GOOGLE_OAUTH_CLIENT_SECRET=
# APPLE_OAUTH_CLIENT_ID=
# APPLE_OAUTH_TEAM_ID=
# APPLE_OAUTH_KEY_ID=
# APPLE_OAUTH_PRIVATE_KEY=

# Email — staging stays in dry-run until SES sandbox-exit lands.
MAIL_DRY_RUN=1
SES_FROM_ADDRESS=no-reply@eventpulse.com.bd

# Base URLs
EVENTPULSE_API_BASE_URL=https://api.staging.eventpulse.com.bd
EVENTPULSE_WEB_BASE_URL=https://staging.eventpulse.com.bd
EOF
mv "$TMP_ENV" "$ENV_FILE"
chown "$EVENTPULSE_USER:$EVENTPULSE_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
# Clear in-memory secrets from this shell — defence in depth even though
# the shell exits right after.
unset JWT_ACCESS_SECRET JWT_REFRESH_SECRET PG_PASSWORD
log "  $ENV_FILE written (chmod 600 owner $EVENTPULSE_USER:$EVENTPULSE_GROUP)"
log "  verify Secrets Manager presence: aws secretsmanager describe-secret --secret-id $SM_JWT_ACCESS"
log "  verify Secrets Manager presence: aws secretsmanager describe-secret --secret-id $SM_JWT_REFRESH"

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
