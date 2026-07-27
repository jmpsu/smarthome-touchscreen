#!/usr/bin/env bash
# Tear down the SmartHome Touchscreen stack and kiosk autostart.
set -Eeuo pipefail
TARGET_DIR="${SMARTHOME_HOME:-$HOME/smarthome-touchscreen}"

echo "[*] Stopping Docker stack..."
if [[ -d "$TARGET_DIR/docker" ]]; then
  (cd "$TARGET_DIR/docker" && docker compose down) || true
fi

echo "[*] Removing kiosk autostart..."
systemctl --user disable --now smarthome-kiosk.service 2>/dev/null || true
rm -f "$HOME/.config/autostart/smarthome-kiosk.desktop" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/smarthome-kiosk.service" 2>/dev/null || true

read -rp "Also delete project + local data at $TARGET_DIR? [y/N] " ans
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  rm -rf "$TARGET_DIR"
  echo "[*] Removed $TARGET_DIR"
fi
echo "[*] Uninstall complete."
