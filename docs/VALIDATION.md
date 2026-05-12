# Validation Guide - Node Demo

This checklist verifies behavior for the currently configured App Service targets in this repo:

- `web-platform-cc-sbx-node`
- `web-platform-eus-dev-node`

## Validation Snapshot

Repository scan performed on `2026-05-12`.

Checks completed locally from this workspace:

- `npm ci`: passed
- `node --check app.js`: passed
- Repo scan of `README.md`, `docs/`, `azure-pipelines.yml`, and `run_from_package.yml`: completed
- `npm audit --omit=dev`: reported 3 vulnerabilities

Validation limits from this workstation:

- The local machine is currently on Node `v22.21.0`, while the repo baseline and pipelines target Node `24`.
- A local HTTP smoke check against `http://127.0.0.1:3000/` could not be confirmed from this UNC-based workspace, so app startup validation here should be treated as partial rather than full runtime proof.

## 1. Prerequisites

- Node.js 24+ for the current repo baseline
- Valid Entra app registration credentials
- Access to the target Azure App Services used by the pipeline:
  - `web-platform-cc-sbx-node`
  - `web-platform-eus-dev-node`

## 2. Local Validation

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Syntax check:
   ```bash
   node --check app.js
   ```
3. Start app:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`.

Important:

- Use Node `24` or newer for a baseline-faithful local run.
- If running from a network share or UNC path, validate startup carefully because local process behavior may differ from a normal local checkout.

Expected:

- Landing page renders without template errors.
- Static assets load from `/static/...`.

## 3. Example Functional Tests

### MSAL sign-in

1. Click `Sign in with MSAL`.
2. Authenticate in Entra ID.
3. Verify redirect to `/profile/msal`.

Expected:

- User fields (name, username, tenant, object id) render.
- Claims list is populated and filter works.
- Active auth badge shows `MSAL`.

### Easy Auth sign-in (App Service)

1. Click `Sign in with Easy Auth`.
2. Authenticate and return.
3. Verify `/profile/easyauth` renders.

Expected:

- Claims parsed from `X-MS-CLIENT-PRINCIPAL`.
- Active auth badge shows `Easy Auth`.

### Logout checks

- `/logout/msal` clears MSAL session.
- `/logout/easyauth` routes through `/.auth/logout`.
- `/logout/all` clears local session and Easy Auth when present.

## 4. Example Negative Tests

1. Callback state mismatch:
   - Edit callback `state` manually.
   - Expected: redirect to `/`, no server crash.

2. Missing callback code:
   - Hit `/auth/callback?state=<random>` directly.
   - Expected: redirect to `/`.

3. Invalid auth init:
   - Break `AAD_CLIENT_ID` temporarily.
   - Expected: `auth_error.njk` page with `login_start_failed`.

## 5. Pipeline Validation

`azure-pipelines.yml` should:

1. Install Node 24.
2. Run `npm ci`.
3. Stage the runtime payload without `node_modules` and build `app.zip`.
4. Check each configured App Service target exists before deployment.
5. Run SCM/Kudu connectivity preflight checks for each target being deployed.
6. Detect each target App Service OS dynamically inside the deploy script.
7. Deploy via `az webapp deploy`.
8. Enable `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `ENABLE_ORYX_BUILD=true`.
9. Set Windows targets to `WEBSITE_NODE_DEFAULT_VERSION=~24`.
10. Set Linux targets to `linuxFxVersion=NODE|24-lts` and startup file `npm start`.

Observed from repo scan:

- `azure-pipelines.yml` is the active default deployment path.
- It auto-triggers from `main`, `dev`, and `sbx`, with matching PR validation.
- It performs explicit primary and optional secondary target-existence checks before deployment.
- It removes `WEBSITE_RUN_FROM_PACKAGE` before ZIP deploy.

Expected post-deploy smoke tests:

- `GET /` returns `200` on every deployed target.
- MSAL profile path works after sign-in.
- Easy Auth profile path works after sign-in.
- Optional targets are skipped cleanly when their name is blank or the App Service is not found.
- Windows and Linux targets both report a Node 24 runtime after deployment.
- Windows targets should load through `web.config` and not return the IIS directory-permission page.
- Windows App Service has been confirmed to run this application with the worker process set to 32-bit.
- Deployments fail early with a clear network error when the runner cannot resolve or reach the SCM endpoint.

`run_from_package.yml` should:

1. Install Node 24.
2. Run `npm ci`.
3. Build `app.zip` with `node_modules` included.
4. Set `WEBSITE_RUN_FROM_PACKAGE=1`.
5. Keep `SCM_DO_BUILD_DURING_DEPLOYMENT` and `ENABLE_ORYX_BUILD` disabled or absent.

Observed from repo scan:

- `run_from_package.yml` is present and consistent with package-mounted deployment.
- It is manual-only because both CI and PR triggers are disabled.
- It includes `node_modules` in the archived artifact.

## 6. Example Smoke Commands

```bash
# Sandbox home page
curl -I https://web-platform-cc-sbx-node.azurewebsites.net/

# Dev home page
curl -I https://web-platform-eus-dev-node.azurewebsites.net/

# Direct profile without auth should redirect
curl -I https://web-platform-eus-dev-node.azurewebsites.net/profile/msal
```

## 7. Runtime Verification Commands

Use Azure CLI to confirm the deployed App Service is on the expected configured runtime.

### Windows App Service

```bash
az webapp config appsettings list \
  --name web-platform-eus-dev-node \
  --resource-group <resource-group> \
  --query "[?name=='WEBSITE_NODE_DEFAULT_VERSION'].value"
```

Expected:

- returns `~24`

Optional architecture check:

```bash
az resource show \
  --resource-group <resource-group> \
  --name web-platform-eus-dev-node/config/web \
  --resource-type Microsoft.Web/sites/config \
  --query "properties.use32BitWorkerProcess"
```

Expected when validating the confirmed Windows 32-bit configuration:

- returns `true`

### Linux App Service

```bash
az webapp config show \
  --name web-platform-eus-dev-node \
  --resource-group <resource-group> \
  --query "linuxFxVersion"
```

Expected:

- returns `NODE|24-lts`

## 8. Operational Caveats

- Current session store is memory-based and not ideal for scaled production.
- Kudu/SCM endpoint access may be blocked by network restrictions.
- Easy Auth behavior cannot be fully validated locally without header simulation.
- Windows 32-bit compatibility is validated for this app, but the exact Node version still depends on the runtime versions available in the target App Service environment.
- Current local workspace validation was performed under Node `22`, not the repo baseline Node `24`.
- `npm audit --omit=dev` currently reports:
  - `path-to-regexp` high severity ReDoS exposure through the Express dependency tree
  - `uuid` moderate severity exposure through `@azure/msal-node`
