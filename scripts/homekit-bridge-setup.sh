#!/usr/bin/env bash
# =============================================================================
# homekit-bridge-setup.sh — audit, configure, and pair the HomeKit bridge
# -----------------------------------------------------------------------------
# Run this ON THE PI (the machine on your home Wi-Fi). One command, no prompts.
#
#   bash scripts/homekit-bridge-setup.sh
#
# It performs, in order:
#   1. Full audit of the running system (read-only; changes nothing)
#   2. Verifies HomeKit bridge prerequisites (mDNS, host networking, caps)
#   3. Installs the repo's HomeKit config into the LIVE config dir, validates
#      it with Home Assistant's own checker, and rolls back if invalid
#   4. Restarts HA, waits for it, extracts the pairing code, renders the QR
#
# SAFETY: .storage/ (your accounts, tokens, and any linked integrations such as
# Tuya) is NEVER overwritten. Only .yaml files are touched, and every one is
# backed up first. If config validation fails, the backup is restored and HA is
# left exactly as it was.
# =============================================================================
set -Eeuo pipefail

c_g=$'\033[1;32m'; c_b=$'\033[1;34m'; c_y=$'\033[1;33m'; c_r=$'\033[1;31m'; c_0=$'\033[0m'
ok()   { printf '%s  ok %s %s\n' "$c_g" "$c_0" "$*"; }
info() { printf '%s   . %s %s\n' "$c_b" "$c_0" "$*"; }
warn() { printf '%s   ! %s %s\n' "$c_y" "$c_0" "$*"; }
bad()  { printf '%s   x %s %s\n' "$c_r" "$c_0" "$*"; }
hdr()  { printf '\n%s== %s ==%s\n' "$c_b" "$*" "$c_0"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${HA_CONTAINER:-homeassistant}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FAILED=0

# -----------------------------------------------------------------------------
hdr "1. SYSTEM AUDIT (read-only)"
# -----------------------------------------------------------------------------

command -v docker >/dev/null 2>&1 || { bad "docker not installed"; exit 1; }
ok "docker present: $(docker --version 2>/dev/null | head -1)"

if ! docker info >/dev/null 2>&1; then
  bad "cannot talk to the docker daemon."
  bad "fix: run 'newgrp docker' then re-run this script (or prefix with sudo)."
  exit 1
fi
ok "docker daemon reachable"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  bad "container '$CONTAINER' is not running."
  info "containers present:"
  docker ps -a --format '    {{.Names}}  {{.Status}}'
  exit 1
fi
ok "container '$CONTAINER' is running ($(docker ps --filter name=^${CONTAINER}$ --format '{{.Status}}'))"

# Which host directory is actually mounted at /config? This is the crux: a
# container started by hand may be using a different config dir than the repo.
LIVE_CONFIG="$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"

if [[ -z "$LIVE_CONFIG" ]]; then
  bad "no host directory is mounted at /config in '$CONTAINER'."
  bad "HA is storing config inside the container; that is not recoverable safely."
  bad "stop here and recreate the container with: -v <dir>:/config"
  exit 1
fi
ok "live config dir: $LIVE_CONFIG"

REPO_CONFIG="$REPO_DIR/docker/homeassistant"
if [[ "$(readlink -f "$LIVE_CONFIG")" == "$(readlink -f "$REPO_CONFIG")" ]]; then
  ok "the running container is already using this repo's config"
else
  warn "the running container is NOT using this repo's config"
  info "  live: $LIVE_CONFIG"
  info "  repo: $REPO_CONFIG"
  info "  -> this script will copy the repo's .yaml files into the live dir"
fi

NET_MODE="$(docker inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')"
if [[ "$NET_MODE" == "host" ]]; then
  ok "network mode: host (required for HomeKit mDNS advertisement)"
else
  bad "network mode is '$NET_MODE', not 'host'."
  bad "HomeKit CANNOT advertise over mDNS from a bridged container."
  bad "this must be fixed or pairing will never work. see REMEDIATION below."
  FAILED=1
fi

if docker inspect "$CONTAINER" --format '{{.Mounts}}' | grep -q '/run/dbus'; then
  ok "dbus mounted (Bluetooth support)"
else
  warn "dbus not mounted — Bluetooth/BLE devices will fail (does not affect HomeKit)"
fi

CAPS="$(docker inspect "$CONTAINER" --format '{{.HostConfig.CapAdd}} {{.HostConfig.Privileged}}')"
if echo "$CAPS" | grep -qi 'NET_ADMIN\|true'; then
  ok "elevated caps present (NET_ADMIN or privileged)"
else
  warn "no NET_ADMIN/NET_RAW — Bluetooth adapter recovery unavailable (not HomeKit-related)"
fi

info "current HA config files in the live dir:"
ls -1 "$LIVE_CONFIG"/*.yaml 2>/dev/null | sed 's/^/      /' || info "      (none)"

if grep -qs '^homekit:' "$LIVE_CONFIG/configuration.yaml" 2>/dev/null; then
  ok "live configuration.yaml already declares a homekit: bridge"
  HOMEKIT_PRESENT=1
else
  warn "live configuration.yaml has NO homekit: block — this is why there is no QR code"
  HOMEKIT_PRESENT=0
fi

if compgen -G "$LIVE_CONFIG/.storage/homekit.*" >/dev/null 2>&1; then
  ok "an existing HomeKit pairing store was found (bridge has run before)"
else
  info "no HomeKit pairing store yet (bridge has never started)"
fi

hdr "2. INTEGRATION PREREQUISITES"

# Tuya cannot be configured from YAML — it requires the UI account-link flow.
if compgen -G "$LIVE_CONFIG/.storage/core.config_entries" >/dev/null 2>&1; then
  if grep -q '"domain": *"tuya"' "$LIVE_CONFIG/.storage/core.config_entries" 2>/dev/null; then
    ok "Tuya integration IS linked"
    TUYA=1
  else
    warn "Tuya integration is NOT linked yet"
    info "  Tuya uses an account-link flow that cannot be scripted."
    info "  The bridge will still be created and pairable — it will simply"
    info "  expose zero lights until you link Tuya."
    TUYA=0
  fi
  LIGHTS="$(grep -o '"domain": *"[a-z_]*"' "$LIVE_CONFIG/.storage/core.config_entries" 2>/dev/null | sort -u | wc -l)"
  info "distinct integrations configured: $LIGHTS"
else
  warn "cannot read core.config_entries (HA may still be initialising)"
  TUYA=0
fi

if [[ "$FAILED" == "1" ]]; then
  hdr "REMEDIATION REQUIRED BEFORE CONTINUING"
  bad "The container is not on host networking. HomeKit pairing cannot work."
  cat <<REMEDY

  Recreate the container with host networking (your config and .storage are
  preserved, because they live on the host at $LIVE_CONFIG):

      docker stop $CONTAINER && docker rm $CONTAINER
      cd "$REPO_DIR/docker" && docker compose --env-file ../.env up -d

  Then re-run this script.

REMEDY
  exit 1
fi

# -----------------------------------------------------------------------------
hdr "3. INSTALL + VALIDATE HOMEKIT CONFIG"
# -----------------------------------------------------------------------------

# Home Assistant runs as root inside the container, so files it has rewritten
# are root-owned on the host. Detect that and escalate only for the writes.
SUDO=""
if ! ( : >> "$LIVE_CONFIG/configuration.yaml" ) 2>/dev/null; then
  if sudo -n true 2>/dev/null || sudo -v 2>/dev/null; then
    SUDO="sudo"
    info "config files are root-owned (HA wrote them) — using sudo for writes only"
  else
    bad "configuration.yaml is not writable and sudo is unavailable."
    bad "re-run as: sudo bash scripts/homekit-bridge-setup.sh"
    exit 1
  fi
fi

BACKUP="$LIVE_CONFIG/.backup-$STAMP"
$SUDO mkdir -p "$BACKUP"
for f in "$LIVE_CONFIG"/*.yaml; do
  [[ -e "$f" ]] && $SUDO cp -a "$f" "$BACKUP/"
done
[[ -d "$LIVE_CONFIG/packages" ]] && $SUDO cp -a "$LIVE_CONFIG/packages" "$BACKUP/" 2>/dev/null || true
ok "backed up existing yaml -> $BACKUP"
info ".storage/ deliberately NOT touched (accounts, tokens, Tuya link preserved)"

# SURGICAL EDIT, NOT WHOLESALE REPLACE.
#
# The live config already has working integrations (Tuya et al). Overwriting it
# with the repo's file would risk dropping anything set up outside this repo and
# would swap in !env_var lookups the container may not have. So we make the two
# minimal text edits needed, preserving comments, anchors, and custom YAML tags:
#   1. append a top-level `homekit:` block if absent
#   2. add `packages: !include_dir_named packages` under `homeassistant:`
TMP_CFG="$(mktemp)"
$SUDO cat "$LIVE_CONFIG/configuration.yaml" > "$TMP_CFG" 2>/dev/null || : > "$TMP_CFG"

HOMEKIT_PORT="${HOMEKIT_PORT:-21063}"
python3 - "$TMP_CFG" "$HOMEKIT_PORT" <<'PY'
import re, sys
path, port = sys.argv[1], sys.argv[2]
src = open(path).read()
orig = src
if not src.endswith("\n"):
    src += "\n"

# 1) homekit: bridge -------------------------------------------------------
if not re.search(r'(?m)^homekit:', src):
    src += f"""
# --- Apple HomeKit Bridge (added by scripts/homekit-bridge-setup.sh) --------
# Exposes lights/switches/etc to Apple Home + Siri. Requires host networking so
# the bridge can advertise over mDNS on the LAN.
homekit:
  - name: SmartHome Bridge
    port: {port}
    filter:
      include_domains:
        - light
        - switch
        - fan
        - cover
        - lock
        - climate
"""
    print("ADDED homekit")
else:
    print("SKIP homekit (already present)")

# 2) packages include, nested under homeassistant: --------------------------
if re.search(r'(?m)^\s*packages:', src):
    print("SKIP packages (already present)")
elif re.search(r'(?m)^homeassistant:', src):
    src = re.sub(r'(?m)^(homeassistant:[ \t]*\n)',
                 r'\1  packages: !include_dir_named packages\n', src, count=1)
    print("ADDED packages (under existing homeassistant:)")
else:
    src += "\nhomeassistant:\n  packages: !include_dir_named packages\n"
    print("ADDED packages (new homeassistant: block)")

if src != orig:
    open(path, "w").write(src)
PY

$SUDO cp "$TMP_CFG" "$LIVE_CONFIG/configuration.yaml"
rm -f "$TMP_CFG"
ok "configuration.yaml updated in place (existing integrations untouched)"

# packages/ carries the Assist voice intents; additive, safe to sync.
if [[ -d "$REPO_CONFIG/packages" ]]; then
  $SUDO mkdir -p "$LIVE_CONFIG/packages"
  $SUDO cp -a "$REPO_CONFIG/packages/." "$LIVE_CONFIG/packages/"
  info "installed packages/ (voice intents)"
fi

# Validate with Home Assistant's own checker. This is authoritative — it is the
# same parser HA uses at boot, so it catches schema errors regardless of what
# any documentation says.
info "validating with Home Assistant's own config checker (may take ~30s)..."
if docker exec "$CONTAINER" python -m homeassistant --script check_config -c /config >/tmp/hacheck.$STAMP 2>&1; then
  ok "config VALID"
  grep -iE 'homekit|package' /tmp/hacheck.$STAMP | head -5 | sed 's/^/      /' || true
else
  bad "config INVALID — rolling back, HA left untouched"
  echo
  tail -30 /tmp/hacheck.$STAMP | sed 's/^/      /'
  echo
  $SUDO cp -a "$BACKUP"/*.yaml "$LIVE_CONFIG/" 2>/dev/null || true
  bad "rolled back from $BACKUP. Nothing was changed. Full log: /tmp/hacheck.$STAMP"
  exit 1
fi

# -----------------------------------------------------------------------------
hdr "4. RESTART, PAIR, RENDER QR"
# -----------------------------------------------------------------------------

info "restarting $CONTAINER..."
docker restart "$CONTAINER" >/dev/null
info "waiting for Home Assistant to come up..."

UP=0
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:8123 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then UP=1; ok "Home Assistant is up (${i}0s)"; break; fi
  sleep 10
  printf '.'
done
echo
if [[ "$UP" != "1" ]]; then
  bad "HA did not answer on :8123 within 10 minutes."
  bad "check: docker logs --tail 100 $CONTAINER"
  exit 1
fi

info "waiting for the HomeKit bridge to initialise..."
sleep 20

# Extract the pairing code. Try, in order: the HomeKit storage file, then the
# HA log, then the PIN configured in .env.
PIN=""
SETUP_ID=""
STORE="$(ls -1 "$LIVE_CONFIG"/.storage/homekit.* 2>/dev/null | head -1 || true)"
if [[ -n "$STORE" ]]; then
  ok "found HomeKit store: $(basename "$STORE")"
  PIN="$(python3 -c "
import json,sys
d=json.load(open('$STORE'))
def dig(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in ('pincode','pin_code','setup_code') and v: return str(v)
            r=dig(v)
            if r: return r
    elif isinstance(o,list):
        for v in o:
            r=dig(v)
            if r: return r
    return None
print(dig(d) or '')
" 2>/dev/null || true)"
  SETUP_ID="$(python3 -c "
import json
d=json.load(open('$STORE'))
def dig(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in ('setup_id','setupID') and v: return str(v)
            r=dig(v)
            if r: return r
    elif isinstance(o,list):
        for v in o:
            r=dig(v)
            if r: return r
    return None
print(dig(d) or '')
" 2>/dev/null || true)"
fi

if [[ -z "$PIN" ]]; then
  PIN="$(docker logs "$CONTAINER" 2>&1 | grep -oE '[0-9]{3}-[0-9]{2}-[0-9]{3}' | tail -1 || true)"
  [[ -n "$PIN" ]] && info "recovered PIN from HA log"
fi
if [[ -z "$PIN" && -f "$REPO_DIR/.env" ]]; then
  PIN="$(grep -E '^HOMEKIT_PIN=' "$REPO_DIR/.env" | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  [[ -n "$PIN" ]] && info "using HOMEKIT_PIN from .env"
fi

if [[ -z "$PIN" ]]; then
  bad "could not determine the pairing PIN automatically."
  info "open http://$(hostname -I | awk '{print $1}'):8123 -> Settings -> Devices & Services"
  info "-> HomeKit Bridge -> the PIN and QR are shown there."
  exit 1
fi

# Strip to digits, then re-format as HomeKit's 3-2-3.
DIGITS="$(echo "$PIN" | tr -cd '0-9')"
if [[ ${#DIGITS} -eq 8 ]]; then
  PRETTY="${DIGITS:0:3}-${DIGITS:3:2}-${DIGITS:5:3}"
else
  PRETTY="$PIN"
fi

# Build the X-HM:// setup URI. Best-effort: prefer HAP-python (the library HA
# itself uses) so the encoding is authoritative; fall back to computing it.
URI="$(docker exec "$CONTAINER" python3 -c "
try:
    from pyhap.util import to_hap_uri  # type: ignore
    print(to_hap_uri('$DIGITS', '${SETUP_ID:-HASS}', 2))
except Exception:
    print('')
" 2>/dev/null || true)"

if [[ -z "$URI" ]]; then
  URI="$(python3 -c "
code=int('$DIGITS')
sid='${SETUP_ID:-HASS}'
payload=0
payload|=0&0x7;    payload<<=4      # version
payload|=0&0xf;    payload<<=8      # reserved
payload|=2&0xff;   payload<<=4      # category: 2 = bridge
payload|=2&0xf;    payload<<=27     # flags: 2 = IP transport
payload|=code&0x7FFFFFF
digits='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
s=''
n=payload
while n:
    s=digits[n%36]+s; n//=36
print('X-HM://'+s.rjust(9,'0')+sid)
" 2>/dev/null || true)"
  [[ -n "$URI" ]] && info "setup URI computed locally (HAP encoding, best-effort)"
fi

hdr "HOMEKIT PAIRING"
echo
printf '   PAIRING CODE:  %s%s%s\n' "$c_g" "$PRETTY" "$c_0"
echo
[[ -n "$URI" ]] && printf '   setup URI:     %s\n\n' "$URI"

RENDERED=0
if [[ -n "$URI" ]]; then
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ANSIUTF8 "$URI" && RENDERED=1
  elif python3 -c 'import qrcode' 2>/dev/null; then
    python3 -c "
import qrcode
q=qrcode.QRCode(border=2); q.add_data('$URI'); q.make()
q.print_ascii(invert=True)
" && RENDERED=1
  elif docker exec "$CONTAINER" python3 -c 'import qrcode' 2>/dev/null; then
    docker exec "$CONTAINER" python3 -c "
import qrcode
q=qrcode.QRCode(border=2); q.add_data('$URI'); q.make()
q.print_ascii(invert=True)
" && RENDERED=1
  fi
fi

if [[ "$RENDERED" != "1" ]]; then
  warn "no QR renderer available in the terminal."
  info "install one with:  sudo apt-get install -y qrencode   (then re-run)"
  info "or just TYPE the code below into the Home app — scanning is optional."
fi

hdr "NEXT STEPS ON YOUR IPHONE"
cat <<STEPS

   1. iPhone must be on the SAME Wi-Fi as this Pi. (HomeKit is mDNS/LAN only —
      it does not work across the internet, VPN, or a VPS.)
   2. Home app -> "+" (top right) -> Add Accessory
   3. Scan the QR above, OR tap "More options..." and type:  $PRETTY
   4. It will warn "Uncertified Accessory" -> Add Anyway
   5. Choose rooms for each light, then finish.

   Siri will then control every exposed light by name, on iPhone and HomePods.

STEPS

if [[ "${TUYA:-0}" != "1" ]]; then
  warn "TUYA IS NOT LINKED — the bridge will pair but expose no lights."
  info "link it first: http://$(hostname -I | awk '{print $1}'):8123"
  info "  Settings -> Devices & Services -> Add Integration -> Tuya"
  info "  -> use the Smart Life app QR / account link, then re-run this script."
fi

hdr "AUDIT COMPLETE"
info "backup of previous config: $BACKUP"
info "config check log:          /tmp/hacheck.$STAMP"
echo
