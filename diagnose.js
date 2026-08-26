const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output', 'diagnose.txt');

async function main() {
  console.log('[DIAG] Connecting to Chrome on CDP http://localhost:9222 ...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log('[DIAG] Waiting 2s for page to settle...');
  await page.waitForTimeout(2000);

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log('URL: ' + page.url());
  log('TITLE: ' + (await page.title()).slice(0, 200));
  log('='.repeat(80));

  // 1. Find all links that look like they point to a person
  const linkInfo = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const result = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (/people|profile|person|member|attendee|speaker/i.test(href) && !/event\/leap2026\/people$/.test(href)) {
        result.push({ href, text: (a.textContent || '').trim().slice(0, 80) });
      }
    }
    return result;
  });

  log(`Found ${linkInfo.length} person-ish links. Sample (first 10):`);
  for (const l of linkInfo.slice(0, 10)) {
    log(`  href="${l.href}" text="${l.text}"`);
  }
  log('='.repeat(80));

  // 2. Dump outerHTML of the first few such links + their parents (up 5 levels)
  const sampleHTML = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /people|profile|person|member|attendee|speaker/i.test(href);
    });
    const out = [];
    for (const a of links.slice(0, 3)) {
      let node = a;
      const chain = [];
      for (let i = 0; i < 6 && node && node !== document.body; i++) {
        const clone = node.cloneNode(false);
        const tag = node.tagName.toLowerCase();
        const cls = (node.getAttribute('class') || '').slice(0, 200);
        const id = node.getAttribute('id') || '';
        const dataAttrs = Array.from(node.attributes)
          .filter(attr => attr.name.startsWith('data-'))
          .map(attr => `${attr.name}="${attr.value}"`)
          .join(' ');
        chain.push(`<${tag} class="${cls}" id="${id}" ${dataAttrs}>`);
        node = node.parentElement;
      }
      out.push('--- LINK CHAIN ---\n' + chain.join('\n  ^\n'));
    }
    return out;
  });
  log('DOM hierarchy of first links:');
  for (const h of sampleHTML) log(h);

  // 3. Get the full innerHTML of the first link's card container
  const cardHTML = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /people|profile|person|member|attendee|speaker/i.test(href);
    });
    if (!links.length) return '(none)';
    const a = links[0];
    let card = a;
    for (let i = 0; i < 4; i++) {
      if (card.parentElement) card = card.parentElement;
    }
    return card.outerHTML.slice(0, 6000);
  });
  log('='.repeat(80));
  log('CARD outerHTML (first candidate):');
  log(cardHTML);

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n[DIAG] Wrote results to ' + OUT);
  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
