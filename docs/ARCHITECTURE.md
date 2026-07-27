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

`dashboard/backend/tides.py` scrapes the tidespro pages named in the spec and
normalizes them into three panels (`Next 7 Days`, `Tides`, `Solunars & Sun/Moon`)
plus a month drill-down. `rotating.js` fades between them every 10 s and adds the
`@SurfnWeatherman` X timeline as a fourth panel. Tapping a tide panel opens the
Jupiter Inlet month table in a modal; tapping the X panel opens x.com.

See [`DEVICES.md`](DEVICES.md) for per-brand integration details.
