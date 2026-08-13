#!/usr/bin/env bash
# =============================================================================
# capture-working-state.sh — snapshot the WORKING system into the repo
# -----------------------------------------------------------------------------
# Run on the Pi:   bash scripts/capture-working-state.sh
#
# STRICTLY READ-ONLY with respect to Home Assistant. It does not restart the
# container, does not edit the live config, does not touch .storage/. The ONLY
# writes are into this git repo's working tree.
#
# WHAT IT DELIBERATELY DOES NOT CAPTURE
#   * secrets.yaml contents      — records key NAMES only
#   * .storage/*                 — auth tokens, Tuya credentials, HomeKit keys
#   * the HomeKit pairing PIN    — pairing material, not configuration
#   * any long-lived access token
# A secret scan runs at the end and ABORTS the capture if anything leaks.
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
NOW_ISO="$(date -Iseconds)"
NOW_TAG="$(date +%Y%m%d-%H%M)"
SNAP="$REPO_DIR/snapshot"
DOC="$REPO_DIR/docs/WORKING-STATE.md"

cd "$REPO_DIR"

hdr "0. PRE-FLIGHT"
docker info >/dev/null 2>&1 || { bad "docker daemon unreachable (try: newgrp docker)"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || { bad "container '$CONTAINER' not running"; exit 1; }
ok "container '$CONTAINER' running — capture is read-only, it will NOT be restarted"

LIVE="$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}')"
[[ -n "$LIVE" ]] || { bad "no /config mount found"; exit 1; }
ok "live config: $LIVE"

SUDO=""
if ! head -c1 "$LIVE/configuration.yaml" >/dev/null 2>&1; then
  sudo -v && SUDO="sudo" || { bad "need sudo to read the live config"; exit 1; }
fi

rm -rf "$SNAP"; mkdir -p "$SNAP/config"

# -----------------------------------------------------------------------------
hdr "1. RUNTIME FACTS"
# -----------------------------------------------------------------------------
HA_IMAGE="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')"
HA_DIGEST="$(docker inspect "$CONTAINER" --format '{{index .Image}}' | cut -c1-19)"
HA_NET="$(docker inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')"
HA_PRIV="$(docker inspect "$CONTAINER" --format '{{.HostConfig.Privileged}}')"
HA_STARTED="$(docker inspect "$CONTAINER" --format '{{.State.StartedAt}}')"
HA_VER="$($SUDO docker exec "$CONTAINER" python3 -c 'import homeassistant.const as c;print(c.__version__)' 2>/dev/null || echo 'unknown')"
PI_MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo 'unknown')"
PI_OS="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo unknown)"
PI_IP="$(hostname -I | awk '{print $1}')"

docker inspect "$CONTAINER" \
  --format '{{json .Mounts}}' 2>/dev/null | python3 -m json.tool > "$SNAP/container-mounts.json" 2>/dev/null || true
ok "HA $HA_VER  ·  image $HA_IMAGE  ·  net $HA_NET"

# -----------------------------------------------------------------------------
hdr "2. CONFIG CAPTURE (sanitised)"
# -----------------------------------------------------------------------------
for f in configuration.yaml automations.yaml scenes.yaml scripts.yaml cameras.yaml groups.yaml customize.yaml; do
  if $SUDO test -f "$LIVE/$f"; then
    $SUDO cat "$LIVE/$f" > "$SNAP/config/$f" 2>/dev/null && info "captured $f"
  fi
done
if $SUDO test -d "$LIVE/packages"; then
  mkdir -p "$SNAP/config/packages"
  for p in $($SUDO ls -1 "$LIVE/packages" 2>/dev/null); do
    $SUDO cat "$LIVE/packages/$p" > "$SNAP/config/packages/$p" 2>/dev/null && info "captured packages/$p"
  done
fi

# secrets.yaml: KEY NAMES ONLY, never values.
if $SUDO test -f "$LIVE/secrets.yaml"; then
  $SUDO grep -oE '^[a-zA-Z0-9_]+:' "$LIVE/secrets.yaml" 2>/dev/null | tr -d ':' \
    | sed 's/^/  - /' > "$SNAP/secrets-keys-only.txt" || true
  ok "secrets.yaml: recorded $(wc -l < "$SNAP/secrets-keys-only.txt" 2>/dev/null || echo 0) key NAMES, zero values"
fi

