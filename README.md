# Couch Spotters

A weekend plane-spotting dashboard — live streams, live ADS-B overhead tracking,
a Melbourne Airport board, and a shared spotting logbook. Runs entirely in the
browser: no backend, no server, no build step, no ongoing cost.

## Why this repo exists

The TDD called for a layered architecture — a frontend calling an API layer,
which calls an "Aviation Service," which calls providers (OpenSky, airport
data, weather, YouTube), with server-side caching and retries. That's a solid
pattern for a commercial product with a real team behind it. For a two-person
hobby project, it's also exactly what burns AI-builder credits fastest: every
one of those layers has to be scaffolded, wired together, and debugged through
paid prompts, and a real backend needs somewhere to run (which is its own
ongoing cost or complexity).

This app gets the same outcome — live aircraft, live streams, a Melbourne
board, a logbook — by calling OpenSky and YouTube directly from the browser
and skipping the backend entirely. It's a single HTML file. There is nothing
to deploy except that file, and nothing to pay for.

## What's already built vs. the TDD

| TDD item | Status here |
|---|---|
| The Lounge | In progress |
| Watch | ✅ done — curated video library, filterable |
| Live Now | ✅ done — per-airport live stream cards, 8 airports |
| Overhead | ✅ done — live ADS-B tracker for Victoria |
| MEL Board | ✅ done — live arrivals/departures near Melbourne Airport |
| Logbook | ✅ done — shared sighting log with ratings |
| SplitFlapBoard component | ✅ done — the ticker at the top of the page |
| AirportCard / VideoCard / FlightCard | ✅ done — same idea, different names |
| Aviation Service / API layer | Intentionally skipped — not needed for a client-only hobby app |
| Weather | Not built yet — easy to add as a simple client-side widget if wanted |
| Notifications / Widgets / Offline sync | Phase 4 in the TDD — worth revisiting only if the app outgrows "just us two" |

## Running it

Open `index.html` in a browser. That's it — no install, no `npm run`, nothing
to configure.

## Deploying it for free (GitHub Pages)

1. Create a new GitHub repo (public or private — Pages works on both if you
   have GitHub Pro, public repos get free Pages regardless).
2. Add this `index.html` (and this README) to the repo, commit, push.
3. In the repo: **Settings → Pages → Source → Deploy from a branch → main →
   /(root)**. Save.
4. GitHub gives you a live URL, typically
   `https://<your-username>.github.io/<repo-name>/`, live within a minute or
   two. Every time you push a change to `index.html`, the live site updates
   automatically — no separate "deploy" step, no credits, no limits.

## A note on data storage

This file uses a small storage adapter (see the top of the `<script>` block)
that:
- Uses Claude's built-in artifact storage when the file is opened inside a
  Claude conversation (which is how we've been testing it) — this syncs data
  across anyone with that artifact link.
- Falls back to the browser's own `localStorage` when opened as a normal
  webpage (e.g. on GitHub Pages) — this only saves data on whichever device
  and browser you're using. Since the two of you mostly use this from one
  couch/one screen, that's probably fine as-is.

If you later want the Logbook to sync across both your phones independently,
the cheapest real option is a free-tier backend like **Firebase Firestore**
or **Supabase** (both have generous permanent free tiers for something this
small) — that's a genuinely useful next step, but only worth doing once
everything else feels finished, since it's the one piece that does need a
tiny bit of backend.

## Keeping building without spending money

The practical version of "streamline the build": treat Base44 as, at most, a
preview/hosting convenience, not the place development happens. Do the actual
building here — in this repo, with Claude for the code — and only touch
Base44 if you specifically want its hosting or its UI. That keeps the whole
project's cost at $0 regardless of how much you iterate.
