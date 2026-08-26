const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  getContactPeople,
  scrollContactsToLoadMore,
  scrapeContactDetails,
  BASE_URL
} = require('./src/scrapeContacts');
const { scrapeProfile } = require('./src/scrapeProfile');
const { isAllowed } = require('./src/countryFilter');
const { loadWorkbook, buildIdRowMap, readRow, COLUMNS } = require('./src/logger');

const CDP_URL = 'http://localhost:9222';
const CONTACTS_URL = 'https://connect.onegiantleap.com/event/leap2026/contacts';
const OUT_FILE = path.join(__dirname, 'output', 'leads_with_contacts.xlsx');

const DEFAULTS = {
  delayMs: 2500,
  pauseEvery: 20,
  pauseMs: 25000,
  errorThreshold: 3,
  errorPauseMs: 45000
};

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    watch: false,
    limit: 0,
    ...DEFAULTS
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--watch') opts.watch = true;
    else if (a === '--limit') { opts.limit = parseInt(argv[i + 1], 10) || 0; i++; }
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--pause-every') { opts.pauseEvery = parseInt(argv[i + 1], 10) || DEFAULTS.pauseEvery; i++; }
    else if (a === '--pause-ms') { opts.pauseMs = parseInt(argv[i + 1], 10) || DEFAULTS.pauseMs; i++; }
    else if (a === '--delay-ms') { opts.delayMs = parseInt(argv[i + 1], 10) || DEFAULTS.delayMs; i++; }
  }
  return opts;
}

function buildContactDetailsValue(details, personUrl) {
  const parts = [];
  if (details.emails.length) parts.push(...details.emails);
  if (details.phones.length) parts.push(...details.phones);
  if (details.location) parts.push(details.location);
  if (parts.length) return parts.join('\n');
  return personUrl;
}

async function gotoWithRetry(page, url, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    const errored = await page.evaluate(() =>
      /something went wrong|oops/i.test(document.body.innerText || '')
    ).catch(() => false);
    if (!errored) return true;
    console.log(`[MONITOR] Page errored, retrying (${i + 1}/${maxRetries})...`);
    await page.waitForTimeout(3000);
  }
  return false;
}

async function loadOutputRows() {
  const rows = [];
  if (!fs.existsSync(OUT_FILE)) return rows;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(OUT_FILE);
    const ws = wb.getWorksheet('Leads');
    if (ws) ws.eachRow((row, n) => { if (n > 1) rows.push(readRow(row)); });
  } catch (e) {
    console.log(`[MONITOR] Could not read output file: ${e.message}`);
  }
  return rows;
}

async function saveOutput(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(OUT_FILE);
}

