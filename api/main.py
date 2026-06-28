"""
Codwatch API — FastAPI backend
Serves vessel monitoring data from the codwatch PostgreSQL database.

Run:
    cd /Users/terence/Desktop/Codwatch
    uvicorn api.main:app --reload --port 8000
"""

import datetime
import os

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
    return query("""
        SELECT
            v.id,
            v.vessel_name,
            v.flag,
            v.gfw_vessel_id,
            v.gfw_ssvid,
            v.gfw_flag,
            v.gfw_geartypes,
            v.gfw_ais_to,
            v.gfw_match_confidence,
            v.eleginoides_authorized,
            v.mawsoni_authorized,
            COUNT(DISTINCT fe.event_id)   AS fishing_event_count,
            MAX(fe.start_time)::date       AS last_fishing_date,
            COUNT(DISTINCT e.event_id)    AS encounter_count,
            COUNT(DISTINCT ag.event_id)   AS ais_gap_count
        FROM vessels v
        LEFT JOIN fishing_events fe ON fe.vessel_id = v.id
        LEFT JOIN encounters      e  ON e.vessel_id  = v.id
        LEFT JOIN ais_gaps        ag ON ag.vessel_id = v.id
        GROUP BY v.id
        ORDER BY fishing_event_count DESC, v.vessel_name
    """)


# ── Fishing Events ────────────────────────────────────────────────────────────

@app.get("/api/fishing-events")
def get_fishing_events(
    vessel_id: int = Query(None),
    limit: int = Query(500, le=2000),
    days: int = Query(None),
):
    conditions = ["fe.lat IS NOT NULL", "fe.lon IS NOT NULL"]
    params = []

    if vessel_id:
        conditions.append("fe.vessel_id = %s")
        params.append(vessel_id)

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
    limit: int = Query(100, le=500),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("pv.vessel_id = %s")
        params.append(vessel_id)

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
    limit: int = Query(100, le=500),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("e.vessel_id = %s")
        params.append(vessel_id)

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
    min_hours: float = Query(None),
    limit: int = Query(100, le=500),
):
    conditions = []
    params = []

    if vessel_id:
        conditions.append("ag.vessel_id = %s")
        params.append(vessel_id)

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
