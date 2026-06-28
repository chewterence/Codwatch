"""
backfill.py

One-time historical data pull for all CCAMLR Dissostichus vessels with GFW IDs.
Fetches: fishing events, port visits, encounters, AIS gaps from 2022-01-01 to present.

Usage:
    cd /Users/terence/Desktop/Codwatch
    python database/backfill.py

    # To re-seed vessels only (no event fetch):
    python database/backfill.py --seed-only

    # To run a specific vessel by name:
    python database/backfill.py --vessel "Nordic Prince"

The script is resume-safe: completed chunks are recorded in backfill_log and
skipped on re-run. Run it again at any time to pick up where it left off.

GFW API datasets used:
    fishing:    public-global-fishing-events:latest
    port_visit: public-global-port-visits-c2:latest
    encounter:  public-global-encounters-events:latest
    ais_gap:    public-global-gaps-events:latest
"""

import json
import os
import sys
import time
import argparse
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List, Tuple, Dict, Any

import requests
import psycopg2
import psycopg2.extras

# ============================================================
# Configuration
# ============================================================

BACKFILL_START = date(2022, 1, 1)
CHUNK_DAYS     = 365          # days per API request (max 366)
GFW_LAG_DAYS   = 5            # 96-hour GFW data lag + 1-day buffer
SLEEP_SEC      = 0.4          # polite delay between API calls
RETRY_WAIT_SEC = 12           # wait after 429 rate limit
PAGE_LIMIT     = 100          # events per page

BASE_URL   = "https://gateway.api.globalfishingwatch.org/v3"
DATASETS   = {
    "fishing":    "public-global-fishing-events:latest",
    "port_visit": "public-global-loitering-events:latest",   # port visits extracted from nextPort field
    "encounter":  "public-global-encounters-events:latest",
    "ais_gap":    "public-global-gaps-events:latest",
}

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/codwatch")

_DIR         = os.path.dirname(os.path.abspath(__file__))
VESSEL_JSON  = os.path.join(_DIR, "..", "gfw_ccamlr_vessel_list.json")
SECRETS_FILE = os.path.join(_DIR, "..", "secrets.json")


# ============================================================
# Setup helpers
# ============================================================

def load_secrets() -> str:
    with open(SECRETS_FILE) as f:
        return json.load(f)["gfw_api_key"]


def get_db_conn():
    return psycopg2.connect(DATABASE_URL)


def parse_dt(s: Optional[str]) -> Optional[datetime]:
    """Parse ISO 8601 timestamp string to timezone-aware datetime."""
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def hours_between(start_str: Optional[str], end_str: Optional[str]) -> Optional[float]:
    start = parse_dt(start_str)
    end   = parse_dt(end_str)
    if not start or not end:
        return None
    return (end - start).total_seconds() / 3600.0


def date_chunks(start: date, end: date, chunk_days: int) -> List[Tuple[date, date]]:
    """Split a date range into chunks of at most chunk_days days."""
    chunks = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


# ============================================================
# Database: seed vessels
# ============================================================

