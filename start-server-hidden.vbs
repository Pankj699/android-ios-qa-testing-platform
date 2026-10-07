Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strBackendDir = strScriptDir & "\backend"
WshShell.CurrentDirectory = strBackendDir
WshShell.Run "cmd.exe /c node src/index.js", 0, False
