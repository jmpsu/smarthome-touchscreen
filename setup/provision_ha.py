#!/usr/bin/env python3
"""Headless Home Assistant provisioning so lights integrate with zero clicking.

Run after the HA container is up. This:
  1. completes HA onboarding (creates the owner account + core config from .env),
  2. mints a long-lived access token and writes HA_TOKEN back into .env
     (so the dashboard talks to HA immediately, no UI login),
  3. pre-registers Spotify OAuth "application credentials" from .env,
  4. kicks off the integration config-flows we can start headlessly
     (WiZ by discovery, Tuya cloud) and reports which ones still need a single
     OAuth/QR click.

It is idempotent and best-effort: anything already done is skipped, and any step
that can't complete headlessly is reported with the exact one-click follow-up
rather than failing the whole run.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sys
import time
from pathlib import Path

import requests

CLIENT_ID = "http://localhost:8123/"


def log(msg: str) -> None:
    print(f"[provision] {msg}", flush=True)


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def set_env(path: Path, key: str, value: str) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    out, found = [], False
    for line in lines:
        if line.strip().startswith(f"{key}="):
            out.append(f"{key}={value}"); found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n")


def wait_for_ha(base: str, timeout: int = 180) -> bool:
    for _ in range(timeout // 2):
        try:
            if requests.get(f"{base}/manifest.json", timeout=3).status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def onboarding_state(base: str) -> list[str]:
    try:
        r = requests.get(f"{base}/api/onboarding", timeout=5)
        return [s["step"] for s in r.json() if s.get("done")]
    except Exception:
        return []


def do_onboarding(base: str, env: dict[str, str]) -> str | None:
    """Create the owner user + core config. Returns an auth code, or None if the
    instance is already onboarded (in which case a token must already exist)."""
    done = onboarding_state(base)
    if "user" in done:
        log("HA already onboarded — skipping user creation.")
        return None

    username = env.get("HA_USERNAME") or "admin"
    password = env.get("HA_PASSWORD") or secrets.token_urlsafe(16)
    set_env(Path(env["_path"]), "HA_USERNAME", username)
    set_env(Path(env["_path"]), "HA_PASSWORD", password)

    log("Creating HA owner account…")
    r = requests.post(f"{base}/api/onboarding/users", timeout=15, json={
        "client_id": CLIENT_ID, "name": "Home", "username": username,
        "password": password, "language": "en",
    })
    r.raise_for_status()
    auth_code = r.json()["auth_code"]

    # core config (location/units) — best effort
    try:
        requests.post(f"{base}/api/onboarding/core_config", timeout=10,
                      headers=_bearer_from_code(base, auth_code))
    except Exception:
        pass
    return auth_code


def _bearer_from_code(base: str, auth_code: str) -> dict[str, str]:
    tok = exchange_code(base, auth_code)
    return {"Authorization": f"Bearer {tok['access_token']}"}


def exchange_code(base: str, auth_code: str) -> dict:
    r = requests.post(f"{base}/auth/token", timeout=15, data={
        "grant_type": "authorization_code", "code": auth_code, "client_id": CLIENT_ID,
    })
    r.raise_for_status()
    return r.json()


async def mint_long_lived(base: str, access_token: str) -> str | None:
    """Create a 10-year long-lived token via the websocket API."""
    import websockets
    ws_url = base.replace("http", "ws", 1) + "/api/websocket"
    async with websockets.connect(ws_url, max_size=2**22) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": access_token}))
        if json.loads(await ws.recv()).get("type") != "auth_ok":
            return None
        await ws.send(json.dumps({
            "id": 1, "type": "auth/long_lived_access_token",
            "client_name": f"dashboard-{secrets.token_hex(3)}", "lifespan": 3650,
        }))
        resp = json.loads(await ws.recv())
        return resp.get("result") if resp.get("success") else None


def start_flow(base: str, token: str, domain: str) -> str:
    """Begin an integration config flow; returns a short status string."""
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        r = requests.post(f"{base}/api/config/config_entries/flow", headers=h,
                          timeout=15, json={"handler": domain, "show_advanced_options": True})
        data = r.json()
        step = data.get("step_id", data.get("type", "?"))
        return f"{domain}: started (step '{step}')"
    except Exception as e:
        return f"{domain}: could not start ({e})"


def register_spotify_app_creds(base: str, token: str, env: dict[str, str]) -> str:
    cid, sec = env.get("SPOTIFY_CLIENT_ID"), env.get("SPOTIFY_CLIENT_SECRET")
    if not (cid and sec):
        return "spotify: no client id/secret in .env — skipped"
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        requests.post(f"{base}/api/config/application_credentials/config", headers=h,
                      timeout=10, json={"domain": "spotify", "client_id": cid,
                                        "client_secret": sec, "name": "Spotify"})
        return "spotify: app credentials registered (finish with 1 OAuth click in HA)"
    except Exception as e:
        return f"spotify: app-cred registration failed ({e})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-dir", default=os.path.expanduser("~/smarthome-touchscreen"))
    ap.add_argument("--ha-url", default=os.getenv("HA_BASE_URL_LOCAL", "http://localhost:8123"))
    args = ap.parse_args()

    root = Path(args.project_dir)
    env_path = root / ".env"
    env = load_env(env_path)
    env["_path"] = str(env_path)
    base = args.ha_url.rstrip("/")

    log(f"Waiting for Home Assistant at {base} …")
    if not wait_for_ha(base):
        log("HA did not come up in time; re-run this script later.")
        return 1

    # 1-2) onboarding + token
    if env.get("HA_TOKEN"):
        log("HA_TOKEN already set — skipping onboarding/token.")
        token = env["HA_TOKEN"]
    else:
        code = do_onboarding(base, env)
        if code is None:
            log("No auth code (already onboarded) and no HA_TOKEN. Create a "
                "long-lived token in HA → Profile → Security and put it in .env.")
            return 2
        tokens = exchange_code(base, code)
        token = asyncio.run(mint_long_lived(base, tokens["access_token"]))
        if not token:
            log("Could not mint a long-lived token.")
            return 3
        set_env(env_path, "HA_TOKEN", token)
        log("HA_TOKEN written to .env — dashboard can now talk to HA with no login.")

    # 3) Spotify application credentials
    if env.get("SPOTIFY_ENABLED", "").lower() == "true":
        log(register_spotify_app_creds(base, token, env))

    # 4) kick off device integrations we can start headlessly
    reports = []
    if env.get("WIZ_ENABLED", "true").lower() == "true":
        reports.append(start_flow(base, token, "wiz"))
    if env.get("TUYA_ENABLED", "").lower() == "true":
        reports.append(start_flow(base, token, "tuya"))
    if env.get("EUFY_ENABLED", "").lower() == "true":
        reports.append("eufy: streams via eufy-security-ws container (no HA flow)")
    for line in reports:
        log(line)

    log("Done. Any integration marked 'started' or needing OAuth/QR: open "
        f"{base} → Settings → Devices & Services and confirm the pending flow "
        "(usually one tap). Lights appear on the dashboard automatically after.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
