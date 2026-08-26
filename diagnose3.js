const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose3.txt');

async function main() {
  console.log('[DIAG3] Connecting to Chrome on CDP http://localhost:9222 ...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  // Go back to the list if we are on a person page
  if (/\/person\//.test(page.url())) {
    log('Currently on a person page, navigating back to list...');
    await page.goto('https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  }

  log('URL: ' + page.url());
  log('='.repeat(80));

  // Scan every person card: dump name + any buttons/action elements inside
  const cardInfo = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/person/"]'));
    return links.slice(0, 20).map((a, i) => {
      const card = a.querySelector('.list__Wrapper, [class*="PersonCard"]') || a;
      const name = card.querySelector('[class*="FullName"]')?.textContent?.trim() || '';
      const buttons = Array.from(card.querySelectorAll('button, [role="button"], a[href*="connect"], a[href*="invite"]')).map(b => ({
        text: (b.textContent || '').trim().slice(0, 40),
        cls: (b.getAttribute('class') || '').slice(0, 120),
        ariaLabel: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        dataHook: b.getAttribute('data-hook') || ''
      }));
      // also capture any element with "connect" in class or text
      const connectish = Array.from(card.querySelectorAll('[class*="onnect"], [class*="ending"], [class*="nvite"]')).map(e => ({
        tag: e.tagName,
        text: (e.textContent || '').trim().slice(0, 40),
        cls: (e.getAttribute('class') || '').slice(0, 120)
      }));
      return { index: i, name, href: a.getAttribute('href'), buttons, connectish };
    });
  });

  log('CARD ACTION SCAN (first 20 cards):');
  for (const c of cardInfo) {
    log(`#${c.index} "${c.name}" href=${c.href}`);
    log(`   buttons: ${JSON.stringify(c.buttons)}`);
    log(`   connect-ish elements: ${JSON.stringify(c.connectish)}`);
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG3] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
