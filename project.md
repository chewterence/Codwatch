# Codwatch — Project Reference

Vessel monitoring tool for Patagonian toothfish (*Dissostichus eleginoides*) supply intelligence.
Owner runs a frozen seafood business dealing in large volumes and wants to become a market maker
by tracking fishing vessel activity, port landings, transshipment, and fleet behavior patterns.

**Other docs:** `api_documentation.md` (GFW API reference) · `ccamlr_vessel_list.md` (vessel fleet,
authorization data — a point-in-time snapshot of the *external* CCAMLR list, re-scrape each
December; not auto-updated by anything in this repo) · `database/schema.md` (full DB schema, column
NULL counts, data-quality notes)

---

## How to run

```bash
# 1 — Postgres (Homebrew, auto-starts on login)
brew services start postgresql@16

# 2 — FastAPI backend  (from project root)
uvicorn api.main:app --port 8000 --reload

# 3 — React frontend  (from project root)
cd frontend && npm run dev
# → http://localhost:5173
```

Production (Mac Mini): Postgres on host, app in Docker container connecting via `host.docker.internal`.
`DATABASE_URL` env var switches between dev (`postgresql://localhost/codwatch`) and prod.

---

## Project structure

```
Codwatch/
├── secrets.json                    # GFW API key — never commit
├── api_documentation.md            # GFW API v3 reference
├── ccamlr_vessel_list.md           # Human-readable CCAMLR fleet notes
├── ccamlr_vessel_list.json         # CCAMLR-authorised vessels (source of truth)
├── gfw_ccamlr_vessel_list.json     # Above + GFW IDs populated by gfw_lookup.py
├── gfw_lookup.py                   # Searches GFW API for each CCAMLR vessel
├── api/
│   ├── main.py                     # FastAPI — serves all dashboard data
│   └── requirements.txt
├── database/
│   ├── schema.sql                  # PostgreSQL schema (apply once)
│   ├── schema.md                   # Full schema reference w/ NULL counts + data quality notes
│   └── backfill.py                 # Resumable historical data pull from GFW API (fleet + carriers)
└── frontend/
    ├── vite.config.js              # Proxies /api → http://127.0.0.1:8000
    └── src/
        ├── App.jsx                 # Root layout, top bar, nav, all cross-view state
        ├── flags.js                 # Country name → flag emoji lookup, shared across views
        ├── timeframe.js             # Shared timeframe presets + query-param builder (Fleet Intelligence)
        └── components/
            ├── VesselTracker.jsx/.css   # "Fishing Vessel Tracking" — full-page selection table
            ├── FleetMap.jsx/.css        # Leaflet map — fishing/encounter/offload/port-landing layers
            ├── EventsPanel.jsx/.css     # Unified chronological event feed (left of the map)
            ├── VesselDetail.jsx/.css    # Single-vessel view: voyage timeline + port history
            ├── VoyageTimeline.jsx/.css  # Horizontal [FISHING]→[TRANSIT]→[PORT] strip
            └── SupplyIntelligence.jsx/.css  # Season-over-season fishing-hours charts
```

---

## The three views

Navigation is a single top bar with three tabs; `App.jsx` owns all state shared across them
(`includedIds`, `selectedVessel`/`detailMode`, `selectedEvent`, the map's `days`/`customRange`
timeframe). There is no router — `activeView` is a plain string.

### 1. Fishing Vessel Tracking (`VesselTracker.jsx`) — default landing view

