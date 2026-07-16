// scripts/capture-history.js
//
// Runs every 15 minutes via GitHub Actions. Snapshots what's currently
// overhead (same airplanes.live query the live Overhead tab uses) and
// appends it to a per-day file under history/, e.g. history/2026-07-15.json.
// Each day's file is an array of { time: "HH:MM", aircraft: [...] } entries
// in Melbourne local time, so the client can later ask "what was flying at
// 14:30 on the 12th?" without doing any timezone math itself.
//
// Field names deliberately match what airplanes.live returns (hex, flight,
// lat, lon, alt_baro, gs, track, category) so the History tab can reuse the
// exact same rendering code as the live Overhead tab — no translation layer.
//
// Storage stays bounded: files older than RETENTION_DAYS are deleted every
// run, so this never grows the repo indefinitely.

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'history');
const RETENTION_DAYS = 14;

// Must match OVERHEAD_POINT in index.html — same coverage area.
const OVERHEAD_POINT = { lat: -37.85, lon: 144.9, radiusNm: 70 };

function melbourneParts(date) {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false });
  return { date: dateFmt.format(date), time: timeFmt.format(date) };
}

async function fetchOverheadSnapshot() {
  const url = `https://api.airplanes.live/v2/point/${OVERHEAD_POINT.lat}/${OVERHEAD_POINT.lon}/${OVERHEAD_POINT.radiusNm}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const aircraft = data.ac || data.aircraft || [];

  // Airborne only, and only the fields the client actually renders — keeps
  // each snapshot small since this accumulates all day, every day.
  return aircraft
    .filter(a => a.alt_baro !== 'ground' && a.lat != null && a.lon != null)
    .map(a => ({
      hex: a.hex || null,
      flight: a.flight || null,
      lat: a.lat,
      lon: a.lon,
      alt_baro: a.alt_baro,
      gs: a.gs != null ? Math.round(a.gs) : null,
      track: a.track != null ? Math.round(a.track) : null,
      category: a.category || null,
    }));
}

function cleanupOldFiles(todayStr) {
  if (!fs.existsSync(HISTORY_DIR)) return;
  const cutoff = new Date(todayStr + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

  fs.readdirSync(HISTORY_DIR).forEach(file => {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) return;
    const fileDate = new Date(match[1] + 'T00:00:00Z');
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(HISTORY_DIR, file));
      console.log(`Deleted old snapshot file: ${file}`);
    }
  });
}

async function main() {
  const now = new Date();
  const { date, time } = melbourneParts(now);

  let aircraft;
  try {
    aircraft = await fetchOverheadSnapshot();
  } catch (err) {
    console.error('Fetch failed, skipping this capture:', err.message);
    return; // don't write a broken/empty snapshot over real data
  }

  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const filePath = path.join(HISTORY_DIR, `${date}.json`);
  let dayData = [];
  if (fs.existsSync(filePath)) {
    try { dayData = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (e) { dayData = []; }
  }

  // Avoid duplicate entries if this run overlaps a previous one somehow.
  dayData = dayData.filter(entry => entry.time !== time);
  dayData.push({ time, aircraft });
  dayData.sort((a, b) => a.time.localeCompare(b.time));

  fs.writeFileSync(filePath, JSON.stringify(dayData));
  console.log(`Captured ${aircraft.length} aircraft at ${date} ${time} (Melbourne)`);

  cleanupOldFiles(date);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
