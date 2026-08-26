const fs = require('fs');
const path = require('path');

const RUN_HISTORY_FILE = path.join(__dirname, '..', 'output', 'run_history.json');
const MAX_LOGS = 2000;
const MAX_HISTORY = 50;

class JobManager {
  constructor() {
    this.current = null;
    this.stopRequested = false;
    this.readyResolver = null;
  }

  get running() {
    return !!this.current &&
      (this.current.status === 'running' || this.current.status === 'waiting-ready');
  }

  _log(line) {
    if (this.current) {
      this.current.logs.push(line);
      if (this.current.logs.length > MAX_LOGS) this.current.logs.shift();
    }
    console.log(line);
  }

  async start(type, task) {
    if (this.running) {
      throw new Error('A job is already running');
    }

    this.stopRequested = false;
    this.readyResolver = null;
    this.current = {
      type,
      status: 'running',
      logs: [],
      summary: null,
      startedAt: new Date().toISOString(),
      finishedAt: null
    };

    this._log(`[${type}] Started`);

    try {
      const summary = await task({
        onLog: (line) => this._log(line),
        waitForUser: (msg) => this._waitForUser(msg),
        shouldStop: () => this.stopRequested
      });
      this.current.summary = summary;
      this.current.status = 'finished';
    } catch (e) {
      this._log(`[${type}] Error: ${e.message}`);
      this.current.summary = { error: e.message };
      this.current.status = 'error';
    } finally {
      this.current.finishedAt = new Date().toISOString();
      this._saveHistory();
    }

    return this.current;
  }

  _waitForUser(msg) {
    this._log(msg);
    this.current.status = 'waiting-ready';
    return new Promise((resolve) => {
      this.readyResolver = resolve;
    });
  }

  resolveReady() {
    if (this.readyResolver) {
      const r = this.readyResolver;
      this.readyResolver = null;
      if (this.current) this.current.status = 'running';
      r();
    }
  }

  stop() {
    this.stopRequested = true;
  }

  status() {
    return {
      running: this.running,
      status: this.current ? this.current.status : 'idle',
      type: this.current ? this.current.type : null,
      startedAt: this.current ? this.current.startedAt : null,
      finishedAt: this.current ? this.current.finishedAt : null,
      summary: this.current ? this.current.summary : null,
      logs: this.current ? this.current.logs.slice() : []
    };
  }

  _saveHistory() {
    try {
      const dir = path.dirname(RUN_HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let history = [];
      if (fs.existsSync(RUN_HISTORY_FILE)) {
        try {
          history = JSON.parse(fs.readFileSync(RUN_HISTORY_FILE, 'utf8'));
        } catch (e) {
          history = [];
        }
      }

      history.push({
        type: this.current.type,
        status: this.current.status,
        summary: this.current.summary,
        startedAt: this.current.startedAt,
        finishedAt: this.current.finishedAt
      });

      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
      fs.writeFileSync(RUN_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
      console.log('[JOB] Could not save run history:', e.message);
    }
  }

  lastRun() {
    try {
      if (!fs.existsSync(RUN_HISTORY_FILE)) return null;
      const history = JSON.parse(fs.readFileSync(RUN_HISTORY_FILE, 'utf8'));
      return history.length ? history[history.length - 1] : null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = { JobManager, RUN_HISTORY_FILE };
