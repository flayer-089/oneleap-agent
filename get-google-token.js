const http = require('http');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const PORT = parseInt(process.env.TOKEN_PORT || '8085', 10);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const CREDS_FILE = path.join(__dirname, 'config', 'google-credentials.json');

async function main() {
  const [clientId, clientSecret] = process.argv.slice(2);
  if (!clientId || !clientSecret) {
    console.error('Usage: node get-google-token.js <client_id> <client_secret>');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${PORT}`);

  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  console.log('1. Open this URL in your browser:');
  console.log('');
  console.log(url);
  console.log('');
  console.log('2. Sign in with the Google account that owns the sheet and approve access.');
  console.log('   If you see "Google hasn\'t verified this app", click Advanced -> Go to (unsafe).');
  console.log('');

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const code = parsed.searchParams.get('code');

    if (code) {
      res.end('Authorization successful. You can close this tab and return to the terminal.');
      server.close();
      try {
        const { tokens } = await oauth2.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error('No refresh token returned. Try again (Google only returns it on first consent).');
        }
        const creds = {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token
        };
        fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), 'utf8');
        console.log('Saved credentials to ' + CREDS_FILE);
        console.log('You can now set your sheet URL in the app UI.');
        process.exit(0);
      } catch (e) {
        console.error('Error exchanging code:', e.message);
        process.exit(1);
      }
    } else {
      res.end('No authorization code received.');
    }
  });

  server.listen(PORT, () => console.log(`Waiting for redirect on http://localhost:${PORT} ...`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
