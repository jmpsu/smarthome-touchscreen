#!/usr/bin/env bash
# Install the Chromium kiosk so the dashboard opens automatically on every boot.
# Called by install.sh with the project dir as $1. Uses an LXDE/Wayland-friendly
# autostart .desktop entry (works on Raspberry Pi OS Desktop out of the box).
set -Eeuo pipefail
PROJECT_DIR="${1:-$HOME/smarthome-touchscreen}"
USER_HOME="$HOME"

chmod +x "$PROJECT_DIR/kiosk/kiosk.sh"

# 1) XDG autostart entry (desktop session) --------------------------------
AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/smarthome-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=SmartHome Kiosk
Exec=env DASHBOARD_PORT=${DASHBOARD_PORT:-8080} $PROJECT_DIR/kiosk/kiosk.sh
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF

# 2) Force the display mode to the panel's native 1920x720 ----------------
# The ultrawide 12.3" panel reports 1920x720 @ 60Hz. Pin it so the desktop and
# kiosk render correctly even if EDID probing is flaky over HDMI.
BOOT_CFG="/boot/firmware/config.txt"
[[ -f "$BOOT_CFG" ]] || BOOT_CFG="/boot/config.txt"
if [[ -f "$BOOT_CFG" ]] && ! grep -q "smarthome-touchscreen" "$BOOT_CFG"; then
  sudo tee -a "$BOOT_CFG" >/dev/null <<EOF

# --- smarthome-touchscreen: 1920x720 ultrawide panel ---
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1920 720 60 6 0 0 0
hdmi_drive=2
disable_overscan=1
EOF
fi

echo "[+] Kiosk autostart installed. It will launch on next login/boot."
