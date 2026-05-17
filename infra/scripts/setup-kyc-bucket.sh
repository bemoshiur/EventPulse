#!/bin/bash
#
# Event Pulse — one-time setup for the KYC documents S3 bucket + dedicated
# KMS CMK.
#
# Per Checkpoint #2 (decisions.md 2026-05-17): dedicated per-purpose CMK
# (`alias/eventpulse-kyc-<env>`) NOT shared with the general staging/prod
# CMK, so a key compromise affects KYC documents only. Bucket name
# `eventpulse-kyc-<env>` (NOT `eventpulse-<env>-kyc`), region
# `ap-southeast-1`, BlockPublicAccess all-on, KMS-only PUT, TLS-only,
# `tenants/{tenant_id}/kyc/{submission_id}/{document_type}.{ext}` prefix,
# GLACIER_IR transition at 30d, NO expiration on the prefix (BFIU §15.1
# 5-year retention enforced at the application + IAM layers, NOT via
# lifecycle expiry — KYC docs must NEVER auto-delete during retention).
#
# This script runs from a DEVELOPER WORKSTATION (or CI) with admin AWS
# credentials — NOT on the EC2 instance role, which only has operational
# perms by design. The script extends the EC2 instance role's inline
# policy with KYC-scoped statements once the bucket + CMK ARNs are known.
#
# Idempotent: re-runs detect existing resources and re-apply settings
# (PAB / versioning / encryption / policy / lifecycle / tags) without
# attempting to recreate them.
#
# Usage:
#   ENVIRONMENT=staging AWS_PROFILE=eventpulse ./infra/scripts/setup-kyc-bucket.sh
#   ENVIRONMENT=prod    AWS_PROFILE=eventpulse-prod ./infra/scripts/setup-kyc-bucket.sh
#
# Required env:
#   ENVIRONMENT      — `staging` or `prod`
#   AWS_PROFILE      — local AWS CLI profile with admin perms (KMS + S3 +
#                      IAM + Secrets Manager write on this account)
# Optional env:
#   AWS_REGION       — default ap-southeast-1
#   EC2_ROLE_NAME    — default eventpulse-${ENVIRONMENT}-ec2
#
# Required IAM (on the user/role running this script):
#   kms:CreateKey + CreateAlias + EnableKeyRotation + DescribeKey + ListAliases + TagResource + PutKeyPolicy
#   s3:CreateBucket + Put{PublicAccessBlock,BucketVersioning,BucketOwnershipControls,BucketEncryption,BucketPolicy,BucketLifecycleConfiguration,BucketTagging} + Get equivalents + HeadBucket
#   iam:GetRolePolicy + PutRolePolicy on the EC2 instance role
#   secretsmanager:CreateSecret + PutSecretValue + DescribeSecret + TagResource on eventpulse/${ENVIRONMENT}/kyc

set -euo pipefail

: "${ENVIRONMENT:?must be set: staging|prod}"
: "${AWS_PROFILE:?must be set: AWS CLI profile with admin perms}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
EC2_ROLE_NAME="${EC2_ROLE_NAME:-eventpulse-${ENVIRONMENT}-ec2}"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "prod" ]]; then
  echo "ERROR: ENVIRONMENT must be 'staging' or 'prod' (got '$ENVIRONMENT')"
  exit 1
fi

# Resource identifiers — derived from $ENVIRONMENT for prod parity.
KYC_BUCKET="eventpulse-kyc-${ENVIRONMENT}"
KYC_KMS_KEY_ALIAS="alias/eventpulse-kyc-${ENVIRONMENT}"
KYC_SECRET_NAME="eventpulse/${ENVIRONMENT}/kyc"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/kyc-bucket"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

for bin in envsubst python3 aws; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: $bin not on PATH"; exit 1; }
done

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] setup-kyc-bucket: $*"; }

aws_cli() { aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }

# Render an envsubst template against a CLOSED list of named variables.
# Passing the explicit `${VAR}` list as envsubst's only positional arg
# limits substitution to those names — any other `${something}` in the
# template stays literal, so a typo or a future stray reference cannot
# silently inject empty strings into JSON. The caller passes the list of
# vars THIS template needs (after `src` and `dst`); each must be set and
# non-empty, else we error rather than silently rendering bad JSON.
#
# Usage:  render_template SRC DST VAR1 [VAR2...]
render_template() {
  local src="$1" dst="$2"
  shift 2
  local v subst=""
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "ERROR: render_template called with empty \$$v (src=$src)" >&2
      return 1
    fi
    subst+="\${$v} "
  done
  envsubst "$subst" < "$src" > "$dst"
}

AWS_ACCOUNT_ID="$(aws_cli sts get-caller-identity --query Account --output text)"
log "account: $AWS_ACCOUNT_ID, region: $AWS_REGION, env: $ENVIRONMENT"
log "bucket: $KYC_BUCKET, kms alias: $KYC_KMS_KEY_ALIAS"

# ─── 1) KMS CMK ─────────────────────────────────────────────────────────

