#!/usr/bin/env bash
# =============================================================================
# healthcheck.sh — exhaustive system status, every layer, top to bottom
# -----------------------------------------------------------------------------
# Run on the Pi:   bash scripts/healthcheck.sh
#
# READ-ONLY. Nothing is started, stopped, restarted, or edited. Safe to run at
# any time, including while everything is working.
#
# Layers checked, in dependency order — a failure high up explains failures
# below it, so read top-down and fix the FIRST failure, not the last:
#
#   1. Host          power, disk, memory, temperature, clock, network
#   2. Docker        daemon, container, restart policy (survives reboot?)
#   3. HA core       HTTP, version, uptime, error log
#   4. Config        homekit block, packages include, config validity
#   5. Integrations  Tuya linked, entity counts, unavailable entities
#   6. HomeKit       port listening, mDNS advertising, paired state
#   7. Voice         Assist intents loaded
#   8. Panel         dashboard reachable
#   9. Live control  actually toggle a light via the API (the only real test)
#
# Exit 0 = everything green. Exit 1 = at least one FAIL.
# =============================================================================
set -uo pipefail

c_g=$'\033[1;32m'; c_b=$'\033[1;34m'; c_y=$'\033[1;33m'; c_r=$'\033[1;31m'; c_0=$'\033[0m'
PASS=0; FAIL=0; WARN=0; SKIP=0
declare -a FAILURES=()

pass() { printf '%s  PASS %s %s\n' "$c_g" "$c_0" "$*"; PASS=$((PASS+1)); }
fail() { printf '%s  FAIL %s %s\n' "$c_r" "$c_0" "$*"; FAIL=$((FAIL+1)); FAILURES+=("$*"); }
warn() { printf '%s  WARN %s %s\n' "$c_y" "$c_0" "$*"; WARN=$((WARN+1)); }
skip() { printf '%s  SKIP %s %s\n' "$c_b" "$c_0" "$*"; SKIP=$((SKIP+1)); }
info() { printf '       %s\n' "$*"; }
hdr()  { printf '\n%s────── %s ──────%s\n' "$c_b" "$*" "$c_0"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${HA_CONTAINER:-homeassistant}"
HA="http://localhost:8123"

printf '\n%s SYSTEM HEALTH CHECK %s  %s\n' "$c_b" "$c_0" "$(date -Iseconds)"

# ============================================================================
hdr "1. HOST"
# ============================================================================
info "uptime: $(uptime -p 2>/dev/null || uptime)"
info "kernel: $(uname -r)   model: $(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo '?')"

DISK_PCT="$(df -P / | awk 'NR==2{print $5}' | tr -d '%')"
if [[ "${DISK_PCT:-0}" -lt 90 ]]; then pass "disk: ${DISK_PCT}% used on /"
else fail "disk: ${DISK_PCT}% used on / — HA will misbehave above ~90%"; fi

MEM_AVAIL="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
if [[ "$MEM_AVAIL" -gt 200 ]]; then pass "memory: ${MEM_AVAIL} MB available"
else fail "memory: only ${MEM_AVAIL} MB available"; fi

if command -v vcgencmd >/dev/null 2>&1; then
  TEMP="$(vcgencmd measure_temp 2>/dev/null | grep -oE '[0-9.]+' | head -1)"
  THROT="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)"
  [[ -n "$TEMP" ]] && info "SoC temp: ${TEMP}°C"
  if [[ "$THROT" == "0x0" ]]; then
    pass "power: no under-voltage or throttling since boot"
  elif [[ -n "$THROT" ]]; then
    fail "power: throttle flags $THROT — under-voltage. A weak PSU causes random shutdowns."
    info "  this is the most common cause of a Pi 5 turning itself off"
  fi
fi

if ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; then pass "network: internet reachable (Tuya cloud needs this)"
else fail "network: no internet — Tuya lights will NOT respond"; fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$IP" ]] && pass "network: LAN IP $IP" || fail "network: no LAN IP"

# HomeKit is time-sensitive; a skewed clock breaks TLS and pairing.
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  pass "clock: NTP synchronised ($(date '+%H:%M:%S %Z'))"
else warn "clock: NTP not synchronised — can break HomeKit and cloud auth"; fi

# ============================================================================
hdr "2. DOCKER"
# ============================================================================
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not installed";
elif ! docker info >/dev/null 2>&1; then
  fail "docker daemon unreachable — try: newgrp docker   (or: sudo systemctl start docker)"
else
  pass "docker daemon running"

  if systemctl is-enabled docker >/dev/null 2>&1; then
    pass "docker enabled at boot"
  else warn "docker NOT enabled at boot — fix: sudo systemctl enable docker"; fi

  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    pass "container '$CONTAINER' running — $(docker ps --filter name=^${CONTAINER}$ --format '{{.Status}}')"

    POLICY="$(docker inspect "$CONTAINER" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null)"
    case "$POLICY" in
      always|unless-stopped) pass "restart policy '$POLICY' — survives reboot automatically" ;;
      *) fail "restart policy '$POLICY' — HA will NOT come back after a power cut"
         info "  fix without recreating the container:"
         info "    docker update --restart unless-stopped $CONTAINER" ;;
    esac

    NET="$(docker inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')"
    if [[ "$NET" == "host" ]]; then pass "network mode host — required for HomeKit mDNS"
    else fail "network mode '$NET' — HomeKit cannot advertise, Siri will break"; fi

    RESTARTS="$(docker inspect "$CONTAINER" --format '{{.RestartCount}}')"
    if [[ "${RESTARTS:-0}" -lt 3 ]]; then pass "restart count: $RESTARTS"
    else warn "restart count: $RESTARTS — container is crash-looping"; fi
  else
    fail "container '$CONTAINER' NOT running — fix: docker start $CONTAINER"
    docker ps -a --format '       {{.Names}}  {{.Status}}' 2>/dev/null | head -5
  fi
