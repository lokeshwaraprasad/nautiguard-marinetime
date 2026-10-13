@echo off
setlocal
cd /d "%~dp0"
title NautiGuard - deploy to Vercel
echo ============================================
echo   NautiGuard - publish online with Vercel
echo ============================================
where npx >nul 2>nul || (
  echo Node.js is needed for the Vercel tool. Install the LTS version from https://nodejs.org
  echo then run this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
echo.
echo Step 1 of 2: sign in to Vercel. A browser window opens - approve the login there.
call npx --yes vercel@latest login || goto :fail
echo.
echo Step 2 of 2: uploading and deploying NautiGuard (about 1-2 minutes)...
call npx --yes vercel@latest deploy --prod --yes || goto :fail
echo.
echo ============================================
echo  DONE. Your public link is the "Production" / "Aliased" https://....vercel.app URL above.
echo  To enable the AI assistant: Vercel dashboard - Project - Settings - Environment Variables -
echo  add GEMINI_API_KEY, then run this file again to redeploy.
echo ============================================
pause
exit /b 0
:fail
echo.
echo Deployment stopped. Read the message above, then see README.md - Troubleshooting.
pause
exit /b 1
