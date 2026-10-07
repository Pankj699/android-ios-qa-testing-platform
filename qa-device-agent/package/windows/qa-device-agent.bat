@echo off
REM QA Device Agent - Windows Portable Launcher
setlocal
cd /d "%~dp0"
if exist "%~dp0qa-device-agent\qa-device-agent.exe" (
    "%~dp0qa-device-agent\qa-device-agent.exe" %*
) else if exist "%~dp0qa-device-agent.exe" (
    "%~dp0qa-device-agent.exe" %*
) else (
    echo Error: qa-device-agent.exe not found!
    pause
)