log "step 1: KMS CMK ($KYC_KMS_KEY_ALIAS)"

# Discover existing alias → key. If alias exists, reuse the underlying
# key (NEVER create a new key when the alias already maps to one — that
# would silently disconnect the existing bucket from its encryption key).
EXISTING_KEY_ID="$(aws_cli kms list-aliases \
  --query "Aliases[?AliasName=='${KYC_KMS_KEY_ALIAS}'].TargetKeyId" \
  --output text 2>/dev/null || true)"

if [[ -n "$EXISTING_KEY_ID" && "$EXISTING_KEY_ID" != "None" ]]; then
  log "  alias exists → reusing key $EXISTING_KEY_ID"
  KYC_KMS_KEY_ID="$EXISTING_KEY_ID"
  KYC_KMS_KEY_ARN="$(aws_cli kms describe-key --key-id "$KYC_KMS_KEY_ID" --query 'KeyMetadata.Arn' --output text)"
else
  log "  creating new CMK"
  # Render policy with substitutions. The KMS key policy template only
  # references account ID + region + env (not KYC_BUCKET / KYC_KMS_KEY_ARN
  # — the key doesn't exist yet on the create-key path).
  render_template "$ASSETS_DIR/kms-key-policy.json" "$WORK_DIR/kms-key-policy.json" \
    AWS_ACCOUNT_ID AWS_REGION ENVIRONMENT

  KYC_KMS_KEY_ID="$(aws_cli kms create-key \
    --description "Event Pulse ${ENVIRONMENT} — KYC documents bucket encryption (dedicated per-purpose CMK, §17.9)" \
    --key-usage ENCRYPT_DECRYPT \
    --key-spec SYMMETRIC_DEFAULT \
    --origin AWS_KMS \
    --policy "file://${WORK_DIR}/kms-key-policy.json" \
    --tags "TagKey=managed-by,TagValue=setup-kyc-bucket.sh" \
           "TagKey=env,TagValue=${ENVIRONMENT}" \
           "TagKey=purpose,TagValue=kyc-bucket-encryption" \
    --query 'KeyMetadata.KeyId' \
    --output text)"
  KYC_KMS_KEY_ARN="$(aws_cli kms describe-key --key-id "$KYC_KMS_KEY_ID" --query 'KeyMetadata.Arn' --output text)"
  aws_cli kms create-alias --alias-name "$KYC_KMS_KEY_ALIAS" --target-key-id "$KYC_KMS_KEY_ID"
  log "  created key $KYC_KMS_KEY_ID, alias $KYC_KMS_KEY_ALIAS"
fi

# Rotation: enable if not already on. Idempotent (KMS no-op if already on).
ROTATION_ENABLED="$(aws_cli kms get-key-rotation-status --key-id "$KYC_KMS_KEY_ID" --query KeyRotationEnabled --output text)"
if [[ "$ROTATION_ENABLED" != "True" ]]; then
  aws_cli kms enable-key-rotation --key-id "$KYC_KMS_KEY_ID"
  log "  enabled key rotation"
else
  log "  key rotation already enabled"
fi

# ─── 2) S3 bucket ───────────────────────────────────────────────────────

log "step 2: S3 bucket ($KYC_BUCKET)"

if aws_cli s3api head-bucket --bucket "$KYC_BUCKET" 2>/dev/null; then
  log "  bucket exists → reapplying settings (idempotent)"
else
  log "  creating bucket"
  aws_cli s3api create-bucket \
    --bucket "$KYC_BUCKET" \
    --create-bucket-configuration "LocationConstraint=${AWS_REGION}" \
    --object-ownership BucketOwnerEnforced >/dev/null
fi

# Apply all 6 bucket settings idempotently. Each call is safe to repeat.
log "  applying BlockPublicAccess (all four flags on)"
aws_cli s3api put-public-access-block --bucket "$KYC_BUCKET" \
  --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

log "  applying versioning (Enabled)"
aws_cli s3api put-bucket-versioning --bucket "$KYC_BUCKET" \
  --versioning-configuration Status=Enabled

log "  applying ownership (BucketOwnerEnforced — ACLs disabled)"
aws_cli s3api put-bucket-ownership-controls --bucket "$KYC_BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

log "  applying default SSE-KMS encryption + BucketKey"
render_template "$ASSETS_DIR/bucket-encryption.json" "$WORK_DIR/bucket-encryption.json" \
  KYC_KMS_KEY_ARN
aws_cli s3api put-bucket-encryption --bucket "$KYC_BUCKET" \
  --server-side-encryption-configuration "file://${WORK_DIR}/bucket-encryption.json"

log "  applying bucket policy (deny non-TLS + deny non-KMS PUT + deny wrong-key PUT + deny destructive actions by EC2 role)"
render_template "$ASSETS_DIR/bucket-policy.json" "$WORK_DIR/bucket-policy.json" \
  AWS_ACCOUNT_ID ENVIRONMENT KYC_BUCKET KYC_KMS_KEY_ARN