def seed_vessels(conn) -> None:
    """Load all vessels from gfw_ccamlr_vessel_list.json into the vessels table."""
    with open(VESSEL_JSON) as f:
        data = json.load(f)

    inserted = 0
    updated  = 0

    with conn.cursor() as cur:
        for v in data["vessels"]:
            ais_from = parse_dt(v.get("gfw_ais_from"))
            ais_to   = parse_dt(v.get("gfw_ais_to"))

            cur.execute("""
                INSERT INTO vessels (
                    vessel_name, flag, ccamlr_member,
                    gfw_vessel_id, gfw_ssvid, gfw_imo, gfw_callsign, gfw_flag,
                    gfw_geartypes, gfw_ais_from, gfw_ais_to, gfw_match_confidence,
                    eleginoides_authorized, mawsoni_authorized
                ) VALUES (%s,%s,%s, %s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s)
                ON CONFLICT (vessel_name) DO UPDATE SET
                    gfw_vessel_id        = EXCLUDED.gfw_vessel_id,
                    gfw_ssvid            = EXCLUDED.gfw_ssvid,
                    gfw_imo              = EXCLUDED.gfw_imo,
                    gfw_callsign         = EXCLUDED.gfw_callsign,
                    gfw_flag             = EXCLUDED.gfw_flag,
                    gfw_geartypes        = EXCLUDED.gfw_geartypes,
                    gfw_ais_from         = EXCLUDED.gfw_ais_from,
                    gfw_ais_to           = EXCLUDED.gfw_ais_to,
                    gfw_match_confidence = EXCLUDED.gfw_match_confidence,
                    eleginoides_authorized = EXCLUDED.eleginoides_authorized,
                    mawsoni_authorized   = EXCLUDED.mawsoni_authorized,
                    updated_at           = NOW()
                RETURNING (xmax = 0) AS inserted
            """, (
                v["vessel"], v["flag"], v["ccamlr_member"],
                v.get("gfw_vessel_id"), v.get("gfw_ssvid"), v.get("gfw_imo"),
                v.get("gfw_callsign"), v.get("gfw_flag"),
                v.get("gfw_geartypes") or [],
                ais_from, ais_to, v.get("gfw_match_confidence"),
                v.get("eleginoides_authorized", False),
                v.get("mawsoni_authorized", False),
            ))

            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1

            vessel_id = cur.execute("SELECT id FROM vessels WHERE vessel_name = %s", (v["vessel"],))
            cur.execute("SELECT id FROM vessels WHERE vessel_name = %s", (v["vessel"],))
            vessel_db_id = cur.fetchone()[0]

            # Sync authorizations: delete existing, re-insert
            cur.execute("DELETE FROM vessel_authorizations WHERE vessel_id = %s", (vessel_db_id,))
            for auth in v.get("authorizations", []):
                cur.execute("""
                    INSERT INTO vessel_authorizations (vessel_id, period_from, period_to, areas, target_species)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    vessel_db_id,
                    auth["period_from"],
                    auth["period_to"],
                    auth["areas"],
                    auth["target_species"],
                ))

    conn.commit()
    print(f"  Vessels seeded: {inserted} inserted, {updated} updated")


def load_vessels(conn) -> List[Dict[str, Any]]:
    """Return all vessels that have a GFW vessel ID."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, vessel_name, gfw_vessel_id, gfw_ssvid
            FROM vessels
            WHERE gfw_vessel_id IS NOT NULL
            ORDER BY vessel_name
        """)
        rows = cur.fetchall()
    return [
        {"id": r[0], "vessel_name": r[1], "gfw_vessel_id": r[2], "gfw_ssvid": r[3]}
        for r in rows
    ]


# ============================================================
# GFW API fetch
# ============================================================

def fetch_events(
    gfw_vessel_id: str,
    dataset: str,
    start: date,
    end: date,
    api_key: str,
) -> List[Dict[str, Any]]:
    """Fetch all events for one vessel, one dataset, one date range. Paginates automatically."""
    headers = {"Authorization": f"Bearer {api_key}"}
    params  = {
        "datasets[0]":  dataset,
        "vessels[0]":   gfw_vessel_id,
        "start-date":   start.isoformat(),
        "end-date":     end.isoformat(),
        "limit":        PAGE_LIMIT,
        "offset":       0,
    }

    all_entries: List[Dict[str, Any]] = []

    while True:
        resp = requests.get(f"{BASE_URL}/events", headers=headers, params=params)

        if resp.status_code == 429:
            print(f"      [rate limit] waiting {RETRY_WAIT_SEC}s...")
            time.sleep(RETRY_WAIT_SEC)
            continue

        if resp.status_code == 404:
            # Dataset may not exist or no events — treat as empty
            return []

        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")

        data    = resp.json()
        entries = data.get("entries", [])
        all_entries.extend(entries)

        total       = data.get("total", 0)
        next_offset = data.get("nextOffset")

        if next_offset is None or len(all_entries) >= total:
            break

        params["offset"] = next_offset
        time.sleep(0.1)   # small delay between pages

    return all_entries


# ============================================================
# Event parsers → DB rows
# ============================================================

def _regions(event: Dict[str, Any]) -> Tuple[List[str], List[str], List[str], List[str]]:
    """Extract fao, rfmo, eez, highSeas region lists from an event."""
    r = event.get("regions") or {}
    return (
        r.get("fao", []) or [],
        r.get("rfmo", []) or [],
        r.get("eez", []) or [],
        r.get("highSeas", []) or [],
    )


def store_fishing_events(conn, vessel_db_id: int, events: List[Dict[str, Any]]) -> int:
    if not events:
        return 0

    rows = []
    for e in events:
        fao, rfmo, eez, hs = _regions(e)
        pos    = e.get("position") or {}
        fish   = e.get("fishing") or {}
        rows.append((
            e["id"],
            vessel_db_id,
            e.get("start"),
            e.get("end"),
            hours_between(e.get("start"), e.get("end")),
            pos.get("lat"),
            pos.get("lon"),
            fao or None,
            rfmo or None,
            eez or None,
            hs or None,
            fish.get("vesselPublicAuthorizationStatus"),
            psycopg2.extras.Json(e),
        ))

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO fishing_events
                (event_id, vessel_id, start_time, end_time, duration_hours,
                 lat, lon, fao_areas, rfmo_areas, eez_areas, high_seas,
                 auth_status, raw)
            VALUES %s
            ON CONFLICT (event_id) DO NOTHING
        """, rows)
    conn.commit()
    return len(rows)


