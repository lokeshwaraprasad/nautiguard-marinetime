@echo off
setlocal
cd /d "%~dp0"
title NautiGuard - local server
echo ============================================
echo   NautiGuard - starting on this computer
echo ============================================
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo Python 3.12 or newer is not installed.
  echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv .venv || goto :fail
)
echo Installing / checking packages (first time takes a minute)...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || goto :fail
if not exist ".env" copy ".env.example" ".env" >nul
echo.
echo NautiGuard is running at  http://127.0.0.1:5000
echo Keep this window open. Close it (or press Ctrl+C) to stop the app.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:5000"
".venv\Scripts\python.exe" app.py
pause
exit /b 0
:fail
echo.
echo Something went wrong. Read the message above, then see README.md - Troubleshooting.
pause
exit /b 1
