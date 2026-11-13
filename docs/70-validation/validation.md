# Validation Guide

Validation snapshot: `2026-11-13`.

## Automated baseline

Run from the repository root with Node.js 24.x:

```bash
npm ci
npm run check
```

`npm run check` is the required local and pipeline gate. It runs:

1. An exact Node.js major-version check for Node 24.
2. ESLint static analysis.
3. Node's test runner and HTTP tests through Supertest.
4. `npm audit --omit=dev --audit-level=high`.

The production dependency lockfile includes patched versions for the reported
audit advisories, including `@azure/msal-node@7.2.2`. Automated HTTP tests do
not perform an upstream Entra token exchange; after MSAL upgrades, also follow
the sign-in steps under Authentication validation. The HTTP suite verifies:

- the home page renders;
- CSP and security headers are present;
- Express fingerprinting is disabled;
- `/health` returns only `{ "status": "ready" }` without redirecting (`/healthz` remains an alias);
- `/metrics` returns Prometheus-compatible operational counters without identity claims or tokens;
- authentication redirects ignore an untrusted request `Host` when
  `APP_BASE_URL` is configured;
- unknown routes return a branded `404`.

YAML files should also be parsed before publishing:

```bash
npx --yes yaml-lint .github/dependabot.yml \
  .github/workflows/azure-webapp.yml \
  .github/workflows/container-image.yml \
  azure-pipelines.yml \
  azure-pipelines/deploy-stage.yml \
  run_from_package.yml
```

## Container image and mirror validation

The container workflow builds on every `main` push in the source repository and the public mirror. It publishes the `latest` tag for the default branch and a full commit SHA tag to GHCR. Check the [public mirror Actions runs](https://github.com/andyxuan2010/web-ccoedemo-node/actions) and confirm that **Build and publish container image** completes successfully after a mirror update.

Build and run locally with a runtime session secret of at least 32 characters:

```bash
docker build -t web-ccoedemo-node .
docker run --rm -d --name web-ccoedemo-node -p 3000:3000 -e SESSION_SECRET="replace-with-a-random-secret-of-at-least-32-characters" web-ccoedemo-node
curl --fail http://localhost:3000/health
docker stop web-ccoedemo-node
```

The image uses Node.js 24 and runs as the unprivileged `node` user. Entra credentials and `SESSION_SECRET` are supplied at runtime and are not copied into the image.

## Local runtime

```bash
copy .env.example .env
# Fill in the Entra values and replace SESSION_SECRET.
npm start
```

Open `http://localhost:3000`. Confirm the landing page and static images load,
then check:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/profile/msal
```

The health endpoint returns `200`; the unauthenticated profile request redirects
to MSAL login.

## Authentication validation

MSAL:

1. Set the Entra redirect URI to the exact deployed callback URL.
2. Sign in through `/login/msal`.
3. Confirm the callback state is accepted and `/profile/msal` renders claims.
4. Confirm a modified or missing `state` does not authenticate a session.
5. Confirm logout clears the local MSAL session.

Easy Auth:

1. Enable App Service Authentication for the target.
2. Sign in through `/login/easyauth`.
3. Confirm `/profile/easyauth` renders claims supplied by
   `X-MS-CLIENT-PRINCIPAL`.
4. Confirm logout routes through `/.auth/logout`.

Production configuration:

- `NODE_ENV=production`
- random `SESSION_SECRET` with at least 32 characters
- canonical HTTPS `APP_BASE_URL` (recommended)
- Entra secrets supplied by the platform secret store
- HTTPS-only ingress

The process intentionally refuses to start in production with a missing or
short session secret.

## Pipeline and GitOps validation

GitHub Actions triggers for `main` and pull requests targeting `main`. Azure
DevOps triggers for `main`, `dev`, and `sbx` pushes and pull requests. Both run
the common `npm run check` gate and use `scripts/stage-package.js` to publish a
self-contained ZIP with production `node_modules`. App Service remote build is
disabled because dependencies are installed and pruned on the CI runner.

Before enabling deployment:

- protect `main` and require the build check plus reviewer approval;
- protect deployment environments with approvers;
- use workload identity federation where possible;
- scope service connections to the target resources;
- store credentials only in GitHub Environments or Azure DevOps secret
  variables;
- keep `persistCredentials: false` on Azure DevOps checkout;
- verify the external shared-runner template reference is controlled and
  reviewed.

Post-deploy:

```bash
curl --fail --silent --show-error https://<app-host>/health
curl --fail --silent --show-error https://<app-host>/
```

For the GitHub staging mirror, verify that `.github/workflows/container-image.yml`
is present and the repository has no open pull requests or non-`main` branches.
The container workflow should run after mirror pushes to `main`; source-only
Azure deployment automation remains gated by `IS_ORIGIN`.

Also confirm the configured runtime:

- Windows: `WEBSITE_NODE_DEFAULT_VERSION=~24`
- Linux: `linuxFxVersion=NODE|24-lts` and startup command `cd /home/site/wwwroot && npm start`

## Repository and branch hygiene

Inspect local state and refresh remote-tracking references before a release:

```bash
git status --short --branch
git fetch --all --prune
git branch --all
git remote prune --dry-run origin
```

Use `git ls-remote --heads <remote>` when the authoritative server-side branch
list is needed without changing local references. Delete a branch only after
confirming that it is merged or intentionally abandoned; branch cleanup is not
part of the application validation gate.

## Known operational constraint

The demo uses the in-memory `express-session` store. It is acceptable for a
single-instance demonstration but not for production scale-out. Configure a
shared session store before running multiple instances.
