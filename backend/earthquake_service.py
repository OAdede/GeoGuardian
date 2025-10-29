import requests

# USGS feed deseni: summary/{mag}_{window}.geojson
# mag: all | 1.0 | 2.5 | 4.5 | significant
# window: hour | day | week | month

def mag_bucket(minmag: float) -> str:
    if minmag >= 4.5:
        return "4.5"
    elif minmag >= 2.5:
        return "2.5"
    elif minmag >= 1.0:
        return "1.0"
    else:
        return "all"

def window_bucket(window: str) -> str:
    window = (window or "day").lower()
    return "hour" if window in ["hour", "saat"] else \
           "day"  if window in ["day", "gün", "gun"] else \
           "week" if window in ["week", "hafta"] else \
           "month"

def get_latest_earthquakes(window: str = "day", minmag: float = 0.0):
    mag = mag_bucket(minmag)
    win = window_bucket(window)
    url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{mag}_{win}.geojson"

    try:
        res = requests.get(url, timeout=8)
        res.raise_for_status()
        data = res.json().get("features", [])
        quakes = []
        for q in data:
            coords = q["geometry"]["coordinates"]
            quakes.append({
                "title": q["properties"]["place"],
                "mag": q["properties"]["mag"] or 0,
                "lat": coords[1],
                "lon": coords[0],
                "depth": coords[2] or 0,
                "time": q["properties"]["time"],
                "source": "USGS",
            })
        return quakes
    except Exception as e:
        print("USGS Hatası =>", e)
        return {"error": "Veri alınamadı"}
