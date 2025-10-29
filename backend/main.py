from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.earthquake_service import get_latest_earthquakes
from backend.weather_service import get_weather

app = FastAPI(title="GeoGuardian API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "GeoGuardian API Running ✅"}

@app.get("/earthquakes")
def earthquakes(window: str = "day", minmag: float = 0.0):
    try:
        return get_latest_earthquakes(window=window, minmag=minmag)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Deprem servisi çalışmıyor: {str(e)}")

@app.get("/weather/{lat}/{lon}")
def weather(lat: float, lon: float):
    try:
        return get_weather(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Hava durumu servisi hatası: {str(e)}")
