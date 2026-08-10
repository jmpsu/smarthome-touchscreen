#!/usr/bin/env bash
# =============================================================================
# Second stage of the CI deploy — piped into `bash -s` over SSH on the VPS.
#
# By this point /tmp/panel.tar.gz and /tmp/panel.env have already been copied
# up by the workflow. This unpacks them into place and hands off to
# deploy/remote-install.sh, then optionally installs the nginx vhost.
#
# Inputs (exported by the SSH command line):
#   PORT           port the backend binds        (default 8000)
#   INSTALL_NGINX  "true" to install the vhost   (default false)
# =============================================================================
set -Eeuo pipefail

PORT="${PORT:-8000}"
INSTALL_NGINX="${INSTALL_NGINX:-false}"
APP_DIR=/opt/smarthome-panel
ENV_FILE=/etc/smarthome-panel.env

# The deploy user may already be root, in which case sudo need not exist.
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo "[+] Unpacking application into $APP_DIR..."
$SUDO mkdir -p "$APP_DIR"
# Replace the application tree, but preserve the virtualenv and local state so
# redeploys stay fast and do not wipe rooms/floorplan data.
$SUDO find "$APP_DIR" -mindepth 1 -maxdepth 1 \
     ! -name '.venv' ! -name 'data' -exec rm -rf {} +
$SUDO tar -xzf /tmp/panel.tar.gz -C "$APP_DIR"

echo "[+] Installing runtime environment file..."
$SUDO install -m 600 /tmp/panel.env "$ENV_FILE"
rm -f /tmp/panel.env /tmp/panel.tar.gz

$SUDO env APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" PORT="$PORT" \
     bash "$APP_DIR/deploy/remote-install.sh"

if [ -n "${CF_HOSTNAME:-}" ]; then
  # This host serves the panel through a Cloudflare Tunnel, not an open port.
  # Add an ingress rule mapping the hostname to our backend, keeping every
  # existing rule intact and validating before anything is restarted.
  CFG=""
  for f in /etc/cloudflared/config.yml /etc/cloudflared/config.yaml \
           /root/.cloudflared/config.yml /root/.cloudflared/config.yaml; do
    [ -f "$f" ] && { CFG="$f"; break; }
  done
  if [ -z "$CFG" ]; then
    echo "[!] CF_HOSTNAME set but no cloudflared config found — skipping." >&2
  elif grep -q "hostname: *$CF_HOSTNAME\$" "$CFG" && \
       grep -A1 "hostname: *$CF_HOSTNAME\$" "$CFG" | grep -q "127.0.0.1:$PORT"; then
    echo "[+] cloudflared already routes $CF_HOSTNAME to 127.0.0.1:$PORT."
  else
    BACKUP="$CFG.bak.$(date +%Y%m%d%H%M%S)"
    $SUDO cp "$CFG" "$BACKUP"
    echo "[+] Backed up $CFG -> $BACKUP"

    # Insert our rule ahead of the catch-all so existing routes still win
    # for their own hostnames.
    $SUDO python3 - "$CFG" "$CF_HOSTNAME" "$PORT" <<'PYEOF'
import re, sys
path, host, port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
lines = text.splitlines()

# Drop any existing rule for this hostname so we do not create a duplicate.
out, skip = [], False
for i, ln in enumerate(lines):
    if re.match(rf'\s*-\s*hostname:\s*{re.escape(host)}\s*$', ln):
        skip = True
        continue
    if skip:
        # Skip the indented body of the removed rule.
        if re.match(r'\s*-\s', ln) or not ln.startswith((' ', '\t')):
            skip = False
        else:
            continue
    out.append(ln)
lines = out

rule = [f"  - hostname: {host}", f"    service: http://127.0.0.1:{port}"]

# Place it immediately before the catch-all (a service with no hostname).
idx = next((i for i, ln in enumerate(lines)
            if re.match(r'\s*-\s*service:', ln)), None)
if idx is None:
    if not any(re.match(r'\s*ingress:', ln) for ln in lines):
        lines += ["ingress:"]
    lines += rule + ["  - service: http_status:404"]
else:
    lines[idx:idx] = rule

open(path, "w").write("\n".join(lines) + "\n")
print(f"[+] ingress: {host} -> http://127.0.0.1:{port}")
PYEOF

    if cloudflared tunnel ingress validate --config "$CFG" 2>/dev/null; then
      $SUDO systemctl restart cloudflared
      echo "[+] cloudflared reloaded."
    else
      echo "[x] ingress validation FAILED — restoring $BACKUP and leaving the" >&2
      echo "    tunnel exactly as it was. The panel keeps serving whatever it" >&2
      echo "    was serving before this run." >&2
      $SUDO cp "$BACKUP" "$CFG"
      exit 1
    fi
  fi
fi

if [ "$INSTALL_NGINX" = "true" ]; then
  echo "[+] Installing nginx reverse proxy..."
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get install -y -qq nginx

  # The dashboard upgrades /ha-ws to a WebSocket, which needs this map.
  printf 'map $http_upgrade $connection_upgrade {\n    default upgrade;\n    ""      close;\n}\n' \
    | $SUDO tee /etc/nginx/conf.d/upgrade.conf >/dev/null

  $SUDO cp "$APP_DIR/deploy/nginx-panel.conf" /etc/nginx/sites-available/smarthome-panel
  $SUDO ln -sf /etc/nginx/sites-available/smarthome-panel \
               /etc/nginx/sites-enabled/smarthome-panel
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  echo "[+] nginx is proxying port 80 -> 127.0.0.1:$PORT"
fi

echo "[+] Deploy complete."
