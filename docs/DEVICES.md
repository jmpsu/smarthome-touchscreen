# Device integration guide

Everything below ends up as normal Home Assistant entities, so the dashboard and
Apple HomeKit treat them all identically — "as if they are all the same company."

## Tuya / SmartLife (lights, light strips, **sprinkler**)

Uses the **[tuya/tuya-smart-life](https://github.com/tuya/tuya-smart-life)**
QR-code integration — **no developer account** needed.

1. On first HA boot, open `http://localhost:8123` (or the dashboard's *Setup →
   Open Home Assistant*).
2. **Settings → Devices & Services → Add Integration → Tuya**.
3. Choose **"Scan QR code with Smart Life app"**.
4. Open **Smart Life** on your iPhone → **Me → ⤢ (scan)** → scan the QR.
5. Every SmartLife device — bulbs, strips, and the **sprinkler** — imports at once.

Your Monster bulbs and any Marvelight strips that were paired through SmartLife
come in here too.

## WiZ

Zero-config. The installer's scanner and HA's `dhcp`/`zeroconf` discovery find
WiZ bulbs over the LAN automatically; confirm the discovered prompt in
**Settings → Devices & Services**. No login required.

## Marvelight / Monster / other strips

- If the strip is controllable from **SmartLife**, it arrives via the Tuya step
  above — nothing else to do.
- **Marvelight** strips that only pair over Bluetooth are reached through HA's
  BLE stack (the compose file maps `/run/dbus` into the container). Add them via
  **Add Integration → Bluetooth** once they're advertising.
- If a strip exposes a fixed-IP local API, add its IP to `EXTRA_LIGHT_HOSTS` in
  the wizard and it's probed on the next scan.

> Some off-brand strips have no open/local API at all. Those can only be bridged
> through their own app's ecosystem (usually SmartLife). The dashboard shows
> whatever HA can see — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Eufy cameras (live views)

The `eufy-security-ws` container logs into your Eufy account (credentials from
the wizard) and exposes each camera; **MediaMTX** restreams them to
`rtsp://…/eufy_front` and `…/eufy_back`, which both HA (`cameras.yaml`) and the
dashboard camera screen consume as low-latency HLS/WebRTC.

If your camera names differ, edit `docker/homeassistant/cameras.yaml` and the
`streamPath()` map in `dashboard/frontend/js/cameras.js`.

## Apple HomeKit + Siri (all devices)

`configuration.yaml` declares a **HomeKit Bridge** that includes the `light`,
`switch`, `climate`, `fan`, `cover`, `camera`, and `lock` domains — i.e. every
device above. This automates the manual steps from the spec:

1. HA generates a pairing QR (HA notification) using the PIN from `.env`
   (also shown on the dashboard **Setup** screen).
2. iPhone → **Home → Add Accessory → scan** → every device joins Apple Home.
3. Siri now controls all of them ("Hey Siri, turn on the balcony lights").

### Matter alternative (local, no cloud)

For a fully local fabric you can instead expose Tuya devices via
**home-assistant-tools/tuya2matter**, which pairs them to Apple Home / Google /
Alexa simultaneously without cloud dependency. Add it as an HA add-on if you
run HA OS/Supervised; the HomeKit Bridge path above is the default because it
works on this container-based setup with zero extra hardware.
