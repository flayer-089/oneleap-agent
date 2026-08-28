const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getVisiblePeople, scrollToLoadMore } = require('./scrapeResultsList');
const { scrapeProfile } = require('./scrapeProfile');
const { connectPerson, closePanel } = require('./connectPerson');
const { isAllowed } = require('./countryFilter');
const { DedupeTracker } = require('./dedupe');
const { appendRow, readRow, saveErrorScreenshot, LOG_FILE } = require('./logger');
const { gotoRetry } = require('./navigation');
const {
  readTab,
  appendTab,
  acquireRunLock,
  releaseRunLock,
  isConfigured,
  LEADS_LOG_TAB
} = require('./googleSheets');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

const START_URL = 'https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=';
const BASE_URL = 'https://connect.onegiantleap.com';
const CDP_URL = 'http://localhost:9222';

function readGoogleSheetUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return String(cfg.googleSheetUrl || '').trim();
  } catch (e) {
    return '';
  }
}

function addHandledLeads(set, rows) {
  for (const r of rows) {
    const uniqueId = String(r.uniqueId || '');
    if (!uniqueId || uniqueId === 'undefined' || uniqueId === '__init__') continue;
    const status = String(r.status || '').toLowerCase();
    if (status === 'success') {
      set.add(uniqueId);
    } else if (status === 'skipped-country') {
      const country = String(r.country || '').trim();
      const hq = String(r.companyHQ || '').trim();
      if (country || hq) set.add(uniqueId);
    }
  }
}

async function loadExistingLeads(log) {
  const logFile = path.join(__dirname, '..', 'output', 'leads_log.xlsx');

  if (!fs.existsSync(logFile)) {
    log('[DEDUPE] No existing local log file found');
    return [];
  }

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(logFile);
    const worksheet = workbook.getWorksheet('Leads');
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) rows.push(readRow(row));
    });
    log(`[DEDUPE] Loaded ${rows.length} rows from local log`);
    return rows;
  } catch (error) {
    log(`[DEDUPE] Error reading local log: ${error.message}`);
    return [];
  }
}

