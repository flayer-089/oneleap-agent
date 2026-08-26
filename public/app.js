let lastLogCount = 0;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  return res;
}

function showLogin() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}

function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function el(id) { return document.getElementById(id); }

// ---- login ----
async function login() {
  const email = el('email').value;
  const password = el('password').value;
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      el('login-error').textContent = '';
      showApp();
      refreshStatus();
    } else {
      el('login-error').textContent = 'Invalid credentials';
    }
  } catch (e) {
    el('login-error').textContent = 'Login failed';
  }
}

async function logout() {
  await fetch('/logout', { method: 'POST' });
  showLogin();
}

// ---- tabs ----
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'analytics') refreshAnalytics();
    if (btn.dataset.tab === 'data') { loadConfig(); loadSheet(); }
  });
});

// ---- run controls ----
async function startJob(type) {
  try {
    const res = await fetch('/run/' + type, { method: 'POST' });
    if (res.status === 409) {
      alert('A job is already running');
    }
  } catch (e) {
    console.error(e);
  }
  refreshStatus();
}

el('run-connections').addEventListener('click', () => startJob('connections'));
el('run-monitor').addEventListener('click', () => startJob('monitor'));
el('stop-btn').addEventListener('click', async () => { await fetch('/stop', { method: 'POST' }); refreshStatus(); });
el('ready-btn').addEventListener('click', async () => { await fetch('/ready', { method: 'POST' }); refreshStatus(); });
el('login-btn').addEventListener('click', login);
el('logout-btn').addEventListener('click', logout);

// ---- status polling ----
async function refreshStatus() {
  try {
    const res = await fetch('/status', { credentials: 'same-origin' });
    if (res.status === 401) { showLogin(); return; }
    const s = await res.json();

    el('cdp-status').textContent = s.cdpUp ? 'Chrome: connected' : 'Chrome: not connected';
    el('cdp-status').className = 'pill ' + (s.cdpUp ? 'ok' : 'bad');

    const statusText = s.status === 'idle' ? 'Idle'
      : s.status === 'waiting-ready' ? 'Waiting for Ready'
      : s.status === 'running' ? 'Running (' + (s.type || '') + ')'
      : s.status === 'finished' ? 'Finished' : s.status;
    el('job-status').textContent = statusText;
    el('job-status').className = 'pill ' + (s.running ? 'running' : 'ok');

    // buttons
    el('run-connections').disabled = s.running;
    el('run-monitor').disabled = s.running;
    el('stop-btn').classList.toggle('hidden', !s.running);
    el('ready-btn').classList.toggle('hidden', s.status !== 'waiting-ready');

    // logs
    const logEl = el('log');
    if (s.logs.length !== lastLogCount) {
      logEl.textContent = s.logs.join('\n');
      lastLogCount = s.logs.length;
      logEl.scrollTop = logEl.scrollHeight;
    }

    // summary
    if (s.summary && (s.status === 'finished' || s.status === 'error')) {
      el('summary-box').classList.remove('hidden');
      el('summary-box').textContent = 'Summary: ' + JSON.stringify(s.summary, null, 2);
    } else if (s.status === 'idle') {
      el('summary-box').classList.add('hidden');
    }
  } catch (e) {
    // ignore transient errors
  }
}

// ---- analytics ----
const STATUS_META = {
  success: { label: 'Sent successfully', cls: 'ok' },
  failed: { label: 'Failed', cls: 'bad' },
  'skipped-country': { label: 'Skipped (country)', cls: 'warn' },
  error: { label: 'Error', cls: 'bad' },
  unknown: { label: 'Unknown', cls: 'muted' }
};

const SUMMARY_LABELS = {
  processed: 'Processed',
  successful: 'Successful',
  failed: 'Failed',
  skipped: 'Skipped',
  collected: 'Collected',
  filtered: 'Filtered (country)',
  urlFallback: 'URL fallback',
  errored: 'Errored',
  contacts: 'Contacts found',
  matched: 'Matched',
  totalSaved: 'Total saved'
};

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(start, end) {
  if (!start || !end) return '';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function renderLastRun(run) {
  const box = el('last-run');
  if (!run) {
    box.innerHTML = '<div class="muted">No runs yet</div>';
    return;
  }

  const typeLabel = run.type === 'connections' ? 'Connections'
    : run.type === 'monitor-scheduled' ? 'Monitor (scheduled)' : 'Monitor';
  const statusLabel = run.status === 'finished' ? 'Finished'
    : run.status === 'error' ? 'Error' : run.status;

  const s = run.summary || {};
  let tiles = '';
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'number' && typeof v !== 'boolean') continue;
    tiles += `<div class="metric"><div class="metric-value">${v}</div><div class="metric-label">${SUMMARY_LABELS[k] || k}</div></div>`;
  }

  box.innerHTML = `
    <div class="run-head">
      <span class="badge type">${typeLabel}</span>
      <span class="badge ${run.status === 'error' ? 'bad' : 'ok'}">${statusLabel}</span>
      <span class="muted time">${formatTime(run.startedAt)} → ${formatTime(run.finishedAt)} ${formatDuration(run.startedAt, run.finishedAt) ? '(' + formatDuration(run.startedAt, run.finishedAt) + ')' : ''}</span>
    </div>
    <div class="metrics">${tiles || '<div class="muted">No summary</div>'}</div>
    ${s.error ? `<div class="error">${s.error}</div>` : ''}
  `;
}

