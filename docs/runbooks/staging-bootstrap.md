# Staging EC2 — first-time bootstrap

One-time procedure to take a freshly-provisioned staging EC2 (per Sprint 1 Day 3-4, PR #42) from "Nginx serving placeholder" to "Next.js + Hono serving real app behind proxy_pass".

Subsequent deploys use `infra/deploy/deploy.sh` triggered via SSM. This runbook is for the bootstrap step that happens once per EC2 lifecycle.

## Prerequisites

- EC2 `i-02e4fddeb923c14f9` exists and is reachable via SSM
- Postgres 16 cluster `eventpulse_staging` exists with the `eventpulse` login role (per Sprint 1 Day 3-4 ansible)
- Redis 7 listening on `127.0.0.1:6379`
- Nginx installed; ACME / TLS certs valid for the 5 staging SANs
- `/home/eventpulse/.pgpass` exists with the `eventpulse` role password
- **IAM role `eventpulse-staging-ec2`** has Secrets Manager write perms scoped to `eventpulse/staging/*`:
  - `secretsmanager:GetSecretValue` + `DescribeSecret` on `eventpulse/staging/*`
  - `secretsmanager:CreateSecret` + `TagResource` with condition `secretsmanager:Name = eventpulse/staging/*`
  - `secretsmanager:PutSecretValue` + `UpdateSecret` on `eventpulse/staging/*`
  - (Already added by `aws iam put-role-policy` during Item 5 prep; verify with `aws iam get-role-policy --role-name eventpulse-staging-ec2 --policy-name eventpulse-staging-app`.)

## Step 1 — Add a GitHub deploy key (one-time)

`deploy.sh` does `git fetch` from the EC2; the EC2 needs read access to the private repo.

```bash
# From your laptop — the gh CLI needs `repo` scope (no admin:public_key needed
# for repo-scoped deploy keys).
PUBKEY=$(aws ssm send-command \
  --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript \
  --comment "extract deploy pubkey" \
  --parameters 'commands=["sudo cat /home/eventpulse/.ssh/eventpulse_deploy.pub"]' \
  --profile eventpulse \
  --query 'Command.CommandId' --output text)
sleep 4
aws ssm get-command-invocation --command-id "$PUBKEY" \
  --instance-id i-02e4fddeb923c14f9 --profile eventpulse \
  --query 'StandardOutputContent' --output text

# Then register that pubkey as a repo deploy key (read-only):
gh api -X POST /repos/publicpulseagency/EventPulse/keys \
  -f title='eventpulse-staging-deploy-key' \
  -f key='<paste pubkey from above>' \
  -F read_only=true
```

If `/home/eventpulse/.ssh/eventpulse_deploy` doesn't exist yet, generate it:

```bash
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --parameters 'commands=[
    "sudo -u eventpulse mkdir -p /home/eventpulse/.ssh && sudo -u eventpulse chmod 700 /home/eventpulse/.ssh",
    "sudo -u eventpulse ssh-keygen -t ed25519 -C eventpulse-staging-deploy-key -f /home/eventpulse/.ssh/eventpulse_deploy -N \"\" -q",
    "sudo -u eventpulse ssh-keyscan -t ed25519 github.com 2>/dev/null > /home/eventpulse/.ssh/known_hosts",
    "sudo chown eventpulse:eventpulse /home/eventpulse/.ssh/known_hosts && sudo chmod 644 /home/eventpulse/.ssh/known_hosts"
  ]'
```

Then write the SSH config (base64-encode to avoid heredoc-in-JSON parsing issues):

```bash
SSH_CONFIG_B64=$(printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile /home/eventpulse/.ssh/eventpulse_deploy\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' | base64)
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --parameters "commands=[
    \"echo $SSH_CONFIG_B64 | base64 -d | sudo -u eventpulse tee /home/eventpulse/.ssh/config >/dev/null\",
    \"sudo chmod 600 /home/eventpulse/.ssh/config && sudo chown eventpulse:eventpulse /home/eventpulse/.ssh/config\",
    \"sudo -u eventpulse ssh -T git@github.com 2>&1 | head -3\"
  ]"
```

The last line should output `Hi publicpulseagency/EventPulse! You've successfully authenticated...`.

## Step 2 — Initial clone + bootstrap

The bootstrap script lives in the repo, but the repo isn't checked out yet. Chicken-and-egg fix: clone it first, then run the script from inside the checkout.

```bash
# Read the eventpulse Postgres role password from .pgpass
PG_PASSWORD=$(aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --parameters 'commands=["sudo awk -F: \"NR==1{print \\$5}\" /home/eventpulse/.pgpass"]' \
  --query 'Command.CommandId' --output text)
sleep 4
PG_PASSWORD_VAL=$(aws ssm get-command-invocation --command-id "$PG_PASSWORD" \
  --instance-id i-02e4fddeb923c14f9 --profile eventpulse \
  --query 'StandardOutputContent' --output text | tr -d '\n')

# Run the bootstrap (clones repo + writes .env.staging + installs Nginx + sets up pm2 systemd)
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --comment "staging bootstrap" \
  --parameters "commands=[
    \"sudo -u eventpulse rm -rf /home/eventpulse/app && sudo -u eventpulse mkdir -p /home/eventpulse/app\",
    \"sudo -u eventpulse git -C /home/eventpulse/app init\",
    \"sudo -u eventpulse git -C /home/eventpulse/app remote add origin git@github.com:publicpulseagency/EventPulse.git\",
    \"sudo -u eventpulse git -C /home/eventpulse/app fetch origin main\",
    \"sudo -u eventpulse git -C /home/eventpulse/app reset --hard origin/main\",
    \"sudo PG_PASSWORD='$PG_PASSWORD_VAL' /home/eventpulse/app/infra/scripts/bootstrap-staging.sh\"
  ]"
```

The bootstrap script:

1. Re-verifies the git checkout (no-op if step above already did it).
2. **Fetches JWT secrets from AWS Secrets Manager** (`eventpulse/staging/jwt-access-secret`, `eventpulse/staging/jwt-refresh-secret`). If they don't exist there yet, generates them, writes them to Secrets Manager IMMEDIATELY, then materialises them to `/home/eventpulse/.env.staging`. **Values never appear in stdout, deploy logs, or SSM command output** — Secrets Manager is the source of truth.
3. Symlinks `infra/nginx/eventpulse-staging.conf` into `/etc/nginx/sites-enabled/`, runs `nginx -t`, reloads.
4. Installs the pm2 systemd unit so the app survives reboot.

After bootstrap, verify the secrets are present in Secrets Manager (presence-only check, never reads the value):

```bash
aws secretsmanager describe-secret \
  --secret-id eventpulse/staging/jwt-access-secret \
  --profile eventpulse --query 'Name'
aws secretsmanager describe-secret \
  --secret-id eventpulse/staging/jwt-refresh-secret \
  --profile eventpulse --query 'Name'
```

Both should print the secret name. If either is missing, the bootstrap step failed — re-run with `-` and check the SSM command output (only "created" / "fetched" markers should appear, never values).

Re-running the bootstrap on a fresh EC2 (or after `.env.staging` deletion) re-uses the existing secrets from Secrets Manager — sessions stay valid across rebuilds as long as the Secrets Manager entries are retained.

## Step 3 — First deploy

```bash
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --comment "first deploy main" \
  --parameters 'commands=["sudo -u eventpulse /home/eventpulse/app/infra/deploy/deploy.sh main"]'
```

`deploy.sh` will:

1. Source `/home/eventpulse/.env.staging` (fail loudly if missing).
2. `git fetch` + `git reset --hard origin/main`.
3. `pnpm install --frozen-lockfile`.
4. Build web (`next build`) + api (`tsc`).
5. Run db migrations.
6. `pm2 reload ecosystem.config.cjs --update-env` (or `pm2 start` if first run).
7. Healthcheck `/health` on `127.0.0.1:4000`. If not 200, auto-rollback via `rollback.sh`.

## Step 4 — Verify

```bash
for HOST in staging app.staging admin.staging api.staging my.staging; do
  echo -n "$HOST → "
  curl -sS -o /dev/null -w "%{http_code}\n" "https://${HOST}.eventpulse.com.bd/health"
done
```

All five should return `200`. The `/health` paths are Nginx-direct (cheap probe); to verify the backend is actually serving:

```bash
curl -sS https://api.staging.eventpulse.com.bd/health  # Hono /health JSON envelope
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://staging.eventpulse.com.bd/  # Next.js root
```

## After-launch tasks

- Add OAuth credentials to Secrets Manager (`eventpulse/staging/oauth-google`, `eventpulse/staging/oauth-apple`) and extend `bootstrap-staging.sh` to materialise them into `.env.staging` — Sprint 2 Day 20 closeout for manual OAuth happy-path testing.
- Verify `pm2 save` was called so the process list persists across reboot.
- Document the deploy key fingerprint in this runbook for audit (`gh api /repos/publicpulseagency/EventPulse/keys` lists current keys).

## Memory headroom — 2GB swap (Day 34, 2026-05-26)

Staging runs on `t3.small` (2GB RAM, no instance-store swap). The full stack — Next.js web + Hono API (with inline BullMQ delivery worker) + Postgres + Redis — peaks close enough to the ceiling that a transient spike can OOM-kill into an **in-VM hang**: port 443 + SSM agent both unresponsive, hypervisor still reporting `running`/`ok`. The Day-33 incident (2026-05-25) was this signature; recovery was **EC2 Stop+Start** (a `Reboot` from the console did NOT fire because the guest OS was stuck and never ACK'd the ACPI signal).

Mitigation applied: 2GB swap file at `/swapfile`, `vm.swappiness=10` (swap as safety net, not routine eviction), persisted in `/etc/fstab` + `/etc/sysctl.d/99-eventpulse-swap.conf`. **This is codified in `bootstrap-staging.sh` step 0.0**, so a fresh EC2 rebuild reproduces it. Idempotent — re-running the bootstrap on the existing instance is safe.

Verify:

```bash
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --parameters 'commands=["free -h", "swapon --show", "cat /proc/sys/vm/swappiness"]'
```

Expected: `Swap: 2.0Gi` in `free`, `/swapfile file 2G` in `swapon --show`, `swappiness=10`.

**Production-cutover note:** this is a staging stopgap. Production should run `t3.medium` (4GB) or larger so swap stays defence-in-depth, not the floor. Tracked in `.claude/memory/decisions.md` "Staging EC2 swap stopgap; t3.medium flagged as pre-production capacity decision" (2026-05-26).

## Recovering from an in-VM hang

Signature (all simultaneously):

- TCP `:443` times out for all 5 vhosts
- `aws ssm describe-instance-information` shows `PingStatus: ConnectionLost`
- EC2 console shows the instance `running` + status checks `ok`
- Console screenshot / `get-console-output` shows the OS frozen mid-syscall

This is **not** a hypervisor or networking problem — it's the guest OS frozen (typically OOM-induced). `Reboot` (ACPI) won't help because the kernel can't process the signal.

Recovery: **Stop, then Start** the instance from the EC2 console (or `aws ec2 stop-instances` → wait → `aws ec2 start-instances`). The Elastic IP persists. After ~2 min the instance is back up and PM2's systemd unit auto-restores the saved process list.

Post-recovery checklist:

```bash
# 1. SSM reconnected
aws ssm describe-instance-information --filters Key=InstanceIds,Values=i-02e4fddeb923c14f9 \
  --query 'InstanceInformationList[0].PingStatus' --profile eventpulse

# 2. All 5 vhosts up
for HOST in staging app.staging admin.staging api.staging my.staging; do
  echo -n "$HOST → "
  curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 "https://${HOST}.eventpulse.com.bd/"
done

# 3. /health DB-aware
curl -sS https://api.staging.eventpulse.com.bd/health

# 4. STAGING_PAYMENT_BLOCK still =1 (re-verify after every recovery)
aws ssm send-command --instance-ids i-02e4fddeb923c14f9 \
  --document-name AWS-RunShellScript --profile eventpulse \
  --parameters 'commands=["grep -E ^STAGING_PAYMENT_BLOCK /home/eventpulse/.env.staging"]'
```

If any of step 1-4 fails repeatedly after Stop+Start, escalate — at that point a t3.medium upgrade may be the actual fix.
