#!/usr/bin/env bash
# Launch Chromium full-screen pointing at the dashboard. Runs on the Pi's
# desktop session at boot (via the autostart entry install_kiosk.sh creates).
set -u

DASHBOARD_PORT="${DASHBOARD_PORT:-8080}"
URL="http://localhost:${DASHBOARD_PORT}"

# Wait for the dashboard container to answer before opening the browser.
for i in $(seq 1 60); do
  if curl -sf "$URL/api/config" >/dev/null 2>&1; then break; fi
  sleep 2
done

# Disable screen blanking / power management on the touch panel.
xset s off        2>/dev/null || true
xset s noblank    2>/dev/null || true
xset -dpms        2>/dev/null || true
# Hide the mouse cursor when idle (touch-only use).
unclutter -idle 0.5 -root &

# Pick whichever Chromium binary exists on this Pi OS image.
BROWSER="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"

exec "$BROWSER" \
  --kiosk "$URL" \
  --incognito \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 \
  --window-size=1920,720 \
  --window-position=0,0 \
  --start-fullscreen
