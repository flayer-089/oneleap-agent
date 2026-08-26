// Scraping for the contacts page (accepted connections) and the
// "Contact details" section of a person profile.

const BASE_URL = 'https://connect.onegiantleap.com';

function personIdFromHref(href) {
  const m = (href || '').match(/person\/([^/?#]+)/i);
  return m ? m[1] : null;
}

async function getContactPeople(page) {
  const people = [];
  const seen = new Set();

  const links = await page.$$('a[href*="/person/"]');
  for (const link of links) {
    try {
      const href = await link.getAttribute('href');
      const id = personIdFromHref(href);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const name = await link.evaluate((el) => {
        const n = el.querySelector('[class*="FullName"], h2, h3');
        return n ? n.textContent.trim() : el.textContent.trim().slice(0, 120);
      });

      people.push({ id, name, href });
    } catch (e) {
      continue;
    }
  }

  return people;
}

async function scrollContactsToLoadMore(page, maxScrolls = 10) {
  for (let i = 0; i < maxScrolls; i++) {
    const before = (await getContactPeople(page)).length;

    await page.evaluate(() => {
      const candidates = [
        document.querySelector('[class*="infinite"]'),
        document.querySelector('[class*="scroll"]'),
        document.querySelector('[class*="list"]'),
        document.querySelector('main'),
        document.body
      ];
      for (const el of candidates) {
        if (el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(1500);

    const after = (await getContactPeople(page)).length;
    console.log(`[CONTACTS] Scroll ${i + 1}: ${before} -> ${after} contacts`);
    if (after > before) return true;

    const loadMore = await page.$('[class*="load-more"], [class*="show-more"]');
    if (loadMore && await loadMore.isVisible().catch(() => false)) {
      await loadMore.click();
      await page.waitForTimeout(2000);
      return true;
    }
  }
  return false;
}

async function scrollProfileToBottom(page) {
  // Simulate real user scrolling (mouse wheel) to trigger lazy loaders.
  await page.mouse.wheel(0, 8000).catch(() => {});
  await page.waitForTimeout(500);

  for (let i = 0; i < 10; i++) {
    const scrolled = await page.evaluate(() => {
      let did = false;
      const beforeY = window.scrollY;
      window.scrollTo(0, document.body.scrollHeight);
      if (window.scrollY !== beforeY) did = true;

      const els = document.querySelectorAll('main, [class*="scroll"], [class*="content"], [class*="detail"], [class*="wrapper"]');
      els.forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 5) {
          const b = el.scrollTop;
          el.scrollTop = el.scrollHeight;
          if (el.scrollTop !== b) did = true;
        }
      });
      return did;
    }).catch(() => false);

    await page.waitForTimeout(700);
    if (!scrolled && i > 2) break;
  }
}

async function scrapeContactDetails(page) {
  // Scroll down so lazily-rendered details at the bottom load.
  await scrollProfileToBottom(page);
  await page.waitForTimeout(500);

  return page.evaluate(() => {
    const result = { emails: [], phones: [], location: '', raw: '' };

    const text = document.body.innerText || '';

    // Emails
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const e = (a.getAttribute('href') || '').replace(/^mailto:/i, '').trim();
      if (e && !result.emails.includes(e)) result.emails.push(e);
    });
    if (!result.emails.length) {
      const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (m) result.emails = [...new Set(m)];
    }

    // Phones
    document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const p = (a.getAttribute('href') || '').replace(/^tel:/i, '').trim();
      if (p && !result.phones.includes(p)) result.phones.push(p);
    });
    if (!result.phones.length) {
      const m = text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g);
      if (m) result.phones = [...new Set(m)];
    }

    // Location: a "Location"/"City"/"Address" label value, else "City, CC" pattern
    const locLabel = Array.from(document.querySelectorAll('[class*="style__Name"], label, dt')).find((el) => {
      const t = (el.textContent || '').trim().toLowerCase();
      return (t === 'location' || t === 'city' || t === 'address') && el.querySelectorAll('*').length <= 2;
    });
    if (locLabel) {
      const v = locLabel.nextElementSibling;
      if (v && v.textContent.trim()) result.location = v.textContent.trim();
    }
    if (!result.location) {
      const m = text.match(/^([A-Za-z][A-Za-z' .-]+),\s*([A-Z]{2})\s*$/m);
      if (m) result.location = `${m[1].trim()}, ${m[2]}`;
    }

    // Raw: the "Contact details" heading plus the following elements
    for (const h of document.querySelectorAll('h2, h3, h4')) {
      if ((h.textContent || '').trim().toLowerCase() === 'contact details') {
        const parts = ['Contact details'];
        let node = h;
        for (let i = 0; i < 6; i++) {
          node = node.nextElementSibling || (node.parentElement && node.parentElement.nextElementSibling);
          if (!node) break;
          const t = node.textContent.trim();
          if (t) parts.push(t);
        }
        result.raw = parts.join(' | ').slice(0, 500);
        break;
      }
    }
    if (!result.raw) result.raw = text.slice(0, 500);

    return result;
  });
}

module.exports = {
  BASE_URL,
  personIdFromHref,
  getContactPeople,
  scrollContactsToLoadMore,
  scrapeContactDetails
};
