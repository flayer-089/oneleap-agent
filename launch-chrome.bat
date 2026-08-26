@echo off
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE="%~dp0browser-data"
set PORT=9222

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo Launching Chrome with remote debugging on port %PORT%...
echo Profile directory: %PROFILE%
echo.
echo KEEP THIS WINDOW OPEN WHILE THE SCRIPT RUNS.
echo.

%CHROME% --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --start-maximized "https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI="
