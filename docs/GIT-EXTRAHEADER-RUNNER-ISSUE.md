# Shared Runner Git `extraheader` Issue

## Problem

The Azure DevOps pipeline for this application started failing during `checkout: self` on the shared self-hosted Linux runner.

Observed error:

```text
git config --get-regexp .*extraheader
##[warning]Git config still contains extraheader keys. It may cause errors.
git --config-env=http.extraheader=env_var_http.extraheader fetch ...
fatal: could not read Password for 'https://example-org@dev.azure.com': terminal prompts disabled
##[error]Git fetch failed with exit code: 128
```

This happened even though a cleanup step had been added before checkout.

## Root Cause

The runner is shared between multiple pipelines and processes. A previous job left Git authentication headers behind in Git config, most notably in the global config under the agent user's home directory.

The failing key was not the generic form that the cleanup script expected. The actual leftover key was URL-scoped, for example:

```text
http.https://dev.azure.com/example-org.extraheader
```

The earlier cleanup logic only tried to remove a few hard-coded keys such as:

```text
http.extraheader
http.https://dev.azure.com.extraheader
http.https://example-org@dev.azure.com.extraheader
```

Because the real key did not exactly match those names, it remained in Git config.

## Analysis

Azure Pipelines performs `checkout: self` before the rest of the job can use the repository contents. During checkout, the agent injects its own authentication header and runs `git fetch`.

When the runner already contains stale `extraheader` values from another pipeline, Git sees conflicting or incorrect authentication settings. In this case the fetch fell back to password-style prompting, which is disabled in the non-interactive agent environment, and checkout failed.

Important observations from the logs:

- The cleanup step ran before checkout.
- The cleanup step reported success, but the `AFTER CLEANUP` output still showed an `extraheader` entry.
- The warning inside the checkout task explicitly said Git config still contained `extraheader` keys.
- The remaining key was organization-scoped, not one of the hard-coded names.

## Principle

On a shared self-hosted runner, Git configuration must be treated as untrusted mutable state.

That means:

- Do not assume Git global or system config is clean at the start of a job.
- Do not rely on removing only a small set of known key names.
- Clean based on what actually exists, not what is expected to exist.
- Prefer job-scoped isolation over shared mutable configuration whenever possible.

## Working Fix

The pipeline cleanup step was updated to:

- Enumerate all `*extraheader` keys in local, global, and system Git config.
- Remove the exact keys that are present.
- Print before and after diagnostics for verification.

This fix is implemented in [azure-pipelines.yml](N:\home\administrator\Documents\GitHub\AeroBBD\CCOE-Azure/IaC\web-ccoedemo-dev-node-601\azure-pipelines.yml).

In practical terms, the cleanup now works dynamically instead of guessing a few possible key names.

## Why The Last Fix Worked

The last fix worked because it changed the cleanup strategy from hard-coded key removal to discovery-based removal.

Instead of assuming only generic keys existed, it asked Git for all keys matching `.*extraheader$` in each scope and then removed those exact keys. This allowed the pipeline to clean URL-scoped keys such as:

```text
http.https://dev.azure.com/example-org.extraheader
```

That was the key difference between the failing version and the working version.

## Current Solution Summary

The current implemented approach is:

1. Run cleanup before `checkout: self`.
2. Enumerate and remove all matching `extraheader` keys from local, global, and system scope.
3. Keep diagnostics in the log to confirm whether the runner is still contaminated.

This is a good mitigation for a shared runner where other pipelines may leave behind Git auth state.

## Additional Recommendation

An additional recommendation was discussed but is not yet implemented.

### Isolate Git config per job

Instead of relying only on cleanup, isolate Git config for the current job by overriding `HOME` and `GIT_CONFIG_GLOBAL` to a temporary directory under `$(Agent.TempDirectory)`.

Benefits:

- Reduces cross-pipeline contamination.
- Prevents new global Git settings from being written into the agent user's persistent home directory.
- Makes cleanup simpler and safer.

Suggested pattern:

```yaml
- script: |
    set -eu
    JOB_GIT_HOME="$(Agent.TempDirectory)/job-git-home"
    mkdir -p "$JOB_GIT_HOME"
    touch "$JOB_GIT_HOME/.gitconfig"

    echo "##vso[task.setvariable variable=HOME]$JOB_GIT_HOME"
    echo "##vso[task.setvariable variable=GIT_CONFIG_GLOBAL]$JOB_GIT_HOME/.gitconfig"
  displayName: Isolate Git config for this job
```

End-of-job cleanup could then remove that temporary directory:

```yaml
- script: |
    rm -rf "$(Agent.TempDirectory)/job-git-home"
  displayName: Cleanup temp Git home
  condition: always()
```

## Note About Manual Auth Injection

Another idea considered was manually writing an auth header into a temporary Git config using `System.AccessToken`.

That approach may help for custom Git commands later in a job, but it is not the main fix for this issue because:

- `checkout: self` already injects its own authentication header.
- A shell `export` inside one script step does not automatically control later pipeline tasks.
- Manually adding another auth header can create confusion if stale headers already exist.

For this incident, cleanup and isolation are the stronger controls.

## Recommended Operating Model

For shared self-hosted runners, the preferred model is:

1. Clean Git `extraheader` values before checkout.
2. Clean again at the end of the job with `condition: always()`.
3. Where possible, isolate `HOME` and `GIT_CONFIG_GLOBAL` per job.
4. If feasible operationally, use separate agents or stronger isolation boundaries for pipelines with different trust levels.

## References

- Pipeline file: [azure-pipelines.yml](N:\home\administrator\Documents\GitHub\AeroBBD\CCOE-Azure/IaC\web-ccoedemo-dev-node-601\azure-pipelines.yml)
- Documentation folder: [docs](N:\home\administrator\Documents\GitHub\AeroBBD\CCOE-Azure/IaC\web-ccoedemo-dev-node-601\docs)
