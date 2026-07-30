from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from earthquake_service import get_latest_earthquakes
from weather_service import get_weather

app = FastAPI(title="GeoGuardian API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"status": "GeoGuardian backend ✅ running"}

@app.get("/earthquakes")
def earthquakes(window: str = "day", minmag: float = 0.0):
    return get_latest_earthquakes(window, minmag)

@app.get("/weather")
def weather(lat: float, lon: float):
    """Deprem noktasındaki güncel hava durumu (WEATHER_KEY tanımlıysa)."""
    return get_weather(lat, lon)
