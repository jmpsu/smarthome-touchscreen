"""Weather, forecast, and pollen for the 'Current conditions' display.

Sources (no API key required):
  * Open-Meteo forecast API  -> current conditions + daily forecast
  * Open-Meteo air-quality API -> pollen (grass / ragweed / tree / mold* where
    available; Open-Meteo pollen has best coverage in Europe, degrades to null
    elsewhere — the UI shows "n/a" rather than failing).

The radar map itself is rendered client-side (a Windy radar embed centered on
the user's coordinates), so this module only supplies the numeric data.

Cached ~10 min. Returns {"enabled": False} when coordinates aren't set.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

_cache: dict[str, Any] = {}
_TTL = 600

WMO = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle",
    55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
    81: "Showers", 82: "Violent showers", 95: "Thunderstorm",
    96: "Thunderstorm w/ hail", 99: "Severe thunderstorm",
}


def _coords() -> tuple[float | None, float | None]:
    def num(k):
        try:
            return float((os.getenv(k, "") or "").strip())
        except Exception:
            return None
    return num("LATITUDE"), num("LONGITUDE")


async def _get(url: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=12) as c:
        r = await c.get(url, params=params)
        r.raise_for_status()
        return r.json()


async def get_weather() -> dict[str, Any]:
    lat, lon = _coords()
    if lat is None or lon is None:
        return {"enabled": False}

    key = f"{lat},{lon}"
    now = time.time()
    if key in _cache and now - _cache[key]["_t"] < _TTL:
        return _cache[key]["data"]

    tz = os.getenv("TIMEZONE", "auto") or "auto"
    try:
        fc = await _get("https://api.open-meteo.com/v1/forecast", {
            "latitude": lat, "longitude": lon, "timezone": tz,
            "temperature_unit": "fahrenheit", "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "current": ",".join([
                "temperature_2m", "apparent_temperature", "relative_humidity_2m",
                "surface_pressure", "wind_speed_10m", "wind_direction_10m",
                "uv_index", "precipitation", "weather_code"]),
            "daily": ",".join([
                "weather_code", "temperature_2m_max", "temperature_2m_min",
                "precipitation_probability_max"]),
            "forecast_days": 6,
        })
    except Exception as e:
        return {"enabled": True, "error": f"forecast: {e}"}

    pollen = {}
    try:
        aq = await _get("https://air-quality-api.open-meteo.com/v1/air-quality", {
            "latitude": lat, "longitude": lon, "timezone": tz,
            "current": ",".join([
                "grass_pollen", "ragweed_pollen", "birch_pollen", "alder_pollen",
                "mugwort_pollen", "olive_pollen"]),
        })
        cur = aq.get("current", {})
        # tree = max of the tree species Open-Meteo exposes
        tree = [cur.get(k) for k in ("birch_pollen", "alder_pollen", "olive_pollen")
                if cur.get(k) is not None]
        pollen = {
            "grass": cur.get("grass_pollen"),
            "ragweed": cur.get("ragweed_pollen"),
            "tree": max(tree) if tree else None,
            "mold": None,  # not provided by Open-Meteo; needs a paid source
        }
    except Exception:
        pollen = {"grass": None, "ragweed": None, "tree": None, "mold": None}

    cur = fc.get("current", {})
    daily = fc.get("daily", {})
    days = []
    times = daily.get("time", [])
    for i in range(len(times)):
        days.append({
            "date": times[i],
            "code": daily.get("weather_code", [None] * len(times))[i],
            "hi": _r(daily.get("temperature_2m_max", [None] * len(times))[i]),
            "lo": _r(daily.get("temperature_2m_min", [None] * len(times))[i]),
            "precip": daily.get("precipitation_probability_max", [None] * len(times))[i],
        })

    data = {
        "enabled": True,
        "current": {
            "temp": _r(cur.get("temperature_2m")),
            "feels_like": _r(cur.get("apparent_temperature")),
            "humidity": cur.get("relative_humidity_2m"),
            "pressure": _r(cur.get("surface_pressure")),
            "wind": _r(cur.get("wind_speed_10m")),
            "wind_dir": cur.get("wind_direction_10m"),
            "uv": _r(cur.get("uv_index")),
            "precip": cur.get("precipitation"),
            "code": cur.get("weather_code"),
            "summary": WMO.get(cur.get("weather_code"), ""),
        },
        "forecast": days,
        "pollen": pollen,
        "coords": {"lat": lat, "lon": lon},
    }
    _cache[key] = {"_t": now, "data": data}
    return data


def _r(v):
    return round(v) if isinstance(v, (int, float)) else v
