const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose2.txt');

async function main() {
  console.log('[DIAG2] Connecting to Chrome on CDP http://localhost:9222 ...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  // 1. Dump full outerHTML of first 2 person card links (up to card container)
  const cards = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/person/"]'));
    return links.slice(0, 3).map(a => {
      // walk up 3 levels to get the card wrapper
      let card = a;
      for (let i = 0; i < 3; i++) {
        if (card.parentElement) card = card.parentElement;
      }
      return {
        href: a.getAttribute('href'),
        linkHTML: a.outerHTML.slice(0, 4000),
        cardHTML: card.outerHTML.slice(0, 8000)
      };
    });
  });

  log('URL: ' + page.url());
  log('='.repeat(80));
  log('PERSON CARD STRUCTURE (first cards):');
  for (const c of cards) {
    log('### href = ' + c.href);
    log('--- LINK outerHTML ---');
    log(c.linkHTML);
    log('--- CARD (3 levels up) outerHTML ---');
    log(c.cardHTML);
    log('='.repeat(80));
  }

  // 2. Click the first person card and dump the panel
  log('CLICKING FIRST PERSON CARD...');
  const firstLink = await page.$('a[href*="/person/"]');
  if (firstLink) {
    await firstLink.click();
    await page.waitForTimeout(3000);

    log('URL after click: ' + page.url());
    log('='.repeat(80));

    const panel = await page.evaluate(() => {
      const candidates = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('[class*="drawer"]'),
        document.querySelector('[class*="Drawer"]'),
        document.querySelector('[class*="modal"]'),
        document.querySelector('[class*="Modal"]'),
        document.querySelector('aside'),
        document.querySelector('main')
      ];
      for (const el of candidates) {
        if (el) {
          return {
            tag: el.tagName,
            cls: el.getAttribute('class'),
            role: el.getAttribute('role'),
            html: el.outerHTML.slice(0, 15000)
          };
        }
      }
      return { html: document.body.innerHTML.slice(0, 15000) };
    });

    log('PANEL CONTAINER: ' + panel.tag + ' class="' + panel.cls + '" role="' + panel.role + '"');
    log('--- PANEL HTML ---');
    log(panel.html);

    // 3. Find Connect button
    const connectBtn = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const connect = buttons.filter(b => /connect/i.test(b.textContent || ''));
      return connect.slice(0, 5).map(b => ({
        text: (b.textContent || '').trim().slice(0, 60),
        cls: b.getAttribute('class'),
        dataHook: b.getAttribute('data-hook'),
        html: b.outerHTML.slice(0, 500)
      }));
    });
    log('='.repeat(80));
    log('CONNECT BUTTONS FOUND: ' + connectBtn.length);
    for (const b of connectBtn) {
      log('--- BUTTON ---');
      log(JSON.stringify(b, null, 2));
    }

    // 4. Find all textareas
    const textareas = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('textarea')).map(t => ({
        placeholder: t.getAttribute('placeholder'),
        cls: t.getAttribute('class'),
        name: t.getAttribute('name')
      }));
    });
    log('TEXTAREAS: ' + JSON.stringify(textareas, null, 2));
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG2] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
