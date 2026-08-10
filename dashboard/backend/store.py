"""Tiny JSON file store for user-editable config (apps, floorplan, voice).

Each config lives in a JSON file next to the project root so it survives
container restarts and can be edited from the touch screen. Defaults are
returned when a file doesn't exist yet, so a fresh install works out of the box
and stays fully generic (nothing hardcoded to one home).
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

_LOCK = threading.Lock()


def _root() -> Path:
    return Path(os.getenv("PROJECT_ROOT", Path(__file__).resolve().parent.parent.parent))


def load(name: str, default):
    p = _root() / f"{name}.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return default


def save(name: str, data) -> None:
    with _LOCK:
        (_root() / f"{name}.json").write_text(json.dumps(data, indent=2))


# --------------------------------------------------------------------------- #
# Default catalogs — generic, editable by the user from the UI.
# --------------------------------------------------------------------------- #
DEFAULT_APPS = {
    "groups": [
        {
            "name": "Home",
            "tiles": [
                {"id": "home-map", "name": "Home Map", "desc": "Floor plan & rooms",
                 "icon": "🏠", "action": "screen:home-map"},
                {"id": "lights", "name": "Lights", "desc": "All lights by room",
                 "icon": "💡", "action": "screen:lights"},
                {"id": "rooms", "name": "Rooms", "desc": "Control by room",
                 "icon": "▦", "action": "screen:rooms"},
                {"id": "scenes", "name": "Scenes", "desc": "One-tap moods",
                 "icon": "✦", "action": "screen:scenes"},
                {"id": "cameras", "name": "Cameras", "desc": "Live views",
                 "icon": "📹", "action": "screen:cameras"},
                {"id": "music", "name": "Music", "desc": "Spotify & playback",
                 "icon": "🎵", "action": "screen:music"},
            ],
        },
        {
            "name": "Info",
            "tiles": [
                {"id": "weather", "name": "Weather", "desc": "Now & 7 days",
                 "icon": "🌤", "action": "screen:weather"},
                {"id": "tides", "name": "Tides", "desc": "Highs, lows & sun",
                 "icon": "🌊", "action": "screen:displays"},
                {"id": "sky", "name": "Sky", "desc": "Meteors & moon",
                 "icon": "✦", "action": "screen:sky"},
                {"id": "voice", "name": "Voice", "desc": "Phrases & Siri",
                 "icon": "🎙", "action": "screen:settings"},
                {"id": "settings", "name": "Setup", "desc": "Devices, rooms, voice",
                 "icon": "⚙", "action": "screen:settings"},
            ],
        },
    ]
}

# A neutral example floor plan the user can reshape from the UI. Grid is 12x6.
DEFAULT_FLOORPLAN = {
    "grid": {"cols": 12, "rows": 6},
    "rooms": [
        {"name": "Office",         "col": 1,  "row": 1, "w": 2, "h": 3},
        {"name": "Master Bedroom", "col": 3,  "row": 1, "w": 3, "h": 3},
        {"name": "Bathroom",       "col": 6,  "row": 1, "w": 2, "h": 2},
        {"name": "Guest Bathroom", "col": 8,  "row": 1, "w": 2, "h": 2},
        {"name": "Hallway",        "col": 6,  "row": 3, "w": 4, "h": 1},
        {"name": "Guest Bedroom",  "col": 10, "row": 1, "w": 3, "h": 3},
        {"name": "Back Porch",     "col": 1,  "row": 4, "w": 2, "h": 2},
        {"name": "Laundry Room",   "col": 1,  "row": 6, "w": 2, "h": 1},
        {"name": "Kitchen",        "col": 3,  "row": 4, "w": 3, "h": 3},
        {"name": "Living Room",    "col": 6,  "row": 4, "w": 7, "h": 3},
    ],
}