aws_cli s3api put-bucket-policy --bucket "$KYC_BUCKET" \
  --policy "file://${WORK_DIR}/bucket-policy.json"

log "  applying lifecycle (Glacier_IR at 30d on tenants/* prefix; NO expiration on prefix)"
aws_cli s3api put-bucket-lifecycle-configuration --bucket "$KYC_BUCKET" \
  --lifecycle-configuration "file://${ASSETS_DIR}/bucket-lifecycle.json"

log "  applying tags"
aws_cli s3api put-bucket-tagging --bucket "$KYC_BUCKET" \
  --tagging "TagSet=[{Key=managed-by,Value=setup-kyc-bucket.sh},{Key=env,Value=${ENVIRONMENT}},{Key=purpose,Value=kyc-documents},{Key=compliance,Value=bfiu-5yr-retention}]"

# ─── 3) IAM — extend EC2 inline policy ──────────────────────────────────

log "step 3: IAM scoped grants on EC2 role ($EC2_ROLE_NAME)"

CURRENT_POLICY="$(aws_cli iam get-role-policy \
  --role-name "$EC2_ROLE_NAME" \
  --policy-name eventpulse-${ENVIRONMENT}-app \
  --query 'PolicyDocument' --output json 2>/dev/null || echo '{}')"

if [[ "$CURRENT_POLICY" == "{}" ]]; then
  echo "ERROR: inline policy eventpulse-${ENVIRONMENT}-app not found on role $EC2_ROLE_NAME."
  echo "       The base policy must be created first (Sprint 1 Day 3-4 bootstrap)."
  exit 1
fi

echo "$CURRENT_POLICY" > "$WORK_DIR/current-policy.json"
render_template "$ASSETS_DIR/iam-statements.json" "$WORK_DIR/iam-statements.json" \
  KYC_BUCKET KYC_KMS_KEY_ARN

# Merge — idempotent: replace existing KYC Sids if present, else append.
python3 - <<PYEOF
import json, sys

with open("${WORK_DIR}/current-policy.json") as f:
    policy = json.load(f)
with open("${WORK_DIR}/iam-statements.json") as f:
    new_stmts = json.load(f)

new_sids = {s["Sid"] for s in new_stmts}
preserved = [s for s in policy["Statement"] if s.get("Sid") not in new_sids]
policy["Statement"] = preserved + new_stmts

with open("${WORK_DIR}/merged-policy.json", "w") as f:
    json.dump(policy, f, indent=2)

print(f"merged: {len(preserved)} preserved + {len(new_stmts)} KYC = {len(policy['Statement'])} total")
PYEOF

aws_cli iam put-role-policy \
  --role-name "$EC2_ROLE_NAME" \
  --policy-name "eventpulse-${ENVIRONMENT}-app" \
  --policy-document "file://${WORK_DIR}/merged-policy.json"

log "  EC2 role inline policy updated with KYC statements"

# ─── 4) Secrets Manager — KYC config canonical lookup ──────────────────

log "step 4: Secrets Manager ($KYC_SECRET_NAME)"

KYC_CONFIG_JSON="$(cat <<JSON
{"bucket_name":"${KYC_BUCKET}","kms_key_id":"${KYC_KMS_KEY_ID}","kms_key_arn":"${KYC_KMS_KEY_ARN}","kms_key_alias":"${KYC_KMS_KEY_ALIAS}","region":"${AWS_REGION}"}
JSON
)"

if aws_cli secretsmanager describe-secret --secret-id "$KYC_SECRET_NAME" >/dev/null 2>&1; then
  log "  secret exists → updating value"
  aws_cli secretsmanager put-secret-value \
    --secret-id "$KYC_SECRET_NAME" \
    --secret-string "$KYC_CONFIG_JSON" \
    --output text --query VersionId >/dev/null
else
  log "  creating secret"
  aws_cli secretsmanager create-secret \
    --name "$KYC_SECRET_NAME" \
    --description "Event Pulse ${ENVIRONMENT} — KYC bucket + dedicated CMK identifiers (non-secret config; here for canonical lookup)" \
    --secret-string "$KYC_CONFIG_JSON" \
    --tags "Key=managed-by,Value=setup-kyc-bucket.sh" "Key=env,Value=${ENVIRONMENT}" "Key=purpose,Value=kyc-config" \
    --output text --query Name >/dev/null
fi

unset KYC_CONFIG_JSON

log "verify (presence-only, no value relay):"
log "  aws secretsmanager describe-secret --secret-id $KYC_SECRET_NAME --region $AWS_REGION"
log ""
log "done."
log "  KYC bucket:       $KYC_BUCKET"
log "  KYC KMS alias:    $KYC_KMS_KEY_ALIAS"
log "  KYC KMS key id:   $KYC_KMS_KEY_ID"
log "  Config in SM at:  $KYC_SECRET_NAME"
log ""
log "Next: run infra/scripts/bootstrap-staging.sh on the EC2 to materialise"
log "      KYC_BUCKET / KYC_KMS_KEY_* into /home/eventpulse/.env.staging."
