#!/bin/bash
#
# Event Pulse — one-time app bootstrap for the PRODUCTION EC2.
#
# Prod analog of bootstrap-staging.sh. Run AFTER provision-prod.sh has set
# up the OS stack + Postgres roles/DB + the eventpulse/prod/database secret.
#
# Differences from bootstrap-staging.sh (everything else is identical
# discipline — Secrets Manager is the source of truth, values never hit
# stdout/SSM logs, atomic 0600 env write, fail-loud validation):
#   - REPO_URL uses the CURRENT org (The-Public-Pulse-Agency), NOT the old
#     publicpulseagency that staging's script still hardcodes.
#   - Secrets prefix is eventpulse/prod (not eventpulse/staging).
#   - Writes /home/eventpulse/.env.production + the /home/eventpulse/.eventpulse-env
#     marker (="production") that deploy.sh reads to pick the env file.
#   - DATABASE_URL is built from the eventpulse/prod/database secret that
#     provision-prod.sh created (NOT a PG_PASSWORD caller env var).
#   - Base URLs are the production hostnames (api.eventpulse.com.bd / eventpulse.com.bd).
#   - MAIL_DRY_RUN=1 + STAGING_PAYMENT_BLOCK=1 are the SAFE BOOT DEFAULTS.
#     * MAIL_DRY_RUN flips to 0 as a sub-step of Phase 4 prod SNS wiring.
#     * STAGING_PAYMENT_BLOCK (legacy name; the EPS wrapper guard is
#       env-agnostic) stays =1 so a freshly-cut-over prod box cannot charge
#       a real card until the operator deliberately lifts it for the BDT-100
#       smoke and then go-live (launch-readiness.md §4). DNS isn't pointed
#       at prod until cutover, so there's no public traffic before then —
#       this is defence-in-depth, not the only gate.
#   - Swap is NOT handled here (provision-prod.sh owns it).
#
# Required IAM on the eventpulse-prod-ec2 instance role (cutover #1c), scoped
# to eventpulse/prod/*: GetSecretValue + DescribeSecret + CreateSecret +
# PutSecretValue + TagResource.
#
# Usage:  sudo /home/eventpulse/app/infra/scripts/bootstrap-prod.sh

set -euo pipefail

APP_DIR="/home/eventpulse/app"
ENV_FILE="/home/eventpulse/.env.production"
ENV_MARKER="/home/eventpulse/.eventpulse-env"
NGINX_TARGET="/etc/nginx/sites-enabled/eventpulse-prod.conf"
NGINX_SOURCE="$APP_DIR/infra/nginx/eventpulse-prod.conf"
EVENTPULSE_USER="eventpulse"
EVENTPULSE_GROUP="eventpulse"
REPO_URL="git@github.com:The-Public-Pulse-Agency/EventPulse.git"
REF="${REF:-main}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SM_PREFIX="eventpulse/prod"
SM_DATABASE="${SM_PREFIX}/database"
SM_JWT_ACCESS="${SM_PREFIX}/jwt-access-secret"
SM_JWT_REFRESH="${SM_PREFIX}/jwt-refresh-secret"
SM_KYC_CONFIG="${SM_PREFIX}/kyc"
SM_OAUTH_GOOGLE="${SM_PREFIX}/oauth-google"
SM_OAUTH_APPLE="${SM_PREFIX}/oauth-apple"
SM_EPS="${SM_PREFIX}/eps"
SM_POROCHOY="${SM_PREFIX}/porichoy"
DB_NAME="eventpulse_prod"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (use sudo). It writes nginx + systemd + .env." >&2
  exit 1
fi

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] bootstrap-prod: $*"; }

