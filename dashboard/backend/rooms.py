"""Room assignments for devices, editable from the touch screen.

Home Assistant has its own "areas", but assigning entities to areas over the
websocket registry API is fiddly and device-dependent. To keep the on-screen
"add device / assign to room" flow simple and reliable, we keep a lightweight
local mapping in ``rooms.json`` next to the project:

    {
      "rooms": ["Living Room", "Kitchen", "Boys Room"],
      "assignments": { "light.couch": "Living Room", ... }
    }

The dashboard groups lights by these rooms (falling back to HA's area attribute,
then to "Unassigned"). This is the source of truth the user edits via the UI.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

_LOCK = threading.Lock()

DEFAULT_ROOMS = ["Living Room", "Kitchen", "Bedroom", "Bathroom", "Outside"]


def _path() -> Path:
    root = Path(os.getenv("PROJECT_ROOT", Path(__file__).resolve().parent.parent.parent))
    return root / "rooms.json"


def load() -> dict:
    p = _path()
    if p.exists():
        try:
            data = json.loads(p.read_text())
            data.setdefault("rooms", list(DEFAULT_ROOMS))
            data.setdefault("assignments", {})
            return data
        except Exception:
            pass
    return {"rooms": list(DEFAULT_ROOMS), "assignments": {}}


def save(data: dict) -> None:
    with _LOCK:
        _path().write_text(json.dumps(data, indent=2))


def create_room(name: str) -> dict:
    name = (name or "").strip()
    data = load()
    if name and name not in data["rooms"]:
        data["rooms"].append(name)
        save(data)
    return data


def delete_room(name: str) -> dict:
    data = load()
    data["rooms"] = [r for r in data["rooms"] if r != name]
    # unassign any entities that pointed at the removed room
    data["assignments"] = {
        e: r for e, r in data["assignments"].items() if r != name
    }
    save(data)
    return data


def assign(entity_id: str, room: str | None) -> dict:
    data = load()
    if not entity_id:
        return data
    if room:
        if room not in data["rooms"]:
            data["rooms"].append(room)
        data["assignments"][entity_id] = room
    else:
        data["assignments"].pop(entity_id, None)
    save(data)
    return data