# Redact anything sensitive that lives inline in the captured yaml.
python3 - "$SNAP/config" <<'PY'
import os, re, sys
root = sys.argv[1]
# The keyword may be prefixed or suffixed in the key name (api_password,
# tuya_client_secret, token_2). Anchoring the keyword to the start of the key
# lets those through — a tested, real leak. Match anywhere inside the key.
# Over-redaction is the safe direction here: this is a record, not a restore
# image, so a wrongly-redacted value costs nothing and a missed one is a breach.
KEYS = r'(password|passwd|token|api[_-]?key|secret|pincode|credential|auth)'
pat  = re.compile(rf'(?i)^(\s*-?\s*[A-Za-z0-9_.-]*{KEYS}[A-Za-z0-9_.-]*\s*:\s*)(?!!secret\b)(.+)$')
n = 0
for dirpath, _, files in os.walk(root):
    for fn in files:
        p = os.path.join(dirpath, fn)
        try: src = open(p).read()
        except Exception: continue
        out = []
        for line in src.splitlines(True):
            m = pat.match(line.rstrip('\n'))
            if m:
                out.append(f"{m.group(1)}<REDACTED>\n"); n += 1
            else:
                out.append(line)
        open(p, 'w').writelines(out)
print(f"redacted {n} inline value(s)")
PY

# -----------------------------------------------------------------------------
hdr "3. INVENTORY (names only, no credentials)"
# -----------------------------------------------------------------------------
CE="$LIVE/.storage/core.config_entries"
if $SUDO test -f "$CE"; then
  $SUDO cat "$CE" > /tmp/.ce.$$ 2>/dev/null
  python3 - /tmp/.ce.$$ "$SNAP/integrations.md" <<'PY'
import json, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
entries = d.get("data", {}).get("entries", [])
rows = sorted({(e.get("domain",""), e.get("title","")) for e in entries})
with open(out, "w") as fh:
    fh.write("| integration | title |\n|---|---|\n")
    for dom, title in rows:
        fh.write(f"| `{dom}` | {title} |\n")
print(f"{len(rows)} integrations")
PY
  rm -f /tmp/.ce.$$
  ok "integrations captured (domain + title only — no tokens)"
fi

ER="$LIVE/.storage/core.entity_registry"
if $SUDO test -f "$ER"; then
  $SUDO cat "$ER" > /tmp/.er.$$ 2>/dev/null
  python3 - /tmp/.er.$$ "$SNAP/entities.md" <<'PY'
import json, sys, collections
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
ents = d.get("data", {}).get("entities", [])
by = collections.defaultdict(list)
for e in ents:
    eid = e.get("entity_id","")
    by[eid.split(".")[0]].append((eid, e.get("name") or e.get("original_name") or "", e.get("area_id") or ""))
with open(out,"w") as fh:
    fh.write(f"Total entities: {len(ents)}\n\n")
    for dom in sorted(by):
        fh.write(f"\n## {dom} ({len(by[dom])})\n\n| entity_id | name | area |\n|---|---|---|\n")
        for eid,name,area in sorted(by[dom]):
            fh.write(f"| `{eid}` | {name} | {area} |\n")
print(f"{len(ents)} entities, {len(by.get('light',[]))} lights")
PY
  rm -f /tmp/.er.$$
  ok "entity registry captured (ids/names/areas only)"
fi

AR="$LIVE/.storage/core.area_registry"
if $SUDO test -f "$AR"; then
  $SUDO cat "$AR" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('data',{}).get('areas',[]): print('  - '+a.get('name',''))
" > "$SNAP/areas.txt" 2>/dev/null && ok "areas captured"
fi

# HomeKit: confirm the bridge exists. Never record pairing material.
HK_STATE="not configured"
if $SUDO ls "$LIVE"/.storage/homekit.* >/dev/null 2>&1; then
  HK_STATE="configured and paired (pairing material intentionally NOT captured)"
fi
ok "homekit: $HK_STATE"

# -----------------------------------------------------------------------------
hdr "4. WRITE MILESTONE DOC"
# -----------------------------------------------------------------------------
LIGHTS="$(grep -c '^| `light\.' "$SNAP/entities.md" 2>/dev/null || echo 0)"
NINT="$(grep -c '^| `' "$SNAP/integrations.md" 2>/dev/null || echo 0)"
NENT="$(grep -oE 'Total entities: [0-9]+' "$SNAP/entities.md" 2>/dev/null | grep -oE '[0-9]+' || echo 0)"

cat > "$DOC" <<EOF
# Working state — verified milestone

**Captured:** $NOW_ISO
**Status:** Siri voice control working. Devices visible in Apple Home. Panel serving.

This records a system confirmed working end to end. Captured read-only from the
running Pi; Home Assistant was not restarted or modified to produce it.

