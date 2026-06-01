# SNS bounce/complaint suppression-list — AWS-side wiring runbook

> **Status:** runbook. Created Day 39 Phase 4 (2026-05-31). **Executed end-to-end on staging Day 40 (2026-06-01) — runbook updated with the corrections that surfaced during execution.** The procedure ran through 8 STOP-ASK-gated steps; 2 bugs surfaced + were codified into `.claude/memory/gotchas.md` and into this runbook (Sections 2.2 SignatureVersion-2 attribute + 2.3 webhook allowlist env vars — both originally missing from the Day 39 draft).
>
> **Purpose:** end-to-end AWS resource creation + Configuration Set wiring so that SES bounce + complaint events flow as SNS notifications to the platform's webhook endpoints (`/api/v1/webhooks/ses-bounce` + `/api/v1/webhooks/ses-complaint`) that ship with this PR.
>
> **Gates `MAIL_DRY_RUN=0` flip** per the AWS Support case 177899559700777 reply commitment.

## Cross-references

- `decisions.md` 2026-05-31 "SES production access GRANTED ... NEW PRE-LAUNCH COMMITMENT"
- `decisions.md` 2026-06-01 Day 40 EOD "Phase 4 SNS bounce/complaint suppression-list AWS-side wiring SHIPPED end-to-end"
- `gotchas.md` top 3 entries (Day 40): `eventType` vs `notificationType`; SNS SignatureVersion=1 default; pm2-reload-source pattern
- This PR's commits — `email_suppression_list` schema, `verify-signature.ts`, `ses-bounce.ts` + `ses-complaint.ts` webhooks, `client.ts` outbound-send guard
- PR #239 (Day 40): `fix(notifications): accept SES eventType + notificationType envelopes` — load-bearing for the Configuration Set event-publishing path
- CLAUDE.md §10.5 (webhooks) + §16.1 (SES email channel)

## Hard preconditions

