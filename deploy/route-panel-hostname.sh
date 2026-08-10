#!/usr/bin/env bash
# =============================================================================
# Route panel.joeysvault.app to the smarthome-panel backend via cloudflared.
#
# This modifies the cloudflared ingress configuration to add a rule mapping
# panel.joeysvault.app to 127.0.0.1:8000 (where the Python FastAPI panel runs).
# The change is validated before committing and the tunnel is restarted.
#
# Run this ON the VPS where cloudflared is configured.
# =============================================================================
set -Eeuo pipefail

HOSTNAME="panel.joeysvault.app"
PORT=8000

err() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
log() { printf '\033[1;32m[+]\033[0m %s\n' "$*"; }

# Locate the cloudflared config file
CFG=""
for f in /etc/cloudflared/config.yml /etc/cloudflared/config.yaml \
         /root/.cloudflared/config.yml /root/.cloudflared/config.yaml; do
  [ -f "$f" ] && { CFG="$f"; break; }
done

if [ -z "$CFG" ]; then
  err "No cloudflared config found in standard locations."
  err "Install cloudflared and configure ingress rules first."
  exit 1
fi

log "Found cloudflared config at $CFG"

# Check if the rule already exists exactly as we want it
if grep -q "hostname: *$HOSTNAME\$" "$CFG" && \
   grep -A1 "hostname: *$HOSTNAME\$" "$CFG" | grep -q "127.0.0.1:$PORT"; then
  log "✓ $HOSTNAME already routes to 127.0.0.1:$PORT. Nothing to do."
  exit 0
fi

# Backup the config before modification
BACKUP="$CFG.bak.$(date +%Y%m%d%H%M%S)"
sudo cp "$CFG" "$BACKUP"
log "Backed up $CFG → $BACKUP"

# Use Python to insert the ingress rule, removing any existing rule for this hostname
sudo python3 - "$CFG" "$HOSTNAME" "$PORT" <<'PYEOF'
import re, sys
path, host, port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
lines = text.splitlines()

# Drop any existing rule for this hostname so we don't create a duplicate.
out, skip = [], False
for i, ln in enumerate(lines):
    if re.match(rf'\s*-\s*hostname:\s*{re.escape(host)}\s*$', ln):
        skip = True
        continue
    if skip:
        # Skip the indented body of the removed rule.
        if re.match(r'\s*-\s', ln) or not ln.startswith((' ', '\t')):
            skip = False
        else:
            continue
    out.append(ln)
lines = out

rule = [f"  - hostname: {host}", f"    service: http://127.0.0.1:{port}"]

# Place it immediately before the catch-all (a service with no hostname).
idx = next((i for i, ln in enumerate(lines)
            if re.match(r'\s*-\s*service:', ln)), None)
if idx is None:
    if not any(re.match(r'\s*ingress:', ln) for ln in lines):
        lines += ["ingress:"]
    lines += rule + ["  - service: http_status:404"]
else:
    lines[idx:idx] = rule

open(path, "w").write("\n".join(lines) + "\n")
print(f"[+] ingress: {host} -> http://127.0.0.1:{port}")
PYEOF

# Validate the modified config
log "Validating cloudflared config..."
if sudo cloudflared tunnel ingress validate --config "$CFG" 2>/dev/null; then
  log "✓ Config is valid."
  log "Restarting cloudflared..."
  sudo systemctl restart cloudflared
  log "✓ cloudflared reloaded. $HOSTNAME now routes to 127.0.0.1:$PORT"
  exit 0
else
  err "ingress validation FAILED. Restoring backup and exiting."
  sudo cp "$BACKUP" "$CFG"
  exit 1
fi
