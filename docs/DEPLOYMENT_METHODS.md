# Deployment Methods

This repo currently implements three repo-managed delivery paths:

1. `azure-pipelines.yml`
2. `.github/workflows/azure-webapp.yml`
3. `run_from_package.yml`

Azure App Service also supports other delivery models such as `Deployment Center` and `ACR/custom container`, but those are platform options only for this repo today.

## Repo-Implemented Methods

| Method | Implemented in repo | Trigger model | Dependency install location | Runtime content | Primary use |
| --- | --- | --- | --- | --- | --- |
| `azure-pipelines.yml` | Yes | `main`, `dev`, `sbx` CI/CD and PR validation | App Service during deploy via Oryx | ZIP without `node_modules` | Default Azure DevOps path |
| `.github/workflows/azure-webapp.yml` | Yes | `main`, `dev`, `sbx` pushes, PRs, and optional manual dispatch | App Service during deploy via Oryx | ZIP without `node_modules` | Default GitHub Actions path |
| `run_from_package.yml` | Yes | Manual only (`trigger: none`, `pr: none`) | Pipeline runner before deploy | ZIP with `node_modules` mounted read-only | Immutable package testing |
| `Deployment Center` | No | Portal-managed | App Service | Branch contents | Not repo-managed here |
| `ACR/custom container` | No | Pipeline or image-triggered | Image build stage | OCI image | Not repo-managed here |

## What The Repo Actually Ships

### 1. `azure-pipelines.yml`

This is the main Azure DevOps deployment path.

How it works:

1. Uses the Microsoft-hosted `Azure Pipelines` pool on `ubuntu-latest`.
2. Imports shared hygiene steps from `IaC/template` through the `templates` alias.
3. Runs on `main`, `dev`, and `sbx`.
4. Installs Node `24.x`, runs `npm ci`, and validates `app.js`.
5. Stages the runtime payload into `app.zip`.
6. Publishes the ZIP as artifact `drop`.
7. Creates an annotated semantic version tag on non-PR success.
8. Defines `DeploySandbox` and `DeployDev` using `azure-pipelines/deploy-stage.yml` for shared deploy logic.

Deploy-stage behavior:

1. Checks the primary target and optional secondary target.
2. Downloads the ZIP only when at least one target is deployable.
3. Runs SCM/Kudu DNS and TCP `443` checks before deployment.
4. Detects Windows versus Linux dynamically.
5. Configures Linux with `NODE|24-lts` and `npm start`.
6. Configures Windows with `WEBSITE_NODE_DEFAULT_VERSION=~24`.
7. Removes `WEBSITE_RUN_FROM_PACKAGE`.
8. Enables `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `ENABLE_ORYX_BUILD=true`.
9. Deploys with `az webapp deploy --type zip`.

Stage-specific targets:

- `DeploySandbox`
  - service connection: `sc-platform-sbx`
  - primary app: `web-platform-cc-sbx-node`
- `DeployDev`
  - service connection: `sc-platform-dev`
  - primary app: `web-platform-eus-dev-node`
- Shared default
  - secondary app: blank unless explicitly set through `webAppNameSecondary`

Operational characteristics:

- Small artifact because `node_modules` is not shipped.
- Azure DevOps flow is aligned with the sibling `landingzone` sequencing model.
- Uses compile-time service connection values so pipeline validation succeeds.
- The checked-in deploy template supports one primary and one optional secondary App Service target per stage.

### 2. `.github/workflows/azure-webapp.yml`

This is the main GitHub Actions deployment path.

How it works:

1. Runs on `main`, `dev`, and `sbx`, plus PRs and optional manual dispatch.
2. Uses a branch-aware `deployment-precheck` job for `prod`, `dev`, and `sbx` Azure credentials.
3. Builds one ZIP artifact on Ubuntu with Node `24.x`.
4. Creates an annotated semantic version tag on non-PR success.
5. Runs optional mirror-publish prechecks for GitHub and Azure DevOps snapshot publishing.
6. Logs into Azure with branch-specific credentials.
7. Resolves the branch-specific primary App Service name.
8. Performs the same ZIP deploy and SCM/Kudu connectivity checks as the ADO path.

Operational characteristics:

- Keeps GitHub and Azure DevOps delivery models closely aligned.
- Uses separate secrets for `prod`, `dev`, and `sbx`.
- Supports optional repo snapshot publishing to GitHub and Azure DevOps mirrors.
- Uses the same semantic tag logic as the Azure DevOps pipeline.

### 3. `run_from_package.yml`

This is the alternate package-mounted deployment path. It is present in the repo, but intentionally disabled for automatic CI/CD.

How it works:

1. Uses a runner-built artifact that includes `node_modules`.
2. Sets `WEBSITE_RUN_FROM_PACKAGE=1`.
3. Keeps a more immutable package model than the main ZIP-deploy pipelines.

Operational characteristics:

- Produces a larger artifact because `node_modules` is included.
- Supports an immutable package story more cleanly than the primary pipelines.
- Still depends on SCM/Kudu reachability because deployment goes through App Service tooling.

## Recommendation For This Repo

Recommended defaults:

- `azure-pipelines.yml` when Azure DevOps is the orchestrator
- `.github/workflows/azure-webapp.yml` when GitHub is the orchestrator

Use `run_from_package.yml` when you specifically want to validate or promote a sealed ZIP artifact with `node_modules` already included.

Do not treat `Deployment Center` or `ACR/custom container` as active repo-supported deployment methods unless this repository later adds the needed configuration and assets.
