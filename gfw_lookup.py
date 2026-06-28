"""
gfw_lookup.py

Reads ccamlr_vessel_list.json, searches each vessel in the GFW Vessels API,
and writes gfw_ccamlr_vessel_list.json with GFW identity data populated.

GFW endpoint: GET /vessels/search?query=<name>&datasets[0]=public-global-vessel-identity:latest

Output adds per vessel:
  gfw_vessel_id         — primary GFW vessel ID (use this in /events queries)
  gfw_ssvid             — MMSI number broadcast over AIS
  gfw_imo               — IMO number
  gfw_callsign          — radio callsign
  gfw_match_confidence  — "exact" | "name_and_flag" | "name_only" | "multiple_candidates" | "not_found"
  gfw_candidates        — full list of GFW results when multiple matches exist
"""

import json
import time
from typing import Optional
import requests

INPUT_FILE  = "ccamlr_vessel_list.json"
OUTPUT_FILE = "gfw_ccamlr_vessel_list.json"
BASE_URL    = "https://gateway.api.globalfishingwatch.org/v3"
DATASET     = "public-global-vessel-identity:latest"
SLEEP_SEC   = 0.5   # polite delay between requests

# GFW returns ISO3 flag codes; map CCAMLR country names to ISO3 for matching
FLAG_ISO3 = {
    "Australia":          "AUS",
    "Chile":              "CHL",
    "China":              "CHN",
    "France":             "FRA",
    "Japan":              "JPN",
    "Korea, Republic of": "KOR",
    "Namibia":            "NAM",
    "New Zealand":        "NZL",
    "Russian Federation": "RUS",
    "South Africa":       "ZAF",
    "Spain":              "ESP",
    "Ukraine":            "UKR",
    "United Kingdom":     "GBR",
    "Uruguay":            "URY",
}


def load_secrets():
    with open("secrets.json") as f:
        return json.load(f)["gfw_api_key"]


def gfw_search(vessel_name: str, api_key: str) -> list:
    """Return raw GFW search entries for a vessel name query."""
    headers = {"Authorization": f"Bearer {api_key}"}
    params  = {
        "query":       vessel_name,
        "datasets[0]": DATASET,
        "limit":       10,
    }
    resp = requests.get(f"{BASE_URL}/vessels/search", headers=headers, params=params)

    if resp.status_code == 429:
        print("    [rate limit] waiting 10s...")
        time.sleep(10)
        return gfw_search(vessel_name, api_key)

    if resp.status_code != 200:
        print(f"    [error] HTTP {resp.status_code}: {resp.text[:200]}")
        return []

    return resp.json().get("entries", [])


def extract_identity(entry: dict) -> dict:
    """Pull the most useful identity fields from a GFW search entry."""
    # selfReportedInfo[0] is the AIS-derived identity (most current)
    sri = entry.get("selfReportedInfo", [])
    reg = entry.get("registryInfo", [])

    vessel_id  = sri[0]["id"]         if sri else None
    ssvid      = sri[0].get("ssvid")  if sri else None
    imo        = (reg[0].get("imo")   if reg else None) or (sri[0].get("imo") if sri else None)
    callsign   = (reg[0].get("callsign") if reg else None) or (sri[0].get("callsign") if sri else None)
    flag       = (reg[0].get("flag") if reg else None) or (sri[0].get("flag") if sri else None)
    shipname   = (reg[0].get("shipname") if reg else None) or (sri[0].get("shipname") if sri else None)
    tx_from    = sri[0].get("transmissionDateFrom") if sri else None
    tx_to      = sri[0].get("transmissionDateTo")   if sri else None

    geartypes = []
    for src in entry.get("combinedSourcesInfo", []):
        for g in src.get("geartypes", []):
            name = g.get("name")
            if name and name not in geartypes:
                geartypes.append(name)

    return {
        "gfw_vessel_id": vessel_id,
        "gfw_ssvid":     ssvid,
        "gfw_imo":       imo,
        "gfw_callsign":  callsign,
        "gfw_flag":      flag,
        "gfw_shipname":  shipname,
        "gfw_geartypes": geartypes,
        "gfw_ais_from":  tx_from,
        "gfw_ais_to":    tx_to,
    }


def normalize(name: str) -> str:
    """Strip spaces, dots, hyphens for fuzzy name comparison."""
    return "".join(c for c in name.upper() if c.isalnum())


def name_matches(query: str, gfw_name: Optional[str]) -> bool:
    if not gfw_name:
        return False
    q, g = normalize(query), normalize(gfw_name)
    return q in g or g in q


