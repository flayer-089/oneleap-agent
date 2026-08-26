# Deploying the OneLeap Agent UI to your team

The app runs as a local web server (`node server.js`) on the host machine that also runs Chrome.
To let team members reach it over the internet, use **Cloudflare Tunnel**.

## Option A — Quick tunnel (no domain, temporary URL)

1. Install `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Start the app: `node server.js`
3. In another terminal, run: `cloudflared tunnel --url http://localhost:3000`
   (or just run `tunnel.bat`)
4. Share the printed `https://xxxx.trycloudflare.com` URL with your team.

> The URL changes every time you restart the tunnel. The app itself is still
> protected by the login (email + password in `config/auth.json`).

## Option B — Named tunnel (stable URL, needs a domain)

1. Install `cloudflared` and log in once:
   ```
   cloudflared tunnel login
   ```
2. Create the tunnel:
   ```
   cloudflared tunnel create oneleap
   ```
3. Point a domain (or subdomain) at it (must be a domain on your Cloudflare account):
   ```
   cloudflared tunnel route dns oneleap oneleap.yourdomain.com
   ```
4. Run it:
   ```
   cloudflared tunnel run oneleap
   ```

## Login credentials

Team members log in with the email/password in `config/auth.json`
(default: `admin@oneleap.com` / `changeme123`). **Change these before sharing the URL.**

## Notes

- The host machine must stay on, with Chrome logged in (one-time) and the filters set.
- Only one job (Connections or Monitor) runs at a time.
- The Monitor runs automatically every 3 hours (skips if a job is active).