# ─── Secrets Manager helpers (identical to staging) ──────────────────────
secret_get() {
  aws secretsmanager get-secret-value --secret-id "$1" \
    --region "$AWS_REGION" --query 'SecretString' --output text 2>/dev/null
}
secret_exists() {
  aws secretsmanager describe-secret --secret-id "$1" \
    --region "$AWS_REGION" --query 'Name' --output text >/dev/null 2>&1
}
secret_put() {
  local name="$1" value="$2" tmp
  tmp="$(mktemp -p /home/eventpulse)"; chmod 600 "$tmp"
  printf '%s' "$value" > "$tmp"
  if secret_exists "$name"; then
    aws secretsmanager put-secret-value --secret-id "$name" \
      --secret-string "file://${tmp}" --region "$AWS_REGION" \
      --output text --query 'VersionId' >/dev/null
    log "  secrets-manager: updated $name"
  else
    aws secretsmanager create-secret --name "$name" \
      --secret-string "file://${tmp}" \
      --description "Event Pulse production — managed by bootstrap-prod.sh" \
      --tags Key=managed-by,Value=bootstrap-prod.sh Key=env,Value=production \
      --region "$AWS_REGION" --output text --query 'Name' >/dev/null
    log "  secrets-manager: created $name"
  fi
  rm -f "$tmp"
}

# ─── 0) Postgres superuser prep (idempotent; defence-in-depth) ───────────
# provision-prod.sh already created the roles + the WITH ADMIN OPTION grant.
# This re-asserts them (no-op if present) and reassigns any postgres-owned
# public tables — a no-op on a fresh prod DB, kept for parity with staging.
log "step 0: postgres prep on $DB_NAME"
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'PGEOF'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='eventpulse_app')   THEN CREATE ROLE eventpulse_app   WITH NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='eventpulse_admin') THEN CREATE ROLE eventpulse_admin WITH NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT eventpulse_app   TO eventpulse WITH ADMIN OPTION;
GRANT eventpulse_admin TO eventpulse WITH ADMIN OPTION;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname='public' AND tableowner='postgres' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO eventpulse', t.schemaname, t.tablename);
  END LOOP;
END $$;
PGEOF
log "  postgres prep complete"

# ─── 1) git checkout (current org) ───────────────────────────────────────
log "step 1: git checkout @ $REF"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" fetch --all --prune
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" reset --hard "origin/$REF"
else
  sudo -u "$EVENTPULSE_USER" mkdir -p "$APP_DIR"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" init
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" remote add origin "$REPO_URL"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" fetch origin "$REF"
  sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" reset --hard "origin/$REF"
fi
sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" config --local pull.ff only
log "  checked out $(sudo -u "$EVENTPULSE_USER" git -C "$APP_DIR" rev-parse --short HEAD)"

# ─── 2) env marker + .env.production ─────────────────────────────────────
log "step 2: env marker + secrets + $ENV_FILE"

# Marker first — so a deploy triggered before .env materialises still
# resolves to the production env file (and fails loud on missing file
# rather than silently sourcing staging's).
printf 'production\n' > "$ENV_MARKER"
chown "$EVENTPULSE_USER:$EVENTPULSE_GROUP" "$ENV_MARKER"
chmod 644 "$ENV_MARKER"

# DATABASE_URL from the provision-created database secret (fail loud if absent).
if ! secret_exists "$SM_DATABASE"; then
  log "ERROR: $SM_DATABASE not found — run provision-prod.sh first (it creates the DB + this secret)."
  exit 1
fi
PG_PASSWORD="$(secret_get "$SM_DATABASE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
if [[ -z "$PG_PASSWORD" ]]; then log "ERROR: could not read DB password from $SM_DATABASE"; exit 1; fi

# JWT secrets — fetch-or-create (Secrets Manager is source of truth).
if secret_exists "$SM_JWT_ACCESS"; then JWT_ACCESS_SECRET="$(secret_get "$SM_JWT_ACCESS")"
else JWT_ACCESS_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"; secret_put "$SM_JWT_ACCESS" "$JWT_ACCESS_SECRET"; fi
if secret_exists "$SM_JWT_REFRESH"; then JWT_REFRESH_SECRET="$(secret_get "$SM_JWT_REFRESH")"
else JWT_REFRESH_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"; secret_put "$SM_JWT_REFRESH" "$JWT_REFRESH_SECRET"; fi

