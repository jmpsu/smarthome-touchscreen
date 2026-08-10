#!/usr/bin/env bash
# =============================================================================
# SmartHome Touchscreen — one-click installer for Raspberry Pi 5 / Pi OS
# -----------------------------------------------------------------------------
# Copy this repo to a USB stick, plug it into the Pi, then run:
#     ./install.sh
#
# It will:
#   1. Install Docker + prerequisites (idempotent)
#   2. Copy the project to ~/smarthome-touchscreen (so the USB stick can be
#      removed afterwards)
#   3. Run the interactive setup wizard (prompts for passwords on-screen)
#   4. Scan the network for smart devices
#   5. Bring up the Docker stack (Home Assistant + dashboard + camera bridge)
#   6. Install the Chromium kiosk autostart so the dashboard opens on every boot
#
# Safe to re-run: every step checks whether it is already done.
# =============================================================================
set -Eeuo pipefail

# ---- pretty logging ---------------------------------------------------------
c_green=$'\033[1;32m'; c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'
c_red=$'\033[1;31m'; c_reset=$'\033[0m'
log()  { printf '%s[+]%s %s\n' "$c_green" "$c_reset" "$*"; }
info() { printf '%s[i]%s %s\n' "$c_blue"  "$c_reset" "$*"; }
warn() { printf '%s[!]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
err()  { printf '%s[x]%s %s\n' "$c_red"   "$c_reset" "$*" >&2; }
trap 'err "Install failed on line $LINENO. See messages above."' ERR

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SMARTHOME_HOME:-$HOME/smarthome-touchscreen}"
REAL_USER="${SUDO_USER:-$USER}"

banner() {
  cat <<'EOF'
  ____                       _   _   _
 / ___| _ __ ___   __ _ _ __| |_| | | | ___  _ __ ___   ___
 \___ \| '_ ` _ \ / _` | '__| __| |_| |/ _ \| '_ ` _ \ / _ \
  ___) | | | | | | (_| | |  | |_|  _  | (_) | | | | | |  __/
 |____/|_| |_| |_|\__,_|_|   \__|_| |_|\___/|_| |_| |_|\___|
        Touchscreen Control Panel  ·  Raspberry Pi 5
EOF
}

require_pi_os() {
  if ! grep -qi 'raspbian\|raspberry pi os\|debian' /etc/os-release 2>/dev/null; then
    warn "This does not look like Raspberry Pi OS. Continuing anyway in 5s..."
    sleep 5
  fi
}

# ---- 1. system prerequisites -----------------------------------------------
install_prereqs() {
  log "Installing system prerequisites (Docker, Python, Chromium)..."
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    ca-certificates curl git python3 python3-pip python3-venv \
    chromium-browser unclutter x11-xserver-utils arp-scan avahi-utils jq \
    >/dev/null

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker Engine..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$REAL_USER"
  else
    info "Docker already installed."
  fi

  # docker compose plugin
  if ! docker compose version >/dev/null 2>&1; then
    sudo apt-get install -y -qq docker-compose-plugin >/dev/null || true
  fi
}

# ---- 2. copy project off the USB stick -------------------------------------
copy_project() {
  if [[ "$SRC_DIR" == "$TARGET_DIR" ]]; then
    info "Already running from install target ($TARGET_DIR)."
    return
  fi
  log "Copying project to $TARGET_DIR (so you can remove the USB stick)..."
  mkdir -p "$TARGET_DIR"
  # Preserve an existing .env / data on re-install.
  rsync -a --exclude '.git' --exclude 'data' \
        $( [[ -f "$TARGET_DIR/.env" ]] && echo --exclude '.env' ) \
        "$SRC_DIR"/ "$TARGET_DIR"/
}

# ---- 3. python venv for the wizard + scanner --------------------------------
setup_python() {
  log "Preparing setup wizard environment..."
  python3 -m venv "$TARGET_DIR/.venv"
  # shellcheck disable=SC1091
  source "$TARGET_DIR/.venv/bin/activate"
  pip install --quiet --upgrade pip
  pip install --quiet -r "$TARGET_DIR/setup/requirements.txt"
}

# ---- 4. interactive wizard + network scan ----------------------------------
run_wizard() {
  log "Launching setup wizard — follow the prompts on the touch screen."
  # shellcheck disable=SC1091
  source "$TARGET_DIR/.venv/bin/activate"
  python3 "$TARGET_DIR/setup/first_run_setup.py" --project-dir "$TARGET_DIR"
}

scan_network() {
  log "Scanning your Wi-Fi network for smart devices..."
  # shellcheck disable=SC1091
  source "$TARGET_DIR/.venv/bin/activate"
  python3 "$TARGET_DIR/setup/scan_network.py" \
      --output "$TARGET_DIR/discovered_devices.json" || \
      warn "Network scan hit an issue; you can re-run setup/scan_network.py later."
}

# ---- 5. bring up the stack --------------------------------------------------
start_stack() {
  log "Starting the smart-home stack (this pulls Docker images on first run)..."
  cd "$TARGET_DIR/docker"
  # newgrp so the current shell can talk to Docker without a re-login
  sg docker -c "docker compose --env-file '$TARGET_DIR/.env' up -d" 2>/dev/null \
    || docker compose --env-file "$TARGET_DIR/.env" up -d
  info "Waiting for Home Assistant to come online..."
  "$TARGET_DIR/setup/wait_for_ha.sh" || warn "HA slow to start; it will finish in the background."
}

# ---- 6. kiosk autostart -----------------------------------------------------
install_kiosk() {
  log "Installing Chromium kiosk autostart..."
  bash "$TARGET_DIR/kiosk/install_kiosk.sh" "$TARGET_DIR"
}

main() {
  banner
  require_pi_os
  install_prereqs
  copy_project
  setup_python
  run_wizard
  scan_network
  start_stack
  install_kiosk
  echo
  log "All done! 🎉"
  info "Dashboard:      http://localhost:${DASHBOARD_PORT:-8080}"
  info "Home Assistant: http://localhost:8123"
  info "The touch screen will boot straight into the dashboard from now on."
  info "Open Settings on the dashboard to scan the HomeKit QR with your iPhone."
  echo
  read -rp "Reboot now to launch the kiosk? [Y/n] " ans
  [[ "${ans:-Y}" =~ ^[Yy]?$ ]] && sudo reboot
}

main "$@"
