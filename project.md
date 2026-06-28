# Codwatch — Project Reference

Vessel monitoring tool for Patagonian toothfish (*Dissostichus eleginoides*) supply intelligence.
Owner runs a frozen seafood business dealing in large volumes and wants to become a market maker
by tracking fishing vessel activity, port landings, and fleet behavior patterns.

**Other docs:** `api_documentation.md` (GFW API reference) · `ccamlr_vessel_list.md` (vessel fleet)

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
├── ccamlr_vessel_list.json         # 32 CCAMLR-authorised vessels (source of truth)
├── gfw_ccamlr_vessel_list.json     # Above + GFW IDs populated by gfw_lookup.py
├── gfw_lookup.py                   # Searches GFW API for each CCAMLR vessel
├── api/
│   ├── main.py                     # FastAPI — serves all dashboard data
│   └── requirements.txt
├── database/
│   ├── schema.sql                  # PostgreSQL schema (apply once)
│   └── backfill.py                 # Resumable historical data pull from GFW API
└── frontend/
    ├── vite.config.js              # Proxies /api → http://127.0.0.1:8000
    └── src/
        ├── App.jsx                 # Root layout, top-bar stats, selectedVessel + detailMode state
        └── components/
            ├── VesselSidebar.jsx   # Clickable vessel list with per-vessel counts
            ├── FleetMap.jsx        # Leaflet map — fishing event dots
            ├── EventsPanel.jsx     # Tabbed table: Fishing / Encounters / AIS Gaps / Ports
            ├── VesselDetail.jsx    # Single-vessel detail view (voyage timeline + port history)
            ├── VesselDetail.css
            ├── VoyageTimeline.jsx  # Horizontal [FISHING]→[TRANSIT]→[PORT] strip
            └── VoyageTimeline.css
```

---

## Database (`postgresql://localhost/codwatch`)

Apply schema once: `psql codwatch -f database/schema.sql`

| Table | What it stores | PK |
|---|---|---|
| `vessels` | All 32 CCAMLR vessels + GFW identity fields | `id` serial |
| `vessel_authorizations` | CCAMLR licence periods per vessel (area, species, dates) | `id` |
| `fishing_events` | GFW fishing detections — lat/lon, FAO/RFMO areas, auth status | `event_id` GFW string |
| `port_visits` | Port calls derived from loitering events — name, country, approx. arrival date. `start_time` = loitering end (proxy). `end_time`/`duration_hours` are NULL. | `event_id` = GFW portVisitEventId |
| `encounters` | Vessel-to-vessel meetings — type, other vessel, distance | `event_id` |
| `ais_gaps` | AIS signal loss periods — duration, distance covered dark | `event_id` |
| `backfill_log` | Tracks (vessel, event_type, date-chunk) already fetched | `id` |

`fao_areas TEXT[]` and `rfmo_areas TEXT[]` have GIN indexes. Query: `'48.3' = ANY(fao_areas)`.

CCAMLR season = Dec 1 → Nov 30. GFW data lag = 96 hours (never query within 4-5 days of today).

---

## API (`api/main.py`)

FastAPI, all GET, returns JSON. CORS allows `localhost:5173` and `localhost:3000`.

| Endpoint | Key params | Returns |
|---|---|---|
| `GET /api/summary` | — | Row counts for all tables + last event date |
| `GET /api/vessels` | — | All 32 vessels with aggregated event counts |
| `GET /api/fishing-events` | `vessel_id`, `days`, `limit` | Events with lat/lon for map plotting |
| `GET /api/port-visits` | `vessel_id`, `limit` | Port visit records |
| `GET /api/encounters` | `vessel_id`, `limit` | Encounter records |
| `GET /api/ais-gaps` | `vessel_id`, `min_hours`, `limit` | AIS gap records |
| `GET /api/vessels/{id}/timeline` | `months` (default 12, max 60) | All fishing events + port visits + AIS gaps (≥24h) for one vessel, sorted ASC |

To add an endpoint: add `@app.get` in `api/main.py`, call `fetch('/api/...')` in the React component.

---