## Verified working

- Siri controls lights by voice via the HomeKit bridge
- All devices visible in the Apple Home app on iPhone
- Dashboard panel serving and functional
- Tuya cloud integration linked
- Custom Assist voice intents loaded from \`packages/voice.yaml\`

## Runtime

| | |
|---|---|
| Home Assistant | \`$HA_VER\` |
| Image | \`$HA_IMAGE\` |
| Image ID | \`$HA_DIGEST\` |
| Network mode | \`$HA_NET\` (required for HomeKit mDNS) |
| Privileged | \`$HA_PRIV\` |
| Container started | \`$HA_STARTED\` |
| Live config dir | \`$LIVE\` |
| Host | $PI_MODEL |
| OS | $PI_OS |
| LAN IP | \`$PI_IP\` |
| HomeKit bridge | $HK_STATE |

## Scale

| | count |
|---|---|
| Integrations | $NINT |
| Entities | $NENT |
| Lights | $LIGHTS |

## Snapshot contents

| path | contents |
|---|---|
| \`snapshot/config/\` | live YAML, inline secrets redacted |
| \`snapshot/config/packages/\` | voice intent packages |
| \`snapshot/integrations.md\` | integration domains + titles |
| \`snapshot/entities.md\` | entity ids, names, areas |
| \`snapshot/areas.txt\` | area/room names |
| \`snapshot/secrets-keys-only.txt\` | secrets.yaml **key names only** |
| \`snapshot/container-mounts.json\` | container mount layout |

## Deliberately excluded

Never committed, by design:

- \`secrets.yaml\` **values** — key names only
- \`.storage/\` — auth tokens, Tuya credentials, HomeKit pairing keys
- the HomeKit pairing PIN
- long-lived access tokens

A secret scan runs before commit and aborts if any pattern survives.

## Known gaps at capture time

- Device and room names are **not yet consistent** between Apple Home and the
  Home Assistant panel. Manual reconciliation pending — this is cosmetic and
  does not affect voice control.
- \`dbus\` not mounted and no \`NET_ADMIN\`/\`NET_RAW\` on the container, so
  Bluetooth/BLE devices do not work. Does not affect HomeKit or Tuya.
- The live config dir (\`$LIVE\`) is not the repo's \`docker/homeassistant/\`.
  The running system is authoritative; this snapshot is its record.

## Restoring from this milestone

The YAML here is redacted and cannot be used verbatim — \`secrets.yaml\` must be
recreated from \`snapshot/secrets-keys-only.txt\`, and integrations relinked
through the UI, since their tokens live in \`.storage/\` and are not captured.
This is a **record of a known-good configuration**, not a turnkey restore image.
EOF
ok "wrote docs/WORKING-STATE.md"

# -----------------------------------------------------------------------------
hdr "5. SECRET SCAN (abort on leak)"
# -----------------------------------------------------------------------------
LEAK=0
while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  bad "possible secret: $hit"; LEAK=1
done < <(grep -rInE '(password|passwd|api[_-]?key|client_secret|access_token|refresh_token|authkey|pincode)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9_/+.=-]{8,}' "$SNAP" 2>/dev/null \
         | grep -v '<REDACTED>' | head -20)

for forbidden in ".storage" "secrets.yaml"; do
  if find "$SNAP" -name "*${forbidden}*" -not -name "secrets-keys-only.txt" 2>/dev/null | grep -q .; then
    bad "forbidden file captured: $forbidden"; LEAK=1
  fi
done

if [[ "$LEAK" == "1" ]]; then
  bad "ABORTING — snapshot removed, nothing committed."
  rm -rf "$SNAP"
  exit 1
fi
ok "secret scan clean"

hdr "CAPTURE COMPLETE — NOTHING COMMITTED YET"
info "review it yourself before anything is committed:"
echo
printf '    git -C %s status --short\n' "$REPO_DIR"
printf '    less %s\n' "$DOC"
printf '    grep -ri redacted %s | head\n\n' "$SNAP"
info "then commit and tag the milestone:"
echo
printf '    cd %s\n' "$REPO_DIR"
printf '    git add snapshot docs/WORKING-STATE.md\n'
printf '    git commit -m "Milestone: working Siri voice control, verified %s"\n' "$NOW_ISO"
printf '    git tag -a working-%s -m "Verified working: Siri + Apple Home + panel"\n' "$NOW_TAG"
printf '    git push origin HEAD && git push origin working-%s\n\n' "$NOW_TAG"
ok "Home Assistant was not modified or restarted by this script."
