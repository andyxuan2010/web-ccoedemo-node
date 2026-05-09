# C:\tools\reload-arm-env.ps1

[CmdletBinding()]
param(
    [switch]$SkipLogin
)

$ErrorActionPreference = 'Stop'

$keys = 'ARM_CLIENT_ID', 'ARM_TENANT_ID', 'ARM_CLIENT_SECRET', 'ARM_SUBSCRIPTION_ID'
$secretKeys = 'ARM_CLIENT_SECRET'

function Test-HasValue {
    param([string]$Value)

    return -not [string]::IsNullOrWhiteSpace($Value)
}

function Get-ArmEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    if (-not (Test-HasValue $value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    }

    return $value
}

foreach ($key in $keys) {
    $value = Get-ArmEnvironmentValue -Name $key
    if (Test-HasValue $value) {
        Set-Item -Path "Env:$key" -Value $value
    }
}

Write-Host "Reloaded ARM_* variables into current session:" -ForegroundColor Green
foreach ($key in $keys) {
    $currentValue = (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue).Value
    if ($key -in $secretKeys) {
        "{0} = {1}" -f $key, $(if (Test-HasValue $currentValue) { '********' } else { '<missing>' })
    }
    else {
        "{0} = {1}" -f $key, $(if (Test-HasValue $currentValue) { $currentValue } else { '<missing>' })
    }
}

$missingKeys = @(
    foreach ($key in $keys) {
        $currentValue = (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue).Value
        if (-not (Test-HasValue $currentValue)) {
            $key
        }
    }
)

if ($missingKeys.Count -gt 0) {
    throw "Missing required environment variable(s): $($missingKeys -join ', ')"
}

if ($SkipLogin) {
    Write-Host "Skipping Azure login because -SkipLogin was provided." -ForegroundColor Yellow
    return
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI executable 'az' was not found in PATH."
}

Import-Module Az.Accounts -ErrorAction Stop
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop

Write-Host "Logging in to Azure CLI using service principal..." -ForegroundColor Yellow
$azLoginArgs = @(
    'login'
    '--service-principal'
    '--username', $env:ARM_CLIENT_ID
    '--password', $env:ARM_CLIENT_SECRET
    '--tenant', $env:ARM_TENANT_ID
    '--output', 'none'
)
& az @azLoginArgs
if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI login failed with exit code $LASTEXITCODE."
}

& az account set --subscription $env:ARM_SUBSCRIPTION_ID
if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI subscription selection failed with exit code $LASTEXITCODE."
}

$secureSecret = ConvertTo-SecureString $env:ARM_CLIENT_SECRET -AsPlainText -Force
$credential = [pscredential]::new($env:ARM_CLIENT_ID, $secureSecret)

Write-Host "Connecting to Az PowerShell using service principal..." -ForegroundColor Yellow
Connect-AzAccount -ServicePrincipal -Tenant $env:ARM_TENANT_ID -Credential $credential | Out-Null
Set-AzContext -SubscriptionId $env:ARM_SUBSCRIPTION_ID | Out-Null

Write-Host "Azure CLI and Az PowerShell are ready for subscription $env:ARM_SUBSCRIPTION_ID." -ForegroundColor Green
