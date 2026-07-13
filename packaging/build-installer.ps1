# Uncensored AI Studio - Installer Builder
# Builds a professional Windows installer using Inno Setup.
# Usage: .\build-installer.ps1 [-InstallInnoSetup]

param(
    [switch]$InstallInnoSetup
)

$ErrorActionPreference = "Stop"

$rootDir    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$packDir    = Join-Path $rootDir "packaging"
$outputDir  = Join-Path $packDir "output"
$issPath    = Join-Path $packDir "installer.iss"
$innoDir    = Join-Path $packDir "inno-setup"
$isccExe    = Join-Path $innoDir "ISCC.exe"
$defaultInno = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

function Write-Step { param([string]$s); Write-Host "`n  >> $s" -ForegroundColor Cyan }
function Write-OK   { param([string]$s); Write-Host "  OK  $s" -ForegroundColor Green }
function Write-Fail { param([string]$s); Write-Host "  XX  $s" -ForegroundColor Red; exit 1 }

# ── Step 1: Find Inno Setup ────────────────────────────────────────────────────
Write-Step "Looking for Inno Setup..."

$isccFound = $null
if (Test-Path $defaultInno) {
    $isccFound = $defaultInno
    Write-OK "Found Inno Setup at: $defaultInno"
} elseif (Get-Command "iscc" -ErrorAction SilentlyContinue) {
    $isccFound = (Get-Command "iscc").Source
    Write-OK "Found Inno Setup on PATH: $isccFound"
} elseif (Test-Path $isccExe) {
    $isccFound = $isccExe
    Write-OK "Found portable Inno Setup at: $isccExe"
}

if (-not $isccFound) {
    if ($InstallInnoSetup -or (Read-Host "Inno Setup not found. Download portable version? (y/N)") -match "^y") {
        Write-Step "Downloading portable Inno Setup..."
        New-Item -ItemType Directory -Force -Path $innoDir | Out-Null
        $innoUrl = "https://github.com/jrsoftware/issrc/releases/download/v6.4.2/InnoSetup-6.4.2.exe"
        $innoInstaller = Join-Path $packDir "innosetup.exe"

        try {
            $client = New-Object System.Net.WebClient
            $client.Headers.Add("User-Agent", "Uncensored-AI-Studio-Build")
            Write-Host "  Downloading Inno Setup 6.4.2..."
            $client.DownloadFile($innoUrl, $innoInstaller)
            Write-OK "Downloaded Inno Setup installer."

            # Extract portable version
            Write-Step "Extracting Inno Setup..."
            Start-Process -FilePath $innoInstaller -ArgumentList "/VERYSILENT /DIR=`"$innoDir`" /COMPONENTS=program,help" -Wait -NoNewWindow
            Remove-Item $innoInstaller -Force -ErrorAction SilentlyContinue

            $isccFound = Join-Path $innoDir "ISCC.exe"
            if (-not (Test-Path $isccFound)) {
                Write-Fail "Inno Setup installation failed. Try installing manually from: https://jrsoftware.org/isdl.php"
            }
            Write-OK "Inno Setup installed to: $innoDir"
        } catch {
            Write-Fail "Download failed: $_"
        }
    } else {
        Write-Fail "Inno Setup is required. Install from: https://jrsoftware.org/isdl.php"
    }
}

# ── Step 2: Verify project is built ────────────────────────────────────────────
Write-Step "Verifying project build..."
$distDir = Join-Path $rootDir "app" "dist"
if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    Write-Fail "Frontend not built! Run 'npm install && npm run build' in app/frontend/ first."
}
Write-OK "Frontend build verified at: app/dist/"

# ── Step 3: Verify key backends exist ──────────────────────────────────────────
$requiredPaths = @(
    @{Path = Join-Path $rootDir "app" "backend" "win" "cpu" "sd-cpu.exe"; Label = "CPU backend"}
    @{Path = Join-Path $rootDir "app" "tools" "node-win" "node.exe"; Label = "Portable Node.js"}
    @{Path = Join-Path $rootDir "scripts" "server" "serve.cjs"; Label = "Server script"}
)
foreach ($req in $requiredPaths) {
    if (-not (Test-Path $req.Path)) {
        Write-Warning "Missing: $($req.Label) at $($req.Path)"
        Write-Warning "Run the setup script first: .\scripts\setup\setup.ps1"
        if ((Read-Host "Continue anyway? (y/N)") -notmatch "^y") { exit 1 }
    }
}
Write-OK "Required components verified."

# ── Step 4: Compile installer ──────────────────────────────────────────────────
Write-Step "Compiling installer..."
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $packDir
try {
    & $isccFound "installer.iss"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Inno Setup compilation failed (exit code: $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

# ── Step 5: Find output ────────────────────────────────────────────────────────
$installer = Get-ChildItem $outputDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($installer) {
    $size = [math]::Round($installer.Length / 1MB, 1)
    Write-OK "Installer created: $($installer.FullName) ($size MB)"
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "   Installer built successfully!" -ForegroundColor Green
    Write-Host "   File: $($installer.Name)" -ForegroundColor Green
    Write-Host "   Path: $($installer.FullName)" -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
} else {
    Write-Fail "No installer executable found in $outputDir"
}