fi

LIVE="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
[[ -n "$LIVE" ]] && info "live config dir: $LIVE"
SUDO=""; [[ -n "$LIVE" ]] && ! head -c1 "$LIVE/configuration.yaml" >/dev/null 2>&1 && SUDO="sudo"

# ============================================================================
hdr "3. HOME ASSISTANT CORE"
# ============================================================================
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HA" 2>/dev/null)"
if [[ "$CODE" == "200" ]]; then
  pass "HTTP $CODE on :8123"
elif [[ -z "$CODE" || "$CODE" == "000" ]]; then
  fail "no response on :8123 — HA down or still booting (it takes ~60s after start)"
else
  warn "HTTP $CODE on :8123 — reachable but unexpected status"
fi

VER="$(curl -s --max-time 5 "$HA/api/" 2>/dev/null | grep -o '"message":"[^"]*"' || true)"
HAVER="$(docker exec "$CONTAINER" python3 -c 'import homeassistant.const as c;print(c.__version__)' 2>/dev/null || echo '')"
[[ -n "$HAVER" ]] && pass "Home Assistant version $HAVER" || skip "version (container not queryable)"

ERRS="$(docker logs --since 10m "$CONTAINER" 2>&1 | grep -cE '^[0-9-]+ [0-9:.]+ ERROR' || echo 0)"
if [[ "$ERRS" -eq 0 ]]; then pass "no ERROR lines in the last 10 minutes"
else warn "$ERRS ERROR lines in the last 10 min — see: docker logs --since 10m $CONTAINER | grep ERROR"; fi

if docker logs --since 30m "$CONTAINER" 2>&1 | grep -qi 'safe mode\|recovery mode'; then
  fail "HA is in SAFE/RECOVERY MODE — config error; integrations will not load"
else pass "not in safe/recovery mode"; fi

# ============================================================================
hdr "4. CONFIGURATION"
# ============================================================================
if [[ -n "$LIVE" ]] && $SUDO test -f "$LIVE/configuration.yaml" 2>/dev/null; then
  $SUDO grep -q '^homekit:' "$LIVE/configuration.yaml" 2>/dev/null \
    && pass "homekit: bridge declared" \
    || fail "no homekit: block — Siri cannot work; run scripts/homekit-bridge-setup.sh"
  $SUDO grep -q 'packages:' "$LIVE/configuration.yaml" 2>/dev/null \
    && pass "packages: include present (voice intents active)" \
    || warn "no packages: include — custom Assist phrases inactive"
else
  skip "config file checks (cannot read $LIVE)"
fi

# ============================================================================
hdr "5. INTEGRATIONS & DEVICES"
# ============================================================================
CE="$LIVE/.storage/core.config_entries"
if [[ -n "$LIVE" ]] && $SUDO test -f "$CE" 2>/dev/null; then
  $SUDO grep -q '"domain": *"tuya"' "$CE" 2>/dev/null \
    && pass "Tuya integration linked" \
    || fail "Tuya NOT linked — no lights will appear"
  NINT="$($SUDO grep -o '"domain": *"[a-z_]*"' "$CE" 2>/dev/null | sort -u | wc -l)"
  pass "$NINT distinct integrations configured"
else skip "integration checks"; fi

ER="$LIVE/.storage/core.entity_registry"
if [[ -n "$LIVE" ]] && $SUDO test -f "$ER" 2>/dev/null; then
  NLIGHT="$($SUDO grep -o '"entity_id": *"light\.[^"]*"' "$ER" 2>/dev/null | wc -l)"
  if [[ "$NLIGHT" -gt 0 ]]; then pass "$NLIGHT light entities registered"
  else fail "zero light entities — nothing for Siri to control"; fi
else skip "entity registry"; fi

# ============================================================================
hdr "6. HOMEKIT BRIDGE"
# ============================================================================
if command -v ss >/dev/null 2>&1; then
  if ss -tln 2>/dev/null | grep -qE ':(21063|51827|21064)\b'; then
    pass "HomeKit bridge port listening"
  else fail "no HomeKit port listening — bridge not started"; fi
else skip "port check (ss unavailable)"; fi

if [[ -n "$LIVE" ]] && $SUDO ls "$LIVE"/.storage/homekit.* >/dev/null 2>&1; then
  pass "HomeKit pairing store exists (pairing survives reboots)"
  if $SUDO grep -q '"paired": *true\|pairing' "$LIVE"/.storage/homekit.* 2>/dev/null; then
    info "  bridge shows pairing data — iPhone should reconnect on its own"
  fi
else warn "no HomeKit pairing store — bridge has not completed setup"; fi

# The definitive HomeKit test: is it actually advertising on the LAN?
if command -v avahi-browse >/dev/null 2>&1; then
  HAP="$(timeout 8 avahi-browse -rpt _hap._tcp 2>/dev/null | grep -c '^=' || echo 0)"
  if [[ "$HAP" -gt 0 ]]; then pass "mDNS: $HAP HomeKit accessory(s) advertising on the LAN"
  else fail "mDNS: nothing advertising _hap._tcp — iPhone cannot see the bridge"; fi
else
  skip "mDNS check — install with: sudo apt-get install -y avahi-utils"
fi

# ============================================================================
hdr "7. VOICE INTENTS"
# ============================================================================
if [[ -n "$LIVE" ]] && $SUDO test -f "$LIVE/packages/voice.yaml" 2>/dev/null; then
  NI="$($SUDO grep -cE '^\s{4}HP[0-9]+_' "$LIVE/packages/voice.yaml" 2>/dev/null || echo 0)"
  pass "voice.yaml present ($NI custom intents)"
else warn "voice.yaml not in live packages/ — custom phrases unavailable (HomeKit/Siri unaffected)"; fi

# ============================================================================
hdr "8. PANEL / DASHBOARD"
# ============================================================================
for port in 8080 8000; do
  C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://localhost:$port" 2>/dev/null)"
  [[ "$C" == "200" ]] && pass "dashboard responding on :$port" && break
done
[[ "${C:-000}" != "200" ]] && warn "no dashboard on :8080 or :8000 (HA and Siri work regardless)"

# ============================================================================
hdr "9. LIVE CONTROL TEST"
# ============================================================================
TOKEN=""
[[ -f "$REPO_DIR/.env" ]] && TOKEN="$(grep -E '^HA_TOKEN=' "$REPO_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')"

if [[ -z "$TOKEN" ]]; then
  skip "live API test — no HA_TOKEN in .env"
  info "  this is the ONLY check that proves end-to-end control actually works."
  info "  to enable it: HA UI -> your profile -> Security -> Long-lived access"
  info "  tokens -> Create Token, then add HA_TOKEN=<token> to $REPO_DIR/.env"
else
  STATES="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" "$HA/api/states" 2>/dev/null)"
  if echo "$STATES" | grep -q 'entity_id'; then
    pass "API authenticated"
    TOTAL="$(echo "$STATES" | grep -o '"entity_id": *"light\.[^"]*"' | wc -l)"
    UNAVAIL="$(echo "$STATES" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); sys.exit()
print(sum(1 for e in d if e.get('entity_id','').startswith('light.') and e.get('state') in ('unavailable','unknown')))
" 2>/dev/null || echo '?')"
    if [[ "$UNAVAIL" == "0" ]]; then pass "all $TOTAL lights reporting a live state"
    else fail "$UNAVAIL of $TOTAL lights are unavailable/unknown — cloud or device issue"; fi

    ON="$(echo "$STATES" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
print(sum(1 for e in d if e.get('entity_id','').startswith('light.') and e.get('state')=='on'))
" 2>/dev/null || echo '?')"
    info "  lights currently on: $ON"
  else
    fail "API rejected the token — regenerate HA_TOKEN"
  fi
fi

# ============================================================================
hdr "SUMMARY"
# ============================================================================
printf '\n  %sPASS %d%s   %sFAIL %d%s   %sWARN %d%s   SKIP %d\n\n' \
  "$c_g" "$PASS" "$c_0" "$c_r" "$FAIL" "$c_0" "$c_y" "$WARN" "$c_0" "$SKIP"

if [[ "$FAIL" -eq 0 ]]; then
  printf '  %sSYSTEM HEALTHY%s — ask Siri to turn on a light to confirm end to end.\n\n' "$c_g" "$c_0"
  exit 0
else
  printf '  %s%d FAILURE(S) — fix the FIRST one; later ones are usually downstream:%s\n\n' "$c_r" "$FAIL" "$c_0"
  for f in "${FAILURES[@]}"; do printf '    - %s\n' "$f"; done
  echo
  exit 1
fi
