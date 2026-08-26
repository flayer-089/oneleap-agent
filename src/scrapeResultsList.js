async function getVisiblePeople(page) {
  const people = [];
  const cards = await page.$$('a[href*="/person/"]');

  for (const card of cards) {
    try {
      const href = await card.getAttribute('href');
      const idMatch = (href || '').match(/person\/([^/?#]+)/i);
      const id = idMatch ? idMatch[1] : href;

      const info = await card.evaluate((el) => {
        const text = (sel) => {
          const n = el.querySelector(sel);
          return n ? n.textContent.trim() : '';
        };
        const btn = el.querySelector('button[aria-label^="Connection with"]');
        return {
          name: text('[class*="FullName"]'),
          title: text('[class*="Job"]'),
          company: text('[class*="Organization"]'),
          connectAriaLabel: btn ? (btn.getAttribute('aria-label') || '') : ''
        };
      });

      const connectButton = await card.$('button[aria-label^="Connection with"]');

      people.push({
        cardElement: card,
        connectButton,
        href,
        id,
        name: info.name,
        title: info.title,
        company: info.company,
        connectAriaLabel: info.connectAriaLabel,
        connectable: !!connectButton
      });
    } catch (error) {
      console.log(`[SCRAPE_LIST] Error parsing card: ${error.message}`);
    }
  }

  return people;
}

async function scrollToLoadMore(page, maxScrolls = 10) {
  console.log('[SCRAPE_LIST] Scrolling to load more content...');

  for (let i = 0; i < maxScrolls; i++) {
    const before = (await getVisiblePeople(page)).length;

    await page.evaluate(() => {
      const candidates = [
        document.querySelector('[class*="scroll"]'),
        document.querySelector('[class*="infinite"]'),
        document.querySelector('[class*="list"]'),
        document.querySelector('main'),
        document.body
      ];
      for (const el of candidates) {
        if (el && el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(1500);

    const after = (await getVisiblePeople(page)).length;
    console.log(`[SCRAPE_LIST] Scroll ${i + 1}: ${before} -> ${after} cards`);

    if (after > before) {
      return true;
    }

    const loadMore = await page.$('[class*="load-more"], [class*="show-more"]');
    if (loadMore && await loadMore.isVisible().catch(() => false)) {
      console.log('[SCRAPE_LIST] Clicking "load more" button...');
      await loadMore.click();
      await page.waitForTimeout(2000);
      return true;
    }
  }

  return false;
}

module.exports = { getVisiblePeople, scrollToLoadMore };
