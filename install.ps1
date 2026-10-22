#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy this pi-dotfiles checkout into %USERPROFILE%\.pi\agent.

.DESCRIPTION
    Copies the portable parts of this repo (APPEND_SYSTEM.md, the
    prompt-architect extension, workflows config) into the live pi config
    directory, and scaffolds *.example.json into place on first run.

    Existing real config files are never overwritten unless -Force is passed.
    Files that hold credentials (models.json, mcp.json) are only ever created
    from their .example template, and only when absent.

.PARAMETER Force
    Overwrite files that already exist. Credentials files are still never
    overwritten from templates.

.PARAMETER SkipExamples
    Skip scaffolding the *.example.json files entirely.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$SkipExamples
)

$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$Target   = Join-Path $env:USERPROFILE '.pi\agent'

if (-not (Test-Path $Target)) {
    Write-Host "Creating $Target"
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

# Portable files: repo path -> target path. Real content, always safe to copy.
$Portable = @(
    @{ Source = 'agent\APPEND_SYSTEM.md';        Dest = 'APPEND_SYSTEM.md' }
    @{ Source = 'agent\extensions';              Dest = 'extensions'; Directory = $true }
    @{ Source = 'workflows\model-tiers.json';    Dest = '..\workflows\model-tiers.json' }
    @{ Source = 'workflows\settings.json';       Dest = '..\workflows\settings.json' }
)

# Templates: only scaffolded when the real file is missing, never overwritten.
$Templates = @(
    @{ Source = 'agent\settings.example.json';   Dest = 'settings.json' }
    @{ Source = 'agent\web-search.example.json'; Dest = 'web-search.json' }
    @{ Source = 'agent\models.example.json';     Dest = 'models.json' }
    @{ Source = 'agent\mcp.example.json';        Dest = 'mcp.json' }
)

$created = @()
$skipped = @()

foreach ($item in $Portable) {
    $src  = Join-Path $RepoRoot $item.Source
    $dest = Join-Path $Target $item.Dest
    if (-not (Test-Path $src)) {
        Write-Warning "Missing in repo, skipped: $($item.Source)"
        continue
    }
    if ($item.Directory) {
        # Extension directory: copy files, preserving anything local-only.
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Get-ChildItem $src -Recurse -File | ForEach-Object {
            $rel      = $_.FullName.Substring($src.Length).TrimStart('\')
            $destFile = Join-Path $dest $rel
            $destDir  = Split-Path $destFile -Parent
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            if ((Test-Path $destFile) -and -not $Force) {
                $script:skipped += "$($item.Dest)\$rel (exists)"
                return
            }
            Copy-Item $_.FullName $destFile -Force
            $script:created += "$($item.Dest)\$rel"
        }
        continue
    }
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    if ((Test-Path $dest) -and -not $Force) {
        $skipped += "$($item.Dest) (exists)"
        continue
    }
    Copy-Item $src $dest -Force
    $created += $item.Dest
}

if (-not $SkipExamples) {
    foreach ($item in $Templates) {
        $src  = Join-Path $RepoRoot $item.Source
        $dest = Join-Path $Target $item.Dest
        if (-not (Test-Path $src)) { continue }
        if (Test-Path $dest) {
            $skipped += "$($item.Dest) (real config present, left untouched)"
            continue
        }
        Copy-Item $src $dest -Force
        $created += "$($item.Dest)  <- from template, needs your credentials"
    }
}

Write-Host ''
if ($created.Count -gt 0) {
    Write-Host "Deployed $($created.Count) item(s):" -ForegroundColor Green
    $created | ForEach-Object { Write-Host "  + $_" }
}
if ($skipped.Count -gt 0) {
    Write-Host "Left alone $($skipped.Count) item(s):" -ForegroundColor DarkGray
    $skipped | ForEach-Object { Write-Host "  = $_" }
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Fill in real credentials in ~/.pi/agent/models.json and mcp.json'
Write-Host '     (the copied templates contain REPLACE_ME placeholders).'
Write-Host '  2. Trim the "packages" list in settings.json to what you actually use.'
Write-Host '  3. Start pi and run /prompt-audit to confirm the extension is active.'
