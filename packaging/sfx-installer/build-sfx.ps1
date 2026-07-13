# Uncensored AI Studio - 7-Zip SFX Installer Builder
# Creates a self-extracting installer using 7-Zip (no extra tools required).

$ErrorActionPreference = "Stop"

$rootDir     = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$sfxDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputDir   = Join-Path $sfxDir "output"
$outputFile  = Join-Path $outputDir "UncensoredAIStudio_Setup.exe"
$sevenZip    = "C:\Program Files\7-Zip\7z.exe"
$sfxModule   = "C:\Program Files\7-Zip\7z.sfx"

# List of files/folders to exclude from the archive
$excludes = @(
    "app\frontend\node_modules"
    "app\frontend\src"
    "app\frontend\package-lock.json"
    "app\frontend\vite.config.js"
    "app\frontend\.gitignore"
    "app\frontend\.agents"
    "app\tools\*.zip"
    "app\tools\*-temp"
    "scripts\__pycache__"
    "app\frontend\node_modules_windows"
    "app\frontend\node_modules_linux"
    "app\frontend\node_modules_darwin"
    ".git"
    "__pycache__"
)

# ── Step 1: Verify 7-Zip ──────────────────────────────────────────────────────
Write-Host "`n  >> Checking for 7-Zip..." -ForegroundColor Cyan
if (-not (Test-Path $sevenZip)) {
    Write-Host "  XX  7-Zip not found at $sevenZip" -ForegroundColor Red
    Write-Host "  >>  Install 7-Zip from https://7-zip.org/"
    exit 1
}
Write-Host "  OK  7-Zip found." -ForegroundColor Green

# ── Step 2: Verify project is built ────────────────────────────────────────────
Write-Host "`n  >> Verifying project build..." -ForegroundColor Cyan
$distDir = Join-Path $rootDir "app" "dist"
if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    Write-Host "  XX  Frontend not built! Run 'npm install && npm run build' in app/frontend/ first." -ForegroundColor Red
    exit 1
}

$nodeDir = Join-Path $rootDir "app" "tools" "node-win"
if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
    Write-Host "  XX  Portable Node.js not found. Run setup first: .\scripts\setup\setup.ps1" -ForegroundColor Red
    exit 1
}
Write-Host "  OK  Build verified." -ForegroundColor Green

# ── Step 3: Create config file for SFX ─────────────────────────────────────────
Write-Host "`n  >> Creating SFX configuration..." -ForegroundColor Cyan

$sfxConfig = @"
;!@Install@!UTF-8!
Title="Uncensored AI Studio Setup"
BeginPrompt="This will install Uncensored AI Studio. Continue?"
RunProgram="powershell.exe -ExecutionPolicy Bypass -Command \"& '.\scripts\setup\setup.ps1'\""
RunProgram=".\windows.bat"
Directory="$PROGRAMFILES64\Uncensored AI Studio"
Shortcut="D,Uncensored AI Studio.lnk,.\windows.bat,.,.\app\sunsides.ico"
Shortcut="S,Uncensored AI Studio.lnk,.\windows.bat,.,.\app\sunsides.ico"
GUIMode="1"
OverwriteMode="2"
;!@InstallEnd@!
"@

# Actually, 7z SFX config format is different. Let me use the proper format.
$sfxConfig = @"
;!@Install@!UTF-8!
Title="Uncensored AI Studio"
BeginPrompt="This will install Uncensored AI Studio on your computer. Continue?"
ExecuteFile="windows.bat"
Directory="$PROGRAMFILES64\Uncensored AI Studio"
GUIMode="2"
OverwriteMode="2"
;!@InstallEnd@!
"@

$configPath = Join-Path $sfxDir "config.txt"
$sfxConfig | Out-File -FilePath $configPath -Encoding utf8

# ── Step 4: Build the archive ──────────────────────────────────────────────────
Write-Host "`n  >> Building archive (this may take a while)..." -ForegroundColor Cyan
New-Unit-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$archiveFile = Join-Path $outputDir "app.7z"

# Build exclusion arguments
$excludeArgs = @()
foreach ($excl in $excludes) {
    $excludeArgs += "-x!`"$excl`""
}

Push-Location $rootDir
try {
    $argList = @("a", "-t7z", "-mx=9", "-mfb=273", "-ms=on", "-mmt=on")
    $argList += $excludeArgs
    $argList += "`"$archiveFile`""
    $argList += "`"*`""
    
    & $sevenZip $argList
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
        Write-Host "  XX  7-Zip archive creation failed (exit code: $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $archiveFile)) {
    Write-Host "  XX  Archive file was not created." -ForegroundColor Red
    exit 1
}

$archiveSize = [math]::Round((Get-Item $archiveFile).Length / 1MB, 1)
Write-Host "  OK  Archive created: $archiveFile ($archiveSize MB)" -ForegroundColor Green

# ── Step 5: Create SFX installer ───────────────────────────────────────────────
Write-Host "`n  >> Creating SFX installer..." -ForegroundColor Cyan

# Copy SFX module
Copy-Item $sfxModule (Join-Path $outputDir "7z.sfx") -Force

# Combine: SFX module + config + archive
$configBytes  = [System.IO.File]::ReadAllBytes($configPath)
$sfxModuleBytes = [System.IO.File]::ReadAllBytes((Join-Path $outputDir "7z.sfx"))
$archiveBytes = [System.IO.File]::ReadAllBytes($archiveFile)

$installerBytes = $sfxModuleBytes + $configBytes + $archiveBytes
[System.IO.File]::WriteAllBytes($outputFile, $installerBytes)

# Cleanup temp files
Remove-Item (Join-Path $outputDir "7z.sfx") -Force -ErrorAction SilentlyContinue
Remove-Item $archiveFile -Force -ErrorAction SilentlyContinue
Remove-Item $configPath -Force -ErrorAction SilentlyContinue

# ── Done ───────────────────────────────────────────────────────────────────────
$size = [math]::Round((Get-Item $outputFile).Length / 1MB, 1)
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "   SFX Installer created!" -ForegroundColor Green
Write-Host "   File: $outputFile" -ForegroundColor Green
Write-Host "   Size: $size MB" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To install, simply run the generated .exe file."
Write-Host "  It will extract to the install directory and launch the application."
