const { startMonitor, DEFAULTS } = require('./src/runMonitor');

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    watch: false,
    limit: 0,
    ...DEFAULTS
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--watch') opts.watch = true;
    else if (a === '--limit') { opts.limit = parseInt(argv[i + 1], 10) || 0; i++; }
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a === '--pause-every') { opts.pauseEvery = parseInt(argv[i + 1], 10) || DEFAULTS.pauseEvery; i++; }
    else if (a === '--pause-ms') { opts.pauseMs = parseInt(argv[i + 1], 10) || DEFAULTS.pauseMs; i++; }
    else if (a === '--delay-ms') { opts.delayMs = parseInt(argv[i + 1], 10) || DEFAULTS.delayMs; i++; }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('='.repeat(60));
  console.log('[MONITOR] Contacts monitor');
  console.log(`[MONITOR] dry-run: ${opts.dryRun}, watch: ${opts.watch}, limit: ${opts.limit || 'none'}`);
  console.log(`[MONITOR] delay=${opts.delayMs}ms, pauseEvery=${opts.pauseEvery}, pauseMs=${opts.pauseMs}ms, errorThreshold=${opts.errorThreshold}`);
  console.log('='.repeat(60));

  do {
    await startMonitor({
      dryRun: opts.dryRun,
      limit: opts.limit,
      delayMs: opts.delayMs,
      pauseEvery: opts.pauseEvery,
      pauseMs: opts.pauseMs,
      errorThreshold: opts.errorThreshold
    });

    if (!opts.watch) break;
    console.log('[MONITOR] Sleeping for 3 hours...');
    await new Promise((r) => setTimeout(r, 3 * 60 * 60 * 1000));
  } while (opts.watch);
}

main().catch((e) => {
  console.error('[MONITOR] Fatal error:', e.message);
  process.exit(1);
});
