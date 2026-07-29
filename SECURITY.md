# Security Policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
GitHub **Security** tab to submit a private vulnerability report to the
maintainers. Include reproduction steps, affected routes or pipeline stages,
and any suggested mitigation.

## Operational security requirements

- Store Entra credentials and `SESSION_SECRET` in the deployment platform's
  secret store; never commit them.
- Set `APP_BASE_URL` to the canonical HTTPS origin. Azure App Service can use
  `WEBSITE_HOSTNAME` automatically when this value is omitted.
- Use a random `SESSION_SECRET` of at least 32 characters in production.
- Protect `main` with required build checks and reviewer approval.
- Prefer workload identity federation over long-lived client secrets for Azure
  deployment authentication.
- Rotate deployment credentials and session secrets after suspected exposure.
