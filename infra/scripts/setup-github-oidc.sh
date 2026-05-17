#!/bin/bash
#
# Event Pulse — one-time setup for the GitHub Actions OIDC plumbing.
#
# Sprint 2 Day 13 closeout (per `.claude/memory/decisions.md` 2026-05-17
# "GitHub OIDC provider + deploy role"). Sprint 1 Day 9-10 shipped the
# `deploy-staging.yml` workflow with a placeholder `AWS_OIDC_ROLE_STAGING`
# secret but never created the AWS-side OIDC provider + assumable role.
# The gap stayed silent until Day 13 flipped `STAGING_DEPLOY_ENABLED=true`
# — the first auto-deploy failed at the OIDC step. This script codifies
# the missing infra so a fresh AWS account or a prod cutover is one
# command, not a manual scramble.
#
# What it does:
#   1. Create the GitHub Actions OIDC provider (single per account; idempotent)
#      - URL: token.actions.githubusercontent.com
#      - Audience: sts.amazonaws.com
#      - Thumbprints: 6938fd4d... and 1c58a3a8... (AWS auto-manages since
#        2023, but we declare them explicitly belt-and-braces)
#   2. Create the deploy role `eventpulse-deploy-${ENVIRONMENT}` at path
#      `/eventpulse-deploy/` with a tight three-condition trust policy:
#        - StringEquals on aud=sts.amazonaws.com
#        - StringEquals on sub=repo:${GITHUB_REPO}:environment:${ENVIRONMENT}
#          (the workflow uses `environment:` which makes GitHub set the
#          sub claim to environment-format, NOT ref-format — see
#          `.claude/memory/gotchas.md` "GitHub Environments override the
#          OIDC sub claim from ref:refs/heads/X to environment:Y")
#        - StringEquals on job_workflow_ref pinning to a specific
#          workflow file at ${BRANCH}, so a malicious PR that copies the
#          workflow file under a different name or adds a new workflow
#          using the staging environment fails the trust check cleanly
#      Net protection: only the deploy-${ENVIRONMENT}.yml workflow file,
#      only when running from ${BRANCH}, with the ${ENVIRONMENT}
#      environment set, can assume the role.
#   3. Attach an inline policy granting ssm:SendCommand on the staging
#      EC2 instance + AWS-RunShellScript document, plus ssm:GetCommandInvocation
#      and ssm:ListCommandInvocations scoped to the deploy region. No `*`
#      resources on SendCommand.
#
# Idempotent: detects existing provider/role/policy and reapplies settings
# (creates them if absent, updates them if present).
#
# Usage:
#   ENVIRONMENT=staging \
#   AWS_PROFILE=eventpulse \
#   GITHUB_REPO=publicpulseagency/EventPulse \
#   BRANCH=main \
#   INSTANCE_ID=i-02e4fddeb923c14f9 \
#     ./infra/scripts/setup-github-oidc.sh
#
# After the script completes:
#   gh secret set AWS_OIDC_ROLE_STAGING --body "<role-arn>" --repo <repo>
#
# Required env:
#   ENVIRONMENT   — `staging` or `prod` (informs role name + tags)
#   AWS_PROFILE   — local AWS CLI profile with admin perms
#   GITHUB_REPO   — `owner/name` of the repo authorised to assume the role
#   BRANCH        — git ref to authorise (typically `main` for staging,
#                   `prod` for production)
#   INSTANCE_ID   — EC2 instance id the role can SSM-SendCommand to
# Optional env:
#   AWS_REGION    — default ap-southeast-1
#
# Required IAM (on the user running this script):
#   iam:CreateOpenIDConnectProvider, GetOpenIDConnectProvider,
#       UpdateOpenIDConnectProviderThumbprint
#   iam:CreateRole, GetRole, PutRolePolicy, UpdateAssumeRolePolicy,
#       ListRoleTags, TagRole

set -euo pipefail

: "${ENVIRONMENT:?must be set: staging|prod}"
: "${AWS_PROFILE:?must be set: AWS CLI profile with admin perms}"
: "${GITHUB_REPO:?must be set: owner/name (e.g. publicpulseagency/EventPulse)}"
: "${BRANCH:?must be set: branch authorised to assume the role (e.g. main)}"
: "${INSTANCE_ID:?must be set: EC2 instance id the role can SSM-target}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "prod" ]]; then
  echo "ERROR: ENVIRONMENT must be 'staging' or 'prod' (got '$ENVIRONMENT')"
  exit 1
