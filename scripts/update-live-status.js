// scripts/update-live-status.js
//
// This is your existing runLiveSearch() logic from index.html, moved out of
// the browser and into a scheduled GitHub Actions job. Same queries, same
// relevance filtering, same exclude list, same airport rotation — it just
// runs on a timer server-side and writes the result to live-status.json,
// which your site fetches for free (no quota cost, no matter how many times
// you two open the app or refresh).
//
// Quota math: 5 search.list calls/run (2 general + 3 airport) = ~500 units.
// Running every 2 hours = 12 runs/day = ~6,000 units, leaving ~4,000 units
// of headroom for manual workflow_dispatch runs or troubleshooting.

const fs = require('fs');
const path = require('path');

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const OUTPUT_PATH = path.join(__dirname, '..', 'live-status.json');

const AIRPORT_QUERIES = [
  { code: 'LHR', name: 'Heathrow', q: 'Heathrow airport plane spotting live' },
  { code: 'SYD', name: 'Sydney', q: 'Sydney airport plane spotting live' },
  { code: 'MEL', name: 'Melbourne', q: 'Melbourne airport plane spotting live' },
  { code: 'FNC', name: 'Madeira', q: 'Madeira airport plane spotting live' },
  { code: 'DFW', name: 'Dallas/Fort Worth', q: 'DFW airport plane spotting live' },
  { code: 'SFO', name: 'San Francisco', q: 'SFO airport plane spotting live' },
  { code: 'LAX', name: 'Los Angeles', q: 'LAX airport plane spotting live' },
  { code: 'JFK', name: 'New York', q: 'JFK airport plane spotting live' },
];
const GENERAL_QUERIES = ['plane spotting live stream', 'airport live cam plane spotting'];
const AIRPORTS_PER_CYCLE = 3;

const RELEVANCE_KEYWORDS = [
  'plane', 'planespotting', 'spotting', 'spotter', 'aircraft', 'airport', 'airline',
  'aviation', 'runway', 'takeoff', 'take-off', 'take off', 'landing', 'arrivals',
  'departures', 'atc', 'tower', 'jet', 'heavy', 'airbus', 'boeing', 'a380', 'a350',
  'a330', 'a320', 'a321', 'a220', '747', '737', '777', '787', 'flightradar', 'faa',
];

const EXCLUDE_CHANNELS = [
  'abc news', 'bbc news', 'cnn', 'sky news', 'fox news', 'nbc news', 'cbs news',
  'reuters', 'al jazeera english', 'msnbc', 'the guardian', 'associated press',
  'euronews', 'nine news', '7news', 'sbs news',
];

function isPlaneSpottingRelevant(item) {
  const text = (item.title + ' ' + item.channel).toLowerCase();
  return RELEVANCE_KEYWORDS.some((k) => text.includes(k));
}

function isExcludedChannel(item) {
  const ch = item.channel.toLowerCase();
  return EXCLUDE_CHANNELS.some((x) => ch.includes(x));
}

async function runOneSearch(query) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
    query
  )}&type=video&eventType=live&order=relevance&maxResults=15&key=${YT_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    const reason =
      (data.error.errors && data.error.errors[0] && data.error.errors[0].reason) ||
      data.error.message ||
      '';
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw { quota: true };
    }
    throw { message: reason };
  }

  return (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumb: it.snippet.thumbnails.medium.url,
    matchedQuery: query,
  }));
}

async function fetchViewerCounts(videoIds) {
  if (videoIds.length === 0) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,snippet&id=${videoIds.join(
    ','
  )}&key=${YT_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) return {};

  const map = {};
  (data.items || []).forEach((v) => {
    const stillLive = v.snippet && v.snippet.liveBroadcastContent === 'live';
    map[v.id] = {
      viewers:
        stillLive && v.liveStreamingDetails && v.liveStreamingDetails.concurrentViewers
          ? parseInt(v.liveStreamingDetails.concurrentViewers, 10)
          : null,
      stillLive,
    };
  });
  return map;
}

function loadPreviousState() {
  try {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { airportRotationStart: parsed.airportRotationStart || 0 };
  } catch (e) {
    return { airportRotationStart: 0 };
  }
}

async function main() {
  if (!YT_API_KEY) {
    console.error('YOUTUBE_API_KEY secret is not set.');
    process.exit(1);
  }

  const prev = loadPreviousState();
  let airportRotationStart = prev.airportRotationStart;

  const airportBatch = [];
  for (let i = 0; i < AIRPORTS_PER_CYCLE; i++) {
    airportBatch.push(AIRPORT_QUERIES[(airportRotationStart + i) % AIRPORT_QUERIES.length]);
  }
  airportRotationStart = (airportRotationStart + AIRPORTS_PER_CYCLE) % AIRPORT_QUERIES.length;

  const queries = [...GENERAL_QUERIES, ...airportBatch.map((a) => a.q)];

  let merged = [];
  let quotaExceeded = false;
  let lastSearchError = null;

  try {
    for (const q of queries) {
      const results = await runOneSearch(q);
      merged.push(...results);
    }
  } catch (e) {
    if (e && e.quota) {
      quotaExceeded = true;
      console.error('Quota exceeded during this run.');
    } else {
      lastSearchError = (e && e.message) || 'Unknown API error';
      console.error('Search error:', lastSearchError);
    }
  }

  const seen = new Map();
  merged.forEach((r) => {
    if (!seen.has(r.videoId)) seen.set(r.videoId, r);
  });
  const deduped = [...seen.values()].filter(isPlaneSpottingRelevant).filter((r) => !isExcludedChannel(r));

  let liveResults = [];
  if (deduped.length) {
    const viewerMap = await fetchViewerCounts(deduped.map((r) => r.videoId)).catch(() => ({}));
    deduped.forEach((r) => {
      const info = viewerMap[r.videoId];
      r.viewers = info ? info.viewers : null;
      r.stillLive = info ? info.stillLive : true;
    });
    liveResults = deduped.filter((r) => r.stillLive !== false).sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
  }

  const output = {
    updatedAt: new Date().toISOString(),
    airportRotationStart,
    quotaExceeded,
    lastSearchError,
    liveResults,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${liveResults.length} live results to live-status.json`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
