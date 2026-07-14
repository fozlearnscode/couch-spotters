// scripts/update-overhead.js
//
// Fetches OpenSky Network data server-side (GitHub Actions isn't a browser,
// so it isn't subject to CORS the way your site's own JS calls were) and
// writes the raw results to overhead-status.json. Your existing
// renderFlights() / renderMelBoard() functions in index.html don't need to
// change at all — they already just take a `states` array.
//
// No API key needed: this uses OpenSky's anonymous access, same as before.
// Runs more often than the YouTube job (every 15 min vs every 2 hours)
// since flight positions go stale within minutes, not hours.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'overhead-status.json');

const BBOX = { lamin: -38.4, lomin: 144.2, lamax: -37.3, lomax: 145.6 }; // Greater Melbourne & regional Victoria
const MEL_BBOX = { lamin: -37.86, lomin: 144.62, lamax: -37.49, lomax: 145.06 }; // tight ring around YMML

async function fetchStates(bbox, extended) {
  const url = `https://opensky-network.org/api/states/all?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}${extended ? '&extended=1' : ''}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'couch-spotters/1.0 (hobby project)' },
  });

  const remaining = res.headers.get('x-rate-limit-remaining');
  const retryAfter = res.headers.get('x-rate-limit-retry-after-seconds');

  if (!res.ok) {
    return { states: [], error: `HTTP ${res.status}`, remaining, retryAfter };
  }

  const data = await res.json();
  return { states: data.states || [], error: null, remaining, retryAfter };
}

async function main() {
  const [overhead, melBoard] = await Promise.all([
    fetchStates(BBOX, true),
    fetchStates(MEL_BBOX, false),
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    overhead: { states: overhead.states, error: overhead.error },
    melBoard: { states: melBoard.states, error: melBoard.error },
    // Handy for tuning how often this job can safely run — visible in the
    // committed JSON file if you ever want to check remaining credits.
    rateLimitInfo: {
      overheadRemaining: overhead.remaining,
      melBoardRemaining: melBoard.remaining,
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `Wrote overhead-status.json — ${overhead.states.length} overhead, ${melBoard.states.length} near MEL. ` +
      `Rate limit remaining: overhead=${overhead.remaining}, mel=${melBoard.remaining}`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
