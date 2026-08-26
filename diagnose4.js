const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose4.txt');

async function main() {
  console.log('[DIAG4] Connecting to Chrome on CDP http://localhost:9222 ...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  if (/\/person\//.test(page.url())) {
    log('On person page, navigating back to list...');
    await page.goto('https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  }

  log('URL: ' + page.url());
  log('='.repeat(80));

  // 1. Click the connection button on the first non-connected card (Jordan Alexander)
  const firstConnBtn = await page.$('button.app__ConnectionButton, button[aria-label*="Connection with"]');
  if (!firstConnBtn) {
    log('NO connection button found!');
  } else {
    const label = await firstConnBtn.getAttribute('aria-label');
    log('Found connection button: ' + label);
    log('CLICKING connection button...');
    await firstConnBtn.click();
    await page.waitForTimeout(3000);

    log('URL after click: ' + page.url());
    log('='.repeat(80));

    // Dump any dialog/modal that appeared
    const modal = await page.evaluate(() => {
      const candidates = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('[class*="odal"]'),
        document.querySelector('[class*="ialog"]'),
        document.querySelector('[class*="rawer"]')
      ];
      for (const el of candidates) {
        if (el) return { tag: el.tagName, cls: el.getAttribute('class'), html: el.outerHTML.slice(0, 20000) };
      }
      return null;
    });

    if (modal) {
      log('MODAL FOUND: ' + modal.tag + ' class="' + modal.cls + '"');
      log('--- MODAL HTML ---');
      log(modal.html);
    } else {
      log('NO MODAL FOUND after clicking. Dumping body snippet...');
      const body = await page.evaluate(() => document.body.innerHTML.slice(0, 20000));
      log(body);
    }

    // Find textareas in the modal
    const textareas = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('textarea')).map(t => ({
        placeholder: t.getAttribute('placeholder'),
        cls: t.getAttribute('class'),
        name: t.getAttribute('name'),
        value: t.value
      }));
    });
    log('TEXTAREAS: ' + JSON.stringify(textareas, null, 2));

    // Find buttons in the modal
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map(b => ({
        text: (b.textContent || '').trim().slice(0, 60),
        cls: (b.getAttribute('class') || '').slice(0, 120),
        ariaLabel: b.getAttribute('aria-label') || ''
      }));
    });
    log('BUTTONS: ' + JSON.stringify(buttons, null, 2));
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG4] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
