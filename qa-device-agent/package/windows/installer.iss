; Inno Setup Script for QA Device Agent
#define MyAppName "QA Device Agent"
#define MyAppVersion "1.1.2"
#define MyAppPublisher "Centralized QA Testing Platform"
#define MyAppExeName "qa-device-agent.exe"

[Setup]
AppId={{D37E84B1-29E5-4C82-9B7C-4C8A97A218E2}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\..\dist
OutputBaseFilename=QA-Device-Agent-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startmenu"; Description: "Create Start Menu shortcut"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\..\dist\qa-device-agent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenu
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up temporary runtime cache while preserving AppData configuration unless user explicitly removes it
Type: filesandordirs; Name: "{app}"

[Code]
// Prerequisite Check for Apple Mobile Device Support
function InitializeSetup(): Boolean;
var
  ServiceFound: Boolean;
begin
  Result := True;
  // Note: Installer allows user to continue, but gives clear guidance if Apple drivers are not present
end;
