# SNS bounce/complaint suppression-list — AWS-side wiring runbook

> **Status:** runbook. Created Day 39 Phase 4 (2026-05-31). **DOCUMENTED BUT NOT EXECUTED.** AWS-side wiring (SNS topics + IAM + SES Configuration Set hookup) is a STOP-ASK gate per Day 39 Phase 4 prompt; the code-only PR ships first (this runbook references the merged code), and the AWS writes happen in a separate operator-authorised session.
>
> **Purpose:** end-to-end AWS resource creation + Configuration Set wiring so that SES bounce + complaint events flow as SNS notifications to the platform's webhook endpoints (`/api/v1/webhooks/ses-bounce` + `/api/v1/webhooks/ses-complaint`) that ship with this PR.
>
> **Gates `MAIL_DRY_RUN=0` flip** per the AWS Support case 177899559700777 reply commitment.

## Cross-references

- `decisions.md` 2026-05-31 "SES production access GRANTED ... NEW PRE-LAUNCH COMMITMENT" (the canonical commitment to AWS)
- This PR's commits — `email_suppression_list` schema, `verify-signature.ts`, `ses-bounce.ts` + `ses-complaint.ts` webhooks, `client.ts` outbound-send guard
- CLAUDE.md §10.5 (`/api/v1/webhooks/ses-bounce.ts` + `ses-complaint.ts` previously listed as planned)
- CLAUDE.md §16.1 (SES email channel)

## Hard preconditions

1. **SES production access live** in `ap-southeast-1` ✅ (resolved 2026-05-31 per `decisions.md`).
2. **`email_suppression_list` migration applied to staging Postgres** (`0014_email_suppression_list.sql`; this PR).
3. **Application code deployed** with the webhook routes wired (this PR landed on main + deployed to the EC2).
4. **Webhook URL TLS** — staging + production EC2 already serve over HTTPS via the wildcard Let's Encrypt cert (per `decisions.md` Day 37 infrastructure entries).
5. **Operator on-call** for the AWS Console writes + first signature verification round-trip.

## Resources to create

### 1. SNS topics (two — separate per AWS event type)

```bash
aws sns create-topic --profile eventpulse --region ap-southeast-1 \
  --name eventpulse-ses-bounces-prod \
  --tags Key=Environment,Value=prod Key=Service,Value=ses-feedback Key=Owner,Value=eventpulse
aws sns create-topic --profile eventpulse --region ap-southeast-1 \
  --name eventpulse-ses-complaints-prod \
  --tags Key=Environment,Value=prod Key=Service,Value=ses-feedback Key=Owner,Value=eventpulse
```

Record both ARNs.

### 2. SNS HTTPS subscriptions to platform webhooks

```bash
aws sns subscribe --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-bounces-prod \
  --protocol https \
  --notification-endpoint https://api.eventpulse.com.bd/api/v1/webhooks/ses-bounce

aws sns subscribe --profile eventpulse --region ap-southeast-1 \
  --topic-arn arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-complaints-prod \
  --protocol https \
  --notification-endpoint https://api.eventpulse.com.bd/api/v1/webhooks/ses-complaint
```

AWS sends `SubscriptionConfirmation` to the endpoint immediately. The webhook handler (`ses-bounce.ts` + `ses-complaint.ts`) fetches the `SubscribeURL` to confirm. The subscription transitions to `Confirmed` state.

**Verify subscription is Confirmed:**

```bash
aws sns list-subscriptions-by-topic --profile eventpulse --region ap-southeast-1 \
  --topic-arn <topic-arn> --query 'Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint,Status:SubscriptionArn}'
```

The `SubscriptionArn` will be the full ARN (not `PendingConfirmation`) when the confirmation has succeeded.

### 3. SES Configuration Set + event destinations

```bash
aws sesv2 create-configuration-set --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-prod \
  --reputation-options ReputationMetricsEnabled=true

# Route bounces to the bounces SNS topic
aws sesv2 create-configuration-set-event-destination --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-prod \
  --event-destination-name bounces-to-sns \
  --event-destination "Enabled=true,MatchingEventTypes=BOUNCE,SnsDestination={TopicArn=arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-bounces-prod}"

# Route complaints to the complaints SNS topic
aws sesv2 create-configuration-set-event-destination --profile eventpulse --region ap-southeast-1 \
  --configuration-set-name eventpulse-prod \
  --event-destination-name complaints-to-sns \
  --event-destination "Enabled=true,MatchingEventTypes=COMPLAINT,SnsDestination={TopicArn=arn:aws:sns:ap-southeast-1:739275468267:eventpulse-ses-complaints-prod}"
```

### 4. IAM — SES → SNS publish permission

