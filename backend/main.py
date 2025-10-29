from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from earthquake_service import get_latest_earthquakes

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
