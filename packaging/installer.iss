; Uncensored AI Studio - Inno Setup Installer Script
; Generates a professional Windows installer with desktop shortcuts.

#define MyAppName "Uncensored AI Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Uncensored AI Studio"
#define MyAppURL "https://github.com/uncensored-ai-studio"
#define MyAppExeName "windows.bat"
#define MyAppIcoName "app\sunsides.ico"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
LicenseFile=LICENSE
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=.\output
OutputBaseFilename=UncensoredAIStudio_Setup_{#MyAppVersion}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=100,100
DisableWelcomePage=no
UninstallDisplayIcon={app}\{#MyAppIcoName}
SetupIconFile=..\app\sunsides.ico
UninstallDisplayName={#MyAppName}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce
Name: "startmenuicon"; Description: "Create a &Start Menu shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "..\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\windows.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\.gitignore"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app\sunsides.ico"; Tasks: startmenuicon; Comment: "Launch Uncensored AI Studio"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app\sunsides.ico"; Tasks: desktopicon; Comment: "Launch Uncensored AI Studio"
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app\sunsides.ico"; Tasks: desktopicon; Comment: "Launch Uncensored AI Studio on startup"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: postinstall nowait skipifsilent shellexec; WorkingDir: "{app}"

[UninstallRun]
Filename: "{app}\scripts\reset\reset.ps1"; Flags: runhidden skipifdoesntexist

[Code]
var
  SetupModePage: TInputOptionWizardPage;
  UseCudaOption: TInputOptionWizardPage;
  DownloadModelsPage: TInputOptionWizardPage;

procedure InitializeWizard;
begin
  SetupModePage := CreateInputOptionPage(wpWelcome,
    'Setup Mode', 'Choose how to configure the application.',
    'Uncensored AI Studio requires backend components for AI inference. Select your preferred setup method:',
    True, False);
  SetupModePage.Add('Express Setup (Recommended) - Download pre-built CPU + GPU backends automatically');
  SetupModePage.Add('Custom Setup - Let me choose specific backends later');
  SetupModePage.SelectedValueIndex := 0;

  DownloadModelsPage := CreateInputOptionPage(SetupModePage.ID,
    'Model Download', 'Would you like to download starter models?',
    'Models are required for image generation and text chat. You can download them now or add them later from the app interface.',
    True, False);
  DownloadModelsPage.Add('Skip model download (I will add models manually later)');
  DownloadModelsPage.Add('Download recommended starter models (small ~2GB total)');
  DownloadModelsPage.SelectedValueIndex := 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  SetupScript: String;
begin
  if CurStep = ssPostInstall then
  begin
    if SetupModePage.SelectedValueIndex = 0 then
    begin
      SetupScript := ExpandConstant('{app}\scripts\setup\setup.ps1');
      if FileExists(SetupScript) then
      begin
        if Exec('powershell.exe', '-ExecutionPolicy Bypass -File "' + SetupScript + '"',
               '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
        begin
          if ResultCode = 0 then
            MsgBox('Backend setup completed successfully!', mbInformation, MB_OK)
          else
            MsgBox('Backend setup finished with code ' + IntToStr(ResultCode) + '. You can re-run setup from scripts\setup\setup.ps1', mbWarning, MB_OK);
        end;
      end;
    end;
  end;
end;
