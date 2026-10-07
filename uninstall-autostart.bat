@echo off
echo ========================================================
echo  Uninstalling Android PAD / ORD QA Server from Windows Startup
echo ========================================================
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "DEST_VBS=%STARTUP_FOLDER%\Start-Android-PAD-QA-Server.vbs"

if exist "%DEST_VBS%" (
    del /f /q "%DEST_VBS%"
    echo [SUCCESS] Auto-start script removed from Windows Startup folder.
) else (
    echo [INFO] Auto-start script was not found in Startup folder.
)
echo ========================================================
pause
