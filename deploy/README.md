# Deploying the panel to the VPS

The deploy runs from **GitHub Actions**, not from a laptop and not from an agent
sandbox. A GitHub-hosted runner has unrestricted outbound network access, so it
can SSH into the Contabo VPS and perform the whole install unattended. You fill
in the secrets once; after that a deploy is a single button press.

## One-time setup

In the repository: **Settings → Secrets and variables → Actions**.

### Secrets (encrypted)

| Secret | Required | What it is |
| --- | --- | --- |
| `VPS_HOST` | yes | Public IP or hostname of the Contabo VPS. Must be the **origin** address, not `joeysvault.app` — that name resolves to Cloudflare, which does not proxy SSH. |
| `VPS_USER` | yes | SSH user, e.g. `root`. |
| `VPS_SSH_KEY` | one of | Full private key, including the BEGIN/END lines. Preferred. |
| `VPS_PASSWORD` | one of | Used with `sshpass` if no key is supplied. |
| `VPS_SSH_PORT` | no | Defaults to `22`. |
| `HA_TOKEN` | yes | Home Assistant long-lived access token. |
| `HA_BASE_URL` | no | Defaults to `https://ha.joeysvault.app`. |
| `HOMEKIT_PIN` | no | Shown on the setup screen for HomeKit pairing. |

### Variables (plain text, visible in logs)

`LATITUDE`, `LONGITUDE`, `TIMEZONE`, `X_ACCOUNT`, `TIDES_WEEK_URL`,
`TIDES_MONTH_URL`, `SCREEN_WIDTH`, `SCREEN_HEIGHT`, `ROTATE_SECONDS`.

Sensible defaults are applied for anything left unset — see
[`.env.example`](../.env.example) for what each one does.

## Deploying

**Actions → Deploy panel to VPS → Run workflow.**

Two inputs:

- **port** — what uvicorn binds on the VPS. Default `8000`, bound to
  `127.0.0.1` so it is only reachable through the reverse proxy.
- **install_nginx** — tick this on the *first* deploy to install the
  `panel.joeysvault.app` vhost. Later deploys can leave it off.

The run then:

1. Checks every required secret is present and fails early with a clear message
   if one is missing.
2. Records the VPS host key, so the rest of the run is not open to a silent
   man-in-the-middle.
3. Builds `/etc/smarthome-panel.env` from the secrets — values never appear in
   the log, and blank optional settings are omitted rather than written as
   empty strings that would override the application defaults.
4. Copies a tarball of the app up and unpacks it into `/opt/smarthome-panel`,
   preserving `.venv` and `data/` so redeploys are fast and do not wipe your
   rooms and floor plan.
5. Creates the virtualenv, installs dependencies, writes the
   `smarthome-panel` systemd unit, and restarts it.
6. Polls `http://127.0.0.1:8000/api/config` for 30 seconds and **fails the
   deploy** with the last 60 lines of `journalctl` if the backend does not come
   up. A green run means the service really is answering.
7. Finally checks `https://panel.joeysvault.app/api/config`. If DNS is not
   pointing at the VPS yet this is a warning, not a failure — the install
   itself already succeeded.

## Pointing the domain at it

`panel.joeysvault.app` currently resolves to Cloudflare. Set its DNS record to
the VPS IP (proxied is fine) and let the nginx vhost terminate on port 80;
Cloudflare handles TLS in front. If you would rather keep the VPS off the
public internet, run `cloudflared tunnel` on it and point the tunnel at
`127.0.0.1:8000` instead — in that case skip `install_nginx`.

## Operating it

```bash
systemctl status smarthome-panel
journalctl -u smarthome-panel -f
systemctl restart smarthome-panel
curl -s localhost:8000/api/config | head
```

Files on the VPS:

- `/opt/smarthome-panel` — application, plus `.venv`
- `/etc/smarthome-panel.env` — configuration, mode `600`, rewritten each deploy
- `/etc/systemd/system/smarthome-panel.service` — the unit

## Siri

Voice control does not route through this backend. Enable the **HomeKit Bridge**
integration in Home Assistant, pair it in the Apple Home app, and Siri talks to
Home Assistant directly. The panel's own `/api/voice/command` endpoint is the
on-screen microphone, parsed locally with no external API calls.
