"""Thin async client for the Home Assistant REST + WebSocket APIs.

The dashboard frontend gets *real-time* state by connecting to HA's WebSocket
through a proxy (see app.py `/ha-ws`). This module handles the server-side
pieces: REST fallbacks for control, and reading the long-lived token.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

from . import demo


class HAClient:
    def __init__(self, base_url: str | None = None, token: str | None = None):
        self.base_url = (base_url or os.getenv("HA_BASE_URL", "http://homeassistant:8123")).rstrip("/")
        self.token = token or os.getenv("HA_TOKEN", "")
        # DEMO_MODE=1 runs the whole system on a representative in-memory fleet
        # (Tuya/WiZ/Monster/Marvelight/SmartLife/Eufy/Spotify) so every feature
        # works live before real credentials are supplied.
        self.demo = os.getenv("DEMO_MODE", "").lower() in ("1", "true", "yes")

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def ws_url(self) -> str:
        return self.base_url.replace("http", "ws", 1) + "/api/websocket"

    async def states(self) -> list[dict[str, Any]]:
        """All entity states (used to build the initial light/camera grid)."""
        if self.demo:
            return demo.states()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.base_url}/api/states", headers=self._headers)
            r.raise_for_status()
            return r.json()

    async def call_service(self, domain: str, service: str, data: dict[str, Any]) -> Any:
        """Generic service call — turn_on/off, set brightness, color, etc."""
        if self.demo:
            return demo.call_service(domain, service, data)
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{self.base_url}/api/services/{domain}/{service}",
                headers=self._headers,
                json=data,
            )
            r.raise_for_status()
            return r.json()

    async def healthy(self) -> bool:
        if self.demo:
            return True
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{self.base_url}/api/", headers=self._headers)
                return r.status_code == 200
        except Exception:
            return False
