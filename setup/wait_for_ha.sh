#!/usr/bin/env bash
# Block until Home Assistant answers, then (best-effort) print readiness.
# Times out after ~3 minutes so install.sh never hangs forever.
set -uo pipefail
URL="${HA_BASE_URL_LOCAL:-http://localhost:8123}"
for i in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/manifest.json" || echo 000)"
  if [[ "$code" == "200" ]]; then
    echo "[+] Home Assistant is up at $URL"
    exit 0
  fi
  printf '\r[i] Waiting for Home Assistant... (%ss)   ' "$((i*2))"
  sleep 2
done
echo
echo "[!] Home Assistant did not respond in time; it may still be initializing."
exit 1
