@echo off
setlocal

if "%~1"=="" (
  echo Usage: setup-profile.cmd ^<profile-name^>
  echo Example: setup-profile.cmd admin
  echo.
  echo Suggested profile names match the demo logins in SKILL.md's
  echo Demo Accounts table, e.g.: admin, estimator, pm, purchasing,
  echo finance, hr, superadmin
  exit /b 1
)

set PROFILE_DIR=%~dp0..\.edge-profiles\%~1

set EDGE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe

if "%EDGE%"=="" (
  echo Could not find msedge.exe in the usual install locations.
  echo Edit this script to point EDGE at your Edge or Chrome executable.
  exit /b 1
)

echo Opening a dedicated Edge profile at:
echo   %PROFILE_DIR%
echo.
echo Log in as the role this profile should represent (see SKILL.md's Demo
echo Accounts table), then just close the window when you're done. This
echo profile's session/localStorage is what screenshot-widths.cmd reuses.
echo.
echo Make sure "npm run dev" is already running in another window first.

start "" "%EDGE%" --user-data-dir="%PROFILE_DIR%" "http://localhost:5173/login"

endlocal
