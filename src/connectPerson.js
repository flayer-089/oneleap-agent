const { fillTemplate } = require('./messageTemplate');

const MESSAGE_TEXTAREA = 'textarea[placeholder*="connection request"]';
const SEND_BUTTON = 'button:has-text("Send connection request")';
const BASE_URL = 'https://connect.onegiantleap.com';

async function openConnectionModal(page, person, connectButton) {
  // Primary: navigate straight to the open-connection URL.
  // This is more reliable than clicking the card's "Connection with"
  // button, which is often hidden until the card is hovered.
  if (person && person.href) {
    const href = person.href.startsWith('http') ? person.href : BASE_URL + person.href;
    await page.goto(`${href}?openConnection=true`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch((e) => console.log(`[CONNECT] goto error: ${e.message}`));
  } else if (connectButton) {
    await connectButton.hover().catch(() => {});
    await connectButton.click().catch((e) => console.log(`[CONNECT] click error: ${e.message}`));
  } else {
    return false;
  }

  const modal = await page
    .waitForSelector(`${MESSAGE_TEXTAREA}, ${SEND_BUTTON}`, { state: 'visible', timeout: 10000 })
    .catch(() => null);

  return !!modal;
}

async function fillMessage(page, template, profileData) {
  const message = fillTemplate(template, profileData);

  const textarea = await page.$(MESSAGE_TEXTAREA);
  if (!textarea) {
    return false;
  }

  // fill() focuses the element directly (no pointer click), so the
  // preformatted "suggestion" overlay can't intercept it.
  await textarea.fill(message);
  console.log(`[CONNECT] Filled message (${message.length} characters)`);
  return true;
}

async function submitConnection(page) {
  const btn = await page.$(SEND_BUTTON);
  if (!btn) {
    return false;
  }

  await btn.click();
  console.log('[CONNECT] Submitted connection request');
  await page.waitForTimeout(2500);

  const still = await page.$(MESSAGE_TEXTAREA);
  if (still && await still.isVisible().catch(() => false)) {
    console.log('[CONNECT] Modal still open after submit');
    return false;
  }

  return true;
}

async function closePanel(page) {
  const closeBtn = await page.$('button[aria-label="close"]');
  if (closeBtn) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }

  await page.keyboard.press('Escape').catch(() => {});
  console.log('[CONNECT] Pressed Escape to close');
  return true;
}

async function connectPerson(page, profileData, config, person) {
  try {
    const opened = await openConnectionModal(page, person, person && person.connectButton);
    if (!opened) {
      return { success: false, error: 'Connection modal did not appear' };
    }

    await page.waitForTimeout(500);

    const filled = await fillMessage(page, config.messageTemplate, profileData);
    if (!filled) {
      return { success: false, error: 'Could not fill message textarea' };
    }

    await page.waitForTimeout(300);

    const sent = await submitConnection(page);
    if (!sent) {
      return { success: false, error: 'Could not submit connection request' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { connectPerson, closePanel };
