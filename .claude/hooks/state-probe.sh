#!/usr/bin/env bash
# =============================================================================
# state-probe.sh — SessionStart hook. Enforces CLAUDE.md R3.
# -----------------------------------------------------------------------------
# Dumps real system state into context at session start so the assistant cannot
# begin by assuming what is installed or running. Read-only; changes nothing.
#
# Every probe is guarded and time-limited: this must never block session start.
# =============================================================================
set -uo pipefail

echo "=== SYSTEM STATE (auto-probed at session start — do not assume, read this) ==="
echo "host: $(hostname 2>/dev/null || echo '?')   ip: $(hostname -I 2>/dev/null | awk '{print $1}' || echo '?')"

echo
echo "--- docker ---"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker: NOT INSTALLED"
elif ! timeout 5 docker info >/dev/null 2>&1; then
  echo "docker: installed but daemon UNREACHABLE (permissions? try: newgrp docker)"
else
  timeout 5 docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null \
    | sed 's/^/  /' || echo "  (query failed)"
  cfg="$(timeout 5 docker inspect homeassistant \
        --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  [[ -n "$cfg" ]] && echo "  homeassistant /config mount -> $cfg"
  net="$(timeout 5 docker inspect homeassistant --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)"
  [[ -n "$net" ]] && echo "  homeassistant network mode  -> $net"
fi

echo
echo "--- home assistant ---"
code="$(timeout 4 curl -s -o /dev/null -w '%{http_code}' http://localhost:8123 2>/dev/null)" || code=""
[[ -z "$code" ]] && code="000 (unreachable)"
echo "  http://localhost:8123 -> HTTP $code"
if [[ -n "${cfg:-}" && -f "${cfg:-}/configuration.yaml" ]]; then
  grep -q '^homekit:' "$cfg/configuration.yaml" 2>/dev/null \
    && echo "  live configuration.yaml: homekit: block PRESENT" \
    || echo "  live configuration.yaml: homekit: block ABSENT (no QR will exist)"
  grep -q 'packages:' "$cfg/configuration.yaml" 2>/dev/null \
    && echo "  live configuration.yaml: packages: include PRESENT" \
    || echo "  live configuration.yaml: packages: include ABSENT (voice.yaml inert)"
  if [[ -f "$cfg/.storage/core.config_entries" ]]; then
    grep -q '"domain": *"tuya"' "$cfg/.storage/core.config_entries" 2>/dev/null \
      && echo "  tuya integration: LINKED" \
      || echo "  tuya integration: NOT LINKED"
  fi
fi

echo
echo "--- repo ---"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "  branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  changed="$(git status --porcelain 2>/dev/null | wc -l)"
  echo "  uncommitted changes: $changed"
else
  echo "  not a git repo"
fi

echo
echo "REMINDER (CLAUDE.md R3): the above is ground truth. Do not issue install or"
echo "configure instructions that contradict it, and do not ask the user to report"
echo "state you can probe yourself."
echo "=== END SYSTEM STATE ==="
