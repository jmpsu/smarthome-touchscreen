"""In-memory demo fleet so the whole system runs live without real credentials.

Enable with DEMO_MODE=1. This mirrors a real Home Assistant `/api/states`
payload for a representative home spanning every brand in play — Tuya, WiZ,
Monster, Marvelight strips, a SmartLife sprinkler, two Eufy cameras, and a
Spotify player — each assigned to a room. Control calls mutate this state, so
toggling, dimming, colouring, playback, etc. all behave exactly as they will
with real devices. Swap DEMO_MODE off + add credentials and the identical UI
drives the real fleet.
"""
from __future__ import annotations

import copy
from typing import Any

RGB_MODES = ["rgb", "color_temp"]
TEMP_MODES = ["color_temp"]


def _light(entity_id, name, room, brand, modes, on=True, bri=180, rgb=(255, 190, 120)):
    attrs: dict[str, Any] = {
        "friendly_name": name, "room": room, "brand": brand,
        "supported_color_modes": modes, "brightness": bri if on else None,
    }
    if "rgb" in modes:
        attrs["rgb_color"] = list(rgb)
        attrs["color_mode"] = "rgb"
    elif "color_temp" in modes:
        attrs["color_temp"] = 350
        attrs["color_mode"] = "color_temp"
    return {"entity_id": entity_id, "state": "on" if on else "off", "attributes": attrs}


def _seed() -> dict[str, dict]:
    fleet = [
        # Living Room — Tuya + Marvelight strip
        _light("light.living_room_couch", "Couch", "Living Room", "Tuya", RGB_MODES, True, 15, (255, 120, 40)),
        _light("light.living_room_cabinet", "Cabinet", "Living Room", "Tuya", RGB_MODES, True, 255, (255, 170, 60)),
        _light("light.living_room_strip", "Marvelight Strip", "Living Room", "Marvelight", ["rgb"], True, 200, (140, 60, 255)),
        # Kitchen — WiZ
        _light("light.kitchen_ceiling", "Kitchen Ceiling", "Kitchen", "WiZ", RGB_MODES, True, 220, (255, 210, 170)),
        _light("light.kitchen_sink", "Kitchen Sink Light", "Kitchen", "WiZ", TEMP_MODES, False, 0),
        # Master Bedroom — Tuya
        _light("light.master_bedroom", "Master Bedroom", "Master Bedroom", "Tuya", RGB_MODES, False, 0),
        # Office — Monster
        _light("light.office", "Office", "Office", "Monster", RGB_MODES, True, 120, (80, 160, 255)),
        # Guest Bedroom — Marvelight strip
        _light("light.guest_strip", "Marvelight Strip 2", "Guest Bedroom", "Marvelight", ["rgb"], False, 0),
        # SmartLife sprinkler (switch)
        {"entity_id": "switch.sprinkler", "state": "off",
         "attributes": {"friendly_name": "Sprinkler System", "room": "Outside", "brand": "SmartLife"}},
        # Eufy cameras
        {"entity_id": "camera.front_door", "state": "streaming",
         "attributes": {"friendly_name": "Front Door (Eufy)", "brand": "Eufy",
                        "entity_picture": ""}},
        {"entity_id": "camera.backyard", "state": "streaming",
         "attributes": {"friendly_name": "Backyard (Eufy)", "brand": "Eufy",
                        "entity_picture": ""}},
        # Spotify
        {"entity_id": "media_player.spotify", "state": "playing",
         "attributes": {"friendly_name": "Spotify", "source": "Kitchen HomePod",
                        "media_title": "Here Comes the Sun", "media_artist": "The Beatles",
                        "media_album_name": "Abbey Road", "volume_level": 0.4,
                        "entity_picture": ""}},
        # a couple of scenes
        {"entity_id": "scene.movie_night", "state": "on",
         "attributes": {"friendly_name": "Movie Night"}},
        {"entity_id": "scene.all_bright", "state": "on",
         "attributes": {"friendly_name": "All Bright"}},
    ]
    return {e["entity_id"]: e for e in fleet}


_STATE: dict[str, dict] = _seed()


def states() -> list[dict]:
    return copy.deepcopy(list(_STATE.values()))


def _targets(data: dict) -> list[str]:
    ent = data.get("entity_id")
    if ent in (None, "all"):
        return [k for k in _STATE if k.startswith("light.")]
    return ent if isinstance(ent, list) else [ent]


def call_service(domain: str, service: str, data: dict) -> dict:
    """Mutate the demo fleet to reflect the requested change."""
    data = data or {}
    for eid in _targets(data):
        e = _STATE.get(eid)
        if not e:
            continue
        a = e["attributes"]
        if domain in ("light", "switch"):
            if service == "turn_off":
                e["state"] = "off"
                if "brightness" in a:
                    a["brightness"] = None
            elif service == "turn_on":
                e["state"] = "on"
                if "brightness_pct" in data:
                    a["brightness"] = round(data["brightness_pct"] * 255 / 100)
                elif a.get("brightness") in (None, 0):
                    a["brightness"] = 200
                if "rgb_color" in data:
                    a["rgb_color"] = data["rgb_color"]; a["color_mode"] = "rgb"
                if "color_temp" in data:
                    a["color_temp"] = data["color_temp"]; a["color_mode"] = "color_temp"
            elif service == "toggle":
                e["state"] = "off" if e["state"] == "on" else "on"
        elif domain == "media_player":
            if service == "media_pause":
                e["state"] = "paused"
            elif service == "media_play":
                e["state"] = "playing"
            elif service == "volume_set" and "volume_level" in data:
                a["volume_level"] = data["volume_level"]
        elif domain == "scene":
            pass  # scenes are no-ops in demo
    return {"demo": True, "service": f"{domain}.{service}", "data": data}
