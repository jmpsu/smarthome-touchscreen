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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import tides
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
        "timezone": os.getenv("TIMEZONE", "America/New_York"),
        "rotate_seconds": int(os.getenv("ROTATE_SECONDS", "10")),
        "x_account": os.getenv("X_ACCOUNT", "SurfnWeatherman"),
        "tides_month_url": os.getenv(
            "TIDES_MONTH_URL",
            "https://www.tidespro.com/us/florida/jupiter-inlet-us-highway-1-bridge/month",
        ),
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
