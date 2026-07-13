# Uncensored AI Studio - Installer Wizard
# A self-contained GUI installer that creates shortcuts and sets up the application.
# Run this script to install the application on your system.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Configuration ──────────────────────────────────────────────────────────────
$appName = "Uncensored AI Studio"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$defaultInstallDir = Join-Path $env:LOCALAPPDATA $appName

if (-not $defaultInstallDir) {
    $defaultInstallDir = Join-Path $env:ProgramFiles $appName
}

# ── Form Setup ─────────────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "$appName Setup"
$form.Size = New-Object System.Drawing.Size(600, 480)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $rootDir "app\sunsides.ico"))
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)

# ── Header ─────────────────────────────────────────────────────────────────────
$header = New-Object System.Windows.Forms.Label
$header.Text = "Uncensored AI Studio"
$header.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$header.ForeColor = [System.Drawing.Color]::Cyan
$header.Size = New-Object System.Drawing.Size(560, 40)
$header.Location = New-Object System.Drawing.Point(20, 15)
$header.TextAlign = "MiddleCenter"
$form.Controls.Add($header)

$subheader = New-Object System.Windows.Forms.Label
$subheader.Text = "100% Offline AI Studio - Image Gen, Chat, Speech, TTS"
$subheader.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$subheader.ForeColor = [System.Drawing.Color]::LightGray
$subheader.Size = New-Object System.Drawing.Size(560, 25)
$subheader.Location = New-Object System.Drawing.Point(20, 55)
$subheader.TextAlign = "MiddleCenter"
$form.Controls.Add($subheader)

# ── Tab Control ────────────────────────────────────────────────────────────────
$tabControl = New-Object System.Windows.Forms.TabControl
$tabControl.Size = New-Object System.Drawing.Size(560, 320)
$tabControl.Location = New-Object System.Drawing.Point(20, 90)
$tabControl.Font = New-Object System.Drawing.Font("Segoe UI", 10)

# ── Tab 1: Installation Path ───────────────────────────────────────────────────
$tabPath = New-Object System.Windows.Forms.TabPage
$tabPath.Text = "Installation Path"
$tabPath.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 38)

$lblPath = New-Object System.Windows.Forms.Label
$lblPath.Text = "Install destination:"
$lblPath.ForeColor = [System.Drawing.Color]::White
$lblPath.Size = New-Object System.Drawing.Size(520, 25)
$lblPath.Location = New-Object System.Drawing.Point(15, 20)
$tabPath.Controls.Add($lblPath)

$txtPath = New-Object System.Windows.Forms.TextBox
$txtPath.Text = $defaultInstallDir
$txtPath.Size = New-Object System.Drawing.Size(410, 25)
$txtPath.Location = New-Object System.Drawing.Point(15, 50)
$txtPath.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 45)
$txtPath.ForeColor = [System.Drawing.Color]::White
$txtPath.BorderStyle = "FixedSingle"
$tabPath.Controls.Add($txtPath)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Size = New-Object System.Drawing.Size(95, 28)
$btnBrowse.Location = New-Object System.Drawing.Point(435, 48)
$btnBrowse.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 60)
$btnBrowse.ForeColor = [System.Drawing.Color]::White
$btnBrowse.FlatStyle = "Flat"
$tabPath.Controls.Add($btnBrowse)

$lblInfo = New-Object System.Windows.Forms.Label
$lblInfo.Text = "The application will be installed to the selected folder.`nA desktop shortcut will also be created."
$lblInfo.ForeColor = [System.Drawing.Color]::Gray
$lblInfo.Size = New-Object System.Drawing.Size(520, 40)
$lblInfo.Location = New-Object System.Drawing.Point(15, 90)
$tabPath.Controls.Add($lblInfo)

$chkShortcut = New-Object System.Windows.Forms.CheckBox
$chkShortcut.Text = "Create Desktop Shortcut"
$chkShortcut.Checked = $true
$chkShortcut.ForeColor = [System.Drawing.Color]::White
$chkShortcut.Size = New-Object System.Drawing.Size(200, 25)
$chkShortcut.Location = New-Object System.Drawing.Point(15, 140)
$chkShortcut.BackColor = [System.Drawing.Color]::Transparent
$tabPath.Controls.Add($chkShortcut)

$chkStartMenu = New-Object System.Windows.Forms.CheckBox
$chkStartMenu.Text = "Add to Start Menu"
$chkStartMenu.Checked = $true
$chkStartMenu.ForeColor = [System.Drawing.Color]::White
$chkStartMenu.Size = New-Object System.Drawing.Size(200, 25)
$chkStartMenu.Location = New-Object System.Drawing.Point(15, 170)
$chkStartMenu.BackColor = [System.Drawing.Color]::Transparent
$tabPath.Controls.Add($chkStartMenu)