def store_port_visits(conn, vessel_db_id: int, events: List[Dict[str, Any]]) -> int:
    """Extract unique port visits from loitering events via vessel.nextPort.

    public-global-port-visits-c2:latest was deprecated from GFW's public API.
    Port visit data is now sourced from loitering events: each contains a nextPort
    reference (name, flag, portVisitEventId). We deduplicate by portVisitEventId
    and use the loitering event's end time as a proxy for port arrival.
    """
    if not events:
        return 0

    # Collect the latest-timed loitering event per unique portVisitEventId
    best: Dict[str, Dict[str, Any]] = {}
    for e in events:
        vessel_info = e.get("vessel") or {}
        next_port   = vessel_info.get("nextPort") or {}
        pv_id       = next_port.get("portVisitEventId")
        port_name   = next_port.get("name")
        if not pv_id or not port_name:
            continue
        # Keep whichever loitering event ends latest — closest to the actual port call
        if pv_id not in best or (e.get("end") or "") > (best[pv_id]["end"] or ""):
            best[pv_id] = {
                "pv_id":      pv_id,
                "port_name":  port_name,
                "port_flag":  next_port.get("flag"),
                "port_id":    next_port.get("id"),
                "end":        e.get("end"),   # loitering end ≈ vessel heading to port
            }

    if not best:
        return 0

    rows = []
    for v in best.values():
        rows.append((
            v["pv_id"],
            vessel_db_id,
            v["end"],   # start_time = loitering end (best proxy for port arrival)
            None,       # end_time unknown
            None,       # duration_hours unknown
            None,       # lat (port lat not available without separate lookup)
            None,       # lon
            v["port_name"],
            v["port_id"],
            v["port_flag"],
            2,          # confidence (consistent with GFW port visit default)
            psycopg2.extras.Json({}),
        ))

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO port_visits
                (event_id, vessel_id, start_time, end_time, duration_hours,
                 lat, lon, port_name, port_id, port_flag, confidence, raw)
            VALUES %s
            ON CONFLICT (event_id) DO NOTHING
        """, rows)
    conn.commit()
    return len(rows)


def store_encounters(conn, vessel_db_id: int, events: List[Dict[str, Any]]) -> int:
    if not events:
        return 0

    rows = []
    for e in events:
        fao, rfmo, _, _ = _regions(e)
        pos = e.get("position") or {}
        enc = e.get("encounter") or {}
        ev  = enc.get("vessel") or {}
        rows.append((
            e["id"],
            vessel_db_id,
            e.get("start"),
            e.get("end"),
            hours_between(e.get("start"), e.get("end")),
            pos.get("lat"),
            pos.get("lon"),
            fao or None,
            rfmo or None,
            ev.get("id"),
            ev.get("name"),
            ev.get("flag"),
            enc.get("type"),
            enc.get("medianDistanceKilometers"),
            enc.get("medianSpeedKnots"),
            psycopg2.extras.Json(e),
        ))

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO encounters
                (event_id, vessel_id, start_time, end_time, duration_hours,
                 lat, lon, fao_areas, rfmo_areas,
                 encountered_vessel_id, encountered_vessel_name, encountered_vessel_flag,
                 encounter_type, median_distance_km, median_speed_knots, raw)
            VALUES %s
            ON CONFLICT (event_id) DO NOTHING
        """, rows)
    conn.commit()
    return len(rows)


def store_ais_gaps(conn, vessel_db_id: int, events: List[Dict[str, Any]]) -> int:
    if not events:
        return 0

    rows = []
    for e in events:
        fao, rfmo, _, _ = _regions(e)
        gap  = e.get("gap") or {}
        pos  = gap.get("positions") or {}
        rows.append((
            e["id"],
            vessel_db_id,
            e.get("start"),
            e.get("end"),
            gap.get("durationHours") or hours_between(e.get("start"), e.get("end")),
            pos.get("startLat"),
            pos.get("startLon"),
            pos.get("endLat"),
            pos.get("endLon"),
            gap.get("distanceKm"),
            gap.get("impliedSpeedKnots"),
            fao or None,
            rfmo or None,
            psycopg2.extras.Json(e),
        ))

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO ais_gaps
                (event_id, vessel_id, start_time, end_time, gap_hours,
                 lat_off, lon_off, lat_on, lon_on,
                 distance_km, implied_speed_knots, fao_areas, rfmo_areas, raw)
            VALUES %s
            ON CONFLICT (event_id) DO NOTHING
        """, rows)
    conn.commit()
    return len(rows)


STORE_FN = {
    "fishing":    store_fishing_events,
    "port_visit": store_port_visits,
    "encounter":  store_encounters,
    "ais_gap":    store_ais_gaps,
}


# ============================================================
# Backfill log
# ============================================================

def already_fetched(conn, vessel_id: int, event_type: str, period_from: date, period_to: date) -> bool:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM backfill_log
            WHERE vessel_id = %s AND event_type = %s
              AND period_from = %s AND period_to = %s
              AND status = 'success'
            LIMIT 1
        """, (vessel_id, event_type, period_from, period_to))
        return cur.fetchone() is not None


