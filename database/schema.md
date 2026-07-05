# Codwatch — Database Schema

**Database:** PostgreSQL · **Purpose:** Vessel monitoring for *Dissostichus eleginoides* (Patagonian toothfish)

> **CCAMLR season:** Dec 1 → Nov 30 (e.g. "2025 season" = 2025-12-01 to 2026-11-30)
> **GFW data lag:** ~96 hours · **GFW query max:** 366 days per request

---

## vessels

One row per tracked vessel. **45 total; 45 matched to GFW.** 2 have `tracked = FALSE` (ARGENOVA XXI excluded by design; ARGOSGEORGIA sank July 2024).

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `id` | SERIAL PK | 0 | Internal vessel ID |
| `vessel_name` | TEXT UNIQUE | 0 | |
| `flag` | TEXT | 0 | Flag country (full name, e.g. "New Zealand") |
| `ccamlr_member` | TEXT | 0 | Differs from `flag` only for Globalpesca III |
| `gfw_vessel_id` | TEXT UNIQUE | 0 | GFW internal vessel ID |
| `gfw_ssvid` | TEXT | 0 | MMSI (AIS transponder ID) |
| `gfw_imo` | TEXT | ~8 | IMO number; NULL for vessels without IMO |
| `gfw_callsign` | TEXT | ~5 | Radio callsign |
| `gfw_flag` | TEXT | 0 | ISO3 flag code from GFW |
| `gfw_geartypes` | TEXT[] | 0 | e.g. `{"SET_LONGLINES"}` |
| `gfw_ais_from` | TIMESTAMPTZ | 0 | Earliest AIS record in GFW |
| `gfw_ais_to` | TIMESTAMPTZ | 0 | Latest AIS record in GFW |
| `gfw_match_confidence` | TEXT | 0 | `exact` \| `name_and_flag` \| `name_only` \| `multiple_candidates` \| `not_found` |
| `eleginoides_authorized` | BOOLEAN | 0 | Authorized for *D. eleginoides* |
| `mawsoni_authorized` | BOOLEAN | 0 | Authorized for *D. mawsoni* |
| `tracked` | BOOLEAN | 0 | **Include in supply intelligence stats.** Default `TRUE`. Set `FALSE` to exclude a vessel without deleting it. Never overwritten by backfill re-seed — manual changes persist. |
| `created_at` | TIMESTAMPTZ | 0 | |
| `updated_at` | TIMESTAMPTZ | 0 | |

---

## vessel_aliases

Prior name/flag identities for a vessel that renamed and/or reflagged mid-life while remaining the same physical hull (GFW links these as separate vessel identity records sharing one IMO). One row per prior identity segment; the "current" identity lives on `vessels` itself. **1 row currently** — vessel 376 ("Kristrun", Iceland) was previously "Argos Froyanes" (Saint Helena flag) until a 2022 rename/reflag. Not to be confused with the *current, separate* vessel also named "Argos Froyanes" (id 377, UK flag, matched by GFW independently) — same name, different hull.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `vessel_id` | INTEGER FK → vessels (ON DELETE CASCADE) | |
| `alias_name` | TEXT NOT NULL | Prior vessel name |
| `gfw_vessel_id` | TEXT | GFW vessel ID for this identity segment (differs from `vessels.gfw_vessel_id`) |
| `flag` | TEXT | ISO3 flag during this period |
| `ssvid` | TEXT | MMSI during this period |
| `active_from` | DATE | |
| `active_to` | DATE | NULL if this was the identity immediately before the current one |
| `note` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

**Index:** `(vessel_id)`

`GET /api/vessels` returns each vessel's aliases as a JSON array (`aliases: [{name, flag, active_from, active_to}, ...]`), consumed by the "Aliases" column in the Vessel Tracker frontend.

---

## vessel_authorizations

CCAMLR authorization periods per vessel. **45 total rows.** Fully populated — no NULLs.

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `id` | SERIAL PK | 0 | |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `period_from` | DATE | 0 | Season start |
| `period_to` | DATE | 0 | Season end |
| `areas` | TEXT[] | 0 | CCAMLR subareas e.g. `{"48.3","48.4"}` |
| `target_species` | TEXT[] | 0 | e.g. `{"Dissostichus eleginoides"}` |