$chkRunSetup = New-Object System.Windows.Forms.CheckBox
$chkRunSetup.Text = "Run first-time setup after install (downloads backends)"
$chkRunSetup.Checked = $true
$chkRunSetup.ForeColor = [System.Drawing.Color]::White
$chkRunSetup.Size = New-Object System.Drawing.Size(520, 25)
$chkRunSetup.Location = New-Object System.Drawing.Point(15, 200)
$chkRunSetup.BackColor = [System.Drawing.Color]::Transparent
$tabPath.Controls.Add($chkRunSetup)

$btnBrowse.Add_Click({
    $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderDialog.Description = "Select installation directory"
    $folderDialog.SelectedPath = $txtPath.Text
    if ($folderDialog.ShowDialog() -eq "OK") {
        $txtPath.Text = $folderDialog.SelectedPath
    }
})

# ── Tab 2: Summary ─────────────────────────────────────────────────────────────
$tabSummary = New-Object System.Windows.Forms.TabPage
$tabSummary.Text = "Summary"
$tabSummary.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 38)

$lblSummary = New-Object System.Windows.Forms.Label
$lblSummary.Text = "Installation Summary:"
$lblSummary.ForeColor = [System.Drawing.Color]::White
$lblSummary.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$lblSummary.Size = New-Object System.Drawing.Size(520, 25)
$lblSummary.Location = New-Object System.Drawing.Point(15, 15)
$tabSummary.Controls.Add($lblSummary)

$summaryBox = New-Object System.Windows.Forms.TextBox
$summaryBox.Multiline = $true
$summaryBox.ReadOnly = $true
$summaryBox.Size = New-Object System.Drawing.Size(520, 250)
$summaryBox.Location = New-Object System.Drawing.Point(15, 45)
$summaryBox.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)
$summaryBox.ForeColor = [System.Drawing.Color]::LightGray
$summaryBox.BorderStyle = "FixedSingle"
$summaryBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$tabSummary.Controls.Add($summaryBox)

# ── Tab 3: Progress ────────────────────────────────────────────────────────────
$tabProgress = New-Object System.Windows.Forms.TabPage
$tabProgress.Text = "Installing"
$tabProgress.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 38)

$lblProgress = New-Object System.Windows.Forms.Label
$lblProgress.Text = "Installing files..."
$lblProgress.ForeColor = [System.Drawing.Color]::White
$lblProgress.Size = New-Object System.Drawing.Size(520, 25)
$lblProgress.Location = New-Object System.Drawing.Point(15, 20)
$tabProgress.Controls.Add($lblProgress)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Size = New-Object System.Drawing.Size(520, 25)
$progressBar.Location = New-Object System.Drawing.Point(15, 50)
$progressBar.Style = "Continuous"
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$tabProgress.Controls.Add($progressBar)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Ready..."
$lblStatus.ForeColor = [System.Drawing.Color]::LightGray
$lblStatus.Size = New-Object System.Drawing.Size(520, 100)
$lblStatus.Location = New-Object System.Drawing.Point(15, 85)
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$tabProgress.Controls.Add($lblStatus)

$tabControl.Controls.Add($tabPath)
$tabControl.Controls.Add($tabSummary)
$tabControl.Controls.Add($tabProgress)

$form.Controls.Add($tabControl)

# ── Buttons ────────────────────────────────────────────────────────────────────
$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install"
$btnInstall.Size = New-Object System.Drawing.Size(130, 35)
$btnInstall.Location = New-Object System.Drawing.Point(320, 420)
$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 200)
$btnInstall.ForeColor = [System.Drawing.Color]::White
$btnInstall.FlatStyle = "Flat"
$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnInstall)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Size = New-Object System.Drawing.Size(130, 35)
$btnCancel.Location = New-Object System.Drawing.Point(460, 420)
$btnCancel.BackColor = [System.Drawing.Color]::FromArgb(60, 60, 80)
$btnCancel.ForeColor = [System.Drawing.Color]::White
$btnCancel.FlatStyle = "Flat"
$form.Controls.Add($btnCancel)

