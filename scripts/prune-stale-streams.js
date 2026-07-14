// scripts/prune-stale-streams.js
//
// Runs much more often than the main search job (every 5 min vs every 2
// hours), because it's nearly free: videos.list costs 1 unit TOTAL no
// matter how many video IDs you pass it in one call, unlike search.list
// which costs 100 units per query. This job doesn't search for anything
// new — it just re-checks the streams already in live-status.json and
// drops any that have actually ended, so "Now Playing" never shows a
// stream that finished 90 minutes ago.

const fs = require('fs');
const path = require('path');

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const STATUS_PATH = path.join(__dirname, '..', 'live-status.json');

async function main() {
  if (!YT_API_KEY) {
    console.error('YOUTUBE_API_KEY secret is not set.');
    process.exit(1);
  }

  if (!fs.existsSync(STATUS_PATH)) {
    console.log('No live-status.json yet — nothing to prune.');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  const liveResults = raw.liveResults || [];

  if (liveResults.length === 0) {
    console.log('No tracked streams — nothing to prune.');
    return;
  }

  const ids = liveResults.map((r) => r.videoId).filter(Boolean);
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(
    ','
  )}&key=${YT_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    // Don't wipe out good data just because this cheap check hit an error —
    // leave live-status.json untouched and let the next run try again.
    console.error('videos.list error, leaving live-status.json unchanged:', data.error.message);
    return;
  }

  const stillLiveMap = new Map();
  (data.items || []).forEach((item) => {
    const isLive = item.snippet && item.snippet.liveBroadcastContent === 'live';
    const viewers =
      isLive && item.liveStreamingDetails && item.liveStreamingDetails.concurrentViewers
        ? parseInt(item.liveStreamingDetails.concurrentViewers, 10)
        : null;
    stillLiveMap.set(item.id, { isLive, viewers });
  });

  const before = liveResults.length;
  const pruned = liveResults
    .filter((r) => {
      const info = stillLiveMap.get(r.videoId);
      // If YouTube didn't return the video at all, treat it as ended/removed.
      return info ? info.isLive : false;
    })
    .map((r) => {
      const info = stillLiveMap.get(r.videoId);
      return { ...r, viewers: info && info.viewers != null ? info.viewers : r.viewers };
    })
    .sort((a, b) => (b.viewers || 0) - (a.viewers || 0));

  raw.liveResults = pruned;
  raw.updatedAt = new Date().toISOString();

  fs.writeFileSync(STATUS_PATH, JSON.stringify(raw, null, 2));
  console.log(`Pruned ${before - pruned.length} ended stream(s), ${pruned.length} still live.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
