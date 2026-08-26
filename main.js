const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const config = require('./config/config.json');
const { getVisiblePeople, scrollToLoadMore } = require('./src/scrapeResultsList');
const { scrapeProfile } = require('./src/scrapeProfile');
const { connectPerson, closePanel } = require('./src/connectPerson');
const { isAllowed } = require('./src/countryFilter');
const { DedupeTracker } = require('./src/dedupe');
const { appendRow, saveErrorScreenshot, LOG_FILE } = require('./src/logger');

const START_URL = 'https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=';
const BASE_URL = 'https://connect.onegiantleap.com';
const CDP_URL = 'http://localhost:9222';

function randomDelay() {
  return Math.floor(Math.random() * (config.delayMaxMs - config.delayMinMs + 1)) + config.delayMinMs;
}

async function waitWithProgress(page, action) {
  const delay = randomDelay();
  console.log(`[DELAY] Waiting ${delay}ms before ${action}...`);
  await page.waitForTimeout(delay);
}

async function checkForCaptcha(page) {
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
      if (el && await el.isVisible()) {
        return true;
      }
    } catch (e) {
      continue;
    }
  }

  return false;
}

async function loadExistingLeads() {
  const logFile = path.join(__dirname, 'output', 'leads_log.xlsx');

  if (!fs.existsSync(logFile)) {
    console.log('[DEDUPE] No existing log file found, starting fresh');
    return new Set();
  }

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(logFile);
    const worksheet = workbook.getWorksheet('Leads');

    const seenIds = new Set();

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const uniqueId = row.getCell(1).value;
        const status = String(row.getCell(12).value || '').toLowerCase();
        if (!uniqueId || uniqueId === '__init__') return;

        if (status === 'success') {
          seenIds.add(String(uniqueId));
        } else if (status === 'skipped-country') {
          // Reconsider leads that were skipped only because BOTH Country and
          // Company HQ were missing. Leads with at least one country field
          // (which was genuinely outside the allowed regions) stay skipped.
          const country = String(row.getCell(17).value || '').trim();
          const hq = String(row.getCell(16).value || '').trim();
          if (country || hq) {
            seenIds.add(String(uniqueId));
          }
        }
      }
    });

    console.log(`[DEDUPE] Loaded ${seenIds.size} handled leads (success + non-empty skipped-country)`);
    return seenIds;
  } catch (error) {
    console.log(`[DEDUPE] Error reading log file: ${error.message}`);
    return new Set();
  }
}