Full-page table of every vessel in `vessels`, one row each: checkbox, name, country (flag *after*
the name), aliases, fishing events, encounters, AIS gaps, last fishing event. Search box, sort
dropdown + direction toggle, "Select all"/"Select none". The checked set (`includedIds`, a `Set`
of vessel ids) is what every other view scopes its data to — it's persisted to
`localStorage['codwatch.trackedVesselIds']` and rehydrated on load (filtered against whatever
vessels currently exist, so a stale id from a deleted vessel doesn't linger).

A vessel with **zero fishing/encounter/AIS-gap activity and a `gfw_ais_from` within the last 90
days** gets a "NEW" badge — it distinguishes a genuinely new-to-AIS vessel from one that's been
tracked for years but happens to have no recorded activity (a very different, more concerning
situation). See `newToAisInfo()` in `VesselTracker.jsx`.

Clicking a row (not the checkbox) jumps straight into `VesselDetail` for that vessel, switching
`activeView` to `'fleet'`.

### 2. Fleet Intelligence (`FleetMap.jsx` + `EventsPanel.jsx`)

No sidebar — full-width split between a chronological event feed (left, fixed ~480px) and the map
(right, flex). Both are scoped to `includedIds` (all tracked vessels) unless a single vessel is
selected, in which case both show that vessel's full history regardless of timeframe.

**Timeframe bar** (top of the map, fleet-wide only): presets 1wk/1mo/6mo/1yr/2yr/All + a custom
date-range picker. "All" label dynamically becomes "All since {year}" once `/api/summary`'s
`first_event_date` is known. State lives in `App.jsx` (`days`, `customRange`) and is passed to
both `FleetMap` and `EventsPanel` so they always show the same window — see `timeframe.js` for the
shared preset list, `applyTimeframeParams()`, and `timeframeLabel()`.

**`EventsPanel`** merges four event types — fishing, encounters, AIS gaps, port visits — into one
table sorted purely by date (most recent first). Encounters and port visits get an orange row
highlight (they're "offloading" events: catch leaves the vessel either via transshipment or a
direct landing); fishing and AIS gaps stay neutral (AIS gaps over 7 days get their own separate red
alert shade). Clicking a row's vessel name drills into `VesselDetail`; clicking anywhere else on
the row calls `onSelectEvent`, which flies the map to that event's coordinates and drops a pulsing
highlight marker with a popup (see `SelectedEventLayer` in `FleetMap.jsx`). Events with no
recorded position (some AIS gaps, and any as-yet-unresolved port visit) show a "No location
recorded for this event" toast instead of silently doing nothing.

*Why this needed care:* fishing events vastly outnumber the other three types (tens of thousands
vs. a few hundred fleet-wide). Capping every type's fetch at the same row count made fishing
truncate to just the last few days while the rarer types still reached back years — the merged
list *looked* sorted wrong (it wasn't) because it read as separate chronological blocks instead of
one interleaved feed. Fix, in `EventsPanel.jsx`: fetch encounters/gaps/ports generously (cheap —
their totals are small) first, then bound the fishing fetch to however far back those actually
reach, only when no explicit timeframe is set. A single-vessel view fetches up to 5,000 fishing
rows outright (bounded — the busiest vessel has ~4,700 total).

**`FleetMap`** layers, each with its own marker shape/color and its own legend entry:
- Coloured dots — fishing events (`fe.lat`/`fe.lon`), one colour per `vessel_id`.
- Orange diamond — a fishing↔carrier encounter (`encounter_type = 'fishing-carrier'`), i.e. a
  potential transshipment.
- Orange triangle — a direct port landing by one of our own tracked vessels.
- Orange square — a carrier's *likely offload port*: the carrier's next recorded port call after
  meeting one of our vessels (`GET /api/transshipment-offloads`), connected to the encounter point
  by a dashed line. Multiple encounters landing at the same port aggregate into one marker with a
  popup listing every carrier/date pair.
- Blue pulsing ring — whichever single event the user clicked in `EventsPanel` (see above).

*The port-coordinate gap:* neither `port_visits` nor `carrier_port_visits` has lat/lon in the DB —
GFW's loitering→`nextPort` derivation never included port coordinates (see `backfill.py`,
`store_port_visits`/`store_carrier_port_visits`). `api/main.py` resolves this at the API layer with
a static `PORT_COORDS` dict (~80 ports, hand-compiled) keyed by GFW's `port_id`
(e.g. `"mus-portlouis"`). A handful of GFW's anonymous numeric-code anchorages
(`chn-chn-2193`, `isl-isl-57`, etc.) have no identifiable real-world location and are deliberately
left unmapped rather than guessed — those port visits render the "no location recorded" toast.

### 3. Supply Intelligence (`SupplyIntelligence.jsx`)

Season-over-season fishing-hours charts (monthly/weekly bar + cumulative line), scoped to
`includedIds` — deliberately, per the owner's call: this answers "how active are the vessels I'm
tracking" rather than "total fleet-wide supply." A right-hand panel lists every currently-tracked
vessel (flag + name, alphabetical) so it's clear who's feeding the chart; needs the `vessels` array
passed down alongside `includedIds` since the chart itself only has ids.

Weekly-view tooltips show the actual calendar date range for the hovered week (anchored to the
current season's Dec 1 start, e.g. "Week 6 · 5 Jan – 11 Jan 2026"), including the year — and both
years when a week straddles a year boundary (rare, but real: `29 Dec 2025 – 4 Jan 2026`).

---

## Database (`postgresql://localhost/codwatch`)

Apply schema once: `psql codwatch -f database/schema.sql`. **Full column-level reference — NULL
counts, indexes, known data-quality issues — lives in `database/schema.md`; keep that file current
when the schema changes, this is just the summary.**

| Table | What it stores |
|---|---|
| `vessels` | Tracked CCAMLR vessels + GFW identity fields (incl. `gfw_ais_from`/`gfw_ais_to`) |
| `vessel_aliases` | Prior name/flag identities for a vessel that renamed/reflagged mid-life (same hull, different GFW identity record) |
| `vessel_authorizations` | CCAMLR licence periods per vessel (area, species, dates) |
| `fishing_events` | GFW fishing detections — lat/lon, FAO/RFMO/EEZ areas, auth status |
| `port_visits` | Port calls derived from loitering events. `start_time` = loitering end (proxy). No lat/lon in DB — resolved at request time from `PORT_COORDS`. |
| `encounters` | Vessel-to-vessel meetings — `fishing-fishing` / `fishing-bunker` / `fishing-carrier` (only the last is a transshipment signal) |
| `ais_gaps` | AIS signal loss periods — duration, distance covered dark |
| `backfill_log` | Tracks (vessel, event_type, date-chunk) already fetched |
| `carrier_vessels` | Reefer/carrier vessels discovered via `fishing-carrier` encounters |
| `carrier_port_visits` | Same loitering-derived port-call data as `port_visits`, but for carriers — no lat/lon columns at all, same `PORT_COORDS` resolution |
| `carrier_backfill_log` | Same shape as `backfill_log`, for the carrier backfill pass |

`fao_areas TEXT[]` and `rfmo_areas TEXT[]` have GIN indexes. Query: `'48.3' = ANY(fao_areas)`.

CCAMLR season = Dec 1 → Nov 30. GFW data lag = 96 hours (never query within 4-5 days of today).

---

## API (`api/main.py`)

FastAPI, all GET, returns JSON. CORS allows `localhost:5173` and `localhost:3000`.

| Endpoint | Key params | Returns |
|---|---|---|
| `GET /api/summary` | — | Row counts for all tables + first/last event date |
| `GET /api/vessels` | — | All vessels with aggregated event counts + aliases |
| `GET /api/fishing-events` | `vessel_id`\|`vessel_ids`, `days`\|`start_date`/`end_date`, `limit` (≤5000) | Events with lat/lon for map plotting |
| `GET /api/port-visits` | `vessel_id`\|`vessel_ids`, `days`\|`start_date`/`end_date`, `limit` (≤2000) | Port visit records + resolved `port_lat`/`port_lon` |
| `GET /api/encounters` | `vessel_id`\|`vessel_ids`, `encounter_type`, `days`\|`start_date`/`end_date`, `limit` (≤2000) | Encounter records |
| `GET /api/ais-gaps` | `vessel_id`\|`vessel_ids`, `min_hours`, `days`\|`start_date`/`end_date`, `limit` (≤2000) | AIS gap records |
| `GET /api/transshipment-offloads` | `vessel_id`\|`vessel_ids`, `days`\|`start_date`/`end_date`, `limit` (≤1000) | For each `fishing-carrier` encounter, the carrier's next port call + resolved coordinates |
| `GET /api/vessels/{id}/timeline` | `months` (default 12, max 60) | All fishing events + port visits + AIS gaps (≥24h) for one vessel, sorted ASC |
| `GET /api/supply/season-chart` | `species`, `granularity` (monthly\|weekly), `vessel_ids` | Season-relative bucketed fishing hours per tracked-vessel scope |

Every list endpoint accepts **either** `vessel_id` (singular) **or** `vessel_ids` (comma-separated) —
singular is used by `VesselDetail`'s per-vessel view, plural by the fleet-wide tracked-set views.
`days` and `start_date`/`end_date` are mutually exclusive (`_timeframe_conditions()` — custom range
always wins if both are somehow present).

To add an endpoint: add `@app.get` in `api/main.py`, call `fetch('/api/...')` in the React component.

---

## Frontend (`frontend/`)

React 18 + Vite. No TypeScript, no state management library — plain `useState`/`useEffect`.
No router — `App.jsx`'s `activeView` string picks which of the three views renders.

**`App.jsx`** owns everything that needs to survive switching views or drilling into a vessel:
`vessels`, `includedIds` (+ localStorage sync), `selectedVessel`/`detailMode` (drives
`VesselDetail`), `selectedEvent` (drives the map's highlight marker), and the Fleet Intelligence
timeframe (`days`/`customRange`). `statsExpanded` (the collapsible fleet-stats row in the top bar)
defaults to collapsed.

**`flags.js`** — one shared `FLAG_EMOJI` dict + `flagFor(country)` helper, used by every component
that shows a flag (`VesselTracker`, `VesselDetail`). Previously duplicated per-component, which is
exactly how a missing country (e.g. Argentina) went unnoticed in one place but not another — keep
it in this one file.

**`VesselDetail`** — replaces the Fleet Intelligence split view when a vessel is selected. Header:
flag, name, country, KPI counts (🎣 fishing / 🫱🏻‍🫲🏼 encounters / 📡 AIS gaps), species pills, range
picker (6mo/1yr/2yr/All). Below: `VoyageTimeline` strip + Port Landing History table. "← Fleet"
returns to Fleet Intelligence, not Vessel Tracker (i.e. clicking a vessel is a "drill in", not a
"navigate away").

**`VoyageTimeline`** — groups raw fishing events into trips using a 10-day gap threshold. Gaps
between fishing periods become TRANSIT blocks; port visits slot into transit gaps when present.
🎣 = fishing, ⚓ = port (this pairing is used everywhere in the app now — see below).

**Icon conventions** (consistent across `VesselTracker`, `VesselDetail`, `EventsPanel`, `FleetMap`,
`VoyageTimeline`): 🎣 fishing activity, ⚓ port landing (own vessel *or* carrier offload port),
🫱🏻‍🫲🏼 encounters, 📡 AIS gaps. The map's marker *shapes* (dot/diamond/triangle/square) are separate
from these popup-text icons — see the `FleetMap` layer list above.

**Important:** `vite.config.js` proxy must use `http://127.0.0.1:8000` not `http://localhost:8000` —
on Mac, `localhost` resolves to `::1` (IPv6) but uvicorn binds IPv4 only.

---

## Backfill (`database/backfill.py`)

Resume-safe — records each (vessel, event_type, date-chunk) in `backfill_log` (or
`carrier_backfill_log` for carriers) and skips already-fetched chunks on re-run.

```bash
python3 database/backfill.py                      # full backfill 2022 → today
python3 database/backfill.py --seed-only          # vessels table only, no API calls
python3 database/backfill.py --vessel "Nordic Prince"  # one vessel
```

GFW datasets used:
- `public-global-fishing-events:latest` → `fishing_events`
- `public-global-loitering-events:latest` → `port_visits` / `carrier_port_visits` (derived from
  `vessel.nextPort`; `public-global-port-visits-c2:latest` was deprecated by GFW)
- `public-global-encounters-events:latest` → `encounters` (also how new `carrier_vessels` rows get
  discovered — the first time a `fishing-carrier` encounter names a carrier we haven't seen)
- `public-global-gaps-events:latest` → `ais_gaps`

---

## Known issues

**Port visit timestamps are approximate.** `start_time` is the end of the last loitering event
before the port call, not exact arrival time. `end_time`/`duration_hours` are NULL — we never know
when a vessel left port.

**Port/carrier-port coordinates are a hand-maintained gazetteer, not a real reference table.**
`PORT_COORDS` in `api/main.py` covers every port currently seen in `port_visits` +
`carrier_port_visits`. A newly-appearing port won't have coordinates until someone adds it there.

**AIS gap positions (`lat_off`/`lon_off`/`lat_on`/`lon_on`) are always NULL** — not populated by
the current backfill; would need parsing from the stored `raw` JSONB payload.

**Vessels with no GFW match** can't pull event data — shown greyed out in Vessel Tracking.

**Blue Ocean (Korea)** — `multiple_candidates` match confidence. Treat its data with caution.

See `database/schema.md` for the full, current per-column data-quality table (row counts drift
constantly as the backfill/live sync runs — that file is the source of truth, not this one).

---

## Future work

- `poller.py` — weekly cron to fetch new events since last stored date per vessel
- Docker — `Dockerfile` for API + frontend build, `docker-compose.yml` for Mac Mini deploy
- Expand `PORT_COORDS` toward a real reference table (or a GFW ports endpoint, if one exists)
- Additional visualisations: FAO subarea heatmap, fleet activity calendar
