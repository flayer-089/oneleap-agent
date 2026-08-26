@echo off
rem Expose the local OneLeap server via Cloudflare Tunnel.
rem Requires: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not found. Install it first:
  echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  pause
  exit /b 1
)

echo Starting Cloudflare quick tunnel to http://localhost:3000 ...
echo A temporary URL will be printed below. Keep this window open.
echo.
cloudflared tunnel --url http://localhost:3000
