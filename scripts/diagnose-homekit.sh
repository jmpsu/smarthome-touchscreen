#!/usr/bin/env bash
# =============================================================================
# diagnose-homekit.sh — explain what the Home app is showing, from the terminal
# -----------------------------------------------------------------------------
# Run on the Pi:   bash scripts/diagnose-homekit.sh
#
# READ-ONLY. Starts/stops/edits nothing.
#
# WHY THIS EXISTS
# "No Response" in the Home app is a single symptom with several distinct root
# causes that are indistinguishable on the phone:
#
#   A. Bridge process down            -> nothing advertising, all accessories dead
#   B. Bridge up, not advertising     -> phone cannot find it (mDNS/network)
#   C. Bridge up, entities unavailable-> HomeKit reachable, backend (Tuya) dead
#   D. Bridge fine, Apple hub offline -> "Home Hub Not Responding"; local control
#                                        may still work, automations/remote do not
#
# C is the one people misdiagnose: HomeKit is working perfectly and the Tuya
# cloud link is what actually died. Deleting and re-pairing the bridge — the
# usual instinct — fixes nothing and costs you every room assignment.
#
# This script determines which case you are in and says so explicitly.
# =============================================================================
set -uo pipefail

c_g=$'\033[1;32m'; c_b=$'\033[1;34m'; c_y=$'\033[1;33m'; c_r=$'\033[1;31m'; c_0=$'\033[0m'
yes_() { printf '%s  YES %s %s\n' "$c_g" "$c_0" "$*"; }
no_()  { printf '%s  NO  %s %s\n' "$c_r" "$c_0" "$*"; }
hm_()  { printf '%s  ??  %s %s\n' "$c_y" "$c_0" "$*"; }
info() { printf '       %s\n' "$*"; }
hdr()  { printf '\n%s────── %s ──────%s\n' "$c_b" "$*" "$c_0"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${HA_CONTAINER:-homeassistant}"
HA="http://localhost:8123"

BRIDGE_UP=0; ADVERTISING=0; ENTITIES_OK=-1; HUB_SEEN=0; HA_UP=0

printf '\n%s HOMEKIT DIAGNOSIS %s  %s\n' "$c_b" "$c_0" "$(date -Iseconds)"
if [[ "$(hostname)" != *"raspberrypi"* ]]; then
  printf '%s  ! you are on "%s" — the bridge lives on the Pi (raspberrypi)%s\n' "$c_y" "$(hostname)" "$c_0"
fi

LIVE="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
SUDO=""; [[ -n "$LIVE" ]] && ! head -c1 "$LIVE/configuration.yaml" >/dev/null 2>&1 && SUDO="sudo"

# ============================================================================
hdr "1. IS THE BRIDGE EVEN RUNNING?"
# ============================================================================
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  yes_ "container up — $(docker ps --filter name=^${CONTAINER}$ --format '{{.Status}}')"
  BRIDGE_UP=1
else
  no_ "container '$CONTAINER' is NOT running   -> CASE A"
  info "fix: docker start $CONTAINER"
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HA" 2>/dev/null)"
if [[ "$CODE" == "200" ]]; then yes_ "Home Assistant answering on :8123"; HA_UP=1
else no_ "Home Assistant not answering on :8123 (got '${CODE:-none}')"; fi

if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -qE ':(21063|51827|21064)\b'; then
  yes_ "HomeKit bridge port is listening"
else
  no_ "no HomeKit port listening   -> CASE A/B"
fi

# ============================================================================
hdr "2. CAN YOUR IPHONE FIND IT? (mDNS)"
# ============================================================================
if command -v avahi-browse >/dev/null 2>&1; then
  HAP="$(timeout 8 avahi-browse -rpt _hap._tcp 2>/dev/null | grep '^=' || true)"
  N="$(printf '%s' "$HAP" | grep -c . || echo 0)"
  if [[ "$N" -gt 0 ]]; then
    yes_ "$N HomeKit accessory(s) advertising on the LAN"
    ADVERTISING=1
    printf '%s' "$HAP" | awk -F';' '{print "       - "$4"  ("$8":"$9")"}' | head -8
  else
    no_ "nothing advertising _hap._tcp   -> CASE B: the phone cannot discover the bridge"
    info "the bridge may be running but invisible. Common causes:"
    info "  - container not on host networking"
    info "  - avahi-daemon not running on the Pi"
    info "  - phone on a different SSID/VLAN than the Pi"
  fi
else
  hm_ "avahi-browse missing — cannot test discovery (the decisive check)"
  info "install: sudo apt-get install -y avahi-utils   then re-run"
fi

if systemctl is-active avahi-daemon >/dev/null 2>&1; then yes_ "avahi-daemon running on the Pi"
else hm_ "avahi-daemon not active — mDNS may not work host-side"; fi

# ============================================================================
hdr "3. ARE THE LIGHTS ACTUALLY ALIVE IN HOME ASSISTANT?"
# ============================================================================
# This is the check that separates CASE C from a real HomeKit fault.
TOKEN=""
[[ -f "$REPO_DIR/.env" ]] && TOKEN="$(grep -E '^HA_TOKEN=' "$REPO_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')"

if [[ -n "$TOKEN" && "$HA_UP" == "1" ]]; then
  S="$(curl -s --max-time 10 -H "Authorization: Bearer $TOKEN" "$HA/api/states" 2>/dev/null)"
  if echo "$S" | grep -q entity_id; then
    read -r TOT UNAV ON <<<"$(echo "$S" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('0 0 0'); sys.exit()
L=[e for e in d if e.get('entity_id','').startswith('light.')]
u=[e for e in L if e.get('state') in ('unavailable','unknown')]
o=[e for e in L if e.get('state')=='on']
print(len(L),len(u),len(o))
" 2>/dev/null)"
    if [[ "${UNAV:-0}" == "0" && "${TOT:-0}" -gt 0 ]]; then
      yes_ "all $TOT lights alive in HA ($ON currently on)"
      ENTITIES_OK=1
    elif [[ "${TOT:-0}" -eq 0 ]]; then
      no_ "HA has ZERO light entities   -> Tuya integration not loaded"
      ENTITIES_OK=0
    else
      no_ "$UNAV of $TOT lights are unavailable in HA   -> CASE C"
      ENTITIES_OK=0
      info "HomeKit is NOT the problem. The lights are dead upstream of it."
      echo "$S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for e in d:
    if e.get('entity_id','').startswith('light.') and e.get('state') in ('unavailable','unknown'):
        print('       - '+e['entity_id']+'  ='+e['state'])
" 2>/dev/null | head -10
    fi
  else
    hm_ "API rejected the token — cannot check entity health"
  fi
else
  hm_ "no HA_TOKEN in .env — cannot check whether the lights are alive"
  info "this is the check that distinguishes 'HomeKit broken' from 'Tuya broken'."
  info "HA UI -> profile -> Security -> Long-lived access tokens -> Create,"
  info "then add HA_TOKEN=<token> to $REPO_DIR/.env"
fi

# Cloud reachability — Tuya is a cloud integration; no internet, no lights.
if ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; then yes_ "internet reachable (Tuya cloud needs it)"
else no_ "NO INTERNET — Tuya lights cannot work   -> CASE C"; fi

TUYAERR="$(docker logs --since 15m "$CONTAINER" 2>&1 | grep -ciE 'tuya.*(error|fail|timeout|disconnect)' || echo 0)"
if [[ "$TUYAERR" -gt 0 ]]; then
  no_ "$TUYAERR Tuya error lines in the last 15 min"
  docker logs --since 15m "$CONTAINER" 2>&1 | grep -iE 'tuya.*(error|fail|timeout|disconnect)' | tail -3 | sed 's/^/       /'
else
  yes_ "no recent Tuya errors in the HA log"
fi

# ============================================================================
hdr "4. YOUR APPLE HOME HUB (the HomePod)"
# ============================================================================
# NOTE: hub *role* status is only visible in the Home app. What is testable from
# here is whether the device is present on the network at all. Reported as such,
# not as a claim about hub health.
if command -v avahi-browse >/dev/null 2>&1; then
  PODS="$(timeout 8 avahi-browse -rpt _airplay._tcp 2>/dev/null | grep '^=' || true)"
  NP="$(printf '%s' "$PODS" | grep -c . || echo 0)"
  if [[ "$NP" -gt 0 ]]; then
    yes_ "$NP AirPlay device(s) visible on the LAN"
    HUB_SEEN=1
    printf '%s' "$PODS" | awk -F';' '{print "       - "$4"  "$8}' | sort -u | head -8
    info "presence only — whether Apple considers it a working hub is visible"
    info "only in the Home app (Home Settings -> Home Hubs & Bridges)."
  else
    no_ "no AirPlay devices found   -> CASE D: HomePod is off the network"
    info "the 'Home Hub Not Responding' banner matches this."
    info "fix: power-cycle the Bedroom HomePod, confirm it is on the same Wi-Fi."
  fi
else
  hm_ "avahi-browse missing — cannot scan for HomePods"
fi

# ============================================================================
hdr "VERDICT"
# ============================================================================
echo
if [[ "$BRIDGE_UP" == "0" || "$HA_UP" == "0" ]]; then
  printf '  %sCASE A — the bridge is down.%s\n\n' "$c_r" "$c_0"
  echo "  Every accessory shows No Response because nothing is serving them."
  echo "  FIX:  docker start $CONTAINER     (then wait ~60s)"
  echo "  THEN: docker update --restart unless-stopped $CONTAINER"
  echo "        so a power cut never does this again."
elif [[ "$ADVERTISING" == "0" ]]; then
  printf '  %sCASE B — running, but your iPhone cannot discover it.%s\n\n' "$c_r" "$c_0"
  echo "  The bridge is alive; mDNS is not reaching your phone."
  echo "  CHECK: phone on the same SSID as the Pi (not guest, not cellular)"
  echo "  CHECK: sudo systemctl restart avahi-daemon"
  echo "  CHECK: container network mode must be 'host'"
elif [[ "$ENTITIES_OK" == "0" ]]; then
  printf '  %sCASE C — HomeKit is FINE. The lights are dead upstream.%s\n\n' "$c_y" "$c_0"
  echo "  The bridge is running and discoverable, but the entities behind it are"
  echo "  unavailable — so HomeKit faithfully reports No Response."
  echo "  DO NOT re-pair the bridge. That fixes nothing and loses your rooms."
  echo "  FIX: restore internet / relink Tuya at http://$(hostname -I | awk '{print $1}'):8123"
  echo "       Settings -> Devices & Services -> Tuya"
elif [[ "$HUB_SEEN" == "0" ]]; then
  printf '  %sCASE D — bridge healthy; your Apple hub (HomePod) is offline.%s\n\n' "$c_y" "$c_0"
  echo "  Local control from your iPhone on home Wi-Fi should still work."
  echo "  Automations, remote access, and Siri on the HomePods will not."
  echo "  FIX: power-cycle the Bedroom HomePod and confirm its Wi-Fi."
else
  printf '  %sEVERYTHING TESTABLE FROM HERE IS HEALTHY.%s\n\n' "$c_g" "$c_0"
  echo "  Bridge running, discoverable, entities alive, HomePod on the network."
  echo "  If the Home app still shows No Response, it is phone-side cache:"
  echo "    1. toggle iPhone Wi-Fi off/on, reopen Home"
  echo "    2. confirm the phone is on the same SSID as the Pi"
  echo "    3. force-quit and reopen the Home app"
  echo "  Still do not delete the bridge — the pairing is intact."
fi
echo
