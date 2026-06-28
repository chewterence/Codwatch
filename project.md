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
        ├── App.jsx                 # Root layout, top-bar stats, selectedVessel state
        └── components/
            ├── VesselSidebar.jsx   # Clickable vessel list with per-vessel counts
            ├── FleetMap.jsx        # Leaflet map — fishing event dots
            └── EventsPanel.jsx     # Tabbed table: Fishing / Encounters / AIS Gaps / Ports
```

---

## Database (`postgresql://localhost/codwatch`)

Apply schema once: `psql codwatch -f database/schema.sql`

| Table | What it stores | PK |
|---|---|---|
| `vessels` | All 32 CCAMLR vessels + GFW identity fields | `id` serial |
| `vessel_authorizations` | CCAMLR licence periods per vessel (area, species, dates) | `id` |
| `fishing_events` | GFW fishing detections — lat/lon, FAO/RFMO areas, auth status | `event_id` GFW string |
| `port_visits` | Port calls — name, country, confidence | `event_id` |
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

To add an endpoint: add `@app.get` in `api/main.py`, call `fetch('/api/...')` in the React component.

---

## Frontend (`frontend/`)

React 18 + Vite. No TypeScript, no state management library — plain `useState`/`useEffect`.

**`App.jsx`** owns `selectedVessel` state (null = fleet view, object = single vessel). Passes it as props to all panels.

**`VesselSidebar`** — vessel list sorted by fishing event count. Click to select/deselect. The 5 vessels with no GFW ID are greyed out and unclickable.

**`FleetMap`** — Leaflet + CartoDB dark tiles, centred Southern Ocean (-55, 20). No vessel selected: last 180 days all vessels (≤800 dots). Vessel selected: all stored events for that vessel, map flies to it. Dots coloured per `vessel_id`. Click dot → popup with date, duration, FAO area, auth status.

**`EventsPanel`** — four tabs, re-fetch on `selectedVessel` change:
- **Fishing Events** — date, duration, FAO area, RFMO, authorization check
- **Encounters** — who met whom, type, duration, area
- **AIS Gaps** — duration (orange if > 7 days), distance covered dark
- **Port Visits** — currently empty (see known issues)

**Important:** `vite.config.js` proxy must use `http://127.0.0.1:8000` not `http://localhost:8000` — on Mac, `localhost` resolves to `::1` (IPv6) but uvicorn binds IPv4 only.

---

## Backfill (`database/backfill.py`)

Resume-safe — records each (vessel, event_type, 365-day chunk) in `backfill_log` and skips already-fetched chunks on re-run.

```bash
python3 database/backfill.py                      # full backfill 2022 → today
python3 database/backfill.py --seed-only          # vessels table only, no API calls
python3 database/backfill.py --vessel "Nordic Prince"  # one vessel
```

GFW datasets used: `public-global-fishing-events:latest`, `public-global-port-visits-c2:latest`, `public-global-encounters-events:latest`, `public-global-gaps-events:latest`.

---

## Known issues

**Port visits = 0.** Backfill hits `public-global-port-visits-c2:latest` and returns 0 for all vessels despite them definitely calling at ports (Cape Town, Las Palmas, Montevideo, Punta Arenas). Dataset ID or query structure may be wrong — needs investigation by querying one vessel manually and inspecting the raw response.

**5 vessels not in GFW:** Le Saint Andre (France), Greenstar, Kingstar, Seven Park, Sunstar (Korea). No GFW vessel ID — cannot pull event data until matched.

**Blue Ocean (Korea)** — `multiple_candidates` match confidence. Treat its data with caution.

---

## Future work

- Fix port visits dataset / query
- `poller.py` — weekly cron to fetch new events since last stored date per vessel
- Docker — `Dockerfile` for API + frontend build, `docker-compose.yml` for Mac Mini deploy
- Additional visualisations: fleet activity timeline, FAO subarea heatmap, supply forecast
