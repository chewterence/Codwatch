# Codwatch — Database Schema

**Database:** PostgreSQL · **Purpose:** Vessel monitoring for *Dissostichus eleginoides* (Patagonian toothfish)

> **CCAMLR season:** Dec 1 → Nov 30 (e.g. "2025 season" = 2025-12-01 to 2026-11-30)
> **GFW data lag:** ~96 hours · **GFW query max:** 366 days per request

---

## vessels

One row per CCAMLR-authorized vessel. 32 total; 27 have a GFW vessel ID.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | Internal vessel ID |
| `vessel_name` | TEXT UNIQUE | |
| `flag` | TEXT | CCAMLR flag country (full name, e.g. "New Zealand") |
| `ccamlr_member` | TEXT | Differs from `flag` only for Globalpesca III |
| `gfw_vessel_id` | TEXT UNIQUE | NULL for 5 unmatched vessels |
| `gfw_ssvid` | TEXT | MMSI (AIS transponder ID) |
| `gfw_imo` | TEXT | IMO number |
| `gfw_callsign` | TEXT | |
| `gfw_flag` | TEXT | ISO3 flag code from GFW |
| `gfw_geartypes` | TEXT[] | e.g. `{"SET_LONGLINES"}` |
| `gfw_ais_from` | TIMESTAMPTZ | Earliest AIS record in GFW |
| `gfw_ais_to` | TIMESTAMPTZ | Latest AIS record in GFW |
| `gfw_match_confidence` | TEXT | `exact` \| `name_and_flag` \| `name_only` \| `multiple_candidates` \| `not_found` |
| `eleginoides_authorized` | BOOLEAN | Authorized for *D. eleginoides* |
| `mawsoni_authorized` | BOOLEAN | Authorized for *D. mawsoni* |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## vessel_authorizations

CCAMLR authorization periods per vessel. Many rows per vessel.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `vessel_id` | INTEGER FK → vessels | |
| `period_from` | DATE | Season start |
| `period_to` | DATE | Season end |
| `areas` | TEXT[] | CCAMLR subareas e.g. `{"48.3","48.4"}` |
| `target_species` | TEXT[] | e.g. `{"Dissostichus eleginoides"}` |

---

## fishing_events

GFW fishing activity detections. Source: GFW API v3 events endpoint.

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT PK | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | |
| `start_time` | TIMESTAMPTZ | |
| `end_time` | TIMESTAMPTZ | |
| `duration_hours` | DOUBLE PRECISION | |
| `lat` | DOUBLE PRECISION | Centroid of fishing activity |
| `lon` | DOUBLE PRECISION | |
| `fao_areas` | TEXT[] | e.g. `{"48","48.3"}` — major area and subarea |
| `rfmo_areas` | TEXT[] | e.g. `{"CCAMLR"}` |
| `eez_areas` | TEXT[] | |
| `high_seas` | TEXT[] | |
| `auth_status` | TEXT | `publicly_authorized` \| `not_matching_relevant_public_authorization` |
| `raw` | JSONB | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, GIN on `fao_areas`, GIN on `rfmo_areas`

---

## port_visits

Port calls derived from GFW **loitering events** (`nextPort` field). The dedicated GFW port-visits datasets are deprecated (404). One row per unique `portVisitEventId`.

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT PK | GFW `portVisitEventId` from loitering event |
| `vessel_id` | INTEGER FK → vessels | |
| `start_time` | TIMESTAMPTZ | Loitering event end time ≈ vessel heading to port (approximate) |
| `end_time` | TIMESTAMPTZ | NULL — not available from loitering source |
| `duration_hours` | DOUBLE PRECISION | NULL — not available |
| `lat` | DOUBLE PRECISION | NULL — port coordinates not retrieved |
| `lon` | DOUBLE PRECISION | NULL — port coordinates not retrieved |
| `port_name` | TEXT | |
| `port_id` | TEXT | GFW port ID e.g. `"mus-portlouis"` |
| `port_flag` | TEXT | ISO3 country of port (e.g. `NZL`) |
| `confidence` | INTEGER | Stored as 2 (GFW default) |
| `raw` | JSONB | Stored as `{}` — raw loitering event not kept |
| `ingested_at` | TIMESTAMPTZ | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`, `port_flag`

---

## encounters

GFW vessel-to-vessel encounter events (potential transhipment at sea).

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT PK | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | The CCAMLR vessel |
| `start_time` | TIMESTAMPTZ | |
| `end_time` | TIMESTAMPTZ | |
| `duration_hours` | DOUBLE PRECISION | |
| `lat` | DOUBLE PRECISION | |
| `lon` | DOUBLE PRECISION | |
| `fao_areas` | TEXT[] | |
| `rfmo_areas` | TEXT[] | |
| `encountered_vessel_id` | TEXT | GFW vessel ID of the other vessel |
| `encountered_vessel_name` | TEXT | |
| `encountered_vessel_flag` | TEXT | ISO3 |
| `encounter_type` | TEXT | `CARRIER_FISHING` \| `FISHING_SUPPORT` \| etc. |
| `median_distance_km` | DOUBLE PRECISION | |
| `median_speed_knots` | DOUBLE PRECISION | |
| `raw` | JSONB | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | |

**Indexes:** `(vessel_id, start_time DESC)`, `start_time DESC`

---

## ais_gaps

AIS signal loss events — periods where the vessel "went dark". Potential indicator of IUU behavior.

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT PK | GFW event ID |
| `vessel_id` | INTEGER FK → vessels | |
| `start_time` | TIMESTAMPTZ | When AIS signal was lost |
| `end_time` | TIMESTAMPTZ | When signal resumed (NULL if ongoing) |
| `gap_hours` | DOUBLE PRECISION | |
| `lat_off` | DOUBLE PRECISION | Position when AIS switched off |
| `lon_off` | DOUBLE PRECISION | |
| `lat_on` | DOUBLE PRECISION | Position when AIS resumed |
| `lon_on` | DOUBLE PRECISION | |
| `distance_km` | DOUBLE PRECISION | Distance traveled while dark |
| `implied_speed_knots` | DOUBLE PRECISION | |
| `fao_areas` | TEXT[] | |
| `rfmo_areas` | TEXT[] | |
| `raw` | JSONB | Full GFW event payload |
| `ingested_at` | TIMESTAMPTZ | |

**Indexes:** `(vessel_id, start_time DESC)`, `gap_hours DESC`

---

## backfill_log

Tracks what has been fetched from GFW so the backfill script can resume safely without re-fetching.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `vessel_id` | INTEGER FK → vessels | NULL = fleet-wide fetch |
| `event_type` | TEXT | `fishing` \| `port_visit` \| `encounter` \| `ais_gap` |
| `period_from` | DATE | |
| `period_to` | DATE | |
| `events_fetched` | INTEGER | Count of events returned by GFW for this window |
| `status` | TEXT | `success` \| `error` |
| `error_msg` | TEXT | Set on error |
| `fetched_at` | TIMESTAMPTZ | |

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
