#!/bin/bash
#
# Event Pulse — one-time OS-stack provisioning for the PRODUCTION EC2.
#
# This is the IaC piece that never got written for staging (the original
# staging OS install was manual / a lost ansible playbook; CLAUDE.md §17.3
# describes an `infra/ansible/` that does not exist in the repo). This
# script codifies the EXACT stack that staging (i-02e4fddeb923c14f9) runs,
# captured 2026-06-02 via read-only SSM probe, so production reproduces the
# known-good environment rather than the playbook's stale claims.
#
# ── Divergences from CLAUDE.md §17.3 (staging reality wins — mirrored here) ──
#   Node    : system-wide /usr/bin/node from NodeSource (NOT nvm-under-user)
#   Redis   : 8.x from packages.redis.io  (§1.2 says "Redis 7" — staging is 8.6.3)
#   certbot : 5.x via snap + certbot-dns-route53 snap (NOT apt python3-certbot-*)
#   ufw     : left INACTIVE — the EC2 security group is the firewall (80/443
#             only, no 22). fail2ban installed for parity but vestigial (no SSH).
#   CW agent: NOT installed here — default EC2 metrics cover the CPU alarm;
#             the mem>90% / disk>80% alarms in §17.11 need the agent and are
#             handled in cutover sub-item #8, not provisioning.
#
# ── What it does (idempotent — safe to re-run) ──
#   0. Preconditions (root, Ubuntu 24.04).
#   1. Base apt packages + 2 GB swap + swappiness=10 (Day-34 OOM fix).
#   2. eventpulse system user + /home/eventpulse/{app,data,logs,backups}.
#   3. Node 22 (NodeSource) + pnpm@9.15.9 + pm2@7.0.1 (global, pinned to staging).
#   4. PostgreSQL 16 (pgdg) + the THREE RLS roles with exact attributes +
#      eventpulse_prod DB + citext/pgcrypto extensions. DB password is
#      generated once, stored to Secrets Manager (eventpulse/prod/database),
#      and written to .pgpass — the value is NEVER echoed to stdout/SSM logs.
#   5. Redis 8 (packages.redis.io), bound to 127.0.0.1, systemd-supervised.
#   6. Nginx + /var/www/eventpulse (ACME http-01 fallback root).
#   7. certbot (snap) + certbot-dns-route53 (cert issuance is sub-item #3).
#   8. fail2ban + unattended-upgrades enabled.
#   9. Self-check: assert role security attributes; FAIL LOUDLY on RLS-bypass risk.
#
# Does NOT do (later cutover sub-items own these):
#   - nginx vhost symlink, git checkout, app-secret .env (→ bootstrap-prod.sh, #1b/#1e)
#   - TLS cert issuance (→ #3), OIDC deploy role (→ #4), alarms (→ #8)
#
# ── Run context ──
#   Executed as root on a freshly-launched prod EC2 via SSM SendCommand
#   (no SSH; port 22 closed per §17.7). The instance role eventpulse-prod-ec2
#   (cutover sub-item #1c) must grant, scoped to eventpulse/prod/*:
#     secretsmanager:GetSecretValue + DescribeSecret + CreateSecret +
#     PutSecretValue + TagResource
#
# Usage:  sudo /home/eventpulse/app/infra/scripts/provision-prod.sh
#         (or piped in via SSM before the repo is checked out)

set -euo pipefail

# ─── Constants (production) ──────────────────────────────────────────────
EVENTPULSE_USER="eventpulse"
EVENTPULSE_GROUP="eventpulse"
EVENTPULSE_HOME="/home/eventpulse"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SM_PREFIX="eventpulse/prod"
SM_DATABASE="${SM_PREFIX}/database"
DB_NAME="eventpulse_prod"
DB_ROLE="eventpulse"            # pool owner: LOGIN, CREATEDB, NON-super, NON-bypassrls
DB_HOST="127.0.0.1"
DB_PORT="5432"
PNPM_VERSION="9.15.9"           # pinned to match staging (parity > freshness)
PM2_VERSION="7.0.1"             # pinned to match staging
NODE_MAJOR="22"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root (sudo). It installs packages + writes systemd/postgres." >&2
  exit 1
fi

if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
  echo "ERROR: expected Ubuntu 24.04 (noble). /etc/os-release says:" >&2
  grep -E "^VERSION=" /etc/os-release >&2 || true
  exit 1
fi

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] provision-prod: $*"; }

export DEBIAN_FRONTEND=noninteractive
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"   # noble

# ─── 1. Base packages + swap ─────────────────────────────────────────────
log "apt update + base packages"
apt-get update -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release acl \
  ufw fail2ban unattended-upgrades

