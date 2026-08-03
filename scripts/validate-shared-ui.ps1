$ErrorActionPreference = "Stop"
$repoParent = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$stylesheets = @(
    Join-Path $repoParent "web-ccoedemo-dotnet/wwwroot/css/shared-ui.css"
    Join-Path $repoParent "web-ccoedemo-python/static/css/shared-ui.css"
    Join-Path $repoParent "web-ccoedemo-node/static/css/shared-ui.css"
)
$available = $stylesheets | Where-Object { Test-Path -LiteralPath $_ }
if ($available.Count -eq 0) { throw "No shared UI stylesheet was found." }
function Get-Contract([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    $content = [regex]::Replace($content, '/\*.*?\*/', '', 'Singleline')
    return [regex]::Replace($content, '\s+', '')
}
$canonical = Get-Contract $available[0]
foreach ($stylesheet in $available) {
    if ((Get-Contract $stylesheet) -cne $canonical) { throw "Shared UI drift detected: $stylesheet" }
}
Write-Output "Shared UI contract matches across $($available.Count) available stack repositories."