function renderStatusBreakdown(byStatus) {
  const box = el('status-breakdown');
  const entries = Object.entries(byStatus || {});
  if (!entries.length) {
    box.innerHTML = '<div class="muted">No data yet</div>';
    return;
  }
  box.innerHTML = entries.map(([k, v]) => {
    const meta = STATUS_META[k] || { label: k, cls: 'muted' };
    return `<div class="status-row"><span class="badge ${meta.cls}">${meta.label}</span><span class="status-count">${v}</span></div>`;
  }).join('');
}

async function refreshAnalytics() {
  try {
    const res = await fetch('/analytics', { credentials: 'same-origin' });
    const a = await res.json();
    el('a-sent').textContent = a.sent;
    el('a-accepted').textContent = a.accepted;
    el('a-remaining').textContent = a.remaining;
    el('a-scraped').textContent = a.scraped;
    renderStatusBreakdown(a.byStatus || {});
    renderLastRun(a.lastRun);
  } catch (e) {
    console.error(e);
  }
}

// ---- config ----
async function loadConfig() {
  try {
    const res = await fetch('/config', { credentials: 'same-origin' });
    const c = await res.json();
    el('c-sessionLimit').value = c.sessionLimit;
    el('c-delayMinMs').value = c.delayMinMs;
    el('c-delayMaxMs').value = c.delayMaxMs;
    el('c-countryFilterEnabled').checked = c.countryFilterEnabled !== false;
    el('c-messageTemplate').value = c.messageTemplate || '';
  } catch (e) {
    console.error(e);
  }
}

el('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    sessionLimit: parseInt(el('c-sessionLimit').value, 10),
    delayMinMs: parseInt(el('c-delayMinMs').value, 10),
    delayMaxMs: parseInt(el('c-delayMaxMs').value, 10),
    countryFilterEnabled: el('c-countryFilterEnabled').checked,
    messageTemplate: el('c-messageTemplate').value
  };
  try {
    const res = await fetch('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      el('config-msg').textContent = 'Saved';
    } else {
      el('config-msg').textContent = 'Error saving';
    }
  } catch (err) {
    el('config-msg').textContent = 'Error saving';
  }
});

// ---- google sheets ----
async function loadSheet() {
  try {
    const res = await fetch('/sheet', { credentials: 'same-origin' });
    const s = await res.json();
    const viewBtn = el('sheet-view-btn');
    const urlInput = el('sheet-url');
    if (s.configured) {
      viewBtn.style.display = 'inline-block';
      viewBtn.href = s.url;
      urlInput.value = s.rawUrl || s.url;
      el('sheet-msg').textContent = 'Connected. The sheet updates after each monitor run.';
    } else {
      viewBtn.style.display = 'none';
      urlInput.value = s.rawUrl || '';
      el('sheet-msg').textContent = 'Not connected yet. Paste your Google Sheet URL and save.';
    }
  } catch (e) {
    console.error(e);
  }
}

el('sheet-save-btn').addEventListener('click', async () => {
  const url = el('sheet-url').value.trim();
  if (!url) {
    el('sheet-msg').textContent = 'Please paste a Google Sheet URL.';
    return;
  }
  try {
    const res = await fetch('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleSheetUrl: url })
    });
    if (res.ok) {
      el('sheet-msg').textContent = 'Saved. Click "View" to open the sheet.';
      await loadSheet();
    } else {
      el('sheet-msg').textContent = 'Error saving sheet URL.';
    }
  } catch (e) {
    el('sheet-msg').textContent = 'Error saving sheet URL.';
  }
});

// ---- init ----
(async function init() {
  try {
    const res = await fetch('/status', { credentials: 'same-origin' });
    if (res.status === 401) { showLogin(); } else { showApp(); refreshStatus(); }
  } catch (e) {
    showLogin();
  }
})();

setInterval(refreshStatus, 1500);
