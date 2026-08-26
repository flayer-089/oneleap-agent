const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose5.txt');
const CDP_URL = 'http://localhost:9222';

async function main() {
  const target = process.argv[2];
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  if (target) {
    const url = target.startsWith('http') ? target : `https://connect.onegiantleap.com${target}`;
    log('Navigating to: ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  } else if (!/\/person\//.test(page.url())) {
    log('Navigating to list then first person card...');
    await page.goto('https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a[href*="/person/"]', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.click('a[href*="/person/"]');
    await page.waitForTimeout(3000);
  }

  log('URL: ' + page.url());
  log('='.repeat(80));

  // Dump the "About me" and "Contact details" areas by label detection
  const sections = await page.evaluate(() => {
    const labels = ['Type', 'Level Of Seniority', 'Company Identity', 'Company Industry', 'Company HQ', 'Department', 'Country', 'Industry', 'Sector(s)', 'Contact details', 'About me'];
    const found = {};
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim();
      if (labels.includes(t) && el.querySelectorAll('*').length <= 3) {
        found[t] = { tag: el.tagName, cls: el.getAttribute('class'), html: el.outerHTML.slice(0, 1500) };
      }
    }
    return found;
  });

  log('--- LABEL ELEMENTS FOUND ---');
  for (const [label, info] of Object.entries(sections)) {
    log(`### ${label} -> <${info.tag}> class="${info.cls}"`);
    log(info.html);
    log('---');
  }

  // Dump a broader chunk of the page body for structural analysis
  const body = await page.evaluate(() => {
    const about = Array.from(document.querySelectorAll('*')).find((el) => /about me/i.test(el.textContent || ''));
    const start = about || document.body;
    return start.outerHTML.slice(0, 15000);
  });
  log('='.repeat(80));
  log('--- ABOUT-ME REGION HTML (15k) ---');
  log(body);

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG5] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