async function gotoList(page, listUrl) {
  await page.goto(listUrl, { waitUntil: 'domcontentloaded' }).catch((e) => console.log(`[MAIN] goto warning: ${e.message}`));
  await page.waitForSelector('a[href*="/person/"]', { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1000);
}

async function main() {
  console.log('='.repeat(60));
  console.log('[MAIN] Starting OneLeap Agent');
  console.log(`[MAIN] Session limit: ${config.sessionLimit}`);
  console.log(`[MAIN] Delay range: ${config.delayMinMs}-${config.delayMaxMs}ms`);
  console.log(`[MAIN] Country filter: ${config.countryFilterEnabled !== false ? 'ON' : 'OFF'}`);
  console.log('='.repeat(60));

  const stats = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0
  };

  const dedupe = new DedupeTracker();
  dedupe.seenIds = await loadExistingLeads();

  let browser;

  try {
    console.log('[MAIN] Connecting to your Chrome browser...');
    console.log('[MAIN] Make sure you ran launch-chrome.bat first');
    console.log(`[MAIN] Connecting over CDP: ${CDP_URL}`);
    console.log('='.repeat(60));

    browser = await chromium.connectOverCDP(CDP_URL);

    const context = browser.contexts()[0];
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log('[MAIN] Connected. Make sure you are logged in and on the FILTERED results page.');
    console.log('[MAIN] Press Enter when ready to start...');
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });

    let listUrl = page.url();
    if (!listUrl || listUrl === 'about:blank') {
      await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href*="/person/"]', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);
      listUrl = page.url();
    }

    console.log(`[MAIN] List URL captured: ${listUrl}`);
    console.log('='.repeat(60));

    page.on('console', msg => {
      if (msg.type() === 'error' && !/Minified React error/.test(msg.text())) {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      if (!/Minified React error #(418|423|425)/.test(error.message)) {
        console.log(`[PAGE ERROR] ${error.message}`);
      }
    });

    while (stats.successful < config.sessionLimit) {
      if (await checkForCaptcha(page)) {
        console.log('='.repeat(60));
        console.log('[CAPTCHA DETECTED] Please solve the captcha in the browser');
        console.log('[CAPTCHA] Press Enter in the terminal when ready to continue...');
        console.log('='.repeat(60));
        await new Promise(resolve => {
          process.stdin.once('data', () => resolve());
        });
      }

      let people = await getVisiblePeople(page);
      let connectable = people.filter(p => p.connectable && !dedupe.isDuplicate(p.id));
      console.log(`[MAIN] Found ${people.length} person cards (${connectable.length} connectable)`);

      if (connectable.length === 0) {
        console.log('[MAIN] No connectable people in view, attempting to scroll...');
        const scrolled = await scrollToLoadMore(page);
        if (!scrolled) {
          console.log('[MAIN] No more people to process. Stopping.');
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

      console.log(`[MAIN] Processing: ${profileData.name} (${person.id})`);

      try {
        // 1) Open the plain profile page and scrape the full "About me" data
        await waitWithProgress(page, `opening profile for ${profileData.name}`);
        const profileUrl = person.href && person.href.startsWith('http')
          ? person.href
          : BASE_URL + (person.href || `/event/leap2026/person/${person.id}`);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
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

        console.log(`[MAIN] Profile: ${JSON.stringify(profileData, null, 0)}`);

        // 2) Country filter (both Country and Company HQ must be allowed;
        //    a missing field is ignored, skip only if both are missing)
        if (config.countryFilterEnabled !== false) {
          const allowed = isAllowed(profileData.country, profileData.companyHQ);
          if (!allowed) {
            stats.skipped++;
            profileData.status = 'skipped-country';
            profileData.timestamp = new Date().toISOString();
            await appendRow(profileData);
            console.log(`[MAIN] Skipped (country filter): ${profileData.name} (Country="${profileData.country}", HQ="${profileData.companyHQ}")`);
            await gotoList(page, listUrl);
            continue;
          }
        }

        // 3) Open the connection modal, fill and send
        await waitWithProgress(page, `opening connection modal for ${profileData.name}`);
        const result = await connectPerson(page, profileData, config, person);

        if (result.success) {
          stats.successful++;
          console.log(`[MAIN] Successfully sent connection request to ${profileData.name}`);
        } else {
          stats.failed++;
          console.log(`[MAIN] Failed: ${result.error}`);
          profileData.errorDetails = result.error;
        }

        profileData.messageSent = config.messageTemplate;
        profileData.status = result.success ? 'success' : 'failed';
        profileData.timestamp = new Date().toISOString();

        await appendRow(profileData);
        console.log('[MAIN] Logged to Excel');
      } catch (error) {
        stats.failed++;
        console.log(`[MAIN] Error processing ${profileData.name}: ${error.message}`);

        await saveErrorScreenshot(page, person.id, error.message);

        await appendRow({
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
        console.log('[MAIN] Error closing panel');
      }
      await gotoList(page, listUrl);
    }
  } catch (error) {
    console.log(`[MAIN] Fatal error: ${error.message}`);
    console.log(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }

    console.log('='.repeat(60));
    console.log('[SUMMARY] Session Complete');
    console.log(`[SUMMARY] Total processed: ${stats.processed}`);
    console.log(`[SUMMARY] Successful: ${stats.successful}`);
    console.log(`[SUMMARY] Failed: ${stats.failed}`);
    console.log(`[SUMMARY] Skipped (country/duplicates): ${stats.skipped}`);
    console.log(`[SUMMARY] Excel log: ${LOG_FILE}`);
    console.log('='.repeat(60));
  }
}

main().catch(console.error);
