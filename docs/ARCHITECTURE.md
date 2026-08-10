# Architecture

```
                         ┌──────────────────────────────────────────┐
                         │           Raspberry Pi 5 (Pi OS)          │
                         │                                            │
   Touch panel  ◀──HDMI──┤  Chromium (kiosk)  ──▶  Dashboard (FastAPI)│
   1920×720             │        │  websocket + REST │        │       │
                         │        ▼                   ▼        │       │
                         │  ┌───────────────┐   ┌──────────────┐│      │
                         │  │ Home Assistant│◀─▶│ eufy-security │◀────┐ │
                         │  │  (Docker)     │   │ -ws + MediaMTX│     │ │
                         │  └──────┬────────┘   └──────────────┘     │ │
                         └─────────┼─────────────────────┼──────────┼─┘
                                   │ LAN (Wi-Fi)         │          │
        ┌──────────────┬──────────┴───────┬─────────────┴───┐   Eufy cloud
        ▼              ▼                  ▼                 ▼   (camera auth)
     Tuya /        WiZ bulbs         Monster /          Sprinkler
     SmartLife                      Marvelight strips   (SmartLife)
        │
        ▼
   Apple HomeKit  ◀── HomeKit Bridge exposes every entity ──▶  Siri / iPhone / HomePod
```

## Components

| Component | Role | Why |
|-----------|------|-----|
| **Home Assistant** (`ghcr.io/home-assistant/home-assistant`) | Integration hub. Talks to Tuya (SmartLife QR), WiZ, Eufy, and generic devices. Runs the **HomeKit Bridge** that re-exports everything to Apple Home. | Single well-supported layer that already speaks every brand's protocol; `network_mode: host` lets it discover LAN devices and advertise HomeKit over mDNS. |
| **Dashboard** (FastAPI + vanilla JS) | The dark touch UI. Real-time control via a WebSocket proxy to HA; renders the rotating tide/solunar/X displays. | Keeps the HA token server-side, ships a lightweight kiosk UI tuned for the 1920×720 panel. |
| **eufy-security-ws + MediaMTX** | Pull Eufy camera streams and re-publish them as HLS/WebRTC for the dashboard + HA. | Eufy has no open local API; this is the standard local-restream path. |
| **Setup wizard** (`setup/first_run_setup.py`) | On-screen first-run prompts for the few credentials that can't be auto-discovered; writes `.env`. | Meets the "prompt for passwords on the Pi screen" requirement. |
| **Network scanner** (`setup/scan_network.py`) | mDNS + WiZ-UDP + arp-scan sweep → `discovered_devices.json`. | Meets "scan all devices thoroughly so everything is primed". |

## Data flow for a light tap

1. User taps a light card → `lights.js` calls `POST /api/service/light/turn_on`.
2. Dashboard backend forwards it to HA's REST API (token added server-side).
3. HA drives the device over its native protocol (Tuya local, WiZ UDP, …).
4. HA emits a `state_changed` event → dashboard WS proxy → `ha.js` → UI updates.
5. Because HA also bridges the entity to HomeKit, the same change is reflected
   in Apple Home / Siri instantly.

## Rotating displays

The rotating home panel is **fully user-configured** — nothing is hardcoded. In
the setup wizard (or Settings) a user can optionally provide:

- a **tidespro.com location URL** → adds three panels (`Next 7 Days`, `Tides`,
  `Solunars & Sun/Moon`) parsed by `dashboard/backend/tides.py`, with a
  tap-to-open month drill-down;
- an **X/Twitter handle** → adds a live timeline panel that opens x.com on tap.

`rotating.js` builds the panel set dynamically from whatever is configured and
fades between them every `ROTATE_SECONDS`. If nothing is set, an always-present
clock/date panel shows, so a fresh install is never blank.

See [`DEVICES.md`](DEVICES.md) for per-brand integration details.