1. **SES production access live** in `ap-southeast-1` ✅ (resolved 2026-05-31 per `decisions.md`).
2. **`email_suppression_list` migration applied** (`0014_email_suppression_list.sql`).
3. **Application code deployed** with the webhook routes wired AND the `eventType` envelope fix (PR #239 — without it, Configuration Set event destinations produce `webhook.ses.message_unparseable` in the api log).
4. **Webhook URL TLS** — staging + production EC2 already serve over HTTPS via the wildcard Let's Encrypt cert (per `decisions.md` Day 37 infrastructure entries).
5. **Operator on-call** for AWS Console writes + first signature verification round-trip.

## Resources to create (in this order — order is load-bearing)

> **Order rationale.** The naive sequence "create topic → subscribe → wire SES" silently fails at subscription confirmation because (a) the topic still uses SignatureVersion=1 (default) which `verify-signature.ts` rejects, and (b) the webhook's TopicArn allowlist is empty (env vars unset) so it rejects everything fail-closed. The correct order pairs every resource creation with the matching guardrail before moving on.

### 2.1 Create 2 SNS topics

Substitute `<env>` with `staging` or `prod` per the environment you're wiring.

```bash
aws sns create-topic --profile eventpulse --region ap-southeast-1 \
  --name eventpulse-ses-bounces-<env> \
  --tags Key=Environment,Value=<env> Key=Service,Value=ses-feedback Key=Owner,Value=eventpulse

aws sns create-topic --profile eventpulse --region ap-southeast-1 \
  --name eventpulse-ses-complaints-<env> \
  --tags Key=Environment,Value=<env> Key=Service,Value=ses-feedback Key=Owner,Value=eventpulse
```

Record both ARNs for use in subsequent steps.

### 2.2 Opt each topic into SignatureVersion=2 (LOAD-BEARING — added Day 40)

> **Why this exists.** SNS topics default to `SignatureVersion=1` (legacy SHA1-RSA). `apps/api/src/infra/sns/verify-signature.ts` ONLY accepts version 2 per the JSDoc rationale "current AWS recommendation". Without this attribute set, subscription confirmation POSTs are rejected with `verify:"bad_signature_version"` and subscriptions remain in `PendingConfirmation` indefinitely.
>
> There is no account-level default switch — every topic creation must be paired with this attribute set. **Bundle this with §2.1 in any future runbook executions.** See `gotchas.md` "SNS HTTPS subscriptions default to SignatureVersion=1; topics must opt into v2 per-topic".

```bash
aws sns set-topic-attributes --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-bounces-<env> \
  --attribute-name SignatureVersion --attribute-value 2

aws sns set-topic-attributes --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-complaints-<env> \
  --attribute-name SignatureVersion --attribute-value 2
```

Verify:

```bash
aws sns get-topic-attributes --topic-arn <topic-arn> --query 'Attributes.SignatureVersion' --output text
# Expected output: 2
```

### 2.3 Set webhook TopicArn allowlist env vars on EC2 (LOAD-BEARING — added Day 40)

> **Why this exists.** The webhook handlers (`ses-bounce.ts` + `ses-complaint.ts`) fail-closed when the topic-allowlist env vars are unset. This is the load-bearing trust-source check per Phase 4 PR #236's security review — without it, an attacker with their own AWS account could send legitimately-signed SNS messages from their own topics and either onboard via auto-confirm or spray suppression entries. **Must come BEFORE §2.5 subscriptions** or SubscriptionConfirmation POSTs are rejected with `verify:"topic_not_allowed"`.

Append the env vars + reload the api with the source-pattern wrapper (see `gotchas.md` "`pm2 reload --update-env` only sees env vars from the parent shell"). For staging EC2:

```bash
# Via SSM AWS-RunShellScript on the staging EC2:
sudo -u eventpulse bash -c 'cat >> /home/eventpulse/.env.staging <<EOF

# Phase 4 SNS allowlist for verify-signature.ts
SES_BOUNCE_TOPIC_ARNS=arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-bounces-<env>
SES_COMPLAINT_TOPIC_ARNS=arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-complaints-<env>
EOF'

# Reload with parent-shell env source (load-bearing — see gotcha)
sudo -u eventpulse bash -c '
  set -a
  source /home/eventpulse/.env.staging
  set +a
  pm2 reload api --update-env
'
```

Verify the new env vars are visible to the running api process:

```bash
API_PID=$(sudo -u eventpulse pm2 pid api)
sudo cat /proc/$API_PID/environ | tr '\0' '\n' | grep -E 'SES_BOUNCE_TOPIC_ARNS|SES_COMPLAINT_TOPIC_ARNS'
# Expected: both lines printed with the matching ARNs
```

### 2.4 Apply IAM topic policy on both topics (SES → SNS publish permission)

SES needs IAM permission to publish to each SNS topic. Apply the policy below to BOTH topics, substituting `<topic-arn>` with each topic's ARN. The `SourceAccount` + `SourceArn` conditions provide confused-deputy protection.

```bash
cat > /tmp/sns-topic-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowSESPublishFromAccount",
    "Effect": "Allow",
    "Principal": { "Service": "ses.amazonaws.com" },
    "Action": "sns:Publish",
    "Resource": "<topic-arn>",
    "Condition": {
      "StringEquals": { "AWS:SourceAccount": "<account-id>" },
      "StringLike":   { "AWS:SourceArn":     "arn:aws:ses:ap-southeast-1:<account-id>:*" }
    }
  }]
}
EOF
aws sns set-topic-attributes --profile eventpulse --region ap-southeast-1 \
  --topic-arn <topic-arn> --attribute-name Policy --attribute-value file:///tmp/sns-topic-policy.json
```

Repeat for the complaints topic. Substitute `<topic-arn>` with each topic's ARN. Read back via `get-topic-attributes` to confirm the policy landed.

### 2.5 Subscribe webhook URLs to topics (HTTPS subscriptions)

With §2.2 (SignatureVersion=2) + §2.3 (allowlist env vars) + §2.4 (IAM publish permission) all in place, subscriptions can be created and the webhook handler will auto-confirm them:

```bash
aws sns subscribe --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-bounces-<env> \
  --protocol https \
  --notification-endpoint https://api.<env>.eventpulse.com.bd/api/v1/webhooks/ses-bounce

aws sns subscribe --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-complaints-<env> \
  --protocol https \
  --notification-endpoint https://api.<env>.eventpulse.com.bd/api/v1/webhooks/ses-complaint
```

AWS sends `SubscriptionConfirmation` to each webhook URL immediately. The webhook (`ses-bounce.ts` + `ses-complaint.ts`):

1. Validates TopicArn against the env-var allowlist (§2.3)
2. Validates SignatureVersion=2 (§2.2)
3. Validates SigningCertURL host matches `sns.<region>.amazonaws.com`
4. Verifies RSA-SHA256 signature
5. Validates SubscribeURL host before fetching it
6. Fetches SubscribeURL → AWS marks subscription `Confirmed`

The subscription transitions from `PendingConfirmation` to a full ARN. **Verify subscription is Confirmed:**

```bash
aws sns list-subscriptions-by-topic --profile eventpulse --region ap-southeast-1 \
  --topic-arn <topic-arn> --query 'Subscriptions[].SubscriptionArn' --output text
# Expected output: the full ARN (not "PendingConfirmation")
```

Also verify the api log shows the `subscription_confirm` info line:

```text
{"level":30,"webhook":"ses-bounce","topicArn":"...","msg":"webhook.sns.subscription_confirm"}
{"level":30,"webhook":"ses-complaint","topicArn":"...","msg":"webhook.sns.subscription_confirm"}
```

> **Recovery from stuck PendingConfirmation.** Subscriptions stuck in PendingConfirmation cannot be unsubscribed via the API. Issuing a fresh subscribe call generates a new pending subscription that's signed with the topic's current SignatureVersion (i.e., v2 after §2.2). The old PendingConfirmation entry is silently GC'd by AWS within hours.

### 2.6 Create SES Configuration Set + 2 event destinations

```bash
aws sesv2 create-configuration-set --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-<env> \
  --reputation-options ReputationMetricsEnabled=true

# Route bounces to the bounces SNS topic
aws sesv2 create-configuration-set-event-destination --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-<env> \
  --event-destination-name bounces-to-sns \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["BOUNCE"],"SnsDestination":{"TopicArn":"arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-bounces-<env>"}}'

# Route complaints to the complaints SNS topic
aws sesv2 create-configuration-set-event-destination --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-<env> \
  --event-destination-name complaints-to-sns \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["COMPLAINT"],"SnsDestination":{"TopicArn":"arn:aws:sns:ap-southeast-1:<account-id>:eventpulse-ses-complaints-<env>"}}'
```

Verify:

```bash
aws sesv2 get-configuration-set-event-destinations --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-<env>
# Expected: 2 event destinations, both Enabled=true, with the correct TopicArn values
```

### 2.7 Set `AWS_SES_CONFIGURATION_SET` env var on EC2

This is the LAST resource step — once set, every outbound SES SendEmail from the platform routes through the Configuration Set, which fans out bounce + complaint events to the SNS topics. Until this env var is set, outbound sends bypass the Config Set entirely and no events flow.

```bash
# Via SSM AWS-RunShellScript on the EC2:
sudo -u eventpulse bash -c 'cat >> /home/eventpulse/.env.<env> <<EOF

# Phase 4 SES Configuration Set for bounce/complaint routing
AWS_SES_CONFIGURATION_SET=eventpulse-<env>
EOF'

# Reload with parent-shell env source (load-bearing — see gotcha)
sudo -u eventpulse bash -c '
  set -a
  source /home/eventpulse/.env.<env>
  set +a
  pm2 reload api --update-env
'
```

Verify the var is visible to the running api process:

```bash
API_PID=$(sudo -u eventpulse pm2 pid api)
sudo cat /proc/$API_PID/environ | tr '\0' '\n' | grep AWS_SES_CONFIGURATION_SET
# Expected: AWS_SES_CONFIGURATION_SET=eventpulse-<env>
```

The platform's SES client at `apps/api/src/infra/ses/client.ts:120` reads this env var and passes it as `ConfigurationSetName` on every `SendEmail` call. When undefined the SDK correctly omits the parameter; when set, every send routes through the Config Set.

## End-to-end verification

After all writes land, run the mailbox-simulator round-trip:

1. **Bounce simulation** — use SES's built-in [mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-email-simulator.html) to send a test email to `bounce@simulator.amazonses.com` THROUGH the new Configuration Set:

   ```bash
   aws sesv2 send-email --profile eventpulse --region ap-southeast-1 \
     --from-email-address "Event Pulse <no-reply@eventpulse.com.bd>" \
     --destination 'ToAddresses=["bounce@simulator.amazonses.com"]' \
     --content '{"Simple":{"Subject":{"Data":"Phase 4 wiring smoke - bounce","Charset":"UTF-8"},"Body":{"Text":{"Data":"test","Charset":"UTF-8"}}}}' \
     --configuration-set-name eventpulse-<env>
   ```

   > Mailbox-simulator bounces/complaints [explicitly do NOT count](https://docs.aws.amazon.com/ses/latest/dg/send-email-simulator.html) against your reputation or bounce/complaint rate.

2. **Wait 30–60s** for the SES → Config Set event destination → SNS → webhook → suppression-list chain to propagate.

3. **Verify api log** shows the suppression info line:

   ```text
   {"level":30,"webhook":"ses-bounce","messageId":"...","emailHash":"...","reason":"hard_bounce","msg":"webhook.ses.bounce.suppressed"}
   ```

   If you see `webhook.ses.message_unparseable` instead, the `eventType` envelope fix (PR #239) is NOT in the deployed code — see Hard precondition #3.

4. **Verify the suppression row** in `email_suppression_list`:

   ```sql
   SELECT email, reason, source_message_id, suppressed_until, created_at
   FROM email_suppression_list
   WHERE email = 'bounce@simulator.amazonses.com';
   -- Expected: 1 row; reason='hard_bounce'; suppressed_until=NULL (permanent)
   ```

5. **Complaint simulation** — repeat steps 1–4 with `complaint@simulator.amazonses.com`. Expected reason on the suppression row: `complaint`; suppressed_until=NULL (permanent).

6. **Optional cleanup** — delete the test rows so the production suppression list doesn't carry them forward:

   ```sql
   DELETE FROM email_suppression_list
   WHERE email IN ('bounce@simulator.amazonses.com', 'complaint@simulator.amazonses.com');
   ```

7. **CloudWatch metrics** (optional sanity check):

   ```bash
   aws cloudwatch get-metric-statistics --profile eventpulse --region ap-southeast-1 \
     --namespace AWS/SNS --metric-name NumberOfMessagesPublished \
     --dimensions Name=TopicName,Value=eventpulse-ses-bounces-<env> \
     --start-time "$(date -u -d '-10 minutes' +%Y-%m-%dT%H:%M:%S)" \
     --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
     --period 60 --statistics Sum
   ```

   Expect at least 1 datapoint with Sum=1 for each topic.

## Outbound-send guard verification (optional)

After §2.3 + a bounce-simulator round-trip lands a row in `email_suppression_list`, attempt another send through the PLATFORM's SES client to the same address. The outbound-send guard at `apps/api/src/infra/ses/client.ts` consults `email_suppression_list` before every SES SendEmail call and short-circuits to log line `ses.send.suppressed`. The platform send returns `{suppressed: true}` without invoking SES.

Without an easy operational path to trigger a platform-initiated send to a specific test address (the platform's auto-flows go to real users like the buyer or KYC reviewer), this verification is typically deferred and the guard's behavior is trusted from the suppression-list service's unit tests. The Day 40 staging wiring did not exercise this path explicitly; the guard tests pass in CI and were exercised end-to-end at PR #236 + PR #239 review.

## Rollback

If anything misbehaves:

1. **Disable the Configuration Set OR unset `AWS_SES_CONFIGURATION_SET`** — fastest way to stop new events flowing. Remove the env var from `.env.<env>` + source-pattern reload. The platform falls back to no-Config-Set sends (no bounce/complaint routing, but mail still sends).
2. **Delete the Configuration Set event destinations** (2 calls).
3. **Delete the Configuration Set**.
4. **Unsubscribe the HTTPS subscriptions**: `aws sns unsubscribe --subscription-arn <arn>` (only works for fully-Confirmed subscriptions, not PendingConfirmation).
5. **Delete the SNS topics** (also cleans up any remaining subscriptions).
6. **Remove webhook allowlist env vars** (`SES_BOUNCE_TOPIC_ARNS`, `SES_COMPLAINT_TOPIC_ARNS`) from `.env.<env>` + source-pattern reload — webhooks revert to fail-closed on all messages.
7. **Suppression-list entries persist in Postgres** (not auto-cleared on rollback). Manual cleanup if needed:

   ```sql
   DELETE FROM email_suppression_list WHERE created_at > '<rollback-time>';
   ```

## Production cutover note

Day 40 executed this exact procedure on staging end-to-end. When production EC2 lands, run the same 7 sub-steps with:

- Substitute `staging` → `prod` in resource names
- Substitute `api.staging.eventpulse.com.bd` → `api.eventpulse.com.bd` in the webhook URLs
- Substitute `.env.staging` → `.env.production`

The application code (Phase 4 PR #236 + envelope fix PR #239) is the same; the AWS resources and EC2 env vars are environment-scoped.

## Periodic ops checks

- `SELECT COUNT(*) FROM email_suppression_list GROUP BY reason` — confirm bounce/complaint rates are not climbing
- CloudWatch alarms on the SNS topics' `NumberOfNotificationsFailed` metric (would indicate webhook delivery failures)
- AWS SES reputation dashboard — bounce rate < 5%, complaint rate < 0.1%

## Day 40 codified gotchas (must-read before re-running this runbook)

The Day 40 execution surfaced 3 gotchas that are codified in `.claude/memory/gotchas.md`:

1. **SES publishes bounce/complaint events to SNS with `eventType`, not `notificationType`.** Configuration Set event destinations (this runbook) use `eventType`; legacy `SetIdentityNotificationTopic` uses `notificationType`. PR #239 codified accepting both. Without the fix, the chain reaches `webhook.ses.message_unparseable` in api logs despite signature + cert + allowlist checks all passing.
2. **SNS topics default to `SignatureVersion=1`** (SHA1). `verify-signature.ts` only accepts v2. Section 2.2 of this runbook is the load-bearing opt-in step.
3. **`pm2 reload --update-env` only sees env vars from the parent shell.** Wrap with the `sudo -u eventpulse bash -c 'set -a; source /home/eventpulse/.env.<env>; set +a; pm2 reload api --update-env'` pattern. Sections 2.3 + 2.7 use this pattern; do not deviate.

## Operator authorisation gate (STOP-ASK)

Per Day 39 Phase 4 prompt + `decisions.md` operator-authorisation discipline:

- AWS Console writes (SNS topic creation, topic attributes, IAM policy attachment, Configuration Set creation, subscriptions) require explicit operator authorisation
- AWS CLI commands above MUST be reviewed by the operator before execution
- The webhook endpoints accept inbound traffic from `0.0.0.0/0` (they have to — SNS publishes from AWS's outbound IPs); the SNS signature verification (`verify-signature.ts`) + the env-var topic allowlist (`SES_BOUNCE_TOPIC_ARNS` + `SES_COMPLAINT_TOPIC_ARNS`) together are the entire auth boundary
- Execution session opens separately when operator authorises (for staging: Day 40 self-contained session; for production: lands as a sub-step of the production EC2 cutover ceremony per critical-path step [14])
