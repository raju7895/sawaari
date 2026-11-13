@echo off
REM ============================================================
REM  Sawaari - push the project to GitHub
REM  Double-click this file. It will:
REM    1. check that no secret is about to be published
REM    2. ask for your GitHub username
REM    3. connect to the repository and push
REM  A browser window opens for you to sign in to GitHub.
REM ============================================================
setlocal
cd /d "%~dp0.."

echo.
echo  ==============================================
echo   SAWAARI - PUSH TO GITHUB
echo  ==============================================
echo.

REM 1. safety audit
echo  [1/3] Checking that no secret is about to be published...
call node scripts\audit-before-push.js
if errorlevel 1 (
  echo.
  echo  Audit FAILED. Nothing was pushed. Please send me the output.
  pause
  exit /b 1
)

REM 2. ask for the username
set "USER_NAME="
set /p "USER_NAME=  [2/3] Your GitHub username (e.g. utkarshba): "
if "%USER_NAME%"=="" (
  echo  No username given - nothing was pushed.
  pause
  exit /b 1
)
set "REPO=sawaari"

echo.
echo  [3/3] Pushing to https://github.com/%USER_NAME%/%REPO%
echo        A browser window will open so you can sign in to GitHub.
echo.

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin https://github.com/%USER_NAME%/%REPO%.git
) else (
  git remote set-url origin https://github.com/%USER_NAME%/%REPO%.git
)

git push -u origin main
if errorlevel 1 (
  echo.
  echo  ------------------------------------------------
  echo   The push did not complete. This is normal if the
  echo   repository does not exist yet.
  echo.
  echo   Please do ONE thing:
  echo     open https://github.com/new
  echo     name it   : %REPO%
  echo     leave it completely EMPTY (no README, no .gitignore)
  echo     click "Create repository"
  echo   then run this file again.
  echo  ------------------------------------------------
  pause
  exit /b 1
)

echo.
echo  ==============================================
echo   DONE! Your code is at:
echo   https://github.com/%USER_NAME%/%REPO%
echo  ==============================================
echo.
echo  To put it online, open DEPLOY.md in the project folder.
echo.
pause
