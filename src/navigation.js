async function gotoRetry(page, url, log, opts = {}) {
  const retries = opts.retries ?? 3;
  const timeout = opts.timeout ?? 30000;
  const settleMs = opts.settleMs ?? 1500;

  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(settleMs).catch(() => {});
      return true;
    } catch (e) {
      log(`[NAV] Navigation error (attempt ${i + 1}/${retries}): ${e.message}`);
      await page.waitForTimeout(2000).catch(() => {});
    }
  }
  return false;
}

module.exports = { gotoRetry };