fi

ROLE_NAME="eventpulse-deploy-${ENVIRONMENT}"
ROLE_PATH="/eventpulse-deploy/"
INLINE_POLICY_NAME="${ROLE_NAME}-ssm"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

for bin in aws python3 jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: $bin not on PATH"; exit 1; }
done

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] setup-github-oidc: $*"; }
aws_cli() { aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }

AWS_ACCOUNT_ID="$(aws_cli sts get-caller-identity --query Account --output text)"
log "account: $AWS_ACCOUNT_ID, region: $AWS_REGION, env: $ENVIRONMENT"
log "role: $ROLE_NAME, repo: $GITHUB_REPO, branch: $BRANCH, instance: $INSTANCE_ID"

# ─── 1) GitHub Actions OIDC provider ────────────────────────────────────

log "step 1: GitHub Actions OIDC provider"

OIDC_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if aws_cli iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  log "  OIDC provider exists at $OIDC_ARN"
else
  log "  creating OIDC provider"
  aws_cli iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd \
    --tags Key=managed-by,Value=setup-github-oidc.sh Key=purpose,Value=github-actions-oidc \
    --query 'OpenIDConnectProviderArn' --output text >/dev/null
  log "  created $OIDC_ARN"
fi

# ─── 2) Role + trust policy ─────────────────────────────────────────────

log "step 2: IAM role $ROLE_NAME (branch-scoped to refs/heads/$BRANCH on $GITHUB_REPO)"

cat > "$WORK_DIR/trust-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GitHubActionsOIDC${ENVIRONMENT^}DeployWorkflowOn${BRANCH^}",
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:environment:${ENVIRONMENT}",
          "token.actions.githubusercontent.com:job_workflow_ref": "${GITHUB_REPO}/.github/workflows/deploy-${ENVIRONMENT}.yml@refs/heads/${BRANCH}"
        }
      }
    }
  ]
}
EOF

if aws_cli iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "  role exists -> updating trust policy"
  aws_cli iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "file://${WORK_DIR}/trust-policy.json"
else
  log "  creating role at path $ROLE_PATH"
  aws_cli iam create-role \
    --role-name "$ROLE_NAME" \
    --path "$ROLE_PATH" \
    --description "Event Pulse ${ENVIRONMENT} deploy - assumed via GitHub Actions OIDC from refs/heads/${BRANCH} only" \
    --assume-role-policy-document "file://${WORK_DIR}/trust-policy.json" \
    --max-session-duration 3600 \
    --tags Key=managed-by,Value=setup-github-oidc.sh \
           Key=env,Value="$ENVIRONMENT" \
           Key=purpose,Value=github-actions-deploy \
    --query 'Role.Arn' --output text >/dev/null
fi

ROLE_ARN="$(aws_cli iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"
log "  role ARN: $ROLE_ARN"

# ─── 3) Inline SSM policy ───────────────────────────────────────────────

log "step 3: inline SSM policy $INLINE_POLICY_NAME"

cat > "$WORK_DIR/inline-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SsmSendCommandTo${ENVIRONMENT^}EC2OnlyViaRunShellScript",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:${AWS_REGION}:${AWS_ACCOUNT_ID}:instance/${INSTANCE_ID}",
        "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:managed-instance/${INSTANCE_ID}",
        "arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "SsmReadCommandResultsOn${ENVIRONMENT^}EC2",
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:*"
    },
    {
      "Sid": "SsmListCommandInvocations${ENVIRONMENT^}RegionScoped",
      "Effect": "Allow",
      "Action": "ssm:ListCommandInvocations",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${AWS_REGION}"
        }
      }
    }
  ]
}
EOF

aws_cli iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$INLINE_POLICY_NAME" \
  --policy-document "file://${WORK_DIR}/inline-policy.json"

log "  inline policy attached"

# ─── Done ───────────────────────────────────────────────────────────────

log "done."
log "  Role ARN: $ROLE_ARN"
log "  OIDC ARN: $OIDC_ARN"
log ""
log "Next: register the role ARN as the GitHub secret AWS_OIDC_ROLE_${ENVIRONMENT^^}"
log "  gh secret set AWS_OIDC_ROLE_${ENVIRONMENT^^} --body \"$ROLE_ARN\" --repo $GITHUB_REPO"
log ""
log "Then flip the gate:"
log "  gh variable set ${ENVIRONMENT^^}_DEPLOY_ENABLED --body true --repo $GITHUB_REPO"