def log_backfill(
    conn,
    vessel_id: int,
    event_type: str,
    period_from: date,
    period_to: date,
    events_fetched: int,
    status: str,
    error_msg: Optional[str],
) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO backfill_log
                (vessel_id, event_type, period_from, period_to, events_fetched, status, error_msg)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (vessel_id, event_type, period_from, period_to, events_fetched, status, error_msg))
    conn.commit()


# ============================================================
# Per-vessel backfill
# ============================================================

def backfill_vessel(conn, vessel: Dict[str, Any], api_key: str, end_date: date) -> None:
    vessel_db_id  = vessel["id"]
    gfw_vessel_id = vessel["gfw_vessel_id"]
    vessel_name   = vessel["vessel_name"]

    chunks = date_chunks(BACKFILL_START, end_date, CHUNK_DAYS)

    for event_type, dataset in DATASETS.items():
        total_events = 0
        for chunk_start, chunk_end in chunks:
            if already_fetched(conn, vessel_db_id, event_type, chunk_start, chunk_end):
                continue

            try:
                events = fetch_events(gfw_vessel_id, dataset, chunk_start, chunk_end, api_key)
                count  = STORE_FN[event_type](conn, vessel_db_id, events)
                log_backfill(conn, vessel_db_id, event_type, chunk_start, chunk_end, count, "success", None)
                total_events += count
                if count:
                    print(f"    [{event_type:11s}] {chunk_start} → {chunk_end}: {count} events")
            except Exception as exc:
                log_backfill(conn, vessel_db_id, event_type, chunk_start, chunk_end, 0, "error", str(exc))
                print(f"    [{event_type:11s}] {chunk_start} → {chunk_end}: ERROR — {exc}")

            time.sleep(SLEEP_SEC)

        if total_events:
            print(f"  {event_type:12s}  total: {total_events}")


# ============================================================
# Main
# ============================================================

def run(seed_only: bool = False, vessel_filter: Optional[str] = None) -> None:
    api_key  = load_secrets()
    conn     = get_db_conn()
    end_date = date.today() - timedelta(days=GFW_LAG_DAYS)

    print("Seeding vessels and authorizations...")
    seed_vessels(conn)

    if seed_only:
        conn.close()
        print("Done (seed only).")
        return

    vessels = load_vessels(conn)
    if vessel_filter:
        vessels = [v for v in vessels if vessel_filter.lower() in v["vessel_name"].lower()]
        if not vessels:
            print(f"No vessel matching '{vessel_filter}' found.")
            conn.close()
            return

    print(f"\nBackfilling {len(vessels)} vessels | {BACKFILL_START} → {end_date}\n")

    for i, vessel in enumerate(vessels, 1):
        print(f"[{i:02d}/{len(vessels)}] {vessel['vessel_name']}  (GFW: {vessel['gfw_vessel_id']})")
        backfill_vessel(conn, vessel, api_key, end_date)

    conn.close()

    print("\n" + "=" * 60)
    print("Backfill complete.")
    print("=" * 60)
    print()
    print("Useful queries to verify:")
    print("  SELECT event_type, SUM(events_fetched) FROM backfill_log WHERE status='success' GROUP BY 1;")
    print("  SELECT v.vessel_name, COUNT(*) FROM fishing_events fe JOIN vessels v ON v.id=fe.vessel_id GROUP BY 1 ORDER BY 2 DESC;")
    print("  SELECT v.vessel_name, COUNT(*) FROM port_visits pv JOIN vessels v ON v.id=pv.vessel_id GROUP BY 1 ORDER BY 2 DESC;")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill GFW event data into codwatch DB")
    parser.add_argument("--seed-only",  action="store_true",
                        help="Only seed vessels table, do not fetch events")
    parser.add_argument("--vessel",     type=str, default=None,
                        help="Only backfill vessel(s) matching this name substring")
    args = parser.parse_args()

    run(seed_only=args.seed_only, vessel_filter=args.vessel)
