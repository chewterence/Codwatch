# Global Fishing Watch API v3 — Reference

**Base URL:** `https://gateway.api.globalfishingwatch.org/v3`  
**Auth:** `Authorization: Bearer <token>` on every request  
**Docs:** https://globalfishingwatch.org/our-apis/documentation  
**Tokens:** https://globalfishingwatch.org/our-apis/tokens

---

## Key Concepts

- **Vessel ID**: GFW's internal unique identifier for a vessel (combines AIS history, registries, name, callsign, MMSI). Use this to link vessels across APIs.
- **SSVID**: The MMSI number a vessel broadcasts over AIS.
- **Dataset versioning**: Use `:latest` to always get current data. GFW supports only 2 major versions simultaneously; deprecation = 3 months notice.
- **Species filtering**: GFW does NOT filter by species directly. Proxy via gear type + fishing region + RFMO.

---

## Datasets (Key Identifiers)

| Dataset | ID | Coverage |
|---|---|---|
| Vessel identity | `public-global-vessel-identity:latest` | 2012 – present |
| Fishing events | `public-global-fishing-events:latest` | 2012 – 96 hrs ago |
| Fishing effort (4wings) | `public-global-fishing-effort:latest` | 2012 – 96 hrs ago |
| SAR vessel detections | `public-global-sar-presence:latest` | 2017 – 5 days ago |
| Vessel presence | `public-global-presence:latest` | 2012 – 96 hrs ago |

---

## Endpoints

### Vessels

#### Search
```
GET /vessels/search
```
| Param | Required | Notes |
|---|---|---|
| `query` | Yes | Name, MMSI, IMO, or callsign |
| `datasets[0]` | Yes | `public-global-vessel-identity:latest` |
| `limit` | No | Default 20 |
| `offset` | No | Pagination |

**Response fields of note:**
- `registryInfo[].flag` — ISO3 flag state
- `registryInfo[].geartypes` — e.g. `FISHING`, `LONGLINE`
- `selfReportedInfo[].ssvid` — MMSI
- `combinedSourcesInfo[].geartypes[].name` — ML-inferred gear type

#### Get by IDs
```
GET /vessels?ids=ID1,ID2&datasets[0]=public-global-vessel-identity:latest
```

#### Get single vessel
```
GET /vessels/{vesselId}?datasets[0]=public-global-vessel-identity:latest
```

---

### Events

#### List events
```
GET /events
```
| Param | Required | Notes |
|---|---|---|
| `datasets[0]` | Yes | `public-global-fishing-events:latest` |
| `start-date` | Yes | `YYYY-MM-DD` |
| `end-date` | Yes | `YYYY-MM-DD` (max 366 days per request) |
| `vessels[0]` | No | Filter by GFW vessel ID |
| `event-type` | No | **NOT supported on GET** — use POST body or filter results in Python |
| `limit` | No | Default 30 |
| `offset` | No | Pagination; use `nextOffset` from response |

**Response fields of note:**
- `entries[].type` — event type
- `entries[].start` / `end` — ISO 8601
- `entries[].position.lat` / `.lon`
- `entries[].regions.rfmo` — e.g. `["CCAMLR"]` ← key for Patagonian toothfish
- `entries[].regions.eez` — EEZ IDs
- `entries[].regions.highSeas` — high seas polygon IDs
- `entries[].regions.fao` — FAO area codes (e.g. `"48"` = Atlantic Antarctic)
- `entries[].vessel.flag`, `.name`, `.ssvid`, `.id`
- `entries[].fishing.vesselPublicAuthorizationStatus` — `publicly_authorized` | `not_matching_relevant_public_authorization`

#### Get single event
```
GET /events/{eventId}?datasets[0]=public-global-fishing-events:latest
```

#### Event statistics
```
POST /events/stats
```

---

### 4Wings (Fishing Effort / Heatmaps)

#### Report (aggregate fishing hours by region)
```
POST /4wings/report
GET  /4wings/report?region-id=...&region-dataset=...
```
| Param | Required | Notes |
|---|---|---|
| `datasets[0]` | Yes | e.g. `public-global-fishing-effort:latest` |
| `format` | Yes | `CSV`, `JSON`, or `TIF` |
| `temporal-resolution` | Yes | `HOURLY`, `DAILY`, `MONTHLY`, `YEARLY`, `ENTIRE` |
| `date-range` | No | `YYYY-MM-DD,YYYY-MM-DD` (max 366 days) |
| `spatial-resolution` | No | `LOW` (0.1°) or `HIGH` (0.01°) |
| `group-by` | No | `VESSEL_ID`, `FLAG`, `GEARTYPE`, `FLAGANDGEARTYPE`, `MMSI`, `VESSEL_TYPE` |
| `filters[0]` | No | SQL-like filter string (see below) |

**POST body:** `{ "geojson": <GeoJSON polygon> }`

**Check report status:**
```
GET /4wings/last-report
```
Returns `running` | `finished` | `error`. Reports expire after 30 minutes. Timeout = 524 (>100 sec).

