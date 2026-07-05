"""
Codwatch API — FastAPI backend
Serves vessel monitoring data from the codwatch PostgreSQL database.

Run:
    cd /Users/terence/Desktop/Codwatch
    uvicorn api.main:app --reload --port 8000
"""

import datetime
import os
from collections import defaultdict

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/codwatch")

app = FastAPI(title="Codwatch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def query(sql: str, params=None):
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            rows = cur.fetchall()
            return [_serialize(dict(r)) for r in rows]
    finally:
        conn.close()


def _serialize(obj):
    """Recursively convert non-JSON-serializable types."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    return obj


def _timeframe_conditions(column, days, start_date, end_date, params):
    """Shared timeframe filter: a custom start/end date range takes precedence
    over the relative "last N days" preset — mirrors the frontend's rule in
    timeframe.js (applyTimeframeParams)."""
    conditions = []

    if start_date or end_date:
        if start_date:
            conditions.append(f"{column} >= %s::date")
            params.append(start_date)
        if end_date:
            conditions.append(f"{column} < (%s::date + interval '1 day')")
            params.append(end_date)
    elif days:
        conditions.append(f"{column} >= NOW() - (%s || ' days')::interval")
        params.append(days)

    return conditions


# ── Summary ──────────────────────────────────────────────────────────────────

@app.get("/api/summary")
def get_summary():
    rows = query("""
        SELECT
            (SELECT COUNT(*) FROM vessels)                          AS total_vessels,
            (SELECT COUNT(*) FROM vessels WHERE gfw_vessel_id IS NOT NULL) AS tracked_vessels,
            (SELECT COUNT(*) FROM fishing_events)                   AS total_fishing_events,
            (SELECT COUNT(*) FROM port_visits)                      AS total_port_visits,
            (SELECT COUNT(*) FROM encounters)                       AS total_encounters,
            (SELECT COUNT(*) FROM ais_gaps)                         AS total_ais_gaps,
            (SELECT MAX(start_time)::date FROM fishing_events)      AS last_event_date,
            LEAST(
                (SELECT MIN(start_time) FROM fishing_events),
                (SELECT MIN(start_time) FROM port_visits),
                (SELECT MIN(start_time) FROM encounters),
                (SELECT MIN(start_time) FROM ais_gaps)
            )::date                                                 AS first_event_date
    """)
    return rows[0]


# ── Vessels ───────────────────────────────────────────────────────────────────

@app.get("/api/vessels")
def get_vessels():
    # Pre-aggregate each event table separately before joining to avoid the
    # cartesian explosion that COUNT(DISTINCT ...) on triple-joined tables causes.
    return query("""
        SELECT
            v.id,
            v.vessel_name,
            v.flag,
            v.gfw_vessel_id,
            v.gfw_ssvid,
            v.gfw_flag,
            v.gfw_geartypes,
            v.gfw_ais_from,
            v.gfw_ais_to,
            v.gfw_match_confidence,
            v.eleginoides_authorized,
            v.mawsoni_authorized,
            COALESCE(fe.cnt, 0)      AS fishing_event_count,
            fe.last_date             AS last_fishing_date,
            COALESCE(e.cnt, 0)       AS encounter_count,
            COALESCE(ag.cnt, 0)      AS ais_gap_count,
            COALESCE(al.aliases, '[]'::json) AS aliases
        FROM vessels v
        LEFT JOIN (
            SELECT vessel_id, COUNT(*) AS cnt, MAX(start_time)::date AS last_date
            FROM fishing_events GROUP BY vessel_id
        ) fe ON fe.vessel_id = v.id
        LEFT JOIN (
            SELECT vessel_id, COUNT(*) AS cnt FROM encounters GROUP BY vessel_id
        ) e ON e.vessel_id = v.id
        LEFT JOIN (
            SELECT vessel_id, COUNT(*) AS cnt FROM ais_gaps GROUP BY vessel_id
        ) ag ON ag.vessel_id = v.id
        LEFT JOIN (
            SELECT vessel_id, json_agg(json_build_object(
                'name', alias_name,
                'flag', flag,
                'active_from', active_from,
                'active_to', active_to
            ) ORDER BY active_from) AS aliases
            FROM vessel_aliases GROUP BY vessel_id
        ) al ON al.vessel_id = v.id
        ORDER BY fishing_event_count DESC, v.vessel_name
    """)


# ── Fishing Events ────────────────────────────────────────────────────────────

@app.get("/api/fishing-events")
def get_fishing_events(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    limit: int = Query(500, le=5000),
    days: int = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
):
    conditions = ["fe.lat IS NOT NULL", "fe.lon IS NOT NULL"]
    params = []

    if vessel_id:
        conditions.append("fe.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("fe.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    conditions += _timeframe_conditions("fe.start_time", days, start_date, end_date, params)

    where = "WHERE " + " AND ".join(conditions)

    return query(f"""
        SELECT
            fe.event_id,
            v.vessel_name,
            v.flag,
            fe.vessel_id,
            fe.start_time,
            fe.end_time,
            fe.duration_hours,
            fe.lat,
            fe.lon,
            fe.fao_areas,
            fe.rfmo_areas,
            ARRAY_REMOVE(ARRAY[
                CASE WHEN v.eleginoides_authorized THEN 'D. eleginoides' END,
                CASE WHEN v.mawsoni_authorized     THEN 'D. mawsoni'     END
            ], NULL) AS target_species
        FROM fishing_events fe
        JOIN vessels v ON v.id = fe.vessel_id
        {where}
        ORDER BY fe.start_time DESC
        LIMIT %s
    """, params + [limit])


# ── Port Visits ───────────────────────────────────────────────────────────────

@app.get("/api/port-visits")
def get_port_visits(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    days: int = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    limit: int = Query(100, le=2000),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("pv.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("pv.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    conditions += _timeframe_conditions("pv.start_time", days, start_date, end_date, params)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    rows = query(f"""
        SELECT
            pv.event_id,
            v.vessel_name,
            v.flag,
            pv.vessel_id,
            pv.start_time,
            pv.end_time,
            pv.duration_hours,
            pv.lat,
            pv.lon,
            pv.port_name,
            pv.port_id,
            pv.port_flag,
            pv.confidence
        FROM port_visits pv
        JOIN vessels v ON v.id = pv.vessel_id
        {where}
        ORDER BY pv.start_time DESC
        LIMIT %s
    """, params + [limit])

    # port_visits itself never got lat/lon from GFW's loitering-derived data —
    # resolve from the same static port gazetteer used for carrier offloads.
    for r in rows:
        coord = PORT_COORDS.get(r.get("port_id"))
        r["port_lat"] = coord[0] if coord else None
        r["port_lon"] = coord[1] if coord else None

    return rows


# ── Encounters ────────────────────────────────────────────────────────────────

@app.get("/api/encounters")
def get_encounters(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    encounter_type: str = Query(None),
    days: int = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    limit: int = Query(100, le=2000),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("e.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("e.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    if encounter_type:
        conditions.append("e.encounter_type = %s")
        params.append(encounter_type)

    conditions += _timeframe_conditions("e.start_time", days, start_date, end_date, params)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    return query(f"""
        SELECT
            e.event_id,
            v.vessel_name,
            v.flag,
            e.vessel_id,
            e.start_time,
            e.end_time,
            e.duration_hours,
            e.lat,
            e.lon,
            e.fao_areas,
            e.rfmo_areas,
            e.encountered_vessel_name,
            e.encountered_vessel_flag,
            e.encounter_type,
            e.median_distance_km
        FROM encounters e
        JOIN vessels v ON v.id = e.vessel_id
        {where}
        ORDER BY e.start_time DESC
        LIMIT %s
    """, params + [limit])


# ── Port Coordinates ───────────────────────────────────────────────────────────
#
# Neither port_visits nor carrier_port_visits has lat/lon (GFW's loitering→
# nextPort data doesn't include port coordinates — see backfill.py
# store_port_visits / store_carrier_port_visits). This is a static lookup for
# every port that actually appears in either table so they can be plotted.
# A handful of GFW's anonymous numeric-code anchorages (e.g. "chn-chn-2193",
# "isl-isl-57") have no identifiable real-world location and are deliberately
# left unmapped rather than guessed.
PORT_COORDS = {
    "arg-buenosaires":            (-34.603, -58.381),
    "arg-puertodeseado":          (-47.751, -65.897),
    "ata-discoverybay":           (-62.48, -59.68),
    "aus-taroona":                (-42.958, 147.343),
    "bra-riogrande":              (-32.035, -52.099),
    "can-porthardy":              (50.726, -127.421),
    "can-ucluelet":               (48.941, -125.546),
    "chl-coronel":                (-37.033, -73.167),
    "chl-iquique":                (-20.213, -70.152),
    "chl-puertochacabuco":        (-45.472, -72.819),
    "chl-puertowilliams":         (-54.935, -67.606),
    "chl-puntaarenas":            (-53.163, -70.908),
    "chn-changxingdao":           (39.11, 121.87),
    "chn-dalian":                 (38.914, 121.615),
    "chn-lianyungang":            (34.596, 119.178),
    "chn-ningbo":                 (29.868, 121.544),
    "chn-shidao":                 (36.897, 122.437),
    "chn-weihai":                 (37.513, 122.121),
    "chn-zhoushan":               (30.016, 122.107),
    "civ-abidjan":                (5.316, -4.033),
    "cmr-douala":                 (4.049, 9.700),
    "cod-boma":                   (-5.850, 13.050),
    "cpv-mindelo":                (16.890, -24.981),
    "dnk-skagen":                 (57.719, 10.585),
    "esh-dakhla":                 (23.717, -15.933),
    "esp-cangas":                 (42.261, -8.786),
    "esp-laspalmas":              (28.145, -15.431),
    "fji-suva":                   (-18.142, 178.442),
    "flk-berkeleysound":          (-51.533, -58.033),
    "flk-stanley":                (-51.697, -57.851),
    "fro-toftir":                 (62.176, -6.756),
    "gha-tema":                   (5.669, -0.017),
    "isl-akureyri":               (65.684, -18.126),
    "isl-eskifjordur":            (65.075, -13.972),
    "isl-isafjordur":             (66.075, -23.124),
    "isl-neskaupstadur":          (65.150, -13.706),
    "isl-seydisfjordur":          (65.259, -14.007),
    "isl-siglufjordur":           (66.150, -18.908),
    "jpn-ishinomaki":             (38.428, 141.303),
    "kir-tarawa":                 (1.328, 172.978),
    "kor-busan":                  (35.180, 129.075),
    "mar-agadir":                 (30.421, -9.598),
    "mrt-cansado":                (20.906, -17.038),
    "mus-portlouis":              (-20.160, 57.502),
    "mys-pengerang":              (1.372, 104.113),
    "mys-telokramunia":           (1.408, 104.257),
    "nam-walvisbay":              (-22.957, 14.505),
    "nga-bonny":                  (4.442, 7.170),
    "nga-lagos":                  (6.455, 3.394),
    "nzl-bluff":                  (-46.601, 168.336),
    "nzl-dunedin":                (-45.874, 170.503),
    "nzl-nelson":                 (-41.270, 173.284),
    "nzl-portchalmers":           (-45.815, 170.623),
    "nzl-portlyttelton":          (-43.605, 172.720),
    "nzl-timaru":                 (-44.397, 171.254),
    "pan-balboa":                 (8.955, -79.566),
    "pan-manzanillo":             (9.359, -79.883),
    "pan-panamaanchoragepacific": (8.85, -79.55),
    "per-callao":                 (-12.056, -77.118),
    "png-rabaul":                 (-4.199, 152.174),
    "reu-reunion":                (-20.929, 55.293),
    "rus-kurilsk":                (45.230, 147.877),
    "rus-magadan":                (59.568, 150.808),
    "rus-nevelsk":                (46.677, 141.860),
    "rus-oktyabrskiy":            (47.033, 142.933),
    "rus-petropavlovsk":          (53.045, 158.650),
    "rus-prigorodnoyeanchorage":  (46.593, 142.719),
    "rus-saintpetersburg":        (59.934, 30.335),
    "rus-severokurilsk":          (50.678, 156.125),
    "rus-vladivostok":            (43.117, 131.885),
    "rus-yuzhokurilsk":           (44.021, 145.867),
    "sgp-singapore":              (1.290, 103.850),
    "sgs-sgs-1":                  (-54.283, -36.495),
    "sgs-sgs-2":                  (-54.283, -36.495),
    "tgo-lome":                   (6.131, 1.222),
    "tha-bangkok":                (13.756, 100.501),
    "ury-montevideo":             (-34.906, -56.191),
    "ury-recaladaanchorage":      (-35.20, -55.30),
    "usa-akutan":                 (54.143, -165.786),
    "zaf-capetown":               (-33.925, 18.424),
}


@app.get("/api/transshipment-offloads")
def get_transshipment_offloads(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    days: int = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    limit: int = Query(300, le=1000),
):
    """For each fishing<->carrier encounter, find the carrier's next known port
    call afterwards — a best-effort answer to "where did the catch get offloaded".
    """
    conditions = ["e.encounter_type = 'fishing-carrier'"]
    params = []

    if vessel_id:
        conditions.append("e.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("e.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    conditions += _timeframe_conditions("e.start_time", days, start_date, end_date, params)

    where = "WHERE " + " AND ".join(conditions)

    rows = query(f"""
        SELECT
            e.event_id      AS encounter_id,
            e.vessel_id,
            v.vessel_name,
            e.start_time    AS encounter_time,
            e.lat           AS encounter_lat,
            e.lon           AS encounter_lon,
            cv.id           AS carrier_id,
            cv.vessel_name  AS carrier_name,
            cv.flag         AS carrier_flag,
            npv.start_time  AS port_arrival_time,
            npv.port_name,
            npv.port_id,
            npv.port_flag
        FROM encounters e
        JOIN vessels v ON v.id = e.vessel_id
        JOIN carrier_vessels cv ON cv.gfw_vessel_id = e.encountered_vessel_id
        LEFT JOIN LATERAL (
            SELECT cpv.start_time, cpv.port_name, cpv.port_id, cpv.port_flag
            FROM carrier_port_visits cpv
            WHERE cpv.carrier_id = cv.id AND cpv.start_time > e.start_time
            ORDER BY cpv.start_time ASC
            LIMIT 1
        ) npv ON true
        {where}
        ORDER BY e.start_time DESC
        LIMIT %s
    """, params + [limit])

    for r in rows:
        coord = PORT_COORDS.get(r.get("port_id"))
        r["port_lat"] = coord[0] if coord else None
        r["port_lon"] = coord[1] if coord else None

    return rows


# ── AIS Gaps ──────────────────────────────────────────────────────────────────

@app.get("/api/ais-gaps")
def get_ais_gaps(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    min_hours: float = Query(None),
    days: int = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    limit: int = Query(100, le=2000),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("ag.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("ag.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    conditions += _timeframe_conditions("ag.start_time", days, start_date, end_date, params)

    if min_hours:
        conditions.append("ag.gap_hours >= %s")
        params.append(min_hours)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    return query(f"""
        SELECT
            ag.event_id,
            v.vessel_name,
            v.flag,
            ag.vessel_id,
            ag.start_time,
            ag.end_time,
            ag.gap_hours,
            ag.lat_off,
            ag.lon_off,
            ag.lat_on,
            ag.lon_on,
            ag.distance_km,
            ag.fao_areas,
            ag.rfmo_areas
        FROM ais_gaps ag
        JOIN vessels v ON v.id = ag.vessel_id
        {where}
        ORDER BY ag.gap_hours DESC
        LIMIT %s
    """, params + [limit])


# ── Vessel Timeline ────────────────────────────────────────────────────────────

@app.get("/api/vessels/{vessel_id}/timeline")
def get_vessel_timeline(
    vessel_id: int,
    months: int = Query(12, le=60),
):
    fishing = query("""
        SELECT event_id, start_time, end_time, duration_hours,
               lat, lon, fao_areas, rfmo_areas
        FROM fishing_events
        WHERE vessel_id = %s
          AND start_time >= NOW() - (%s || ' months')::interval
        ORDER BY start_time ASC
    """, [vessel_id, months])

    ports = query("""
        SELECT event_id, start_time, end_time, duration_hours,
               lat, lon, port_name, port_flag, confidence
        FROM port_visits
        WHERE vessel_id = %s
          AND start_time >= NOW() - (%s || ' months')::interval
        ORDER BY start_time ASC
    """, [vessel_id, months])

    gaps = query("""
        SELECT event_id, start_time, end_time, gap_hours,
               lat_off, lon_off, lat_on, lon_on, distance_km, fao_areas
        FROM ais_gaps
        WHERE vessel_id = %s
          AND gap_hours >= 24
          AND start_time >= NOW() - (%s || ' months')::interval
        ORDER BY start_time ASC
    """, [vessel_id, months])

    encounters = query("""
        SELECT event_id, start_time, end_time, duration_hours, lat, lon,
               encountered_vessel_name, encountered_vessel_flag, encounter_type,
               median_distance_km
        FROM encounters
        WHERE vessel_id = %s
          AND start_time >= NOW() - (%s || ' months')::interval
        ORDER BY start_time ASC
    """, [vessel_id, months])

    return {
        "fishing_events": fishing,
        "port_visits":    ports,
        "ais_gaps":       gaps,
        "encounters":     encounters,
    }


# ── Supply Intelligence ───────────────────────────────────────────────────────

@app.get("/api/supply/season-chart")
def get_season_chart(
    species:     str = Query("all"),      # all | eleginoides | mawsoni
    granularity: str = Query("monthly"),  # monthly | weekly
    vessel_ids:  str = Query(None),
):
    if species == "mawsoni":
        species_filter = "AND '88' = ANY(fe.fao_areas)"
    elif species == "eleginoides":
        species_filter = "AND NOT ('88' = ANY(fe.fao_areas))"
    else:
        species_filter = ""

    params = []
    if vessel_ids:
        species_filter += " AND fe.vessel_id = ANY(%s)"
        params.append([int(v) for v in vessel_ids.split(",") if v])

    if granularity == "weekly":
        bucket_sql = """
            (start_time::date
             - TO_DATE(season_year::text || '-12-01', 'YYYY-MM-DD')) / 7 + 1
        """
        max_bucket = 52
    else:
        # Season-relative month: Dec=1, Jan=2, …, Nov=12
        bucket_sql = """
            CASE WHEN EXTRACT(MONTH FROM start_time) >= 12
                THEN EXTRACT(MONTH FROM start_time)::int - 11
                ELSE EXTRACT(MONTH FROM start_time)::int + 1
            END
        """
        max_bucket = 12

    rows = query(f"""
        WITH base AS (
            SELECT
                CASE WHEN EXTRACT(MONTH FROM fe.start_time) >= 12
                    THEN EXTRACT(YEAR FROM fe.start_time)::int
                    ELSE EXTRACT(YEAR FROM fe.start_time)::int - 1
                END AS season_year,
                fe.start_time,
                fe.duration_hours
            FROM fishing_events fe
            WHERE fe.duration_hours IS NOT NULL
              AND fe.duration_hours > 0
              {species_filter}
        )
        SELECT
            season_year,
            {bucket_sql} AS bucket,
            SUM(duration_hours) AS hours
        FROM base
        WHERE season_year >= 2022
        GROUP BY season_year, bucket
        HAVING {bucket_sql} BETWEEN 1 AND {max_bucket}
        ORDER BY season_year, bucket
    """, params)

    season_years = sorted(set(r["season_year"] for r in rows))

    # Raw bucket sums per season (cumulative is computed on the frontend)
    season_buckets = defaultdict(dict)
    for r in rows:
        season_buckets[r["season_year"]][r["bucket"]] = r["hours"]

    # Pivot to Recharts format: [{bucket: 1, "2022": 1234, ...}, ...]
    data = []
    for b in range(1, max_bucket + 1):
        row = {"bucket": b}
        for year in season_years:
            val = season_buckets[year].get(b, 0)
            if val > 0:
                row[str(year)] = round(val, 1)
        data.append(row)

    return {
        "seasons": [str(y) for y in season_years],
        "data":    data,
    }
