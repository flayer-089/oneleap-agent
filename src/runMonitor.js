const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');
const {
  getContactPeople,
  scrollContactsToLoadMore,
  scrollProfileToBottom,
  scrapeContactDetails,
  BASE_URL
} = require('./scrapeContacts');
const { scrapeProfile } = require('./scrapeProfile');
const { loadWorkbook, buildIdRowMap, readRow, COLUMNS } = require('./logger');
const {
  readTab,
  writeTab,
  acquireRunLock,
  releaseRunLock,
  isConfigured,
  LEADS_LOG_TAB,
  CONTACTS_TAB
} = require('./googleSheets');
const { gotoRetry } = require('./navigation');

const CDP_URL = 'http://localhost:9222';
const CONTACTS_URL = 'https://connect.onegiantleap.com/event/leap2026/contacts';
const OUT_FILE = path.join(__dirname, '..', 'output', 'leads_with_contacts.xlsx');
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

const DEFAULTS = {
  delayMs: 2500,
  pauseEvery: 20,
  pauseMs: 25000,
  errorThreshold: 3,
  errorPauseMs: 45000
};

function buildContactDetailsValue(details, personUrl) {
  const parts = [];
  if (details.emails.length) parts.push(...details.emails);
  if (details.phones.length) parts.push(...details.phones);
  if (details.location) parts.push(details.location);
  if (parts.length) return parts.join('\n');
  return personUrl;
}

function readGoogleSheetUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return String(cfg.googleSheetUrl || '').trim();
  } catch (e) {
    return '';
  }
}