async function runOnce(opts) {
  console.log('[MONITOR] Connecting to Chrome on CDP ' + CDP_URL + ' ...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log('[MONITOR] Navigating to contacts page...');
  await page.goto(CONTACTS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForSelector('a[href*="/person/"]', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(2000);

  for (let i = 0; i < 20; i++) {
    const scrolled = await scrollContactsToLoadMore(page);
    if (!scrolled) break;
  }

  const contacts = await getContactPeople(page);
  console.log(`[MONITOR] Found ${contacts.length} contacts on the contacts page`);

  const { worksheet } = await loadWorkbook();
  const idRowMap = buildIdRowMap(worksheet);
  console.log(`[MONITOR] Loaded ${idRowMap.size} leads from Excel`);

  const outputRows = await loadOutputRows();
  const doneIds = new Set(outputRows.map((r) => String(r.uniqueId)));
  console.log(`[MONITOR] ${doneIds.size} leads already collected in output file`);

  const matched = contacts.filter((c) => idRowMap.has(c.id) && !doneIds.has(c.id));
  console.log(`[MONITOR] ${matched.length} new contacts to process`);

  const toProcess = opts.limit ? matched.slice(0, opts.limit) : matched;

  let collected = 0;
  let filtered = 0;
  let errored = 0;
  let urlFallback = 0;
  let consecutiveErrors = 0;
  let sincePause = 0;

  for (const contact of toProcess) {
    const personUrl = `${BASE_URL}/event/leap2026/person/${contact.id}`;
    const ok = await gotoWithRetry(page, personUrl);
    if (!ok) {
      errored++;
      consecutiveErrors++;
      console.log(`[MONITOR] Failed to load ${contact.name || '(no name)'} after retries`);
      if (consecutiveErrors >= opts.errorThreshold) {
        console.log(`[MONITOR] ${consecutiveErrors} consecutive errors - pausing ${opts.errorPauseMs}ms...`);
        await page.waitForTimeout(opts.errorPauseMs);
        consecutiveErrors = 0;
      }
      continue;
    }
    consecutiveErrors = 0;

    const profile = await scrapeProfile(page);

    if (!isAllowed(profile.country, profile.companyHQ)) {
      filtered++;
      console.log(`[MONITOR] Filtered out (country): ${contact.name || '(no name)'} (Country="${profile.country}", HQ="${profile.companyHQ}")`);
      sincePause++;
      if (sincePause >= opts.pauseEvery) {
        console.log(`[MONITOR] Pausing ${opts.pauseMs}ms after ${sincePause} leads...`);
        await page.waitForTimeout(opts.pauseMs);
        sincePause = 0;
      }
      await page.waitForTimeout(opts.delayMs);
      continue;
    }

    const details = await scrapeContactDetails(page);
    const hasData = !!(details.emails.length || details.phones.length || details.location);
    const value = buildContactDetailsValue(details, personUrl);
    if (!hasData) urlFallback++;

    const row = readRow(idRowMap.get(contact.id));
    if (!row.type) row.type = profile.type || '';
    if (!row.seniorityLevel) row.seniorityLevel = profile.seniorityLevel || '';
    if (!row.companyIdentity) row.companyIdentity = profile.companyIdentity || '';
    if (!row.companyIndustry) row.companyIndustry = profile.companyIndustry || '';
    if (!row.industry) row.industry = profile.industry || '';
    if (!row.sectors) row.sectors = (profile.sectors && profile.sectors.length) ? profile.sectors.join(', ') : '';
    if (!row.department) row.department = profile.department || '';
    if (!row.companyHQ) row.companyHQ = profile.companyHQ || '';
    if (!row.country) row.country = profile.country || '';
    row.contactDetails = value;

    if (opts.dryRun) {
      console.log(`[DRY-RUN] ${row.name || '(no name)'} (${row.uniqueId})`);
      console.log(`         type="${row.type}" seniority="${row.seniorityLevel}" identity="${row.companyIdentity}"`);
      console.log(`         industry="${row.companyIndustry}" sectors="${row.sectors}" dept="${row.department}"`);
      console.log(`         HQ="${row.companyHQ}" country="${row.country}"`);
      console.log(`         contact=${value.replace(/\n/g, ' | ').slice(0, 120)}`);
    } else {
      outputRows.push(row);
      await saveOutput(outputRows);
      collected++;
      console.log(`[MONITOR] ${row.name || '(no name)'} | ${row.seniorityLevel || row.title || ''} | ${row.companyIndustry || row.industry || ''} | ${row.country || ''} -> ${value.replace(/\n/g, ' | ').slice(0, 90)}`);
    }

    sincePause++;
    if (sincePause >= opts.pauseEvery) {
      console.log(`[MONITOR] Pausing ${opts.pauseMs}ms after ${sincePause} leads...`);
      await page.waitForTimeout(opts.pauseMs);
      sincePause = 0;
    }
    await page.waitForTimeout(opts.delayMs);
  }

  if (!opts.dryRun && outputRows.length) {
    await saveOutput(outputRows);
    console.log(`[MONITOR] Saved ${outputRows.length} total rows to ${OUT_FILE}`);
  }

  await browser.close();

  return {
    contacts: contacts.length,
    matched: matched.length,
    collected,
    filtered,
    urlFallback,
    errored,
    totalSaved: outputRows.length
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('='.repeat(60));
  console.log('[MONITOR] Contacts monitor');
  console.log(`[MONITOR] dry-run: ${opts.dryRun}, watch: ${opts.watch}, limit: ${opts.limit || 'none'}`);
  console.log(`[MONITOR] delay=${opts.delayMs}ms, pauseEvery=${opts.pauseEvery}, pauseMs=${opts.pauseMs}ms, errorThreshold=${opts.errorThreshold}`);
  console.log('='.repeat(60));

  do {
    const summary = await runOnce(opts);
    console.log('='.repeat(60));
    console.log(`[MONITOR] Summary: ${summary.collected} collected (${summary.totalSaved} total saved), ${summary.filtered} filtered (country), ${summary.urlFallback} URL-fallback, ${summary.errored} errored`);
    console.log('='.repeat(60));

    if (!opts.watch) break;
    console.log('[MONITOR] Sleeping for 3 hours...');
    await new Promise((r) => setTimeout(r, 3 * 60 * 60 * 1000));
  } while (opts.watch);
}

main().catch((e) => {
  console.error('[MONITOR] Fatal error:', e.message);
  process.exit(1);
});
