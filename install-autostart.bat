@echo off
echo ========================================================
echo  Installing Android PAD / ORD QA Server to Windows Startup
echo ========================================================
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "BACKEND_DIR=%PROJECT_DIR%\backend"
set "DEST_VBS=%STARTUP_FOLDER%\Start-Android-PAD-QA-Server.vbs"

echo Project Directory: %PROJECT_DIR%
echo Backend Directory: %BACKEND_DIR%
echo Destination: %DEST_VBS%

(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.CurrentDirectory = "%BACKEND_DIR%"
echo WshShell.Run "cmd.exe /c node src/index.js", 0, False
) > "%DEST_VBS%"

if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Auto-start script installed in Windows Startup folder!
    echo The server will now automatically start on Port 8080 whenever you start your PC.
) else (
    echo [ERROR] Failed to install into Startup folder.
)
echo ========================================================
pause