async function startMonitor(opts = {}, events = {}) {
  const log = (msg) => {
    if (typeof events.onLog === 'function') events.onLog(msg);
    else console.log(msg);
  };

  const shouldStop = () => (typeof events.shouldStop === 'function' ? events.shouldStop() : false);

  const options = { ...DEFAULTS, ...opts };

  const gotoWithRetry = async (page, url, maxRetries = 2) => {
    for (let i = 0; i < maxRetries; i++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const errored = await page.evaluate(() =>
        /something went wrong|oops/i.test(document.body.innerText || '')
      ).catch(() => false);
      if (!errored) return true;
      log(`[MONITOR] Page errored, retrying (${i + 1}/${maxRetries})...`);
      await page.waitForTimeout(3000);
    }
    return false;
  };

  const loadOutputRows = async () => {
    const rows = [];
    if (!fs.existsSync(OUT_FILE)) return rows;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(OUT_FILE);
      const ws = wb.getWorksheet('Leads');
      if (ws) ws.eachRow((row, n) => { if (n > 1) rows.push(readRow(row)); });
    } catch (e) {
      log(`[MONITOR] Could not read output file: ${e.message}`);
    }
    return rows;
  };

  const saveOutput = async (rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.columns = COLUMNS;
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    await wb.xlsx.writeFile(OUT_FILE);
  };

  const sheetUrl = readGoogleSheetUrl();
  const sheetConfigured = sheetUrl && isConfigured(sheetUrl);
  let lockOwner = null;
  let browser;

  let contacts = [];
  let matched = [];
  let collected = 0;
  let filtered = 0;
  let errored = 0;
  let urlFallback = 0;
  let outputRows = [];

  try {
    if (sheetConfigured) {
      lockOwner = `${os.hostname()}:monitor:${Date.now()}`;
      const gotLock = await acquireRunLock(sheetUrl, lockOwner).catch((e) => {
        log(`[LOCK] Error acquiring lock: ${e.message}`);
        return false;
      });
      if (!gotLock) {
        throw new Error('Another machine is currently running a job (run-lock held). Refusing to start.');
      }
      log('[LOCK] Acquired run lock');
    }

    log('[MONITOR] Connecting to Chrome on CDP ' + CDP_URL + ' ...');
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const page = await context.newPage();

    log('[MONITOR] Navigating to contacts page...');
    const contactsLoaded = await gotoRetry(page, CONTACTS_URL, log, { retries: 3 });
    if (!contactsLoaded) {
      log('[MONITOR] Could not load the contacts page.');
    }
    await page.waitForSelector('a[href*="/person/"]', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(2000);

    for (let i = 0; i < 20; i++) {
      const scrolled = await scrollContactsToLoadMore(page);
      if (!scrolled) break;
    }

    contacts = await getContactPeople(page);
    log(`[MONITOR] Found ${contacts.length} contacts on the contacts page`);

    const idRowMap = new Map();
    const { worksheet } = await loadWorkbook();
    buildIdRowMap(worksheet).forEach((row, id) => {
      if (!idRowMap.has(id)) idRowMap.set(id, readRow(row));
    });
    if (sheetConfigured) {
      for (const r of await readTab(sheetUrl, LEADS_LOG_TAB)) {
        const id = String(r.uniqueId || '');
        if (id && id !== 'undefined') idRowMap.set(id, r);
      }
    }
    log(`[MONITOR] Loaded ${idRowMap.size} leads (local + sheet)`);

    const outputMap = new Map();
    for (const r of await loadOutputRows()) {
      const id = String(r.uniqueId || '');
      if (id && id !== 'undefined') outputMap.set(id, r);
    }
    if (sheetConfigured) {
      for (const r of await readTab(sheetUrl, CONTACTS_TAB)) {
        const id = String(r.uniqueId || '');
        if (id && id !== 'undefined') outputMap.set(id, r);
      }
    }
    outputRows = [...outputMap.values()];
    const doneIds = new Set(outputMap.keys());
    log(`[MONITOR] ${doneIds.size} leads already collected (local + sheet)`);

    matched = contacts.filter((c) => !doneIds.has(c.id));
    log(`[MONITOR] ${matched.length} new contacts to process`);

    const toProcess = options.limit ? matched.slice(0, options.limit) : matched;

    let consecutiveErrors = 0;
    let sincePause = 0;

    for (const contact of toProcess) {
      if (shouldStop()) {
        log('[MONITOR] Stop requested, exiting loop.');
        break;
      }

      const personUrl = `${BASE_URL}/event/leap2026/person/${contact.id}`;
      const ok = await gotoWithRetry(page, personUrl);
      if (!ok) {
        errored++;
        consecutiveErrors++;
        log(`[MONITOR] Failed to load ${contact.name || '(no name)'} after retries`);
        if (consecutiveErrors >= options.errorThreshold) {
          log(`[MONITOR] ${consecutiveErrors} consecutive errors - pausing ${options.errorPauseMs}ms...`);
          await page.waitForTimeout(options.errorPauseMs);
          consecutiveErrors = 0;
        }
        continue;
      }
      consecutiveErrors = 0;

      await scrollProfileToBottom(page);
      await page.waitForTimeout(500);

      const profile = await scrapeProfile(page);

      const details = await scrapeContactDetails(page);
      const hasData = !!(details.emails.length || details.phones.length || details.location);
      const value = buildContactDetailsValue(details, personUrl);
      if (!hasData) urlFallback++;

      const row = idRowMap.get(contact.id) || { uniqueId: contact.id, name: contact.name || '' };
      row.name = row.name || profile.name || contact.name || '';
      row.title = row.title || profile.title || '';
      row.company = row.company || profile.company || '';
      row.type = profile.type || row.type || '';
      row.seniorityLevel = profile.seniorityLevel || row.seniorityLevel || '';
      row.companyIdentity = profile.companyIdentity || row.companyIdentity || '';
      row.companyIndustry = profile.companyIndustry || row.companyIndustry || '';
      row.industry = profile.industry || row.industry || '';
      row.sectors = (profile.sectors && profile.sectors.length) ? profile.sectors.join(', ') : (row.sectors || '');
      row.department = profile.department || row.department || '';
      row.companyHQ = profile.companyHQ || row.companyHQ || '';
      row.country = profile.country || row.country || '';
      row.contactDetails = value;

      if (options.dryRun) {
        log(`[DRY-RUN] ${row.name || '(no name)'} (${row.uniqueId}) country="${row.country}" -> ${value.replace(/\n/g, ' | ').slice(0, 120)}`);
      } else {
        outputRows.push(row);
        await saveOutput(outputRows);
        collected++;
        log(`[MONITOR] ${row.name || '(no name)'} -> ${value.replace(/\n/g, ' | ').slice(0, 90)}`);
      }

      sincePause++;
      if (sincePause >= options.pauseEvery) {
        log(`[MONITOR] Pausing ${options.pauseMs}ms after ${sincePause} leads...`);
        await page.waitForTimeout(options.pauseMs);
        sincePause = 0;
      }
      await page.waitForTimeout(options.delayMs);
    }

    if (!options.dryRun && outputRows.length) {
      await saveOutput(outputRows);
      log(`[MONITOR] Saved ${outputRows.length} total rows to ${OUT_FILE}`);
    }

    if (!options.dryRun && outputRows.length && sheetConfigured) {
      try {
        await writeTab(sheetUrl, CONTACTS_TAB, outputRows);
        log(`[SHEETS] Wrote ${outputRows.length} rows to Google Sheet "${CONTACTS_TAB}"`);
      } catch (e) {
        log(`[SHEETS] Could not write to Google Sheet: ${e.message}`);
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (lockOwner) {
      await releaseRunLock(sheetUrl, lockOwner);
      log('[LOCK] Released run lock');
    }
  }

  const summary = {
    contacts: contacts.length,
    matched: matched.length,
    collected,
    filtered,
    urlFallback,
    errored,
    totalSaved: outputRows.length
  };

  log('='.repeat(60));
  log(`[MONITOR] Summary: ${summary.collected} collected (${summary.totalSaved} total saved), ${summary.filtered} filtered (country), ${summary.urlFallback} URL-fallback, ${summary.errored} errored`);
  log('='.repeat(60));

  return summary;
}

module.exports = { startMonitor, DEFAULTS, OUT_FILE };
