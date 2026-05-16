# Security Policy

Event Pulse is a payment-handling SaaS platform. Vulnerabilities, regardless of severity, are taken seriously.

## Reporting a vulnerability

**Email `security@eventpulse.com.bd`.** Do not file a public GitHub issue.

We commit to:

- **First response within 72 hours**, every day of the year.
- Treating researchers acting in good faith under safe-harbour terms documented at <https://eventpulse.com.bd/trust/security/disclosure>.
- Crediting the reporter (if desired) in the changelog at <https://eventpulse.com.bd/legal/changelog> once a fix has shipped.

## What to include

- A clear description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept that demonstrates the issue without affecting real tenant data.
- Affected environment (staging / production) and the approximate time of discovery so we can correlate with our logs.
- Suggested remediation, if you have one.

## What we ask

- Do not access, modify, or delete data belonging to anyone other than yourself or accounts you control.
- Do not run scans that degrade availability for real tenants or attendees.
- Do not publicly disclose the vulnerability until we've shipped a fix and (where appropriate) notified affected tenants.

## Supported versions

The latest release on `prod` is the only supported version. The `main` branch is the staging build and is supported for security fixes that affect imminent production cuts.

## Related

- Vulnerability Disclosure (full safe-harbour policy): <https://eventpulse.com.bd/trust/security/disclosure>
- Acceptable Use Policy: <https://eventpulse.com.bd/trust/acceptable-use>
- Trust Center: <https://eventpulse.com.bd/trust>
