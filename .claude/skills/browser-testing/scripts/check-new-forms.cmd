@echo off
echo Scanning src\ for form tags...
echo.
findstr /S /N /C:"<form" src\*.jsx src\*.js
echo.
echo Compare every match above against the frozen legacy baseline in
echo SKILL.md ("Standing Rule: No New Form Tags"). Any file NOT on that
echo baseline list is a new violation of the no-form-tag rule.
