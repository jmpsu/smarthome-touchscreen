# Hardware & first-boot setup

## Bill of materials

| Item | Notes |
|------|-------|
| Raspberry Pi 5 (4 GB+; 8 GB recommended) | Runs the full stack in Docker. |
| Power supply | Official 27 W USB-C PD for the Pi 5. |
| microSD (32 GB+) or NVMe HAT + SSD | SSD strongly recommended for Docker I/O. |
| 12.3" 1920×720 IPS touch monitor | HDMI video **+** USB for the touch panel. |
| micro-HDMI → HDMI cable | Pi 5 uses micro-HDMI (use HDMI0, nearest USB-C). |
| USB-A cable | Carries touch input from the monitor to the Pi. |
| USB stick | Holds this repo for the one-click install. |
| VESA / flush wall mount | The monitor is 0.78" D — mounts flat, centrally. |

## The touch panel

From the product spec: IPS LCD, **1920×720 native**, 60 Hz, 3 ms, glossy,
178° viewing, 2000:1 contrast, 1× HDMI + 1× USB. The installer pins this exact
mode in `/boot/firmware/config.txt` via `hdmi_cvt=1920 720 60` so the desktop
and kiosk always render at native resolution even if HDMI EDID probing is flaky.

## Step 1 — flash Raspberry Pi OS

1. Use **Raspberry Pi Imager** → *Raspberry Pi OS (64-bit, Desktop)*.
2. In the Imager's advanced options (gear icon) set:
   - hostname (e.g. `smarthome`)
   - your Wi-Fi SSID + password (so the Pi joins the same network as the lights)
   - locale/timezone = your zone (e.g. America/New_York)
   - enable SSH (optional, handy for remote tweaks)
3. Boot the Pi to the desktop once so first-run expansion completes.

## Step 2 — run the installer

1. Copy this whole `smarthome-touchscreen/` folder onto the USB stick.
2. Plug the stick into the Pi, open a terminal:
   ```bash
   cd /media/$USER/*/smarthome-touchscreen
   ./install.sh
   ```
3. Answer the on-screen wizard prompts (see the README quick-start).
4. Reboot when prompted — the panel now boots straight into the dashboard.

## Contabo VPS (optional remote access)

The panel works fully **on the LAN** with no cloud. If you also want to reach it
from your Contabo VPS (e.g. remote viewing), the recommended path is a
**Tailscale** or **WireGuard** tunnel between the Pi and the VPS rather than
exposing ports publicly. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#remote-access).
Never port-forward Home Assistant directly to the internet without TLS + auth.
