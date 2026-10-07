@echo off
title Android PAD / ORD QA Testing Platform (Port 8080)
echo ========================================================
echo  Starting Android PAD / ORD QA Server on Port 8080...
echo  Local URL:   http://localhost:8080
echo  Network URL: http://192.168.0.163:8080
echo ========================================================
cd /d "%~dp0backend"
node src/index.js
pause
