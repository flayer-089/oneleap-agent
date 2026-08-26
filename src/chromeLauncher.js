const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const START_URL = 'https://connect.onegiantleap.com/event/leap2026/people/RXZlbnRWaWV3XzIwNzA1NzI=';

function findChromePath() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMW6432 && path.join(process.env.PROGRAMW6432, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function isCdpRunning(timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://${CDP_HOST}:${CDP_PORT}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function launchChrome() {
  const chromePath = findChromePath();
  if (!chromePath) return null;

  const profileDir = path.join(__dirname, '..', 'browser-data');
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    START_URL
  ];

  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function ensureChrome() {
  if (await isCdpRunning()) return { launched: false, cdpUp: true };

  const child = launchChrome();
  if (!child) return { launched: false, cdpUp: false, error: 'Chrome executable not found' };

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpRunning()) return { launched: true, cdpUp: true };
  }

  return { launched: true, cdpUp: false, error: 'Chrome launched but CDP not reachable' };
}

module.exports = { ensureChrome, isCdpRunning, launchChrome, findChromePath, CDP_PORT };
