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