def match_vessel(vessel_name: str, flag_iso3: Optional[str], entries: list) -> tuple:
    """
    Try to find the best single match among GFW search results.

    Returns (confidence, best_identity, all_candidates)
      confidence: "exact" | "name_and_flag" | "name_only" | "multiple_candidates" | "not_found"
    """
    if not entries:
        return "not_found", None, []

    candidates = [extract_identity(e) for e in entries]

    # Exact: name matches AND flag matches
    exact = [
        c for c in candidates
        if name_matches(vessel_name, c["gfw_shipname"]) and c["gfw_flag"] == flag_iso3
    ]
    if len(exact) == 1:
        return "exact", exact[0], candidates
    if len(exact) > 1:
        # Prefer the candidate with an IMO number as it's more authoritative
        with_imo = [c for c in exact if c["gfw_imo"]]
        best = with_imo[0] if with_imo else exact[0]
        return "name_and_flag", best, candidates

    # Name match only (flag mismatch or not in registry)
    name_only = [
        c for c in candidates
        if name_matches(vessel_name, c["gfw_shipname"])
    ]
    if len(name_only) == 1:
        return "name_only", name_only[0], candidates
    if len(name_only) > 1:
        return "multiple_candidates", name_only[0], candidates

    # Query returned results but none match the name substring
    return "not_found", None, candidates


def run():
    api_key = load_secrets()

    with open(INPUT_FILE) as f:
        data = json.load(f)

    vessels = data["vessels"]
    total   = len(vessels)

    stats = {"exact": 0, "name_and_flag": 0, "name_only": 0,
             "multiple_candidates": 0, "not_found": 0}

    for i, vessel in enumerate(vessels, 1):
        name     = vessel["vessel"]
        flag_iso = FLAG_ISO3.get(vessel.get("flag", ""))

        print(f"[{i:02d}/{total}] Searching: {name} ({vessel.get('flag', '?')}) ...")

        entries    = gfw_search(name, api_key)
        confidence, best, candidates = match_vessel(name, flag_iso, entries)

        stats[confidence] += 1
        print(f"         → {confidence.upper()}")

        if best:
            vessel["gfw_vessel_id"]        = best["gfw_vessel_id"]
            vessel["gfw_ssvid"]            = best["gfw_ssvid"]
            vessel["gfw_imo"]              = best["gfw_imo"]
            vessel["gfw_callsign"]         = best["gfw_callsign"]
            vessel["gfw_flag"]             = best["gfw_flag"]
            vessel["gfw_geartypes"]        = best["gfw_geartypes"]
            vessel["gfw_ais_from"]         = best["gfw_ais_from"]
            vessel["gfw_ais_to"]           = best["gfw_ais_to"]
            vessel["gfw_match_confidence"] = confidence
        else:
            vessel["gfw_vessel_id"]        = None
            vessel["gfw_ssvid"]            = None
            vessel["gfw_imo"]              = None
            vessel["gfw_callsign"]         = None
            vessel["gfw_flag"]             = None
            vessel["gfw_geartypes"]        = []
            vessel["gfw_ais_from"]         = None
            vessel["gfw_ais_to"]           = None
            vessel["gfw_match_confidence"] = confidence

        # Store all candidates when ambiguous so you can review manually
        if confidence in ("multiple_candidates", "not_found") and candidates:
            vessel["gfw_candidates"] = [
                {k: v for k, v in c.items() if k in
                 ("gfw_vessel_id", "gfw_shipname", "gfw_flag", "gfw_ssvid", "gfw_imo")}
                for c in candidates
            ]
        else:
            vessel.pop("gfw_candidates", None)

        time.sleep(SLEEP_SEC)

    # Update metadata
    data["metadata"]["gfw_lookup_date"] = "2026-06-28"
    data["metadata"]["gfw_lookup_stats"] = stats
    data["metadata"]["notes"].append(
        "gfw_match_confidence: 'exact'=name+flag matched; 'name_and_flag'=multiple records same vessel; "
        "'name_only'=flag mismatch or not in registry; 'multiple_candidates'=ambiguous, check gfw_candidates; "
        "'not_found'=no GFW record found."
    )

    with open(OUTPUT_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print()
    print("=" * 50)
    print(f"Output written to {OUTPUT_FILE}")
    print(f"  exact:               {stats['exact']}")
    print(f"  name_and_flag:       {stats['name_and_flag']}")
    print(f"  name_only:           {stats['name_only']}")
    print(f"  multiple_candidates: {stats['multiple_candidates']}")
    print(f"  not_found:           {stats['not_found']}")
    print("=" * 50)
    print()
    print("Vessels needing manual review:")
    for v in vessels:
        if v.get("gfw_match_confidence") in ("multiple_candidates", "not_found", "name_only"):
            print(f"  [{v['gfw_match_confidence']:20s}] {v['vessel']} ({v.get('flag')})")
            if v.get("gfw_candidates"):
                for c in v["gfw_candidates"]:
                    print(f"      candidate: {c.get('gfw_shipname')} flag={c.get('gfw_flag')} "
                          f"ssvid={c.get('gfw_ssvid')} imo={c.get('gfw_imo')}")


if __name__ == "__main__":
    run()