# KYC config (created upstream by setup-kyc-bucket.sh for prod — cutover #6).
KYC_BUCKET_NAME=""; KYC_KMS_KEY_ID=""; KYC_KMS_KEY_ARN=""; KYC_KMS_KEY_ALIAS=""
if secret_exists "$SM_KYC_CONFIG"; then
  { read -r KYC_BUCKET_NAME; read -r KYC_KMS_KEY_ID; read -r KYC_KMS_KEY_ARN; read -r KYC_KMS_KEY_ALIAS; } \
    < <(secret_get "$SM_KYC_CONFIG" | python3 -c 'import json,sys;d=json.load(sys.stdin);[print(d[k]) for k in ("bucket_name","kms_key_id","kms_key_arn","kms_key_alias")]')
  log "  KYC config materialised (bucket=$KYC_BUCKET_NAME)"
else
  log "  WARN: $SM_KYC_CONFIG missing — KYC upload routes fail at runtime until setup-kyc-bucket.sh (prod) runs."
fi

# OAuth (Google + Apple). Empty = clean 503 OAUTH_NOT_CONFIGURED.
GOOGLE_OAUTH_CLIENT_ID=""; GOOGLE_OAUTH_CLIENT_SECRET=""
if secret_exists "$SM_OAUTH_GOOGLE"; then
  { read -r GOOGLE_OAUTH_CLIENT_ID; read -r GOOGLE_OAUTH_CLIENT_SECRET; } \
    < <(secret_get "$SM_OAUTH_GOOGLE" | python3 -c 'import json,sys;d=json.load(sys.stdin);[print(d.get(k,"")) for k in ("client_id","client_secret")]')
  log "  Google OAuth materialised"
else log "  INFO: $SM_OAUTH_GOOGLE missing — Google sign-in returns 503 OAUTH_NOT_CONFIGURED."; fi

