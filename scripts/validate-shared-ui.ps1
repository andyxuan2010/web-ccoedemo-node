$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoParent = Split-Path -Parent $repoRoot
$expectedSha256 = "0F56E957183F34724375A0DAEEFCFC3B34B85B50C3AD6816601C8E8C27BA9F65"

$localStylesheets = @(
    (Join-Path $repoRoot "wwwroot/css/shared-ui.css")
    (Join-Path $repoRoot "static/css/shared-ui.css")
)
$localStylesheet = $localStylesheets | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $localStylesheet) { throw "The canonical shared-ui.css stylesheet was not found." }

$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $localStylesheet).Hash
if ($actualSha256 -cne $expectedSha256) {
    throw "Shared UI contract drift detected in $localStylesheet. Expected SHA-256 $expectedSha256 but found $actualSha256."
}

$peerStylesheets = @(
    (Join-Path $repoParent "web-ccoedemo-dotnet/wwwroot/css/shared-ui.css")
    (Join-Path $repoParent "web-ccoedemo-python/static/css/shared-ui.css")
    (Join-Path $repoParent "web-ccoedemo-node/static/css/shared-ui.css")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique

foreach ($stylesheet in $peerStylesheets) {
    $peerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stylesheet).Hash
    if ($peerHash -cne $expectedSha256) {
        throw "Cross-repository shared UI drift detected in $stylesheet."
    }
}

$css = Get-Content -Raw -LiteralPath $localStylesheet
$requiredSelectors = @(
    ":root"
    ".shell"
    ".layout"
    ".card"
    ".side-panel"
    ".button"
    ".button.tiny"
    ".mode-signin-button"
    ".auth-badge"
    ".mode-pill"
    ".idle-timer"
    'html[data-theme="cloud"] .auth-badge'
    'html[data-theme="cloud"] .mode-pill'
    'html[data-theme="cloud"] .idle-timer'
)
foreach ($selector in $requiredSelectors) {
    if (-not $css.Contains($selector)) { throw "Shared UI selector '$selector' is missing." }
}

$templateCandidates = @(
    (Join-Path $repoRoot "Views/Shared/_Layout.cshtml")
    (Join-Path $repoRoot "templates/base.html")
    (Join-Path $repoRoot "views/base.njk")
)
$template = $templateCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $template) { throw "The application layout template was not found." }

$html = Get-Content -Raw -LiteralPath $template
if ($html -match "(?i)<style(?:\s|>)") { throw "Inline CSS is prohibited; common presentation belongs in shared-ui.css." }
if (([regex]::Matches($html, "shared-ui\.css")).Count -ne 1) { throw "The layout must load shared-ui.css exactly once." }
if ($html -match "(?:ccoe|ccoedemo)-(?:theme|language)") { throw "Use the universal identity-demo theme and language storage keys." }
if ($html -match 'href=.*site\.css') { throw "A stack-specific stylesheet is loaded by the common layout." }

$requiredTemplateFragments = @(
    'class="site-banner"'
    'class="brand"'
    'class="banner-actions"'
    'class="banner-primary-actions"'
    'class="theme-switch"'
    'class="language-switch"'
    'class="shell"'
    'class="layout"'
    'class="card"'
    'class="side-panel"'
    'class="auth-badge'
    'class="mode-pill'
    'class="idle-timer"'
    'identity-demo-theme'
    'identity-demo-language'
)
foreach ($fragment in $requiredTemplateFragments) {
    if (-not $html.Contains($fragment)) { throw "Shared layout fragment '$fragment' is missing from $template." }
}

Write-Output "Shared UI contract $expectedSha256 validated for stylesheet, layout, theme, and component structure."
