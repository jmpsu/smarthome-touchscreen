# Running on the Contabo VPS (test → live)

This is the VPS-first deployment. The full stack (Home Assistant + dashboard +
camera bridge + Spotify) runs on the Contabo VPS. The Raspberry Pi 5 becomes a
**thin display**: it boots Chromium in kiosk mode pointed at the VPS dashboard
URL. Nothing smart-home-specific runs on the Pi except (optionally) a Tailscale
subnet router so the VPS can reach your home devices.

```
   Contabo VPS  ─────────────────────────  Home
   ┌────────────────────────────┐          ┌───────────────────────────┐
   │ Home Assistant (Docker)    │          │  Raspberry Pi 5           │
   │ Dashboard (FastAPI)        │◀── HTTPS ─┤  Chromium kiosk → VPS URL │
   │ eufy-security-ws + MediaMTX│          │  (+ Tailscale subnet route)│
   │ Spotify / Tuya Cloud       │◀═ Tailscale ═▶  WiZ / BLE / RTSP on LAN │
   └────────────────────────────┘          └───────────────────────────┘
        CLOUD devices work directly            LOCAL devices via the tunnel
```

## The one thing that decides whether a device works remotely

A VPS is **not on your home Wi-Fi**, so:

| Integration | Type | Works from VPS alone? |
|-------------|------|------------------------|
| **Tuya / Smart Life** (cloud project) | CLOUD | ✅ yes |
| **Eufy** (account login) | CLOUD | ✅ yes (snapshots); live RTSP smoother over the tunnel |
| **Spotify** | CLOUD | ✅ yes |
| **WiZ** bulbs | LOCAL | ❌ needs the Tailscale route |
| **BLE strips** (some Marvelight) | LOCAL (Bluetooth) | ❌ needs a BT radio on the LAN (the Pi) |
| **Camera RTSP** live video | LOCAL | ❌ needs the route (snapshots are cloud) |

**So:** for a first live test you can use only the CLOUD integrations and see
real devices immediately. To also drive WiZ/BLE/RTSP you add the Tailscale
subnet route below — a 5-minute step.

## Bring-up on the VPS

```bash
# on the Contabo VPS (Ubuntu/Debian)
git clone <this repo> smarthome-touchscreen && cd smarthome-touchscreen
cp credentials.env .env            # the file you filled out
docker compose -f docker/docker-compose.yml --env-file .env up -d
# dashboard:  http://<VPS_HOST>:8080     Home Assistant: http://<VPS_HOST>:8123
```

First boot: open `http://<VPS_HOST>:8123`, and for the CLOUD integrations do the
one-click links the wizard/docs describe (Tuya "link app account", Spotify OAuth,
Eufy login). Then everything shows on the dashboard.

### Make local devices reachable (Tailscale subnet router at home)

1. On the **Pi** (at home): `curl -fsSL https://tailscale.com/install.sh | sh`
   then `sudo tailscale up --authkey=$TAILSCALE_AUTHKEY --advertise-routes=$HOME_SUBNET`.
2. On the **VPS**: install Tailscale, `sudo tailscale up --authkey=$TAILSCALE_AUTHKEY`.
3. In the Tailscale admin, **approve the advertised subnet route**.
4. The VPS can now reach `192.168.x.x` devices; WiZ/RTSP/LocalTuya start working.

`setup/scan_network.py` also becomes meaningful once the VPS is on the route (or
run it on the Pi) — it will then list every device on the home LAN.

## Securing the test (do this even for a sandbox)

- Put the dashboard + HA behind HTTPS. Easiest: a Caddy container terminating
  TLS for `VPS_DOMAIN` (auto Let's Encrypt) in front of ports 8080/8123. A ready
  `docker/caddy/Caddyfile` example is included — set `VPS_DOMAIN` and add the
  service.
- Or, keep HA/dashboard bound to the Tailscale interface only and reach them via
  the tailnet (no public exposure at all) — the most secure option for testing.

## Going live later

Nothing structural changes: edit `.env`, replace each test credential with your
real one, `docker compose up -d` to restart. The Pi kiosk already points at the
same VPS URL, so swapping credentials is the whole "go live" step.
