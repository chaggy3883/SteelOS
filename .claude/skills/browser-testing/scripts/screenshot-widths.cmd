@echo off
setlocal enabledelayedexpansion

if "%~2"=="" (
  echo Usage: screenshot-widths.cmd ^<profile-name^> ^<route-path^>
  echo Example: screenshot-widths.cmd admin /production
  echo.
  echo Run setup-profile.cmd once for ^<profile-name^> first, and log in
  echo there, before using this script against it.
  exit /b 1
)

set PROFILE_NAME=%~1
set ROUTE=%~2
set PROFILE_DIR=%~dp0..\.edge-profiles\%PROFILE_NAME%
set OUTDIR=%~dp0..\.screenshots

if not exist "%PROFILE_DIR%" (
  echo No profile found at %PROFILE_DIR%
  echo Run setup-profile.cmd %PROFILE_NAME% first and log in.
  exit /b 1
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

set EDGE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe

if "%EDGE%"=="" (
  echo Could not find msedge.exe. Edit this script to point EDGE at your
  echo Edge or Chrome executable.
  exit /b 1
)

set SAFE_ROUTE=%ROUTE:/=_%
if "%SAFE_ROUTE%"=="" set SAFE_ROUTE=_root

echo Make sure no other Edge window is already using the "%PROFILE_NAME%"
echo profile - a locked profile directory will make these launches fail
echo or silently fall back to a blank profile.
echo.

echo Capturing 1024px wide...
"%EDGE%" --headless=new --disable-gpu --user-data-dir="%PROFILE_DIR%" --window-size=1024,900 --screenshot="%OUTDIR%\%PROFILE_NAME%%SAFE_ROUTE%_1024.png" "http://localhost:5173%ROUTE%"

echo Capturing 1440px wide...
"%EDGE%" --headless=new --disable-gpu --user-data-dir="%PROFILE_DIR%" --window-size=1440,900 --screenshot="%OUTDIR%\%PROFILE_NAME%%SAFE_ROUTE%_1440.png" "http://localhost:5173%ROUTE%"

echo Capturing 1920px wide...
"%EDGE%" --headless=new --disable-gpu --user-data-dir="%PROFILE_DIR%" --window-size=1920,1080 --screenshot="%OUTDIR%\%PROFILE_NAME%%SAFE_ROUTE%_1920.png" "http://localhost:5173%ROUTE%"

echo.
echo Screenshots written to %OUTDIR%
echo This script only captures images - open them yourself and judge
echo truncation/overflow by eye. If a screenshot is blank or shows the
echo login page instead of the expected route, the profile isn't logged
echo in (or Edge's headless mode couldn't read its session) - fall back
echo to a manual check for that route/role.

endlocal
