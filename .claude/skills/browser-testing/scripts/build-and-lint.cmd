@echo off
setlocal

echo === npm run build ===
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED - stopping.
  exit /b 1
)

echo.
echo === npm run lint ===
call npm run lint
if errorlevel 1 (
  echo.
  echo LINT FAILED - stopping.
  exit /b 1
)

echo.
echo Build and lint both passed.
endlocal
