@echo off
echo Stopping Android PAD / ORD QA Server on Port 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do (
    echo Terminating PID %%a on Port 8080...
    taskkill /F /PID %%a
)
echo Server stopped.
pause
