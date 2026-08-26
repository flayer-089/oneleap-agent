const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose7.txt');
const CDP_URL = 'http://localhost:9222';

async function main() {
  const id = process.argv[2] || 'RXZlbnRQZW9wbGVfNDc4MTg3MDM=';
  const url = id.startsWith('http') ? id : `https://connect.onegiantleap.com/event/leap2026/person/${id}`;

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log('Navigating to: ' + url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 8000).catch(() => {});
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      document.querySelectorAll('main, [class*="scroll"], [class*="content"], [class*="detail"]').forEach((el) => {
        el.scrollTop = el.scrollHeight;
      });
    });
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1000);

  log('URL: ' + page.url());
  log('='.repeat(80));

  // All mailto / tel links
  const links = await page.evaluate(() => ({
    mailto: Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute('href')),
    tel: Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute('href'))
  }));
  log('MAILTO LINKS: ' + JSON.stringify(links.mailto));
  log('TEL LINKS: ' + JSON.stringify(links.tel));
  log('='.repeat(80));

  // Full body text (to see if contact details are plain text)
  const bodyText = await page.evaluate(() => document.body.innerText);
  const idx = bodyText.toLowerCase().indexOf('contact details');
  log('BODY TEXT around "contact details":');
  log(bodyText.slice(Math.max(0, idx - 50), idx + 400));
  log('='.repeat(80));

  // DOM structure around the "Contact details" heading (up 2, and siblings)
  const structure = await page.evaluate(() => {
    const out = [];
    for (const h of document.querySelectorAll('h2, h3, h4')) {
      if ((h.textContent || '').trim().toLowerCase() === 'contact details') {
        out.push('--- HEADING ---');
        out.push(h.outerHTML.slice(0, 800));
        const parent = h.parentElement;
        if (parent) out.push('--- HEADING PARENT ---\n' + parent.outerHTML.slice(0, 4000));
        if (parent && parent.parentElement) {
          out.push('--- GRANDPARENT ---\n' + parent.parentElement.outerHTML.slice(0, 6000));
        }
      }
    }
    return out.join('\n\n');
  });
  log('--- CONTACT DETAILS DOM ---');
  log(structure || '(no "Contact details" heading found)');

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG7] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
