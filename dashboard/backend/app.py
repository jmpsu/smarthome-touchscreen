"""SmartHome Touchscreen dashboard — FastAPI backend.

Responsibilities:
  * serve the static dark-themed touch UI (frontend/)
  * proxy the Home Assistant WebSocket so the browser gets real-time device
    state without exposing the HA token to the client
  * expose light/scene/camera control endpoints (thin wrappers over HA services)
  * serve the rotating-display data (tides / solunar / sun-moon) + month drill-down
  * serve the discovered-devices inventory + HomeKit pairing info for Settings
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import celestial
from . import rooms as rooms_store
from . import store
from . import tides
from . import voice as voice_mod
from . import voice_rules
from . import weather as weather_mod
from .ha_client import HAClient

BASE = Path(__file__).resolve().parent.parent
FRONTEND = BASE / "frontend"
PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", BASE.parent))

app = FastAPI(title="SmartHome Touchscreen")
ha = HAClient()


# --------------------------------------------------------------------------- #
# Config the frontend needs at startup (no secrets leave the server)
# --------------------------------------------------------------------------- #
@app.get("/api/config")
async def config():
    return {
        "screen": {
            "width": int(os.getenv("SCREEN_WIDTH", "1920")),
            "height": int(os.getenv("SCREEN_HEIGHT", "720")),
        },
        "timezone": os.getenv("TIMEZONE") or "UTC",
        "rotate_seconds": int(os.getenv("ROTATE_SECONDS", "10")),
        "x_account": os.getenv("X_ACCOUNT", "").lstrip("@"),
        "tides_enabled": bool(os.getenv("TIDES_WEEK_URL", "").strip()),
        "tides_month_url": os.getenv("TIDES_MONTH_URL", ""),
        "demo_mode": ha.demo,
        "ha_healthy": await ha.healthy(),
    }


# --------------------------------------------------------------------------- #
# Devices: initial snapshot + control
# --------------------------------------------------------------------------- #
@app.get("/api/states")
async def states():
    """All HA entities; the frontend filters lights/switches/cameras/climate."""
    try:
        return await ha.states()
    except Exception as e:
        return JSONResponse({"error": str(e), "states": []}, status_code=502)


@app.get("/api/camera/{entity_id}/snapshot")
async def camera_snapshot(entity_id: str):
    """Proxy a still image for ANY Home Assistant camera entity (any brand).

    This keeps camera live views generic: the frontend refreshes this endpoint
    for a near-live view without needing brand-specific stream URLs. The HA
    token stays server-side.
    """
    import httpx
    from fastapi.responses import Response
    url = f"{ha.base_url}/api/camera_proxy/{entity_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url, headers={"Authorization": f"Bearer {ha.token}"})
            return Response(content=r.content,
                            media_type=r.headers.get("content-type", "image/jpeg"))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/service/{domain}/{service}")
async def call_service(domain: str, service: str, payload: dict):
    """Proxy an HA service call (turn_on/off, brightness, color, scene, etc.)."""
    try:
        result = await ha.call_service(domain, service, payload or {})
        return {"ok": True, "result": result}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)


@app.get("/api/discovered")
async def discovered():
    """Devices found by setup/scan_network.py — shown on the Settings screen."""
    path = PROJECT_ROOT / "discovered_devices.json"
    if path.exists():
        return json.loads(path.read_text())
    return {"count": 0, "devices": []}


@app.post("/api/scan")
async def scan():
    """Run a fresh network scan on demand (the 'Add device' flow uses this)."""
    import asyncio
    script = PROJECT_ROOT / "setup" / "scan_network.py"
    out = PROJECT_ROOT / "discovered_devices.json"
    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", str(script), "--output", str(out),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=60)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    if out.exists():
        return {"ok": True, **json.loads(out.read_text())}
    return {"ok": True, "count": 0, "devices": []}


# --------------------------------------------------------------------------- #
# Rooms: list / create / delete / assign (edited from the touch screen)
# --------------------------------------------------------------------------- #
@app.get("/api/rooms")
async def get_rooms():
    return rooms_store.load()


@app.post("/api/rooms/create")
async def create_room(payload: dict):
    return rooms_store.create_room(payload.get("name", ""))


@app.post("/api/rooms/delete")
async def delete_room(payload: dict):
    return rooms_store.delete_room(payload.get("name", ""))


@app.post("/api/rooms/assign")
async def assign_room(payload: dict):
    """Assign an entity (light/switch/camera) to a room, or clear it (room=null)."""
    return rooms_store.assign(payload.get("entity_id", ""), payload.get("room"))


# --------------------------------------------------------------------------- #
# Launcher apps + floor plan (user-editable, generic defaults)
# --------------------------------------------------------------------------- #
@app.get("/api/apps")
async def get_apps():
    return store.load("apps", store.DEFAULT_APPS)


@app.post("/api/apps")
async def save_apps(payload: dict):
    store.save("apps", payload)
    return {"ok": True}


@app.get("/api/floorplan")
async def get_floorplan():
    return store.load("floorplan", store.DEFAULT_FLOORPLAN)


@app.post("/api/floorplan")
async def save_floorplan(payload: dict):
    store.save("floorplan", payload)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Voice command (called by an Apple Shortcut / Siri automation)
# --------------------------------------------------------------------------- #
async def _lights_snapshot() -> list[voice_mod.Light]:
    """Build the Light list the parser needs from HA + room assignments."""
    assignments = rooms_store.load().get("assignments", {})
    lights: list[voice_mod.Light] = []
    try:
        states = await ha.states()
    except Exception:
        states = []
    for s in states:
        if not s["entity_id"].startswith("light."):
            continue
        attrs = s.get("attributes", {})
        modes = attrs.get("supported_color_modes", []) or []
        room = assignments.get(s["entity_id"]) or attrs.get("room") or attrs.get("area") or ""
        lights.append(voice_mod.Light(
            entity_id=s["entity_id"],
            name=attrs.get("friendly_name", s["entity_id"].split(".")[1]),
            room=room,
            supports_color=any(m in modes for m in ("rgb", "rgbw", "rgbww", "hs", "xy")),
            supports_temp="color_temp" in modes,
        ))
    return lights


@app.post("/api/voice/command")
async def voice_command(payload: dict):
    """Parse a spoken phrase and execute it. Returns a spoken confirmation.

    Body: {"text": "dim the kitchen lights by 99%"}
    An Apple Shortcut posts the dictated text here and speaks back `spoken`.
    """
    text = payload.get("text", "")
    lights = await _lights_snapshot()

    # The user's own rules come first; the built-in parser is the safety net
    # for phrasings no rule covers, so removing every rule never bricks voice.
    rules = store.load("voice_rules", voice_rules.DEFAULT_RULES).get("rules", [])
    plan = voice_rules.plan_for(text, lights, rules, await _media_entity())
    if not plan.understood:
        fallback = voice_mod.parse(text, lights)
        if fallback.understood:
            plan = fallback

    if payload.get("dry_run"):
        return {"spoken": plan.spoken, "understood": plan.understood,
                "matched": plan.matched, "calls": plan.calls}
    for call in plan.calls:
        try:
            await ha.call_service(call["domain"], call["service"], call["data"])
        except Exception as e:
            return JSONResponse(
                {"spoken": "Something went wrong reaching the lights.",
                 "error": str(e)}, status_code=502)
    return {"spoken": plan.spoken, "understood": plan.understood,
            "matched": plan.matched}


async def _media_entity() -> str:
    """The media player voice rules act on: whatever is playing, else the first."""
    try:
        states = await ha.states()
    except Exception:
        return ""
    players = [s for s in states if s["entity_id"].startswith("media_player.")]
    playing = next((s for s in players if s.get("state") == "playing"), None)
    chosen = playing or (players[0] if players else None)
    return chosen["entity_id"] if chosen else ""


# --------------------------------------------------------------------------- #
# Voice rules — the editable phrase book behind Settings > Voice
# --------------------------------------------------------------------------- #
@app.get("/api/voice/rules")
async def voice_rules_get():
    data = store.load("voice_rules", voice_rules.DEFAULT_RULES)
    scenes = []
    try:
        scenes = [
            s.get("attributes", {}).get("friendly_name") or s["entity_id"].split(".")[1]
            for s in await ha.states() if s["entity_id"].startswith("scene.")
        ]
    except Exception:
        pass
    return {
        "rules": data.get("rules", []),
        "actions": [{"id": k, "label": v["label"], "needs": v["needs"]}
                    for k, v in voice_rules.ACTIONS.items()],
        "scenes": scenes,
    }


@app.post("/api/voice/rules")
async def voice_rules_save(payload: dict):
    """Replace the rule set. Body: {"rules": [{action, phrases[], scene?}]}."""
    rules = payload.get("rules")
    if not isinstance(rules, list):
        return JSONResponse({"error": "rules must be a list"}, status_code=400)
    clean = []
    for r in rules:
        action = str(r.get("action", ""))
        if action not in voice_rules.ACTIONS:
            return JSONResponse({"error": f"unknown action: {action}"}, status_code=400)
        phrases = [str(p).strip() for p in r.get("phrases", []) if str(p).strip()]
        entry: dict = {"action": action, "phrases": phrases}
        if r.get("scene"):
            entry["scene"] = str(r["scene"])
        clean.append(entry)
    store.save("voice_rules", {"rules": clean})
    return {"ok": True, "count": len(clean)}


@app.post("/api/voice/rules/reset")
async def voice_rules_reset():
    store.save("voice_rules", voice_rules.DEFAULT_RULES)
    return {"ok": True, "rules": voice_rules.DEFAULT_RULES["rules"]}


@app.get("/api/voice/sentences")
async def voice_sentences():
    """The 'Build Siri phrases' download: Home Assistant custom_sentences YAML."""
    rules = store.load("voice_rules", voice_rules.DEFAULT_RULES).get("rules", [])
    yaml_text = voice_rules.build_ha_sentences(rules)
    return Response(
        yaml_text,
        media_type="text/yaml",
        headers={"Content-Disposition": 'attachment; filename="panel.yaml"'},
    )


@app.get("/api/homekit")
async def homekit():
    """HomeKit pairing PIN so Settings can render the Add-to-Apple-Home QR."""
    pin = os.getenv("HOMEKIT_PIN", "")
    # Standard HomeKit setup URI Apple's camera understands.
    uri = f"X-HM://{pin.replace('-', '')}" if pin else ""
    return {"pin": pin, "setup_uri": uri}


# --------------------------------------------------------------------------- #
# Rotating info displays
# --------------------------------------------------------------------------- #
@app.get("/api/displays")
async def displays():
    try:
        return await tides.get_displays()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/weather")
async def weather():
    """Current conditions + 6-day forecast + pollen for the weather displays."""
    try:
        return await weather_mod.get_weather()
    except Exception as e:
        return JSONResponse({"enabled": False, "error": str(e)}, status_code=502)


@app.get("/api/celestial")
async def celestial_events():
    """Curated upcoming celestial events for the rotating slides + calendar."""
    try:
        return celestial.upcoming()
    except Exception as e:
        return JSONResponse({"slides": [], "calendar": [], "error": str(e)},
                            status_code=500)


@app.get("/api/displays/month")
async def displays_month():
    try:
        return await tides.get_month()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


# --------------------------------------------------------------------------- #
# Home Assistant WebSocket proxy (real-time state for lights/cameras)
# --------------------------------------------------------------------------- #
@app.websocket("/ha-ws")
async def ha_ws(client: WebSocket):
    """Bridge the browser to HA's WS API, injecting our token server-side.

    The browser speaks the normal HA websocket protocol but never sees the
    token: when HA sends `auth_required`, we answer with the token from the
    environment. Everything else is relayed verbatim in both directions.
    """
    await client.accept()
    try:
        async with websockets.connect(ha.ws_url(), max_size=8 * 1024 * 1024) as upstream:
            import asyncio

            async def upstream_to_client():
                async for message in upstream:
                    data = json.loads(message)
                    if data.get("type") == "auth_required":
                        await upstream.send(json.dumps(
                            {"type": "auth", "access_token": ha.token}))
                        continue
                    if data.get("type") in ("auth_ok", "auth_invalid"):
                        # tell the client it's authed without leaking the token
                        await client.send_json(
                            {"type": "auth_ok"} if data["type"] == "auth_ok"
                            else {"type": "auth_invalid"})
                        continue
                    await client.send_text(message)

            async def client_to_upstream():
                while True:
                    msg = await client.receive_text()
                    # swallow any auth attempt from the browser; we handle it
                    parsed = json.loads(msg)
                    if parsed.get("type") == "auth":
                        continue
                    await upstream.send(msg)

            await asyncio.gather(upstream_to_client(), client_to_upstream())
    except WebSocketDisconnect:
        pass
    except Exception as e:  # surface upstream failures to the client UI
        try:
            await client.send_json({"type": "proxy_error", "error": str(e)})
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Static frontend (mounted last so /api/* wins)
# --------------------------------------------------------------------------- #
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
