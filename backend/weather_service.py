import requests
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("WEATHER_KEY")

def get_weather(lat, lon):
    if not API_KEY:
        return {"error": "Weather API key missing"}

    url = (
        "http://api.openweathermap.org/data/2.5/weather"
        f"?lat={lat}&lon={lon}&units=metric&lang=tr&appid={API_KEY}"
    )

    res = requests.get(url)
    
    if res.status_code != 200:
        return {"error": "Weather API failed"}

    data = res.json()

    return {
        "temp": data.get("main", {}).get("temp"),
        "desc": data.get("weather", [{}])[0].get("description"),
        "wind": data.get("wind", {}).get("speed")
    }
