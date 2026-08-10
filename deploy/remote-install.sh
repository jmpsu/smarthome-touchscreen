#!/usr/bin/env bash
# =============================================================================
# SmartHome Touchscreen — VPS installer (runs ON the VPS)
# -----------------------------------------------------------------------------
# Idempotent. Safe to re-run on every deploy. Expects the repo to already be
# unpacked at $APP_DIR and an env file to already exist at $ENV_FILE.
#
#   APP_DIR   where the code lives            (default /opt/smarthome-panel)
#   ENV_FILE  runtime environment for systemd (default /etc/smarthome-panel.env)
#   PORT      port uvicorn binds              (default 8000)
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smarthome-panel}"
ENV_FILE="${ENV_FILE:-/etc/smarthome-panel.env}"
PORT="${PORT:-8000}"
SERVICE="smarthome-panel"
VENV="$APP_DIR/.venv"

log() { printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
trap 'err "install failed on line $LINENO"' ERR

[ -d "$APP_DIR" ]  || { err "APP_DIR $APP_DIR does not exist"; exit 1; }
[ -f "$ENV_FILE" ] || { err "ENV_FILE $ENV_FILE does not exist"; exit 1; }

# ---- 1. system packages -----------------------------------------------------
log "Installing system prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-dev build-essential curl >/dev/null

# ---- 2. python environment --------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
  log "Creating virtualenv at $VENV..."
  python3 -m venv "$VENV"
fi
log "Installing Python dependencies..."
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# ---- 3. systemd unit --------------------------------------------------------
log "Writing systemd unit..."
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=SmartHome Touchscreen panel backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/python -m uvicorn dashboard.backend.app:app --host 127.0.0.1 --port $PORT
Restart=always
RestartSec=3
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

chmod 600 "$ENV_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"

# ---- 4. health check --------------------------------------------------------
log "Waiting for the backend to answer on 127.0.0.1:$PORT..."
for i in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/config" >/dev/null 2>&1; then
    log "Backend healthy after ${i}s."
    curl -fsS -m 5 "http://127.0.0.1:$PORT/api/config"; echo
    exit 0
  fi
  sleep 1
done

err "Backend did not become healthy in 30s. Recent logs:"
journalctl -u "$SERVICE" -n 60 --no-pager >&2 || true
exit 1
