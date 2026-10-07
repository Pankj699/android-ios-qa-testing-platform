@echo off
REM =========================================================================
REM  Direct PowerShell QA Test Launcher
REM =========================================================================
setlocal
cd /d "%~dp0.."

powershell.exe -ExecutionPolicy Bypass -File "%~dp0qa-test-asset-delivery.ps1" %*

pause