function Install-App {
    $installDir = $txtPath.Text
    $createShortcut = $chkShortcut.Checked
    $createStartMenu = $chkStartMenu.Checked
    $runSetup = $chkRunSetup.Checked

    # Update summary
    $summaryBox.Text = "Installation path:    $installDir`r`n"
    $summaryBox.Text += "Desktop shortcut:     $(if ($createShortcut) { 'Yes' } else { 'No' })`r`n"
    $summaryBox.Text += "Start Menu entry:     $(if ($createStartMenu) { 'Yes' } else { 'No' })`r`n"
    $summaryBox.Text += "Run first-time setup: $(if ($runSetup) { 'Yes' } else { 'No' })`r`n"

    $btnInstall.Enabled = $false
    $tabControl.SelectedTab = $tabProgress

    try {
        # Step 1: Create directory
        $lblStatus.Text = "Creating installation directory..."
        $progressBar.Value = 5
        [System.Windows.Forms.Application]::DoEvents()

        New-Item -ItemType Directory -Force -Path $installDir | Out-Null

        # Step 2: Copy files
        $lblStatus.Text = "Copying application files..."
        $progressBar.Value = 15
        [System.Windows.Forms.Application]::DoEvents()

        $totalItems = 0
        $copiedItems = 0

        # Get all files in the source directory
        $sourceFiles = Get-ChildItem $rootDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
            $_.FullName -notmatch '\\node_modules\\' -and
            $_.FullName -notmatch '\\__pycache__\\' -and
            $_.FullName -notmatch '\\.git\\' -and
            $_.FullName -notlike "*\packaging\*" -and
            $_.FullName -notmatch "\.pyc$" -and
            $_.FullName -notmatch "\\.venv\\"
        }

        $totalItems = $sourceFiles.Count

        foreach ($file in $sourceFiles) {
            $relativePath = $file.FullName.Substring($rootDir.Length + 1)
            $destPath = Join-Path $installDir $relativePath
            $destDir = Split-Path -Parent $destPath

            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            }

            Copy-Item $file.FullName $destPath -Force -ErrorAction SilentlyContinue

            $copiedItems++
            $progress = 15 + [int](($copiedItems / $totalItems) * 70)
            $progressBar.Value = [math]::Min($progress, 85)

            if ($copiedItems % 100 -eq 0) {
                $lblStatus.Text = "Copying files... ($copiedItems of $totalItems)"
                [System.Windows.Forms.Application]::DoEvents()
            }
        }

        # Step 3: Create desktop shortcut
        if ($createShortcut) {
            $lblStatus.Text = "Creating desktop shortcut..."
            $progressBar.Value = 88
            [System.Windows.Forms.Application]::DoEvents()

            $shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$appName.lnk"
            $wshShell = New-Object -ComObject WScript.Shell
            $shortcut = $wshShell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = Join-Path $installDir "windows.bat"
            $shortcut.WorkingDirectory = $installDir
            $shortcut.IconLocation = Join-Path $installDir "app\sunsides.ico"
            $shortcut.Description = "Launch Uncensored AI Studio"
            $shortcut.Save()
        }

        # Step 4: Create Start Menu shortcut
        if ($createStartMenu) {
            $lblStatus.Text = "Creating Start Menu shortcut..."
            $progressBar.Value = 92
            [System.Windows.Forms.Application]::DoEvents()

            $startMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) $appName
            New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
            $startMenuShortcut = Join-Path $startMenuDir "$appName.lnk"
            $wshShell = New-Object -ComObject WScript.Shell
            $shortcut = $wshShell.CreateShortcut($startMenuShortcut)
            $shortcut.TargetPath = Join-Path $installDir "windows.bat"
            $shortcut.WorkingDirectory = $installDir
            $shortcut.IconLocation = Join-Path $installDir "app\sunsides.ico"
            $shortcut.Description = "Launch Uncensored AI Studio"
            $shortcut.Save()
        }

        # Step 5: Run setup
        if ($runSetup) {
            $lblStatus.Text = "Running first-time setup (downloading backends)..."
            $progressBar.Value = 95
            [System.Windows.Forms.Application]::DoEvents()

            $setupScript = Join-Path $installDir "scripts\setup\setup.ps1"
            if (Test-Path $setupScript) {
                $psi = New-Object System.Diagnostics.ProcessStartInfo
                $psi.FileName = "powershell.exe"
                $psi.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$setupScript`""
                $psi.WorkingDirectory = $installDir
                $psi.UseShellExecute = $true
                $process = [System.Diagnostics.Process]::Start($psi)
                $process.WaitForExit()
            }
        }

        $progressBar.Value = 100
        $lblStatus.Text = "Installation complete!"
        [System.Windows.Forms.Application]::DoEvents()

        [System.Windows.Forms.MessageBox]::Show(
            "Uncensored AI Studio has been installed successfully!`n`nYou can launch it from the desktop shortcut or Start Menu.",
            "Installation Complete",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )

        $form.Close()

    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Installation failed: $_",
            "Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        $btnInstall.Enabled = $true
    }
}

$btnInstall.Add_Click({
    $tabControl.SelectedTab = $tabSummary
    $summaryBox.Text = "Installation path:    $($txtPath.Text)`r`n"
    $summaryBox.Text += "Desktop shortcut:     $(if ($chkShortcut.Checked) { 'Yes' } else { 'No' })`r`n"
    $summaryBox.Text += "Start Menu entry:     $(if ($chkStartMenu.Checked) { 'Yes' } else { 'No' })`r`n"
    $summaryBox.Text += "Run first-time setup: $(if ($chkRunSetup.Checked) { 'Yes' } else { 'No' })`r`n"
    $summaryBox.Text += "`r`nClick Install to begin."

    $btnInstall.Text = "Install"
    $btnInstall.Add_Click({
        $btnInstall.Enabled = $false
        $btnInstall.Text = "Installing..."
        $tabControl.SelectedTab = $tabProgress
        Install-App
    })
})

$btnCancel.Add_Click({ $form.Close() })

# ── Show Form ──────────────────────────────────────────────────────────────────
$form.ShowDialog() | Out-Null