log "swap: 2 GB swapfile + swappiness=10 (Day-34 OOM fix, mirrored from staging)"
if ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-eventpulse-swap.conf
sysctl -p /etc/sysctl.d/99-eventpulse-swap.conf >/dev/null

# ─── 2. eventpulse user + directories ────────────────────────────────────
log "eventpulse system user + home dirs"
if ! id -u "$EVENTPULSE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$EVENTPULSE_USER"
fi
install -d -o "$EVENTPULSE_USER" -g "$EVENTPULSE_GROUP" -m 0755 \
  "$EVENTPULSE_HOME/app" "$EVENTPULSE_HOME/data" \
  "$EVENTPULSE_HOME/logs" "$EVENTPULSE_HOME/backups"
install -d -o "$EVENTPULSE_USER" -g "$EVENTPULSE_GROUP" -m 0700 "$EVENTPULSE_HOME/.ssh"
install -d -o www-data -g www-data -m 0755 /var/www/eventpulse

# ─── 3. Node 22 (NodeSource) + pnpm + pm2 ────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" != "$NODE_MAJOR" ]]; then
  log "Node $NODE_MAJOR via NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node already present: $(node -v)"
fi

log "pnpm@$PNPM_VERSION + pm2@$PM2_VERSION (global, pinned to staging)"
command -v pnpm >/dev/null 2>&1 && [[ "$(pnpm -v)" == "$PNPM_VERSION" ]] || npm install -g "pnpm@${PNPM_VERSION}"
command -v pm2  >/dev/null 2>&1 && [[ "$(pm2 -v 2>/dev/null)" == "$PM2_VERSION" ]] || npm install -g "pm2@${PM2_VERSION}"

# ─── 4. PostgreSQL 16 (pgdg) ─────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  log "PostgreSQL 16 via pgdg apt repo"
  apt-get install -y postgresql-common
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y postgresql-16
else
  log "PostgreSQL already present: $(psql --version)"
fi
systemctl enable --now postgresql

# 4a. Database password — generate once, store to Secrets Manager, write .pgpass.
#     Value never appears in stdout/SSM output (only "fetched"/"created" markers).
log "database credential — resolve from Secrets Manager (or generate + store)"
DB_PASSWORD=""
if aws secretsmanager describe-secret --secret-id "$SM_DATABASE" --region "$AWS_REGION" >/dev/null 2>&1; then
  DB_PASSWORD="$(aws secretsmanager get-secret-value --secret-id "$SM_DATABASE" \
    --region "$AWS_REGION" --query 'SecretString' --output text 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["password"])')"
  log "  database secret: fetched existing"
else
  DB_PASSWORD="$(openssl rand -hex 24)"   # 48 hex chars — URL-safe, no escaping needed
  SECRET_JSON="$(python3 - "$DB_PASSWORD" "$DB_ROLE" "$DB_HOST" "$DB_PORT" "$DB_NAME" <<'PY'
import json, sys
pw, role, host, port, db = sys.argv[1:6]
print(json.dumps({
    "username": role, "password": pw, "host": host, "port": port, "dbname": db,
    "url": f"postgres://{role}:{pw}@{host}:{port}/{db}",
}))
PY
)"
  aws secretsmanager create-secret --name "$SM_DATABASE" --region "$AWS_REGION" \
    --description "Event Pulse production Postgres credential (eventpulse role)" \
    --secret-string "$SECRET_JSON" >/dev/null
  unset SECRET_JSON
  log "  database secret: created"
fi

# .pgpass for the eventpulse role (used by deploy/migration tooling).
PGPASS="$EVENTPULSE_HOME/.pgpass"
printf '%s:%s:*:%s:%s\n' "$DB_HOST" "$DB_PORT" "$DB_ROLE" "$DB_PASSWORD" > "$PGPASS"
chown "$EVENTPULSE_USER:$EVENTPULSE_GROUP" "$PGPASS"
chmod 600 "$PGPASS"