SES needs IAM permission to publish to the SNS topics. The simplest path is a topic-level policy. Apply to BOTH topics:

```bash
cat > /tmp/sns-topic-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ses.amazonaws.com" },
    "Action": "sns:Publish",
    "Resource": "<topic-arn>",
    "Condition": {
      "StringEquals": { "AWS:SourceAccount": "739275468267" },
      "StringLike": { "AWS:SourceArn": "arn:aws:ses:ap-southeast-1:739275468267:*" }
    }
  }]
}
EOF
aws sns set-topic-attributes --profile eventpulse --region ap-southeast-1 \
  --topic-arn <topic-arn> --attribute-name Policy --attribute-value file:///tmp/sns-topic-policy.json
```

Repeat for the complaints topic. Substitute `<topic-arn>` with each topic's ARN.

### 5. Set `AWS_SES_CONFIGURATION_SET` env var

On the production EC2 (when prod is provisioned; on staging immediately):

```bash
aws ssm send-command --profile eventpulse --instance-ids <EC2-INSTANCE-ID> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["sudo -u eventpulse pm2 set AWS_SES_CONFIGURATION_SET eventpulse-prod && sudo -u eventpulse pm2 reload api"]'
```

This wires every outbound SES SendEmail through the Configuration Set, which fans out bounce + complaint events to the SNS topics.

## End-to-end verification

After all writes land:

1. **Bounce simulation** — use SES's built-in [mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-email-simulator.html) to send to `bounce@simulator.amazonses.com`:

   ```bash
   # Run from the EC2 (using the platform's SES client)
   aws sesv2 send-email --profile eventpulse --region ap-southeast-1 \
     --from-email-address "Event Pulse <hello@eventpulse.com.bd>" \
     --destination 'ToAddresses=["bounce@simulator.amazonses.com"]' \
     --content 'Simple={Subject={Data="Bounce test",Charset=UTF-8},Body={Text={Data="test",Charset=UTF-8}}}' \
     --configuration-set-name eventpulse-prod
   ```

2. **Verify the SNS subscription delivered to the webhook** by checking application logs for `webhook.ses.bounce.suppressed` lines.

3. **Verify the suppression row** in `email_suppression_list`:

   ```sql
   SELECT email, reason, source_message_id, created_at
   FROM email_suppression_list
   WHERE email = 'bounce@simulator.amazonses.com';
   ```

4. **Verify the outbound-send guard blocks subsequent sends** to `bounce@simulator.amazonses.com`:

   ```bash
   # Attempt a second send; sendEmail() should return {suppressed: true}
   ```

   Application log line: `ses.send.suppressed`.

5. **Complaint simulation** — repeat steps 1–4 with `complaint@simulator.amazonses.com`.

## Rollback

If anything misbehaves:

1. Unsubscribe the HTTPS subscriptions: `aws sns unsubscribe --subscription-arn <arn>`
2. Delete the Configuration Set event destinations (bounces + complaints).
3. Either disable the Configuration Set entirely OR delete it.
4. Unset `AWS_SES_CONFIGURATION_SET` on the EC2 + `pm2 reload api`.
5. Suppression-list entries persist in Postgres (not auto-cleared on rollback). Manual cleanup if needed:

   ```sql
   DELETE FROM email_suppression_list WHERE email IN ('bounce@simulator.amazonses.com', 'complaint@simulator.amazonses.com');
   ```

## Post-launch

Once verified, this runbook is reusable on the production EC2 when it's provisioned (just substitute `staging` resource names with `prod` equivalents and update the webhook URL host to `api.eventpulse.com.bd` for the prod Route 53 record).

Periodic ops checks:

- `SELECT COUNT(*) FROM email_suppression_list GROUP BY reason` — confirm bounce/complaint rates are not climbing
- CloudWatch alarms on the SNS topics' `NumberOfNotificationsFailed` metric (would indicate webhook delivery failures)
- AWS SES reputation dashboard — bounce rate < 5%, complaint rate < 0.1%

## Operator authorisation gate (STOP-ASK)

**This runbook is documented but NOT executed.** Per Day 39 Phase 4 prompt + decisions.md operator-authorisation discipline:

- AWS Console writes (SNS topic creation, IAM policy attachment, Configuration Set creation) require explicit operator authorisation
- AWS CLI commands above MUST be reviewed by the operator before execution
- The webhook endpoints accept inbound traffic from `0.0.0.0/0` (they have to — SNS publishes from AWS's outbound IPs); the SNS signature verification (`verify-signature.ts`) is the entire auth boundary
- Execution session opens separately when operator authorises (probably the same session as the prod EC2 cutover)