async function startConnections(config, events = {}) {
  const log = (msg) => {
    if (typeof events.onLog === 'function') events.onLog(msg);
    else console.log(msg);
  };

  const waitForUser = (message) => {
    if (typeof events.waitForUser === 'function') {
      return Promise.resolve(events.waitForUser(message));
    }
    log(message);
    return new Promise((resolve) => process.stdin.once('data', () => resolve()));
  };

  const shouldStop = () => (typeof events.shouldStop === 'function' ? events.shouldStop() : false);

  const randomDelay = () =>
    Math.floor(Math.random() * (config.delayMaxMs - config.delayMinMs + 1)) + config.delayMinMs;

  const waitWithProgress = async (page, action) => {
    const delay = randomDelay();
    log(`[DELAY] Waiting ${delay}ms before ${action}...`);
    await page.waitForTimeout(delay);
  };

  const checkForCaptcha = async (page) => {
    const captchaSelectors = [
      '[class*="captcha"]',
      '[class*="recaptcha"]',
      '[id*="captcha"]',
      '[data-testid*="captcha"]',
      'iframe[src*="recaptcha"]'
    ];
    for (const selector of captchaSelectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) return true;
      } catch (e) {
        continue;
      }
    }
    return false;
  };

  const gotoList = async (page, listUrl) => {
    await gotoRetry(page, listUrl, log, { retries: 3 });
    await page.waitForSelector('a[href*="/person/"]', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(1000);
  };

  log('='.repeat(60));
  log('[MAIN] Starting OneLeap Agent');
  log(`[MAIN] Session limit: ${config.sessionLimit}`);
  log(`[MAIN] Delay range: ${config.delayMinMs}-${config.delayMaxMs}ms`);
  log(`[MAIN] Country filter: ${config.countryFilterEnabled !== false ? 'ON' : 'OFF'}`);
  log('='.repeat(60));

  const stats = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0
  };

  const dedupe = new DedupeTracker();
  dedupe.seenIds = new Set();

  const sheetUrl = readGoogleSheetUrl();
  const sheetConfigured = sheetUrl && isConfigured(sheetUrl);
  const sheetLogRows = [];
  let lockOwner = null;
  const recordRow = async (data) => {
    await appendRow(data);
    sheetLogRows.push(data);
  };

  let browser;

  try {
    addHandledLeads(dedupe.seenIds, await loadExistingLeads(log));

    if (sheetConfigured) {
      lockOwner = `${os.hostname()}:connections:${Date.now()}`;
      const gotLock = await acquireRunLock(sheetUrl, lockOwner).catch((e) => {
        log(`[LOCK] Error acquiring lock: ${e.message}`);
        return false;
      });
      if (!gotLock) {
        throw new Error('Another machine is currently running a job (run-lock held). Refusing to start.');
      }
      log('[LOCK] Acquired run lock');
      addHandledLeads(dedupe.seenIds, await readTab(sheetUrl, LEADS_LOG_TAB));
    }

    log(`[DEDUPE] Loaded ${dedupe.seenIds.size} handled leads (local + sheet)`);

    log('[MAIN] Connecting to your Chrome browser...');
    log(`[MAIN] Connecting over CDP: ${CDP_URL}`);
    log('='.repeat(60));

    browser = await chromium.connectOverCDP(CDP_URL);

    const context = browser.contexts()[0];
    const existingPages = context.pages();
    const page = existingPages.find((p) => /onegiantleap|people|person/i.test(p.url() || '')) ||
      existingPages[existingPages.length - 1] ||
      await context.newPage();

    await waitForUser('[MAIN] Connected. Make sure you are logged in and on the FILTERED results page, then confirm ready.');

    let listUrl = page.url();
    if (!listUrl || listUrl === 'about:blank') {
      const ok = await gotoRetry(page, START_URL, log, { retries: 3 });
      if (!ok) {
        throw new Error('Could not load the people list page');
      }
      await page.waitForSelector('a[href*="/person/"]', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);
      listUrl = page.url();
    }

    log(`[MAIN] List URL captured: ${listUrl}`);
    log('='.repeat(60));

    page.on('console', msg => {
      if (msg.type() === 'error' && !/Minified React error/.test(msg.text())) {
        log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      if (!/Minified React error #(418|423|425)/.test(error.message)) {
        log(`[PAGE ERROR] ${error.message}`);
      }
    });

    while (stats.successful < config.sessionLimit) {
      if (shouldStop()) {
        log('[MAIN] Stop requested, exiting loop.');
        break;
      }

      if (await checkForCaptcha(page)) {
        log('='.repeat(60));
        log('[CAPTCHA DETECTED] Please solve the captcha in the browser');
        await waitForUser('[CAPTCHA] Confirm ready when the captcha is solved.');
        log('='.repeat(60));
      }

      let people = await getVisiblePeople(page);
      let connectable = people.filter(p => p.connectable && !dedupe.isDuplicate(p.id));
      log(`[MAIN] Found ${people.length} person cards (${connectable.length} connectable)`);

      if (connectable.length === 0) {
        log('[MAIN] No connectable people in view, attempting to scroll...');
        const scrolled = await scrollToLoadMore(page);
        if (!scrolled) {
          log('[MAIN] No more people to process. Stopping.');
          break;
        }
        continue;
      }

      const person = connectable[0];

      stats.processed++;
      dedupe.markContacted(person.id);

      const profileData = {
        uniqueId: person.id,
        name: person.name || 'Unknown',
        title: person.title || '',
        company: person.company || '',
        industry: '',
        sectors: [],
        type: '',
        seniorityLevel: '',
        companyIdentity: '',
        companyIndustry: '',
        companyHQ: '',
        department: '',
        country: ''
      };

      log(`[MAIN] Processing: ${profileData.name} (${person.id})`);

      try {
        await waitWithProgress(page, `opening profile for ${profileData.name}`);
        const profileUrl = person.href && person.href.startsWith('http')
          ? person.href
          : BASE_URL + (person.href || `/event/leap2026/person/${person.id}`);
        await gotoRetry(page, profileUrl, log, { retries: 3 });
        await page.waitForTimeout(1500);

        const profile = await scrapeProfile(page);

        Object.assign(profileData, {
          type: profile.type || '',
          seniorityLevel: profile.seniorityLevel || '',
          companyIdentity: profile.companyIdentity || '',
          companyIndustry: profile.companyIndustry || '',
          industry: profile.industry || '',
          sectors: profile.sectors || [],
          companyHQ: profile.companyHQ || '',
          department: profile.department || '',
          country: profile.country || ''
        });

        if (!profileData.name || profileData.name === 'Unknown') profileData.name = profile.name;
        if (!profileData.title) profileData.title = profile.title;
        if (!profileData.company) profileData.company = profile.company;

        log(`[MAIN] Profile: ${JSON.stringify(profileData)}`);

        if (config.countryFilterEnabled !== false) {
          const allowed = isAllowed(profileData.country, profileData.companyHQ);
          if (!allowed) {
            stats.skipped++;
            profileData.status = 'skipped-country';
            profileData.timestamp = new Date().toISOString();
            await recordRow(profileData);
            log(`[MAIN] Skipped (country filter): ${profileData.name} (Country="${profileData.country}", HQ="${profileData.companyHQ}")`);
            await gotoList(page, listUrl);
            continue;
          }
        }

        await waitWithProgress(page, `opening connection modal for ${profileData.name}`);
        const result = await connectPerson(page, profileData, config, person);

        if (result.success) {
          stats.successful++;
          log(`[MAIN] Successfully sent connection request to ${profileData.name}`);
        } else {
          stats.failed++;
          log(`[MAIN] Failed: ${result.error}`);
          profileData.errorDetails = result.error;
        }

        profileData.messageSent = config.messageTemplate;
        profileData.status = result.success ? 'success' : 'failed';
        profileData.timestamp = new Date().toISOString();

        await appendRow(profileData);
        log('[MAIN] Logged to Excel');
      } catch (error) {
        stats.failed++;
        log(`[MAIN] Error processing ${profileData.name}: ${error.message}`);

        await saveErrorScreenshot(page, person.id, error.message);

        await recordRow({
          uniqueId: person.id,
          name: profileData.name,
          status: 'error',
          errorDetails: error.message,
          timestamp: new Date().toISOString()
        });
      }

      await waitWithProgress(page, 'returning to list');
      try {
        await closePanel(page);
      } catch (e) {
        log('[MAIN] Error closing panel');
      }
      await gotoList(page, listUrl);
    }
  } catch (error) {
    log(`[MAIN] Fatal error: ${error.message}`);
    log(error.stack || '');
    stats.error = error.message;
  } finally {
    if (browser) {
      await browser.close();
    }

    if (sheetConfigured && sheetLogRows.length) {
      try {
        await appendTab(sheetUrl, LEADS_LOG_TAB, sheetLogRows);
        log(`[SHEETS] Appended ${sheetLogRows.length} rows to leads log in sheet`);
      } catch (e) {
        log(`[SHEETS] Could not append to sheet: ${e.message}`);
      }
    }

    if (lockOwner) {
      await releaseRunLock(sheetUrl, lockOwner);
      log('[LOCK] Released run lock');
    }

    log('='.repeat(60));
    log('[SUMMARY] Session Complete');
    log(`[SUMMARY] Total processed: ${stats.processed}`);
    log(`[SUMMARY] Successful: ${stats.successful}`);
    log(`[SUMMARY] Failed: ${stats.failed}`);
    log(`[SUMMARY] Skipped (country/duplicates): ${stats.skipped}`);
    log(`[SUMMARY] Excel log: ${LOG_FILE}`);
    log('='.repeat(60));
  }

  return stats;
}

module.exports = { startConnections, START_URL, CDP_URL };
