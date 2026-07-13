# Uncensored AI Studio - Quick Installer
# Run this script to install and set up the application.
# .\install.ps1 [-InstallDir "C:\MyPath"] [-NoShortcuts] [-NoSetup]

param(
    [string]$InstallDir = "",
    [switch]$NoShortcuts,
    [switch]$NoSetup,
    [switch]$Help
)

$appName = "Uncensored AI Studio"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Help) {
    Write-Host @"

  Uncensored AI Studio - Installer
  =================================
  Usage: .\install.ps1 [options]

  Options:
    -InstallDir <path>   Installation directory (default: %LOCALAPPDATA%\Uncensored AI Studio)
    -NoShortcuts         Skip creating desktop/Start Menu shortcuts
    -NoSetup             Skip downloading backends after install
    -Help                Show this help message

"@
    exit
}

# ── Determine install directory ────────────────────────────────────────────────
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA $appName
}

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   $appName - Installer" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Verify source ──────────────────────────────────────────────────────
Write-Host "  >> Verifying source files..." -ForegroundColor Cyan
$distFile = Join-Path $scriptDir "app" "dist" "index.html"
$nodeExe = Join-Path $scriptDir "app" "tools" "node-win" "node.exe"
$serveScript = Join-Path $scriptDir "scripts" "server" "serve.cjs"
$batFile = Join-Path $scriptDir "windows.bat"

if (-not (Test-Path $distFile)) {
    Write-Host "  XX  Frontend not built! Run setup first: .\scripts\setup\setup.ps1" -ForegroundColor Red
    exit 1
}
Write-Host "  OK  Source files verified." -ForegroundColor Green

# ── Step 2: Create directory ────────────────────────────────────────────────────
Write-Host ""
Write-Host "  >> Installing to: $InstallDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ── Step 3: Copy files ─────────────────────────────────────────────────────────
Write-Host "  >> Copying files..." -ForegroundColor Cyan

$sourceFiles = Get-ChildItem $scriptDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\__pycache__\\' -and
    $_.FullName -notmatch '\\.git\\' -and
    $_.FullName -notmatch '\\packaging\\' -and
    $_.FullName -notmatch '\\.venv\\' -and
    $_.FullName -notmatch "\.pyc$"
}

$count = 0
$total = $sourceFiles.Count

foreach ($file in $sourceFiles) {
    $relativePath = $file.FullName.Substring($scriptDir.Length + 1)
    $destPath = Join-Path $InstallDir $relativePath
    $destDir = Split-Path -Parent $destPath

    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }

    Copy-Item $file.FullName $destPath -Force -ErrorAction SilentlyContinue

    $count++
    if ($count % 500 -eq 0 -or $count -eq $total) {
        Write-Host "  Progress: $count of $total files" -ForegroundColor DarkGray
    }
}

Write-Host "  OK  $count files copied." -ForegroundColor Green

# ── Step 4: Create shortcuts ───────────────────────────────────────────────────
if (-not $NoShortcuts) {
    Write-Host "  >> Creating shortcuts..." -ForegroundColor Cyan

    try {
        $wshShell = New-Object -ComObject WScript.Shell
        $iconPath = Join-Path $InstallDir "app\sunsides.ico"
        $targetPath = Join-Path $InstallDir "windows.bat"

        # Desktop shortcut
        $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$appName.lnk"
        $shortcut = $wshShell.CreateShortcut($desktopShortcut)
        $shortcut.TargetPath = $targetPath
        $shortcut.WorkingDirectory = $InstallDir
        if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
        $shortcut.Description = "Launch $appName"
        $shortcut.Save()
        Write-Host "  OK  Desktop shortcut created." -ForegroundColor Green

        # Start Menu shortcut
        $startMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) $appName
        New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
        $startMenuShortcut = Join-Path $startMenuDir "$appName.lnk"
        $shortcut = $wshShell.CreateShortcut($startMenuShortcut)
        $shortcut.TargetPath = $targetPath
        $shortcut.WorkingDirectory = $InstallDir
        if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
        $shortcut.Description = "Launch $appName"
        $shortcut.Save()
        Write-Host "  OK  Start Menu shortcut created." -ForegroundColor Green
    } catch {
        Write-Host "  !!  Could not create shortcuts: $_" -ForegroundColor Yellow
    }
}

# ── Step 5: Run setup ──────────────────────────────────────────────────────────
if (-not $NoSetup) {
    Write-Host ""
    Write-Host "  >> Running first-time setup..." -ForegroundColor Cyan
    Write-Host "  >> This will download backends and configure the application." -ForegroundColor DarkCyan
    Write-Host ""

    $setupScript = Join-Path $InstallDir "scripts\setup\setup.ps1"
    if (Test-Path $setupScript) {
        Push-Location $InstallDir
        try {
            & powershell.exe -ExecutionPolicy Bypass -File $setupScript
        } finally {
            Pop-Location
        }
    }
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "   Installation complete!" -ForegroundColor Green
Write-Host "   Installed to: $InstallDir" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "   Launch with: .\windows.bat" -ForegroundColor Green
Write-Host "   Or use the desktop shortcut." -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
