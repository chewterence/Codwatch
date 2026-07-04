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
            (SELECT MAX(start_time)::date FROM fishing_events)      AS last_event_date
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
    limit: int = Query(500, le=2000),
    days: int = Query(None),
):
    conditions = ["fe.lat IS NOT NULL", "fe.lon IS NOT NULL"]
    params = []

    if vessel_id:
        conditions.append("fe.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("fe.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    if days:
        conditions.append("fe.start_time >= NOW() - (%s || ' days')::interval")
        params.append(days)

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
    limit: int = Query(100, le=500),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("pv.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("pv.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    return query(f"""
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
            pv.port_flag,
            pv.confidence
        FROM port_visits pv
        JOIN vessels v ON v.id = pv.vessel_id
        {where}
        ORDER BY pv.start_time DESC
        LIMIT %s
    """, params + [limit])


# ── Encounters ────────────────────────────────────────────────────────────────

@app.get("/api/encounters")
def get_encounters(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    encounter_type: str = Query(None),
    days: int = Query(None),
    limit: int = Query(100, le=500),
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

    if days:
        conditions.append("e.start_time >= NOW() - (%s || ' days')::interval")
        params.append(days)

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


# ── AIS Gaps ──────────────────────────────────────────────────────────────────

@app.get("/api/ais-gaps")
def get_ais_gaps(
    vessel_id: int = Query(None),
    vessel_ids: str = Query(None),
    min_hours: float = Query(None),
    limit: int = Query(100, le=500),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("ag.vessel_id = %s")
        params.append(vessel_id)

    if vessel_ids:
        conditions.append("ag.vessel_id = ANY(%s)")
        params.append([int(v) for v in vessel_ids.split(",") if v])

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

    return {
        "fishing_events": fishing,
        "port_visits":    ports,
        "ais_gaps":       gaps,
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
