# Troubleshooting

## The screen is blank / wrong resolution
- Confirm HDMI is in the **HDMI0** port (nearest the USB-C power) on the Pi 5.
- The installer pins `1920x720@60` in `config.txt`. If the panel still looks
  wrong, reboot once more (mode changes need a reboot), or comment out the
  `smarthome-touchscreen` block in `/boot/firmware/config.txt` to let EDID win.

## Touch input doesn't work
- The panel needs its **USB** cable connected in addition to HDMI.
- Run `xinput` — the touch device should be listed. If it's rotated/offset, add
  a `libinput` calibration matrix in `/etc/X11/xorg.conf.d/`.

## Lights don't appear on the dashboard
1. Open **Setup → Open Home Assistant** (`:8123`).
2. **Settings → Devices & Services** — is the Tuya/WiZ integration listed and
   healthy? If not, re-add it (see [`DEVICES.md`](DEVICES.md)).
3. Entities must be in the `light.` or `switch.` domain to show in the grid.
4. Re-run the scan: `python3 setup/scan_network.py` and check
   `discovered_devices.json`.

## Cameras show "SNAPSHOT" instead of live video
- `eufy-security-ws` may need 2FA. Check its logs:
  `docker logs eufy-security-ws`. Complete any verification prompt.
- Confirm MediaMTX is up: `docker logs mediamtx` and that
  `http://<pi>:8888/eufy_front/index.m3u8` returns a playlist.

## Home Assistant "starting…" forever on the Setup screen
- First boot pulls images and initializes; give it 3–5 minutes.
- `docker compose -f docker/docker-compose.yml logs -f homeassistant`.

## HomeKit pairing fails
- The PIN is in `.env` (`HOMEKIT_PIN`) and on the **Setup** screen.
- Make sure the iPhone is on the **same Wi-Fi** as the Pi (HomeKit is mDNS/LAN).
- If it says "already added", remove the old bridge in the Home app and re-pair.

## Remote access
Keep Home Assistant off the public internet. To reach the panel from your
Contabo VPS or phone remotely, use a private tunnel:
- Install **Tailscale** on both the Pi and the VPS (`curl -fsSL https://tailscale.com/install.sh | sh`), then reach the dashboard at the Pi's Tailscale IP.
- Or terminate a **WireGuard** tunnel on the VPS and route to the Pi.

## Re-running / resetting
- Re-run `./install.sh` any time — it's idempotent and preserves your `.env`.
- Full teardown: `./uninstall.sh`.
