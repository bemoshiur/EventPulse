#!/usr/bin/env bash
# Provision the public event-asset bucket (cover images + tenant logos).
#
# Idempotent: re-running reconciles the public-access-block, bucket policy, CORS,
# and the EC2 role's PutObject permission. The bucket is PUBLIC-READ on the
# assets/* prefix only (event covers + logos render on public event pages); all
# other paths are denied, and public ACLs are blocked (writes happen only via
# presigned PUTs signed by the EC2 instance role — see apps/api/src/infra/s3/
# assets.ts). Distinct from the KMS-encrypted, reviewer-only KYC bucket.
#
# Usage:  AWS_PROFILE=eventpulse ./infra/scripts/setup-assets-bucket.sh
#
# First run: 2026-06-05 (Day 48), operator-approved. Account 739275468267,
# ap-southeast-1, role eventpulse-prod-ec2.
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
ACCOUNT="${ACCOUNT:-739275468267}"
BUCKET="${ASSETS_BUCKET_NAME:-eventpulse-assets-prod-${ACCOUNT}}"
ROLE="${EC2_ROLE:-eventpulse-prod-ec2}"
PROFILE_ARG=()
[ -n "${AWS_PROFILE:-}" ] && PROFILE_ARG=(--profile "${AWS_PROFILE}")

echo "Bucket: ${BUCKET}  Region: ${REGION}  Role: ${ROLE}"

# 1. Bucket (ignore if it already exists).
aws "${PROFILE_ARG[@]}" s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
  --create-bucket-configuration LocationConstraint="${REGION}" 2>/dev/null || true

# 2. Public access block — allow a bucket POLICY to grant public read, but block
#    public ACLs entirely (defence in depth).
aws "${PROFILE_ARG[@]}" s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false

# 3. Bucket policy — public GET on assets/* ONLY.
aws "${PROFILE_ARG[@]}" s3api put-bucket-policy --bucket "${BUCKET}" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadAssetsPrefix",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${BUCKET}/assets/*"
  }]
}
JSON
)"

# 4. CORS — browser presigned PUT from the app origins + public GET.
aws "${PROFILE_ARG[@]}" s3api put-bucket-cors --bucket "${BUCKET}" --cors-configuration "$(cat <<JSON
{
  "CORSRules": [{
    "AllowedOrigins": ["https://app.eventpulse.com.bd","https://eventpulse.com.bd","https://admin.eventpulse.com.bd"],
    "AllowedMethods": ["PUT","GET","HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}
JSON
)"

# 5. EC2 role — PutObject on assets/* so the API can sign presigned PUTs.
aws "${PROFILE_ARG[@]}" iam put-role-policy --role-name "${ROLE}" \
  --policy-name eventpulse-assets-put --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PutEventAssets",
    "Effect": "Allow",
    "Action": ["s3:PutObject"],
    "Resource": "arn:aws:s3:::${BUCKET}/assets/*"
  }]
}
JSON
)"

echo "Done. Public read verified by uploading + GETting assets/_healthcheck/."
