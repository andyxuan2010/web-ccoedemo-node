# Shared Self-Hosted Runner Hygiene Standard

## Purpose

This document defines a reusable baseline for Azure DevOps pipelines that run on shared self-hosted runners.

It is intentionally generalized so the same approach can be applied across:

- Node.js
- .NET
- Python
- Terraform
- other build and deployment workloads

The goal is to reduce cross-pipeline contamination, secret leakage, stale tool state, and non-deterministic failures caused by long-lived shared runner state.

## Core Principle

Treat a shared self-hosted runner as a partially untrusted, stateful environment.

Assume that before a job starts:

- Git config may already be contaminated.
- temporary files may exist from previous jobs.
- caches may contain stale or conflicting state.
- credentials may have been persisted accidentally.
- tool-specific home directories may contain prior session data.

The standard response is:

1. isolate the job
2. clean before use
3. avoid persistent writes
4. clean after use

## Standardized Baseline

Every pipeline running on a shared self-hosted runner should follow these steps.

### 1. Isolate job-scoped state

Create a unique job home, temp, and cache area under `$(Agent.TempDirectory)`.

Use job-scoped directories for:

- `HOME`
- `TMPDIR`
- `GIT_CONFIG_GLOBAL`
- package manager caches
- cloud CLI config
- tool session state

Example targets:

```text
$(Agent.TempDirectory)/job-home
$(Agent.TempDirectory)/job-tmp
$(Agent.TempDirectory)/job-cache
```

### 2. Run a pre-job hygiene step before checkout

Before `checkout: self`, remove stale authentication and state from the current workspace and shared config.

At minimum:

- remove Git `extraheader` entries from local, global, and system scopes
- remove repo-local credential overrides if present
- create the job-scoped directories
- point mutable config to the job-scoped locations

### 3. Keep checkout credentials non-persistent by default

Use:

```yaml
persistCredentials: false
```

unless a later step explicitly requires authenticated Git commands.

This reduces the chance that a token remains in repo-local config after checkout.

### 4. Use deterministic tool setup

Do not depend on whatever happens to already exist on the runner.

Always pin or explicitly configure the required runtime version for the job, for example:

- Node version
- .NET SDK version
- Python version
- Terraform version

### 5. Use job-local auth and config, not machine-global config

Avoid writing credentials or config to persistent user-level locations such as:

- `~/.gitconfig`
- `~/.npmrc`
- `~/.config/pip/pip.conf`
- `~/.pypirc`
- `~/.nuget/NuGet/NuGet.Config`
- `~/.terraformrc`
- `~/.azure`

Prefer:

- environment variables
- Azure DevOps managed auth tasks
- temporary files inside `$(Agent.TempDirectory)`
- repo-local config only when necessary

### 6. Run post-job cleanup with `condition: always()`

Cleanup must run even if the build, test, or deploy step fails.

At minimum:

- remove Git `extraheader` entries again
- remove temp credential files
- remove job-scoped home, temp, and cache directories
- remove any temporary tokens or service principal artifacts

### 7. Segment runners by trust boundary

If operationally possible, do not let all pipelines share the same runner pool.

At minimum, split by:

- production vs non-production
- trusted repos vs lower-trust repos
- deployment pipelines vs general CI

### 8. Prefer ephemeral runners when possible

The strongest control is a fresh VM or container per job.

If ephemeral runners are available, prefer them over long-lived shared runners.

## Generic Implementation Pattern

The generalized flow is:

1. initialize job-scoped directories
2. clean Git auth and stale config before checkout
3. checkout source with non-persistent credentials
4. configure tool-specific caches under the job-scoped directories
5. run build, test, deploy steps
6. clean auth and delete job-scoped directories at the end

## Tool-Specific Guidance

### Git

Risks:

- stale `extraheader`
- persistent credential helpers
- repo-local or global auth config from prior jobs

Standard:

- clean `*extraheader` keys before and after the job
- set `GIT_CONFIG_GLOBAL` to a job-local file
- keep `persistCredentials: false` unless explicitly needed
- avoid `git config --global` unless targeting the job-local global file

### Node.js and npm

Risks:

- stale auth in `.npmrc`
- shared package cache contamination
- global package installs leaking across jobs

Standard:

- set `npm_config_cache` to a job-local cache path
- use `npm ci`
- avoid persistent global `.npmrc` writes
- if auth is needed, write `.npmrc` only in job-scoped temp or workspace and remove it afterward

### Python and pip

Risks:

- shared virtual environments
- stale wheels and package cache
- persisted pip auth or index settings

Standard:

- create a new virtual environment per job
- set `PIP_CACHE_DIR` to a job-local path
- avoid global `pip install`
- keep pip config and index credentials job-scoped

### .NET and NuGet

Risks:

- persistent authenticated package sources
- shared global package cache causing drift or disk growth

Standard:

- pin the SDK version
- set `NUGET_PACKAGES` to a job-local or controlled cache location
- use job-scoped NuGet config when credentials are required
- remove temporary NuGet config files after use

### Terraform

Risks:

- leftover `.terraform` directories
- shared plugin cache drift
- backend credentials or CLI config persistence

Standard:

- keep `.terraform` in the workspace for the current job only
- set `TF_PLUGIN_CACHE_DIR` to a controlled path if caching is desired
- store backend and cloud credentials in env vars or temp files
- remove temporary plan files and credentials after the run

### Cloud CLIs

Risks:

- persisted login sessions
- stale subscription or tenant context

Standard:

- log in only when needed
- prefer service connections or env-based auth
- store CLI config under job-scoped home if possible
- log out or delete the temp config directory after use

## Minimal Mandatory Controls

If a team cannot adopt the full standard immediately, these controls should still be considered mandatory on shared runners:

1. pre-job Git auth cleanup
2. post-job cleanup with `condition: always()`
3. `persistCredentials: false` by default
4. no credential writes to persistent shared home directories
5. job-scoped temp directory usage for secrets and generated config

## Recommended Reusable Azure DevOps Template

A reusable starter template is included at:

[templates/shared-runner-hygiene.yml](N:\home\administrator\Documents\GitHub\AeroBBD\CCOE-Azure/IaC\template\templates\shared-runner-hygiene.yml)

This template provides:

- pre-job Git cleanup
- job-scoped `HOME`, `TMPDIR`, and `GIT_CONFIG_GLOBAL`
- optional tool cache env setup
- post-job cleanup with `always()`

## Example Adoption Model

For each repository:

1. include the shared runner hygiene template at the start of the job
2. keep `checkout: self` after the pre-job hygiene step
3. add tool-specific env variables for the stack in that repo
4. include the cleanup template step at the end of the job

## Best Practice Order Of Preference

From strongest to weakest:

1. ephemeral runner per job
2. long-lived runner with job-scoped isolation and standardized cleanup
3. long-lived runner with cleanup only

If a long-lived shared runner must remain in use, option 2 should be the target standard.
