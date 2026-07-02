# Codwatch — Database Schema

**Database:** PostgreSQL · **Purpose:** Vessel monitoring for *Dissostichus eleginoides* (Patagonian toothfish)

> **CCAMLR season:** Dec 1 → Nov 30 (e.g. "2025 season" = 2025-12-01 to 2026-11-30)
> **GFW data lag:** ~96 hours · **GFW query max:** 366 days per request

---

## vessels

One row per tracked vessel. **40 total; 40 matched to GFW** (5 previously unmatched now fixed).

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

GFW apparent fishing activity detections. Source: GFW API v3 events endpoint. **40,185 total rows.**

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
| `rfmo_areas` | TEXT[] | **73** | e.g. `{"CCAMLR"}`; NULL for ~0.2% of records |
| `eez_areas` | TEXT[] | **26,937** | NULL for ~67% of records — high-seas fishing has no EEZ; fix: populate from lat/lon |
| `high_seas` | TEXT[] | **13,251** | NULL for ~33% of records — meaning unclear; fix: investigate GFW payload |
| `auth_status` | TEXT | 0 | `publicly_authorized` \| `not_matching_relevant_public_authorization` |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, GIN on `fao_areas`, GIN on `rfmo_areas`

---

## port_visits

Port calls derived from GFW **loitering events** (`nextPort` field). The dedicated GFW port-visits datasets are deprecated (404). **261 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW `portVisitEventId` from loitering event |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | Loitering event end time ≈ vessel heading to port (approximate) |
| `end_time` | TIMESTAMPTZ | **261 (ALL)** | Not available from loitering source — we never know when vessel left port |
| `duration_hours` | DOUBLE PRECISION | **261 (ALL)** | Not available — derived from end_time which is NULL |
| `lat` | DOUBLE PRECISION | **261 (ALL)** | Port coordinates not retrieved from GFW; fix: join to a port reference table |
| `lon` | DOUBLE PRECISION | **261 (ALL)** | Port coordinates not retrieved from GFW; fix: join to a port reference table |
| `port_name` | TEXT | 0 | |
| `port_id` | TEXT | 0 | GFW port ID e.g. `"mus-portlouis"` |
| `port_flag` | TEXT | 0 | ISO3 country of port (e.g. `NZL`) |
| `confidence` | INTEGER | 0 | Stored as 2 (GFW default) |
| `raw` | JSONB | 0 | Stored as `{}` — raw loitering event not kept |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, `port_flag`

---

## encounters

GFW vessel-to-vessel encounter events (potential transhipment at sea). **440 total rows.**

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
| `encounter_type` | TEXT | 0 | `CARRIER_FISHING` \| `FISHING_SUPPORT` \| etc. |
| `median_distance_km` | DOUBLE PRECISION | 0 | |
| `median_speed_knots` | DOUBLE PRECISION | 0 | |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`

---

## ais_gaps

AIS signal loss events — periods where the vessel "went dark". Potential indicator of IUU behavior. **147 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `event_id` | TEXT PK | 0 | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `start_time` | TIMESTAMPTZ | 0 | When AIS signal was lost |
| `end_time` | TIMESTAMPTZ | 0 | When signal resumed (all gaps in DB have ended) |
| `gap_hours` | DOUBLE PRECISION | 0 | |
| `lat_off` | DOUBLE PRECISION | **147 (ALL)** | Position when AIS switched off — not populated by GFW; fix: extract from `raw` JSONB |
| `lon_off` | DOUBLE PRECISION | **147 (ALL)** | Not populated; fix: extract from `raw` JSONB |
| `lat_on` | DOUBLE PRECISION | **147 (ALL)** | Position when AIS resumed — not populated; fix: extract from `raw` JSONB |
| `lon_on` | DOUBLE PRECISION | **147 (ALL)** | Not populated; fix: extract from `raw` JSONB |
| `distance_km` | DOUBLE PRECISION | 0 | Distance traveled while dark |
| `implied_speed_knots` | DOUBLE PRECISION | 0 | |
| `fao_areas` | TEXT[] | 0 | |
| `rfmo_areas` | TEXT[] | 0 | |
| `raw` | JSONB | 0 | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | 0 | |

**Indexes:** `(vessel_id, start_time DESC)`, `gap_hours DESC`

---

## backfill_log

Tracks what has been fetched from GFW so the backfill script can resume safely without re-fetching. **540 total rows.**

| Column | Type | NULL count | Notes |
|---|---|---|---|
| `id` | SERIAL PK | 0 | |
| `vessel_id` | INTEGER FK → vessels | 0 | |
| `event_type` | TEXT | 0 | `fishing` \| `port_visit` \| `encounter` \| `ais_gap` |
| `period_from` | DATE | 0 | |
| `period_to` | DATE | 0 | |
| `events_fetched` | INTEGER | 0 | Count of events returned by GFW for this window |
| `status` | TEXT | 0 | `success` \| `error` |
| `error_msg` | TEXT | **540 (ALL)** | NULL when status = success; only populated on error (all 540 rows succeeded) |
| `fetched_at` | TIMESTAMPTZ | 0 | |

**Index:** `(vessel_id, event_type, period_from)`

---

## Entity Relationships

```
vessels (1) ──< vessel_authorizations (many)
vessels (1) ──< fishing_events (many)
vessels (1) ──< port_visits (many)
vessels (1) ──< encounters (many)
vessels (1) ──< ais_gaps (many)
vessels (1) ──< backfill_log (many)
```

---

## Data Quality Summary

| Table | Total Rows | Issues |
|---|---|---|
| vessels | 40 | All 40 matched to GFW. 8 new vessels added (5 Chilean/French CCAMLR-authorized + 3 others). `tracked=TRUE` for all by default. |
| vessel_authorizations | 45 | None |
| fishing_events | 40,185 | `eez_areas` NULL 67%, `high_seas` NULL 33%, `rfmo_areas` NULL 0.2% |
| port_visits | 261 | `end_time`, `duration_hours`, `lat`, `lon` all NULL (structural — not fixable from current source) |
| encounters | 440 | `rfmo_areas` NULL for 1 record |
| ais_gaps | 147 | `lat_off`, `lon_off`, `lat_on`, `lon_on` all NULL — fixable by parsing `raw` JSONB |
| backfill_log | 540 | `error_msg` NULL for all (expected — all fetches succeeded) |
