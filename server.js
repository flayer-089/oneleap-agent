const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const { JobManager } = require('./src/jobManager');
const { startConnections } = require('./src/runConnections');
const { startMonitor } = require('./src/runMonitor');
const { getAnalytics } = require('./src/analytics');
const { ensureChrome, isCdpRunning } = require('./src/chromeLauncher');
const { isConfigured: isSheetConfigured, sheetIdFromUrl, sheetUrlFromId } = require('./src/googleSheets');

const CONFIG_PATH = path.join(__dirname, 'config', 'config.json');
const AUTH_PATH = path.join(__dirname, 'config', 'auth.json');
const CONTACTS_FILE = path.join(__dirname, 'output', 'leads_with_contacts.xlsx');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'oneleap-internal-secret';
const MONITOR_INTERVAL_MS = 3 * 60 * 60 * 1000;

let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

let authConfig = { email: 'admin@oneleap.com', password: 'changeme123' };
try {
  authConfig = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
} catch (e) {
  console.log('[AUTH] No auth.json found, using defaults');
}

const app = express();
const jobs = new JobManager();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function readConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    // keep in-memory config
  }
  return config;
}

function writeConfig(body) {
  const updatable = ['sessionLimit', 'delayMinMs', 'delayMaxMs', 'countryFilterEnabled', 'messageTemplate', 'googleSheetUrl'];
  updatable.forEach((k) => {
    if (body[k] !== undefined) config[k] = body[k];
  });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

// ---- auth ----
app.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email === authConfig.email && password === authConfig.password) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- status / control ----
app.get('/status', requireAuth, async (req, res) => {
  res.json({ ...jobs.status(), cdpUp: await isCdpRunning() });
});

app.post('/ready', requireAuth, (req, res) => {
  jobs.resolveReady();
  res.json({ ok: true });
});

app.post('/stop', requireAuth, (req, res) => {
  jobs.stop();
  res.json({ ok: true });
});

// ---- run ----
app.post('/run/connections', requireAuth, async (req, res) => {
  if (jobs.running) return res.status(409).json({ error: 'A job is already running' });
  const currentConfig = readConfig();
  res.json({ ok: true });
  jobs.start('connections', (events) => startConnections(currentConfig, events)).catch((e) => console.error(e));
});

app.post('/run/monitor', requireAuth, async (req, res) => {
  if (jobs.running) return res.status(409).json({ error: 'A job is already running' });
  res.json({ ok: true });
  jobs.start('monitor', (events) => startMonitor({}, events)).catch((e) => console.error(e));
});

// ---- analytics ----
app.get('/analytics', requireAuth, async (req, res) => {
  try {
    const a = await getAnalytics();
    a.lastRun = jobs.lastRun();
    res.json(a);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- download ----
app.get('/download/contacts', requireAuth, (req, res) => {
  if (!fs.existsSync(CONTACTS_FILE)) {
    return res.status(404).send('No data yet. Run the Monitor first.');
  }
  res.download(CONTACTS_FILE, 'leads_with_contacts.xlsx');
});

// ---- config ----
app.get('/config', requireAuth, (req, res) => {
  res.json(readConfig());
});

app.post('/config', requireAuth, (req, res) => {
  res.json(writeConfig(req.body || {}));
});

// ---- google sheets ----
app.get('/sheet', requireAuth, (req, res) => {
  const raw = String(readConfig().googleSheetUrl || '').trim();
  const id = sheetIdFromUrl(raw);
  const configured = isSheetConfigured(raw);
  res.json({
    configured,
    rawUrl: raw,
    url: configured ? sheetUrlFromId(id) : ''
  });
});

// ---- 3-hour monitor scheduler (skip if busy) ----
setInterval(() => {
  if (jobs.running) {
    console.log('[SCHEDULER] Skipping monitor tick: a job is already running');
    return;
  }
  console.log('[SCHEDULER] Running scheduled monitor...');
  jobs.start('monitor-scheduled', (events) => startMonitor({}, events)).catch((e) => console.error(e));
}, MONITOR_INTERVAL_MS);

// ---- start ----
ensureChrome().then((r) => {
  console.log('Chrome:', r.cdpUp ? 'CDP reachable' : 'CDP not reachable', r.launched ? '(auto-launched)' : '');
  if (r.error) console.log('Chrome error:', r.error);

  app.listen(PORT, () => {
    console.log(`OneLeap server listening on http://localhost:${PORT}`);
  });
});