#### Statistics (global)
```
GET /4wings/stats?datasets[0]=...&date-range=...&filters[0]=...
```

---

### Insights (per vessel)
```
GET /vessels/{vesselId}/insights?datasets[0]=public-global-vessel-identity:latest
```
Returns aggregated activity, authorization status, and IUU risk indicators.

---

### Bulk Download
```
POST /bulk-download/report      # create report
GET  /bulk-download/report/{id} # check status
GET  /bulk-download/report/{id}/download?type=DATA|README|GEOM
GET  /bulk-download/report/{id}/data?sort=...&limit=...
GET  /bulk-download/reports     # list all user reports
```

---

## Filters (SQL-like strings)

Used with `filters[0]=` on 4Wings and bulk download endpoints.

```
# By flag
flag in ('CHN', 'ESP', 'RUS')

# By gear type
geartype in ('trawlers', 'longlines', 'squid_jigger')

# By vessel type
vessel_type = 'fishing'

# By vessel ID
vessel_id = 'abc123'

# SAR-specific
matched='true'
neural_vessel_type in ('Likely Fishing')
```

---

## Gear Types

Relevant to Patagonian toothfish / cod monitoring:

| Gear type string | Description |
|---|---|
| `trawlers` | Bottom/midwater trawl — main cod gear |
| `longlines` | Main Patagonian toothfish gear |
| `squid_jigger` | Squid/jigging vessels |
| `set_gillnets` | Gillnets |
| `driftnets` | Drift gillnets |
| `tuna_purse_seines` | Purse seine tuna |
| `pole_and_line` | Pole & line |
| `pots_and_traps` | Pot/trap fishing |

---

## RFMO & Region Codes (for Patagonian Toothfish)

| RFMO | Waters | Relevance |
|---|---|---|
| `CCAMLR` | Southern Ocean / Antarctic | **Primary** for Patagonian toothfish |
| `SEAFO` | SE Atlantic | Secondary |
| `NEAFC` | NE Atlantic | Cod / deepwater |
| `NAFO` | NW Atlantic | Cod |
| `ICES` | N Atlantic / Baltic | Cod science body |

| FAO Area | Region |
|---|---|
| `48` | Atlantic Antarctic — Patagonian toothfish core |
| `58` | Indian Ocean Antarctic — Patagonian toothfish |
| `88` | Pacific Antarctic — Patagonian toothfish |
| `21` | NW Atlantic — Atlantic cod |
| `27` | NE Atlantic — Atlantic cod |
| `67` | Pacific NE — Pacific cod |

---

## Error Codes

| Code | Meaning |
|---|---|
| 401 | Missing or invalid auth token |
| 403 | Access forbidden |
| 404 | Resource not found |
| 422 | Invalid parameters |
| 429 | Rate limit — only 1 concurrent report per token |
| 524 | Gateway timeout — report >100 sec; poll `/4wings/last-report` |

---

## Pagination Pattern

```python
all_entries = []
offset = 0
limit = 100
while True:
    resp = requests.get(url, params={**params, "limit": limit, "offset": offset})
    data = resp.json()
    all_entries.extend(data["entries"])
    if data.get("nextOffset") is None or len(all_entries) >= data["total"]:
        break
    offset = data["nextOffset"]
```

---

## Strategy: Monitoring Patagonian Toothfish Vessels

GFW has no species field. Use this proxy approach:

1. **Find vessels**: Search events in FAO areas `48`, `58`, `88` (CCAMLR waters) with `event-type=FISHING`
2. **Filter gear**: Patagonian toothfish = `longlines`. Exclude squid jiggers, purse seines.
3. **Check authorization**: `fishing.vesselPublicAuthorizationStatus` — flag vessels without CCAMLR authorization as potential IUU risk.
4. **Cross-check RFMO**: `regions.rfmo` should include `CCAMLR` for legitimate activity.
5. **AIS gaps**: Use `event-type=AIS_OFF` to detect potential dark vessel behavior.
6. **Port visits**: `event-type=PORT_VISIT` to track where catch is landed.

Key flags to watch: CHN, RUS, ESP, KOR, GBR (via South Georgia) are major toothfish fishing nations.

---

## Strategy: Finding Cod Vessels

Cod is not a direct filter. Use:
- Gear: `trawlers` (bottom trawl — dominant cod gear)
- FAO areas: `21` (NW Atlantic), `27` (NE Atlantic), `67` (Pacific NE)
- RFMOs: `NAFO`, `NEAFC`, `ICES`
- Flags: NOR, ISL, RUS, CAN, GBR, FRO for Atlantic cod

---

## Rate Limits Summary

- **Concurrent reports**: 1 per token (429 if exceeded)
- **Date range**: Max 366 days per request
- **Report retention**: 30 min
- **GET caching**: Gateway caches identical GET requests
- **No published RPS limit** — if you hit it, you get a 429
