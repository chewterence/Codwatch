import json
import requests

with open("secrets.json") as f:
    secrets = json.load(f)

API_KEY = secrets["gfw_api_key"]
BASE_URL = "https://gateway.api.globalfishingwatch.org/v3"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def test_vessel_search():
    print("\n--- Vessel Search ---")
    params = {
        "query": "7831410",
        "datasets[0]": "public-global-vessel-identity:latest",
    }
    resp = requests.get(f"{BASE_URL}/vessels/search", headers=HEADERS, params=params)
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(json.dumps(data, indent=2))
    return data


def test_events():
    print("\n--- Events (fishing) ---")
    params = {
        "datasets[0]": "public-global-fishing-events:latest",
        "start-date": "2024-01-01",
        "end-date": "2024-01-31",
        "limit": 5,
        "offset": 0,
    }
    resp = requests.get(f"{BASE_URL}/events", headers=HEADERS, params=params)
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(json.dumps(data, indent=2))
    return data


if __name__ == "__main__":
    test_vessel_search()
    test_events()