APPLE_OAUTH_CLIENT_ID=""; APPLE_OAUTH_TEAM_ID=""; APPLE_OAUTH_KEY_ID=""; APPLE_OAUTH_PRIVATE_KEY=""
if secret_exists "$SM_OAUTH_APPLE"; then
  { read -r APPLE_OAUTH_CLIENT_ID; read -r APPLE_OAUTH_TEAM_ID; read -r APPLE_OAUTH_KEY_ID; read -r APPLE_OAUTH_PRIVATE_KEY; } \
    < <(secret_get "$SM_OAUTH_APPLE" | python3 -c '
import json,sys,base64
d=json.load(sys.stdin)
print(d.get("client_id","")); print(d.get("team_id","")); print(d.get("key_id",""))
pk=d.get("private_key","")
print(base64.b64encode(pk.encode()).decode() if pk else "")')
  log "  Apple OAuth materialised"
else log "  INFO: $SM_OAUTH_APPLE missing — Apple sign-in returns 503 OAUTH_NOT_CONFIGURED."; fi

# EPS production credentials (eventpulse/prod/eps — already provisioned 2026-05-31).
EPS_MERCHANT_ID=""; EPS_STORE_ID=""; EPS_USERNAME=""; EPS_PASSWORD=""; EPS_HASH_KEY=""; EPS_MODE=""
if secret_exists "$SM_EPS"; then
  { read -r EPS_MERCHANT_ID; read -r EPS_STORE_ID; read -r EPS_USERNAME; read -r EPS_PASSWORD; read -r EPS_HASH_KEY; read -r EPS_MODE; } \
    < <(secret_get "$SM_EPS" | python3 -c 'import json,sys;d=json.load(sys.stdin);[print(d.get(k,"")) for k in ("merchant_id","store_id","username","password","hash_key","mode")]')
  log "  EPS credentials materialised (mode=${EPS_MODE})"
else log "  WARN: $SM_EPS missing — EPS integration fails at runtime."; fi

# Porichoy (scaffold-only; stub throws regardless).
POROCHOY_API_KEY=""; POROCHOY_BASE_URL=""
if secret_exists "$SM_POROCHOY"; then
  { read -r POROCHOY_API_KEY; read -r POROCHOY_BASE_URL; } \
    < <(secret_get "$SM_POROCHOY" | python3 -c 'import json,sys;d=json.load(sys.stdin);[print(d.get(k,"")) for k in ("api_key","base_url")]')
fi

# JWT sanity (jwt.ts enforces ≥32 chars).
[[ -n "$JWT_ACCESS_SECRET"  && ${#JWT_ACCESS_SECRET}  -ge 32 ]] || { log "ERROR: JWT_ACCESS_SECRET empty/too short";  exit 1; }
[[ -n "$JWT_REFRESH_SECRET" && ${#JWT_REFRESH_SECRET} -ge 32 ]] || { log "ERROR: JWT_REFRESH_SECRET empty/too short"; exit 1; }

log "  writing $ENV_FILE"
TMP_ENV="$(mktemp -p /home/eventpulse --suffix=.env.production)"; chmod 600 "$TMP_ENV"
cat > "$TMP_ENV" <<EOF
# Event Pulse — PRODUCTION environment file.
# Owner: eventpulse:eventpulse, chmod 600. NEVER commit.
# Generated by infra/scripts/bootstrap-prod.sh from Secrets Manager.

NODE_ENV=production

# Postgres — local cluster, eventpulse role (password from $SM_DATABASE)
DATABASE_URL=postgresql://eventpulse:${PG_PASSWORD}@localhost:5432/${DB_NAME}

# Redis — local
REDIS_URL=redis://localhost:6379

# JWT — sourced from $SM_PREFIX in Secrets Manager
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# OAuth — empty values yield clean 503 OAUTH_NOT_CONFIGURED.
# APPLE_OAUTH_PRIVATE_KEY is base64-encoded (API auto-decodes).
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}
GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}
APPLE_OAUTH_CLIENT_ID=${APPLE_OAUTH_CLIENT_ID}
APPLE_OAUTH_TEAM_ID=${APPLE_OAUTH_TEAM_ID}
APPLE_OAUTH_KEY_ID=${APPLE_OAUTH_KEY_ID}
APPLE_OAUTH_PRIVATE_KEY=${APPLE_OAUTH_PRIVATE_KEY}

# EPS — PRODUCTION credentials. EPS_MODE=production.
# STAGING_PAYMENT_BLOCK is a SAFE BOOT DEFAULT (=1) on a freshly cut-over
# prod box: the EPS wrapper refuses priced orders until the operator
# deliberately lifts it for the BDT-100 smoke (launch-readiness.md §4) and
# then for go-live. Lift is recorded in decisions.md per the runbook.
EPS_MERCHANT_ID=${EPS_MERCHANT_ID}
EPS_STORE_ID=${EPS_STORE_ID}
EPS_USERNAME=${EPS_USERNAME}
EPS_PASSWORD=${EPS_PASSWORD}
EPS_HASH_KEY=${EPS_HASH_KEY}
EPS_MODE=${EPS_MODE}
STAGING_PAYMENT_BLOCK=1

# Porichoy — scaffold-only (stub throws regardless of value).
POROCHOY_API_KEY=${POROCHOY_API_KEY}
POROCHOY_BASE_URL=${POROCHOY_BASE_URL}

# Email — prod boots in dry-run; flipped to 0 as a sub-step of Phase 4
# prod SNS wiring (after the bounce/complaint suppression chain is proven).
MAIL_DRY_RUN=1
SES_FROM_ADDRESS=no-reply@eventpulse.com.bd

# Base URLs — production hostnames.
EVENTPULSE_API_BASE_URL=https://api.eventpulse.com.bd
EVENTPULSE_WEB_BASE_URL=https://eventpulse.com.bd
NEXT_PUBLIC_API_BASE_URL=https://api.eventpulse.com.bd

# KYC documents bucket — sourced from $SM_KYC_CONFIG.
KYC_BUCKET_NAME=${KYC_BUCKET_NAME}
KYC_KMS_KEY_ID=${KYC_KMS_KEY_ID}
KYC_KMS_KEY_ARN=${KYC_KMS_KEY_ARN}
KYC_KMS_KEY_ALIAS=${KYC_KMS_KEY_ALIAS}
EOF
mv "$TMP_ENV" "$ENV_FILE"
chown "$EVENTPULSE_USER:$EVENTPULSE_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ─── 2.1) validate load-bearing materialised values ──────────────────────
log "step 2.1: validate load-bearing env values"
for var in NEXT_PUBLIC_API_BASE_URL EVENTPULSE_API_BASE_URL EVENTPULSE_WEB_BASE_URL; do
  value="$(grep "^${var}=" "$ENV_FILE" | sed -E "s/^${var}=//" || true)"
  if [[ -z "$value" || ! "$value" =~ ^https?:// ]]; then
    log "ERROR: ${var} missing/invalid in $ENV_FILE — would break the Next.js build/runtime"; exit 1
  fi
  log "  ok: ${var} = ${value}"
done

unset PG_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET \
      GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET \
      APPLE_OAUTH_CLIENT_ID APPLE_OAUTH_TEAM_ID APPLE_OAUTH_KEY_ID APPLE_OAUTH_PRIVATE_KEY \
      EPS_MERCHANT_ID EPS_STORE_ID EPS_USERNAME EPS_PASSWORD EPS_HASH_KEY EPS_MODE \
      POROCHOY_API_KEY POROCHOY_BASE_URL \
      KYC_BUCKET_NAME KYC_KMS_KEY_ID KYC_KMS_KEY_ARN KYC_KMS_KEY_ALIAS

# ─── 3) Nginx vhost ──────────────────────────────────────────────────────
log "step 3: Nginx vhost"
[[ -f "$NGINX_SOURCE" ]] || { log "ERROR: $NGINX_SOURCE missing (repo checkout stale?)"; exit 1; }
# Remove staging vhost if present on this box (it never should be, but a
# rebuilt-from-staging box might carry it). Prod serves only the prod vhost.
rm -f /etc/nginx/sites-enabled/eventpulse-staging.conf
ln -sf "$NGINX_SOURCE" "$NGINX_TARGET"
if [[ ! -f /etc/nginx/snippets/ep-security-headers.conf ]]; then
  log "  creating ep-security-headers snippet"
  mkdir -p /etc/nginx/snippets
  cat > /etc/nginx/snippets/ep-security-headers.conf <<'EOF'
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF
fi
# nginx -t will FAIL until the prod TLS cert exists (cutover #3). That's
# expected on first bootstrap — issue the cert (#3), then re-run this step
# (or just `sudo nginx -t && sudo systemctl reload nginx`).
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "  nginx validated + reloaded"
else
  log "  NOTE: nginx -t failed — expected if the prod TLS cert isn't issued yet (cutover #3)."
  log "        After issuing the cert: sudo nginx -t && sudo systemctl reload nginx"
fi

# ─── 4) pm2 systemd ──────────────────────────────────────────────────────
log "step 4: pm2 systemd unit"
PM2_SERVICE_FILE="/etc/systemd/system/pm2-${EVENTPULSE_USER}.service"
if [[ ! -f "$PM2_SERVICE_FILE" ]]; then
  STARTUP_CMD="$(sudo -u "$EVENTPULSE_USER" /usr/bin/pm2 startup systemd -u "$EVENTPULSE_USER" --hp "/home/$EVENTPULSE_USER" 2>&1 | grep -E '^sudo env' | head -1 || true)"
  [[ -n "$STARTUP_CMD" ]] && { log "  running: $STARTUP_CMD"; bash -c "$STARTUP_CMD"; } || log "  WARN: could not derive pm2 startup cmd"
else
  log "  pm2 systemd unit already present"
fi

log "bootstrap-prod complete. Next: sudo -u $EVENTPULSE_USER $APP_DIR/infra/deploy/deploy.sh main"
