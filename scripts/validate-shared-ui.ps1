$ErrorActionPreference = "Stop"
$repoParent = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$stylesheets = @(
    Join-Path (Split-Path -Parent $PSScriptRoot) "wwwroot/css/shared-ui.css"
    Join-Path (Split-Path -Parent $PSScriptRoot) "static/css/shared-ui.css"
    Join-Path $repoParent "web-ccoedemo-dotnet/wwwroot/css/shared-ui.css"
    Join-Path $repoParent "web-ccoedemo-python/static/css/shared-ui.css"
    Join-Path $repoParent "web-ccoedemo-node/static/css/shared-ui.css"
)
$available = @($stylesheets | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
if ($available.Count -eq 0) { throw "No shared UI stylesheet was found." }
function Get-Contract([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    $content = [regex]::Replace($content, '/\*.*?\*/', '', 'Singleline')
    return [regex]::Replace($content, '\s+', '')
}
$canonical = Get-Contract $available[0]
$requiredSelectors = @(
    'html[data-theme="cloud"].auth-badge',
    'html[data-theme="cloud"].mode-pill',
    'html[data-theme="cloud"].idle-timer',
    '.button.tiny',
    '.mode-signin-button'
)
foreach ($stylesheet in $available) {
    $contract = Get-Contract $stylesheet
    if ($contract -cne $canonical) { throw "Shared UI drift detected: $stylesheet" }
    foreach ($selector in $requiredSelectors) {
        if (-not $contract.Contains($selector)) { throw "Shared UI selector '$selector' is missing from $stylesheet" }
    }
}
Write-Output "Shared UI contract matches across $($available.Count) available stack repositories."
