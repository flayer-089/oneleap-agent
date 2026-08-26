const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose6.txt');
const CDP_URL = 'http://localhost:9222';
const CONTACTS_URL = 'https://connect.onegiantleap.com/event/leap2026/contacts';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log('Navigating to contacts page...');
  await page.goto(CONTACTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href*="/person/"]', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(3000);

  log('URL: ' + page.url());
  log('='.repeat(80));

  // status-related text/indicators
  const statusInfo = await page.evaluate(() => {
    const texts = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (/^(accepted|pending|requested|connected|connections|requests|contacts)$/.test(t)) {
        texts.push({ text: el.textContent.trim(), tag: el.tagName, cls: el.getAttribute('class') });
      }
    }
    return texts;
  });
  log('--- STATUS-RELATED ELEMENTS ---');
  for (const s of statusInfo.slice(0, 40)) {
    log(`${s.text} <${s.tag}> class="${s.cls}"`);
  }

  // person links
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="/person/"]')).slice(0, 5).map((a) => {
      let card = a;
      for (let i = 0; i < 3; i++) if (card.parentElement) card = card.parentElement;
      return { href: a.getAttribute('href'), linkText: a.textContent.trim().slice(0, 120), cardHTML: card.outerHTML.slice(0, 3000) };
    });
  });
  log('='.repeat(80));
  log(`--- FIRST ${links.length} CONTACT CARDS ---`);
  for (const l of links) {
    log('### href=' + l.href);
    log('link text: ' + l.linkText);
    log('card HTML:');
    log(l.cardHTML);
    log('='.repeat(80));
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG6] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
