$ErrorActionPreference = "Stop"
$repoParent = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$workflows = @(
    Join-Path $repoParent "web-ccoedemo-dotnet/.github/workflows/azure-webapp.yml"
    Join-Path $repoParent "web-ccoedemo-python/.github/workflows/azure-webapp.yml"
    Join-Path $repoParent "web-ccoedemo-node/.github/workflows/azure-webapp.yml"
) | Where-Object { Test-Path -LiteralPath $_ }
if ($workflows.Count -eq 0) { throw "No GitHub web-app workflow was found." }
$required = @(
    'group: webapp-${{ github.workflow }}-${{ github.ref }}',
    "cancel-in-progress: `${{ github.event_name == 'pull_request' }}",
    "if: github.event_name != 'pull_request'",
    "github.ref == 'refs/heads/main'",
    'timeout-minutes: 60',
    'WEBAPP_NAME_THIRD: ${{ vars.WEBAPP_NAME_THIRD }}',
    'ZIP deployment attempt ${attempt}/3 failed',
    "--exclude='.github/'"
)
foreach ($workflow in $workflows) {
    $content = Get-Content -LiteralPath $workflow -Raw
    foreach ($fragment in $required) { if (-not $content.Contains($fragment)) { throw "Missing workflow contract fragment '$fragment' in $workflow" } }
    if ($content -match '(?m)^\s+- (dev|sbx)\s*$') { throw "Legacy branch trigger found in $workflow" }
    if ($content -match '(?m)^\s*uses:\s*[^\s]+@(v\d+|main|master)\s*$') { throw "Mutable action reference found in $workflow" }
    if ([regex]::Matches($content, [regex]::Escape("--exclude='.github/'")).Count -ne 2) { throw "Stage and ADO mirror exclusions are inconsistent in $workflow" }
}
Write-Output "GitHub workflow contract passed for $($workflows.Count) available stack repositories."