# 4b. Roles + DB + extensions. Exact attributes mirror staging (probed 2026-06-02):
#       eventpulse        super=f bypassrls=f login=t createdb=t
#       eventpulse_admin  super=f bypassrls=t login=f
#       eventpulse_app    super=f bypassrls=f login=f
#     Idempotent: CREATE-if-absent then ALTER to enforce attributes every run.
log "postgres roles + database + extensions"
ROLE_SQL="$(cat <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eventpulse_app')   THEN CREATE ROLE eventpulse_app   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eventpulse_admin') THEN CREATE ROLE eventpulse_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_ROLE}')       THEN CREATE ROLE ${DB_ROLE}        LOGIN;   END IF;
END \$\$;
ALTER ROLE eventpulse_app   NOSUPERUSER NOBYPASSRLS NOLOGIN NOCREATEDB NOCREATEROLE;
ALTER ROLE eventpulse_admin NOSUPERUSER   BYPASSRLS NOLOGIN NOCREATEDB NOCREATEROLE;
ALTER ROLE ${DB_ROLE}       NOSUPERUSER NOBYPASSRLS   LOGIN   CREATEDB NOCREATEROLE PASSWORD '${DB_PASSWORD}';
-- WITH ADMIN OPTION is load-bearing: migration 0001 re-issues
-- GRANT eventpulse_app TO eventpulse, which Postgres 16 rejects unless
-- the grantor holds ADMIN OPTION on the target role (the creator does NOT
-- get it automatically). Without this, migrations fail (Day-11 gotcha:
-- 8 failed deploys). Re-granting is a no-op, so this stays idempotent.
GRANT eventpulse_app, eventpulse_admin TO ${DB_ROLE} WITH ADMIN OPTION;
SQL
)"
# Piped via stdin so the password never appears in process args / SSM logs.
printf '%s\n' "$ROLE_SQL" | sudo -u postgres psql -v ON_ERROR_STOP=1 -q
unset ROLE_SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_ROLE" "$DB_NAME"
  log "  created database $DB_NAME"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" \
  -c "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# ─── 5. Redis 8 (packages.redis.io) ──────────────────────────────────────
if ! command -v redis-server >/dev/null 2>&1; then
  log "Redis via packages.redis.io"
  curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
  chmod 644 /usr/share/keyrings/redis-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb ${CODENAME} main" \
    > /etc/apt/sources.list.d/redis.list
  apt-get update -y
  apt-get install -y redis
else
  log "Redis already present: $(redis-server --version | awk '{print $3}')"
fi
# Enforce local-only bind (matches staging: bind 127.0.0.1 -::1, supervised systemd).
if ! grep -qE '^bind 127\.0\.0\.1' /etc/redis/redis.conf; then
  sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
fi
grep -qE '^supervised systemd' /etc/redis/redis.conf || sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf
systemctl enable --now redis-server

# ─── 6. Nginx ────────────────────────────────────────────────────────────
command -v nginx >/dev/null 2>&1 || { log "nginx"; apt-get install -y nginx; }
systemctl enable --now nginx

# ─── 7. certbot (snap) + dns-route53 plugin ──────────────────────────────
# Cert ISSUANCE is cutover sub-item #3 — this only installs the tooling.
if ! snap list certbot >/dev/null 2>&1; then
  log "certbot via snap (classic) + certbot-dns-route53"
  snap install core && snap refresh core
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
  snap set certbot trust-plugin-with-root=ok
  snap install certbot-dns-route53
else
  log "certbot snap already present: $(certbot --version 2>&1)"
fi

# ─── 8. fail2ban + unattended-upgrades ───────────────────────────────────
systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades || true

# ─── 9. Self-check — fail loudly on any RLS-bypass risk ──────────────────
log "self-check: postgres role security attributes"
ATTRS="$(sudo -u postgres psql -tAc \
  "select rolname||':'||rolsuper::int||':'||rolbypassrls::int||':'||rolcanlogin::int \
   from pg_roles where rolname like 'eventpulse%' order by rolname")"
echo "$ATTRS"
# Expected: eventpulse:0:0:1  eventpulse_admin:0:1:0  eventpulse_app:0:0:0
fail=0
echo "$ATTRS" | grep -qx "eventpulse_app:0:0:0"   || { echo "FATAL: eventpulse_app attrs wrong (must be non-super/non-bypassrls/nologin)" >&2; fail=1; }
echo "$ATTRS" | grep -qx "eventpulse_admin:0:1:0" || { echo "FATAL: eventpulse_admin attrs wrong (must be non-super/BYPASSRLS/nologin)" >&2; fail=1; }
echo "$ATTRS" | grep -qx "eventpulse:0:0:1"        || { echo "FATAL: eventpulse pool-owner attrs wrong (must be non-super/non-bypassrls/login)" >&2; fail=1; }
if [[ "$fail" -ne 0 ]]; then
  echo "Provisioning produced unsafe Postgres roles — refusing to continue. RLS isolation depends on this." >&2
  exit 1
fi

unset DB_PASSWORD
log "DONE — OS stack provisioned. Next: bootstrap-prod.sh (git checkout + app secrets + nginx vhost + pm2)."
