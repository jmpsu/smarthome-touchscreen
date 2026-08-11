#!/usr/bin/env bash
# =============================================================================
# verify-citations.sh — Stop hook. Enforces CLAUDE.md R1.
# -----------------------------------------------------------------------------
# Blocks the assistant from ending its turn if the final message contains a URL
# that never appeared in a WebFetch/WebSearch tool RESULT this session.
#
# Per Claude Code docs, a Stop hook exiting 2 "Prevents Claude from stopping,
# continues the conversation" — so the model is forced to remove the unverified
# citation or go actually retrieve it.
#
# Input: hook JSON on stdin, including transcript_path.
# Exit 0 = allow stop. Exit 2 = block, stderr is fed back to the model.
#
# FAIL-OPEN BY DESIGN: if the transcript cannot be read, this allows the stop
# and prints a warning. A broken safety hook that blocks every turn would brick
# the session, which is worse than the failure it guards against. The warning is
# the signal that the control is not currently active.
# =============================================================================
set -uo pipefail

INPUT="$(cat)"

TRANSCRIPT="$(printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('transcript_path',''))
except Exception: print('')
" 2>/dev/null)"

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  echo "[verify-citations] WARNING: no readable transcript; citation check INACTIVE this turn." >&2
  exit 0
fi

python3 - "$TRANSCRIPT" <<'PY'
import json, re, sys

path = sys.argv[1]

# Domains that are structural, not evidentiary claims.
ALLOW_HOSTS = {
    "github.com", "www.github.com",          # repo's own links / PRs
    "claude.ai", "claude.com",               # attribution footers
    "code.claude.com", "docs.claude.com",
    "localhost", "127.0.0.1",
}

URL_RE = re.compile(r'https?://([A-Za-z0-9.\-]+)(/[^\s)>\]"\'`]*)?')

retrieved = set()   # every URL that appeared in a tool RESULT
last_assistant = ""

def texts(content):
    out = []
    if isinstance(content, str):
        out.append(content)
    elif isinstance(content, list):
        for c in content:
            if isinstance(c, dict):
                if isinstance(c.get("text"), str):
                    out.append(c["text"])
                if "content" in c:
                    out.extend(texts(c["content"]))
            elif isinstance(c, str):
                out.append(c)
    elif isinstance(content, dict):
        out.extend(texts(content.get("content", "")))
    return out

try:
    with open(path, "r", errors="ignore") as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except Exception:
                continue

            msg = e.get("message") or {}
            role = msg.get("role") or e.get("type")
            blob = " ".join(texts(msg.get("content", "")))

            # Tool results arrive as user-role messages containing tool_result
            # blocks. Anything in a result is ground truth: it was retrieved.
            is_result = ("tool_result" in line) or (role == "user" and "toolUseResult" in e)
            if is_result or "toolUseResult" in e:
                extra = ""
                try:
                    extra = json.dumps(e.get("toolUseResult", ""))
                except Exception:
                    pass
                for m in URL_RE.finditer(blob + " " + extra):
                    retrieved.add(m.group(0).rstrip('.,;:'))
                    retrieved.add(m.group(1))

            if role == "assistant" and blob.strip():
                last_assistant = blob
except Exception as exc:
    print(f"[verify-citations] WARNING: transcript unreadable ({exc}); check INACTIVE.", file=sys.stderr)
    sys.exit(0)

if not last_assistant.strip():
    sys.exit(0)

retrieved_hosts = {u for u in retrieved if "/" not in u}

unverified = []
for m in URL_RE.finditer(last_assistant):
    url  = m.group(0).rstrip('.,;:')
    host = m.group(1)
    if host in ALLOW_HOSTS:
        continue
    if url in retrieved:
        continue
    if host in retrieved_hosts or host in {h for h in retrieved if "/" not in h}:
        # Host was fetched but this exact deep path was not. Flag it: fabricated
        # deep links under a real domain are the exact failure mode R1 targets.
        unverified.append(f"{url}   (host was retrieved, this PATH was not)")
        continue
    unverified.append(f"{url}   (never retrieved in this session)")

if unverified:
    print("BLOCKED by CLAUDE.md R1 — unverified citations in your message:", file=sys.stderr)
    for u in unverified[:12]:
        print(f"  - {u}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Do ONE of these, then finish:", file=sys.stderr)
    print("  1. WebFetch/WebSearch the URL and quote only what actually came back", file=sys.stderr)
    print("  2. Delete the citation", file=sys.stderr)
    print("  3. Mark it [UNVERIFIED] and say you could not confirm it", file=sys.stderr)
    print("Do NOT reconstruct the source from memory.", file=sys.stderr)
    sys.exit(2)

sys.exit(0)
PY
