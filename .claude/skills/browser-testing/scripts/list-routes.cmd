@echo off
echo Extracting route declarations from src\App.jsx...
echo.
findstr /N /C:"Route path=" src\App.jsx
echo.
echo Cross-check this list against the Route Inventory table in SKILL.md.
echo A route here that is missing from that table (or vice versa) means the
echo checklist has drifted from the actual router and needs updating.