---

## fishing_events

GFW apparent fishing activity detections. Source: GFW API v3 events endpoint. **84,530 total rows.**

### How fishing events are detected

Vessels **do not broadcast that they are fishing**. AIS transponders only transmit: position (lat/lon), speed, heading, and vessel identity — continuously, ~every few seconds to minutes.

GFW receives 110M+ AIS messages per day and runs a **convolutional neural network (CNN)** trained on manually labelled vessel tracks to classify each AIS position as "apparently fishing" or "not fishing". The model uses **18 features**: average speed, change in velocity, and change in heading — each measured across 6 time windows (30 min, 1 hr, 3 hr, 6 hr, 12 hr, 24 hr).

For longline vessels like these, the fishing signature is a **slow, back-and-forth movement pattern** (setting and hauling gear) vs. the faster, straighter track of transiting. A single `fishing_event` row represents one **continuous period** of apparent fishing behavior — when the pattern starts and stops, GFW records a start_time, end_time, and centroid.

> **"Apparent" caveat**: GFW does not have direct catch data. A fishing event means the vessel's movement looked like fishing, not that fish were actually caught. Short events (< 1hr) may be noise.

Source: [Teaching Machines to Tell Us About Fishing — GFW](https://globalfishingwatch.org/data/teaching-machines-to-tell-us-about-fishing/) · [Datasets & Code: Fishing Effort — GFW](https://globalfishingwatch.org/dataset-and-code-fishing-effort/)

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | |
| `end_time` | TIMESTAMPTZ | 0 | |
| `duration_hours` | DOUBLE PRECISION | 0 | |
| `lat` | DOUBLE PRECISION | 0 | Centroid of fishing activity |
| `lon` | DOUBLE PRECISION | 0 | |
| `fao_areas` | TEXT[] | 0 | e.g. `{"48","48.3"}` — major area and subarea |
| `rfmo_areas` | TEXT[] | **135** | e.g. `{"CCAMLR"}`; NULL for ~0.2% of records |
| `eez_areas` | TEXT[] | **48,543** | NULL for ~57% of records — high-seas fishing has no EEZ; fix: populate from lat/lon |
| `high_seas` | TEXT[] | **35,942** | NULL for ~42% of records — meaning unclear; fix: investigate GFW payload |
| `auth_status` | TEXT | 0 | `publicly_authorized` \| `not_matching_relevant_public_authorization` |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, GIN on `fao_areas`, GIN on `rfmo_areas`

---

## port_visits

Port calls derived from GFW **loitering events** (`nextPort` field). The dedicated GFW port-visits datasets are deprecated (404). **595 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW `portVisitEventId` from loitering event |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | Loitering event end time ≈ vessel heading to port (approximate) |
| `end_time` | TIMESTAMPTZ | **595 (ALL)** | Not available from loitering source — we never know when vessel left port |
| `duration_hours` | DOUBLE PRECISION | **595 (ALL)** | Not available — derived from end_time which is NULL |
| `lat` | DOUBLE PRECISION | **595 (ALL)** | Port coordinates not retrieved from GFW. **Partial fix shipped**: `api/main.py` (`get_port_visits`) resolves `port_lat`/`port_lon` at request time from a static `PORT_COORDS` gazetteer keyed by `port_id`, covering every named port seen in `port_visits`/`carrier_port_visits`. The DB columns themselves remain NULL — this is an API-response enrichment, not a stored value. A handful of GFW's anonymous numeric-code anchorages (e.g. `chl-chl-44`, `isl-isl-57`) have no real-world location and are deliberately left unresolved. |
| `lon` | DOUBLE PRECISION | **595 (ALL)** | See `lat` |
| `port_name` | TEXT | 0 | |
| `port_id` | TEXT | 0 | GFW port ID e.g. `"mus-portlouis"` |
| `port_flag` | TEXT | 0 | ISO3 country of port (e.g. `NZL`) |
| `confidence` | INTEGER | 0 | Stored as 2 (GFW default) |
| `raw` | JSONB | 0 | Stored as `{}` — raw loitering event not kept |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, `port_flag`

---

## carrier_vessels

Reefer/carrier vessels that our tracked fishing fleet has met at sea (`encounters.encounter_type = 'fishing-carrier'`). Populated opportunistically — a carrier is added here the first time it shows up as the *other* vessel in one of our fishing vessels' encounters, then backfilled independently for its own port-call history. **16 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `id` | SERIAL PK | 0 | Internal carrier ID |
| `gfw_vessel_id` | TEXT UNIQUE NOT NULL | 0 | GFW internal vessel ID |
| `vessel_name` | TEXT NOT NULL | 0 | |
| `flag` | TEXT | 0 | ISO3 |
| `gfw_ssvid` | TEXT | 0 | MMSI |
| `gfw_imo` | TEXT | **16 (ALL)** | Not populated for any carrier yet |
| `gfw_callsign` | TEXT | **16 (ALL)** | Not populated for any carrier yet |
| `first_encountered` | TIMESTAMPTZ | 0 | First time this carrier met one of our tracked vessels |
| `last_encountered` | TIMESTAMPTZ | 0 | Most recent such meeting |
| `created_at` | TIMESTAMPTZ | 0 | |
| `updated_at` | TIMESTAMPTZ | 0 | |

---

## carrier_port_visits

Same loitering→`nextPort` derivation as `port_visits`, but for carrier vessels — used to answer "which port did the carrier likely offload the transshipped catch at afterwards." **349 total rows across 58 distinct ports.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW `portVisitEventId` |
| `carrier_id` | INTEGER FK → carrier_vessels (ON DELETE CASCADE) | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | Loitering event end time ≈ port arrival (approximate) |
| `port_name` | TEXT | 0 | |
| `port_id` | TEXT | 0 | GFW port ID |
| `port_flag` | TEXT | 0 | ISO3 |
| `confidence` | INTEGER | 0 | Stored as 2 |
| `raw` | JSONB | 0 | Stored as `{}` |
| `ingested_at` | TIMESTAMPTZ | 0 | |

Unlike `port_visits`, this table has **no lat/lon columns at all** (never added). `GET /api/transshipment-offloads` resolves each row's location from the same `PORT_COORDS` gazetteer as above, joining `encounters` → `carrier_vessels` (via `gfw_vessel_id`) → this table's next chronological row after the encounter.

**Indexes:** `start_time DESC`, `(carrier_id, start_time DESC)`

---

## carrier_backfill_log

Same shape and purpose as `backfill_log`, for the carrier backfill pass. **80 total rows, 100% success.**

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `carrier_id` | INTEGER FK → carrier_vessels | |
| `event_type` | TEXT | Only `port_visit` is fetched for carriers — they don't fish |
| `period_from` / `period_to` | DATE | |
| `events_fetched` | INTEGER | |
| `status` | TEXT | |
| `error_msg` | TEXT | NULL for all 80 rows |
| `fetched_at` | TIMESTAMPTZ | |

**Index:** `(carrier_id, event_type, period_from)`

---

## encounters

GFW vessel-to-vessel encounter events (potential transhipment at sea). **615 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | 0 | The CCAMLR vessel |
| `start_time` | TIMESTAMPTZ | 0 | |
| `end_time` | TIMESTAMPTZ | 0 | |
| `duration_hours` | DOUBLE PRECISION | 0 | |
| `lat` | DOUBLE PRECISION | 0 | |
| `lon` | DOUBLE PRECISION | 0 | |
| `fao_areas` | TEXT[] | 0 | |
| `rfmo_areas` | TEXT[] | **1** | NULL for 1 record (0.2%) |
| `encountered_vessel_id` | TEXT | 0 | GFW vessel ID of the other vessel |
| `encountered_vessel_name` | TEXT | 0 | |
| `encountered_vessel_flag` | TEXT | 0 | ISO3 |
| `encounter_type` | TEXT | 0 | `fishing-fishing` (543) \| `fishing-bunker` (40) \| `fishing-carrier` (32) — only the last is a real transshipment risk (`fishing-carrier` rows feed `carrier_vessels`/the offload-tracking feature) |
| `median_distance_km` | DOUBLE PRECISION | 0 | |
| `median_speed_knots` | DOUBLE PRECISION | 0 | |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`

---

## ais_gaps

AIS signal loss events — periods where the vessel "went dark". Potential indicator of IUU behavior. **285 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | When AIS signal was lost |
| `end_time` | TIMESTAMPTZ | 0 | When signal resumed (all gaps in DB have ended) |
| `gap_hours` | DOUBLE PRECISION | 0 | |
| `lat_off` | DOUBLE PRECISION | **285 (ALL)** | Position when AIS switched off — not populated by GFW; fix: extract from `raw` JSONB |
| `lon_off` | DOUBLE PRECISION | **285 (ALL)** | Not populated; fix: extract from `raw` JSONB |
| `lat_on` | DOUBLE PRECISION | **285 (ALL)** | Position when AIS resumed — not populated; fix: extract from `raw` JSONB |
| `lon_on` | DOUBLE PRECISION | **285 (ALL)** | Not populated; fix: extract from `raw` JSONB |
| `distance_km` | DOUBLE PRECISION | 0 | Distance traveled while dark |
| `implied_speed_knots` | DOUBLE PRECISION | 0 | |
| `fao_areas` | TEXT[] | 0 | |
| `rfmo_areas` | TEXT[] | 0 | |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `gap_hours DESC`

---

## backfill_log

Tracks what has been fetched from GFW so the backfill script can resume safely without re-fetching. **1,188 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `id` | SERIAL PK | 0 | |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `event_type` | TEXT | 0 | `fishing` \| `port_visit` \| `encounter` \| `ais_gap` |
| `period_from` | DATE | 0 | |
| `period_to` | DATE | 0 | |
| `events_fetched` | INTEGER | 0 | Count of events returned by GFW for this window |
| `status` | TEXT | 0 | `success` \| `error` |
| `error_msg` | TEXT | **1,188 (ALL)** | NULL when status = success; only populated on error (all 1,188 rows succeeded) |
| `fetched_at` | TIMESTAMPTZ | 0 | |

**Index:** `(vessel_id, event_type, period_from)`

---

## Entity Relationships

```
vessels (1) ──< vessel_aliases (many)
vessels (1) ──< vessel_authorizations (many)
vessels (1) ──< fishing_events (many)
vessels (1) ──< port_visits (many)
vessels (1) ──< encounters (many)
vessels (1) ──< ais_gaps (many)
vessels (1) ──< backfill_log (many)

carrier_vessels (1) ──< carrier_port_visits (many)
carrier_vessels (1) ──< carrier_backfill_log (many)

encounters.encountered_vessel_id  ⇢  carrier_vessels.gfw_vessel_id   (text join, not an FK —
                                                                       only resolves for encounter_type='fishing-carrier')
```

---

## Data Quality Summary

| Table | Total Rows | Issues |
|---|---|---|
| vessels | 45 | All 45 matched to GFW. `tracked=FALSE` for ARGENOVA XXI (excluded by design) and ARGOSGEORGIA (sank July 2024). |
| vessel_aliases | 1 | None |
| vessel_authorizations | 45 | None |
| fishing_events | 84,530 | `eez_areas` NULL ~57%, `high_seas` NULL ~42%, `rfmo_areas` NULL ~0.2% |
| port_visits | 595 | `end_time`, `duration_hours` NULL (structural). `lat`/`lon` NULL in the DB but resolved at the API layer via `PORT_COORDS` for known ports. |
| encounters | 615 | `rfmo_areas` NULL for ~1 record. Only 32 rows are `fishing-carrier` (real transshipment risk) vs. 543 `fishing-fishing` / 40 `fishing-bunker`. |
| ais_gaps | 285 | `lat_off`, `lon_off`, `lat_on`, `lon_on` all NULL — fixable by parsing `raw` JSONB |
| backfill_log | 1,188 | `error_msg` NULL for all (expected — all fetches succeeded) |
| carrier_vessels | 16 | `gfw_imo`, `gfw_callsign` NULL for all — not fetched during carrier discovery |
| carrier_port_visits | 349 | No lat/lon columns at all; resolved at the API layer via `PORT_COORDS`, same as `port_visits` |
| carrier_backfill_log | 80 | `error_msg` NULL for all (expected — all fetches succeeded) |
