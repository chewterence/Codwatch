import json
import requests

with open("secrets.json") as f:
    secrets = json.load(f)

API_KEY = secrets["gfw_api_key"]
BASE_URL = "https://gateway.api.globalfishingwatch.org/v3"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# Cod is caught primarily by bottom trawlers in these FAO areas:
#   21 = NW Atlantic, 27 = NE Atlantic, 67 = NE Pacific
# GFW has no species field — we proxy by gear type + fishing region.

COD_FAO_AREAS = {"21", "27", "67"}
COD_GEAR_TYPES = {"trawlers", "set_longlines", "set_gillnets", "pots_and_traps"}

FISHING_EVENTS_DATASET = "public-global-fishing-events:latest"
VESSEL_DATASET = "public-global-vessel-identity:latest"


def fetch_fishing_events(start_date: str, end_date: str, limit: int = 100) -> list:
    """Fetch all fishing events, paginating through results."""
    # event-type is not supported on GET /events — the fishing-events dataset
    # only returns fishing events anyway
    params = {
        "datasets[0]": FISHING_EVENTS_DATASET,
        "start-date": start_date,
        "end-date": end_date,
        "limit": limit,
        "offset": 0,
    }

    all_entries = []
    while True:
        resp = requests.get(f"{BASE_URL}/events", headers=HEADERS, params=params)
        resp.raise_for_status()
        data = resp.json()
        entries = data.get("entries", [])
        all_entries.extend(entries)
        print(f"  Fetched {len(all_entries)} / {data['total']} events...")

        next_offset = data.get("nextOffset")
        if next_offset is None or len(all_entries) >= data["total"]:
            break
        params["offset"] = next_offset

    return all_entries


def is_cod_region(event: dict) -> bool:
    """Return True if the event occurred in a known cod fishing FAO area."""
    fao_areas = set(event.get("regions", {}).get("fao", []))
    major_fao = set(event.get("regions", {}).get("majorFao", []))
    return bool((fao_areas | major_fao) & COD_FAO_AREAS)


def get_vessel_gear(vessel_id: str) -> set:
    """Look up gear types for a vessel from the identity API."""
    params = {"datasets[0]": VESSEL_DATASET}
    resp = requests.get(f"{BASE_URL}/vessels/{vessel_id}", headers=HEADERS, params=params)
    if resp.status_code != 200:
        return set()
    data = resp.json()
    gear = set()
    for source in data.get("combinedSourcesInfo", []):
        for g in source.get("geartypes", []):
            gear.add(g.get("name", "").lower())
    return gear


def find_cod_vessels(start_date: str = "2024-01-01", end_date: str = "2024-03-31"):
    print(f"\nFetching fishing events {start_date} to {end_date}...")
    events = fetch_fishing_events(start_date, end_date, limit=100)

    print("\nFiltering events in cod FAO areas (21, 27, 67)...")
    cod_region_events = [e for e in events if is_cod_region(e)]
    print(f"  {len(cod_region_events)} events in cod regions out of {len(events)} total")

    # Deduplicate by vessel ID
    vessels_seen = {}
    for event in cod_region_events:
        v = event.get("vessel", {})
        vid = v.get("id")
        if vid and vid not in vessels_seen:
            vessels_seen[vid] = {
                "id": vid,
                "name": v.get("name"),
                "ssvid": v.get("ssvid"),
                "flag": v.get("flag"),
                "event_count": 0,
            }
        if vid:
            vessels_seen[vid]["event_count"] += 1

    print(f"\n  {len(vessels_seen)} unique vessels fishing in cod regions\n")

    # Enrich with gear type and filter to likely cod gear
    cod_vessels = []
    for i, (vid, vessel) in enumerate(vessels_seen.items()):
        print(f"  [{i+1}/{len(vessels_seen)}] Checking gear for {vessel['name']} ({vessel['flag']})...")
        gear = get_vessel_gear(vid)
        vessel["gear_types"] = sorted(gear)
        if gear & COD_GEAR_TYPES:
            cod_vessels.append(vessel)

    return cod_vessels


if __name__ == "__main__":
    # Narrow date range for a quick test — expand for more complete results
    cod_vessels = find_cod_vessels(start_date="2024-01-01", end_date="2024-01-07")

    print(f"\n=== Likely Cod Vessels ({len(cod_vessels)}) ===")
    for v in cod_vessels:
        print(
            f"  {v['name']:30s}  flag={v['flag']}  ssvid={v['ssvid']}  "
            f"events={v['event_count']}  gear={v['gear_types']}"
        )

    with open("cod_vessels.json", "w") as f:
        json.dump(cod_vessels, f, indent=2)
    print("\nSaved to cod_vessels.json")
