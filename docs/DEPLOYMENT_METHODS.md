# Deployment Methods

This repo currently implements two deployment methods in version-controlled YAML:

1. `azure-pipelines.yml`
2. `run_from_package.yml`

Azure App Service also supports other delivery models such as `Deployment Center` and `ACR/custom container`, but those are platform options only for this repo today. There is no Dockerfile, container build pipeline, or Deployment Center wiring checked into this repository.

## Repo-Implemented Methods

| Method | Implemented in repo | Trigger model | Dependency install location | Runtime content | Primary use |
| --- | --- | --- | --- | --- | --- |
| `azure-pipelines.yml` | Yes | `main` CI/CD and PR validation | App Service during deploy via Oryx | ZIP without `node_modules` | Default deployment path |
| `run_from_package.yml` | Yes | Manual only (`trigger: none`, `pr: none`) | Pipeline runner before deploy | ZIP with `node_modules` mounted read-only | Immutable package testing |
| `Deployment Center` | No | Portal-managed | App Service | Branch contents | Not repo-managed here |
| `ACR/custom container` | No | Pipeline or image-triggered | Image build stage | OCI image | Not repo-managed here |

## What The Repo Actually Ships

### 1. `azure-pipelines.yml`

This is the primary deployment path and the only one wired to run automatically from `main`.

How it works:

1. Uses a Linux Azure DevOps runner from the `IaCRunner` pool.
2. Installs Node `24.x`.
3. Runs `npm ci`.
4. Runs `node --check app.js`.
5. Stages only the runtime payload into `app.zip`:
   - `app.js`
   - `package.json`
   - `package-lock.json`
   - `web.config`
   - `views/`
   - `static/`
6. Resolves up to three App Service targets:
   - `webAppNamePrimary`
   - `webAppNameSecondary`
   - `webAppNameThird`
7. Verifies the target exists before deployment.
8. Runs DNS and TCP preflight checks against `<app>.scm.azurewebsites.net`.
9. Detects the target OS dynamically from `az webapp show --query reserved`.
10. Applies OS-specific runtime settings:
   - Linux: `linuxFxVersion=NODE|24-lts` and startup file `npm start`
   - Windows: `WEBSITE_NODE_DEFAULT_VERSION=~24`
11. Removes `WEBSITE_RUN_FROM_PACKAGE` so the app is deployed as normal App Service content.
12. Enables App Service build automation:
   - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
   - `ENABLE_ORYX_BUILD=true`
13. Deploys with `az webapp deploy --type zip`.

Operational characteristics:

- Smallest artifact of the repo-supported methods because `node_modules` is not shipped.
- Best fit when App Service should own dependency restore/build behavior.
- Requires SCM/Kudu reachability from the runner at deploy time.
- Most faithful to the current repo default and README guidance.

### 2. `run_from_package.yml`

This is the alternate package-mounted deployment path. It is present in the repo, but intentionally disabled for automatic CI/CD.

How it works:

1. Uses the same Linux Azure DevOps runner model.
2. Installs Node `24.x`.
3. Runs `npm ci`.
4. Runs `node --check app.js`.
5. Builds a self-contained package directory with:
   - `app.js`
   - `package.json`
   - `package-lock.json`
   - `web.config`
   - `views/`
   - `static/`
   - `node_modules/`
6. Archives that package into `app.zip`.
7. Resolves each target App Service during the deploy function itself.
8. Runs the same SCM/Kudu DNS and TCP preflight checks.
9. Detects Linux versus Windows dynamically.
10. Applies OS-specific runtime settings:
   - Linux: `linuxFxVersion=NODE|24-lts` and startup file `npm start`
   - Windows: `WEBSITE_NODE_DEFAULT_VERSION=~24`
11. Removes build-automation settings if present:
   - `SCM_DO_BUILD_DURING_DEPLOYMENT`
   - `ENABLE_ORYX_BUILD`
12. Sets `WEBSITE_RUN_FROM_PACKAGE=1`.
13. Deploys the ZIP with `az webapp deploy --type zip`.

Operational characteristics:

- Produces a larger artifact because `node_modules` is included.
- Supports an immutable package story more cleanly than the primary pipeline.
- Keeps build output and runtime payload tightly coupled.
- Still depends on SCM/Kudu reachability because the pipeline deploys through App Service tooling.

## Repo Comparison

| Topic | `azure-pipelines.yml` | `run_from_package.yml` |
| --- | --- | --- |
| Automatic trigger | Yes, `main` and PR validation | No |
| Default status in repo | Primary | Alternate/manual |
| ZIP contents | Runtime files only | Runtime files plus `node_modules` |
| Build location | App Service/Oryx during deploy | Pipeline runner before deploy |
| `WEBSITE_RUN_FROM_PACKAGE` | Removed | Set to `1` |
| Oryx/build automation | Enabled | Removed/disabled |
| Best fit | Standard App Service deployment | Immutable package validation |

## Platform Options Not Implemented Here

### `Deployment Center`

Azure App Service can also pull directly from a repo or connected source by using Deployment Center. That is not how this repository is currently operated.

Gaps relative to this repo:

- No Deployment Center configuration is stored here.
- Startup and build behavior would move partly into portal state.
- Drift risk would be higher than the YAML-driven methods above.

### `ACR/custom container`

Azure App Service can run this app as a custom container from Azure Container Registry, but this repo does not currently include container assets.

Missing repo pieces:

- No `Dockerfile`
- No image build pipeline
- No ACR publish flow
- No container-specific App Service configuration

## Recommendation For This Repo

Recommended default: `azure-pipelines.yml`

Why:

- It is the deployment method this repo actually uses by default.
- It is the only method currently wired for automatic `main` deployment behavior.
- It keeps the runtime payload smaller.
- It preserves the current App Service build-automation model across Windows and Linux targets.

Use `run_from_package.yml` when you specifically want to validate or promote a sealed ZIP artifact with `node_modules` already included.

Do not treat `Deployment Center` or `ACR/custom container` as active repo-supported deployment methods unless this repository later adds the needed configuration and assets.
