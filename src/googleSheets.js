const fs = require('fs');
const path = require('path');

const { COLUMNS } = require('./logger');

const CREDS_FILE = path.join(__dirname, '..', 'config', 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function loadCredentials() {
  if (!fs.existsSync(CREDS_FILE)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    if (c.client_id && c.client_secret && c.refresh_token) return c;
    return null;
  } catch (e) {
    console.log('[SHEETS] Could not parse Google credentials:', e.message);
    return null;
  }
}

function sheetIdFromUrl(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function sheetUrlFromId(id) {
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

function isConfigured(url) {
  return !!sheetIdFromUrl(url) && !!loadCredentials();
}

async function writeLeadsToSheet(url, rows) {
  const sheetId = sheetIdFromUrl(url);
  const creds = loadCredentials();
  if (!sheetId || !creds) {
    throw new Error('Google Sheets not configured (missing sheet URL or Google credentials)');
  }

  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({ refresh_token: creds.refresh_token });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheetTitle =
    meta.data.sheets && meta.data.sheets[0]
      ? meta.data.sheets[0].properties.title
      : 'Sheet1';

  const headers = COLUMNS.map((c) => c.header);
  const values = [headers].concat(
    rows.map((r) =>
      COLUMNS.map((c) => {
        const v = r[c.key];
        return v === undefined || v === null ? '' : String(v);
      })
    )
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${sheetTitle}'!A1:Z100000`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  return { sheetId, sheetTitle, rowCount: rows.length, url: sheetUrlFromId(sheetId) };
}

module.exports = {
  loadCredentials,
  sheetIdFromUrl,
  sheetUrlFromId,
  isConfigured,
  writeLeadsToSheet,
  CREDS_FILE
};
