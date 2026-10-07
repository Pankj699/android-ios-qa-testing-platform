@echo off
REM =========================================================================
REM  Android Play Asset Delivery (PAD) / ORD QA Web Testing Platform Launcher
REM =========================================================================
TITLE Android PAD QA Testing Platform

echo =========================================================
echo  Starting Android PAD / ORD QA Web Testing Platform...
echo =========================================================
echo.

REM Check if node is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH. Please install Node.js 18+.
    pause
    exit /b 1
)

REM Check if backend node_modules exist
if not exist "backend\node_modules" (
    echo [INFO] Installing backend dependencies...
    cd backend && npm.cmd install && cd ..
)

REM Check if frontend build exists
if not exist "frontend\dist" (
    echo [INFO] Building frontend application...
    cd frontend && npm.cmd install && npm.cmd run build && cd ..
)

echo.
echo [INFO] Starting Backend Server on http://localhost:3000...
echo [INFO] Open your browser and navigate to: http://localhost:3000
echo.

cd backend
node src/index.js

pause