## Frontend (`frontend/`)

React 18 + Vite. No TypeScript, no state management library — plain `useState`/`useEffect`.

**`App.jsx`** owns two states: `selectedVessel` (null | vessel object) and `detailMode` (bool). Clicking a vessel in the sidebar sets both and shows `VesselDetail`. "← Fleet" button clears both and returns to the fleet map.

**`VesselSidebar`** — vessel list sorted by fishing event count. Clicking a tracked vessel enters detail view. The 5 vessels with no GFW ID are greyed out and unclickable.

**`FleetMap`** — Leaflet + CartoDB dark tiles, centred Southern Ocean (-55, 20). No vessel selected: last 180 days all vessels (≤800 dots). Vessel selected: all stored events for that vessel, map flies to it. Dots coloured per `vessel_id`. Click dot → popup with date, duration, FAO area. Only visible when `detailMode` is false.

**`VesselDetail`** — replaces the map when a vessel is clicked. Contains:
- Header: flag, name, country, KPI counts (fishing events / encounters / AIS gaps), species pills, range picker (6mo/1yr/2yr/All)
- `VoyageTimeline` strip
- Port Landing History table (port name, country, approx. arrival — departure/duration not available from GFW public API)
- "← Fleet" button returns to fleet map
- Fetches from `GET /api/vessels/{id}/timeline?months=N`

**`VoyageTimeline`** — groups raw fishing events into trips using a 10-day gap threshold. Consecutive events within 10 days → same fishing period. Gaps between periods become TRANSIT blocks. Port visits slot into transit gaps when present. Block colours: fishing=blue, transit=grey dashed, port=green. Width proportional at 4.5px/day (min 72–110px). Horizontally scrollable.

**`EventsPanel`** — four tabs, only shown in fleet map view (hidden in detail view). Re-fetches on `selectedVessel` change:
- **Fishing Events** — date, duration, FAO area, species (CCAMLR auth), RFMO
- **Encounters** — who met whom, type, duration, area
- **AIS Gaps** — duration (orange badge if > 7 days), distance covered dark
- **Port Visits** — loitering-derived port calls (see backfill note)

**Important:** `vite.config.js` proxy must use `http://127.0.0.1:8000` not `http://localhost:8000` — on Mac, `localhost` resolves to `::1` (IPv6) but uvicorn binds IPv4 only.

---

## Backfill (`database/backfill.py`)

Resume-safe — records each (vessel, event_type, 365-day chunk) in `backfill_log` and skips already-fetched chunks on re-run.

```bash
python3 database/backfill.py                      # full backfill 2022 → today
python3 database/backfill.py --seed-only          # vessels table only, no API calls
python3 database/backfill.py --vessel "Nordic Prince"  # one vessel
```

GFW datasets used:
- `public-global-fishing-events:latest` → `fishing_events`
- `public-global-loitering-events:latest` → `port_visits` (port visits derived from `vessel.nextPort` in each event; `public-global-port-visits-c2:latest` was deprecated by GFW)
- `public-global-encounters-events:latest` → `encounters`
- `public-global-gaps-events:latest` → `ais_gaps`

---

## Known issues

**Port visit timestamps are approximate.** Port visits are derived from loitering events (GFW dataset `public-global-loitering-events:latest`) because `public-global-port-visits-c2:latest` was deprecated. The `start_time` in `port_visits` is the end of the last loitering event before the port call — an estimate of when the vessel headed toward port, not exact arrival time. `end_time` and `duration_hours` are NULL.

**5 vessels not in GFW:** Le Saint Andre (France), Greenstar, Kingstar, Seven Park, Sunstar (Korea). No GFW vessel ID — cannot pull event data until matched.

**Blue Ocean (Korea)** — `multiple_candidates` match confidence. Treat its data with caution.

---

## Future work

- `poller.py` — weekly cron to fetch new events since last stored date per vessel
- Docker — `Dockerfile` for API + frontend build, `docker-compose.yml` for Mac Mini deploy
- Additional visualisations: FAO subarea heatmap, supply forecast, fleet activity calendar
