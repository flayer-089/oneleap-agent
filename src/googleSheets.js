const fs = require('fs');
const path = require('path');

const { COLUMNS } = require('./logger');

const CREDS_FILE = path.join(__dirname, '..', 'config', 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const CONTACTS_TAB = 'Leads';
const LEADS_LOG_TAB = 'Leads Log';
const CONTROL_TAB = 'Control';

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

function cellValue(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function getSheetsClient() {
  const creds = loadCredentials();
  if (!creds) throw new Error('Google credentials missing');
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({ refresh_token: creds.refresh_token });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(sheets, sheetId, title, headers = null) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === title);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  if (headers) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${title}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
  }
}

async function readTab(sheetUrl, title) {
  const sheetId = sheetIdFromUrl(sheetUrl);
  if (!sheetId) return [];
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values
    .get({ spreadsheetId: sheetId, range: `'${title}'` })
    .catch(() => null);
  if (!res || !res.data.values || res.data.values.length <= 1) return [];
  const values = res.data.values;
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    COLUMNS.forEach((c, idx) => {
      const v = values[i][idx];
      obj[c.key] = v === undefined || v === null ? '' : String(v);
    });
    rows.push(obj);
  }
  return rows;
}

async function writeTab(sheetUrl, title, rows) {
  const sheetId = sheetIdFromUrl(sheetUrl);
  const sheets = await getSheetsClient();
  const headers = COLUMNS.map((c) => c.header);
  await ensureTab(sheets, sheetId, title, headers);
  const values = [headers].concat(rows.map((r) => COLUMNS.map((c) => cellValue(r[c.key]))));
  await sheets.spreadsheets.values
    .clear({ spreadsheetId: sheetId, range: `'${title}'!A1:ZZ20000` })
    .catch(() => {});
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

async function appendTab(sheetUrl, title, rows) {
  if (!rows.length) return;
  const sheetId = sheetIdFromUrl(sheetUrl);
  const sheets = await getSheetsClient();
  const headers = COLUMNS.map((c) => c.header);
  await ensureTab(sheets, sheetId, title, headers);
  const values = rows.map((r) => COLUMNS.map((c) => cellValue(r[c.key])));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });
}

async function acquireRunLock(sheetUrl, owner, ttlMs = 2 * 60 * 60 * 1000) {
  const sheetId = sheetIdFromUrl(sheetUrl);
  const sheets = await getSheetsClient();
  await ensureTab(sheets, sheetId, CONTROL_TAB);
  const res = await sheets.spreadsheets.values
    .get({ spreadsheetId: sheetId, range: `'${CONTROL_TAB}'!A1:B1` })
    .catch(() => null);
  const row = res && res.data.values ? res.data.values[0] : [];
  const [rawOwner, rawTime] = row;
  const now = Date.now();
  if (rawOwner) {
    const startedAt = parseInt(rawTime, 10) || now;
    if (rawOwner !== owner && now - startedAt < ttlMs) return false;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${CONTROL_TAB}'!A1:B1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[owner, String(now)]] }
  });
  return true;
}

async function releaseRunLock(sheetUrl, owner) {
  try {
    const sheetId = sheetIdFromUrl(sheetUrl);
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values
      .get({ spreadsheetId: sheetId, range: `'${CONTROL_TAB}'!A1:B1` })
      .catch(() => null);
    const row = res && res.data.values ? res.data.values[0] : [];
    if (row[0] === owner) {
      await sheets.spreadsheets.values
        .clear({ spreadsheetId: sheetId, range: `'${CONTROL_TAB}'!A1:B1` })
        .catch(() => {});
    }
  } catch (e) {
    console.log('[LOCK] Could not release lock:', e.message);
  }
}

module.exports = {
  loadCredentials,
  sheetIdFromUrl,
  sheetUrlFromId,
  isConfigured,
  readTab,
  writeTab,
  appendTab,
  acquireRunLock,
  releaseRunLock,
  CREDS_FILE,
  CONTACTS_TAB,
  LEADS_LOG_TAB
};
