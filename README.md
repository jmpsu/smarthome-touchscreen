# SmartHome Touchscreen Control Panel

A **generic, shareable** wall-mounted smart-home command center for a
**Raspberry Pi 5 + touch screen**. Anyone can download it, install it, and set
up **their own** home — add their own lights, cameras, rooms, and info panels
entirely from the touch screen. Nothing is hardcoded to a particular house.

It unifies the Wi-Fi lights and devices on your network — **Tuya / SmartLife,
WiZ**, and other brands with a local or SmartLife-linked API — plus any
**cameras** you link, into one clean, dark-themed touch dashboard, and exposes
them all to **Apple HomeKit / Siri** as if they were native accessories.

Everything is designed to be copied to a **USB stick**, plugged into a Pi 5
running Raspberry Pi OS, and brought up with **one script**. An interactive
setup wizard prompts for the handful of passwords that can't be auto-discovered,
scans your network for devices, and launches the kiosk — typically in **1–5
minutes**. After that you **add devices and assign them to rooms right on the
touch screen** (Lights → ＋ Add device / Rooms).

---

## What you get

| Layer | Purpose |
|-------|---------|
| **Home Assistant** (Docker) | Device integration hub — Tuya, WiZ, Eufy, SmartLife, etc. Exposes everything to Apple HomeKit + Siri via the HomeKit Bridge. |
| **Kiosk Dashboard** (FastAPI + web) | The dark, glass-styled touch UI. Talks to Home Assistant over WebSocket for real-time control. Unified light grid, camera live views, scenes, and a rotating info panel (clock/tides/X). |
| **MediaMTX + eufy-security-ws** | Pulls the two Eufy cameras into low-latency WebRTC live views for the dashboard. |
| **Installer + Setup Wizard** | `install.sh` bootstraps Docker, prompts for credentials, discovers devices, and configures Chromium kiosk autostart. |

### The interface

- **Landing page** — an app-launcher home screen: a clock, a mini calendar +
  reminders, and grouped tiles for every tool the system controls (all
  user-editable). Tiles open internal screens or your own external tools.
- **Home map** — a sleek, top-down floor plan of your house (fully
  configurable). Tap a room to drill into just that room's lights and control
  color / brightness / on-off by touch.
- **Lights / Scenes / Cameras / Info** — the unified device screens.
- **Voice** — "Hey Siri…" via HomeKit is the primary control; an optional Apple
  Shortcut adds rich phrases like "dim the kitchen by 99%".

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture,
[`docs/DEVICES.md`](docs/DEVICES.md) for how each brand is integrated, and
[`docs/VOICE.md`](docs/VOICE.md) for voice setup.

---

## Quick start (on the Raspberry Pi 5)

1. Flash **Raspberry Pi OS (64-bit, Desktop)** to the Pi's SD card / NVMe and
   boot to the desktop once (see [`docs/HARDWARE.md`](docs/HARDWARE.md)).
2. Copy this entire folder onto a USB stick.
3. Plug the USB stick into the Pi. Open a terminal and run:

   ```bash
   cd /media/$USER/*/smarthome-touchscreen   # wherever the stick mounted
   ./install.sh
   ```

4. The **setup wizard** opens on the touch screen and asks for:
   - Wi-Fi / network confirmation
   - Tuya / SmartLife account (QR-code sync — no developer account needed)
   - WiZ (auto-discovered, no login)
   - Eufy Security e-mail + password (for camera streams)
   - The HomeKit pairing PIN is generated for you
5. When it finishes, the touch screen boots straight into the dashboard on every
   power-up. Scan the HomeKit QR shown in the Settings screen with your iPhone
   to add every device to Apple Home at once.

> First boot downloads the Docker images, so give it a few minutes on the first
> run. Subsequent boots are instant.

---

## Repository layout

```
install.sh              One-click installer (run this on the Pi)
uninstall.sh            Tear everything back down
.env.example            Every configurable value, documented
setup/                  Interactive wizard + network scanner
docker/                 docker-compose stack (Home Assistant, dashboard, MediaMTX)
dashboard/              The touch UI (FastAPI backend + web frontend)
kiosk/                  Chromium kiosk autostart + systemd units
docs/                   Hardware, architecture, device, and troubleshooting guides
```

---

## Security note

Credentials you enter in the wizard are written to a local `.env` file with
`600` permissions on the Pi and are **never** committed to git (`.gitignore`
covers `.env`). Nothing in this repository contains real passwords — the
`.env.example` file uses placeholders only. See
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) if a device won't appear.

---

## License

MIT — see [`LICENSE`](LICENSE).
