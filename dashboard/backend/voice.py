"""Natural-language voice-command parser for the smart-home system.

How voice fits in
-----------------
Primary voice control is **Siri / HomePod via Apple HomeKit**: once devices are
bridged (see docs/DEVICES.md) and assigned to HomeKit rooms, "Hey Siri, turn off
the kitchen lights" already works natively, including per-room grouping.

This module powers a *richer* fallback/extension path: an Apple **Shortcut**
personal automation captures the spoken phrase and POSTs it to
``/api/voice/command``. We parse the phrase here and translate it into Home
Assistant service calls. That lets us support commands Siri+HomeKit can be
fussy about — e.g. "dim the kitchen lights by 99%", "change kitchen lights to
warm 50%", or targeting one light within a room ("turn off the kitchen sink
light").

The parser is deliberately pure and dependency-free so it is easy to unit test:
:func:`parse` takes the phrase plus a snapshot of known lights (name + room +
capabilities) and returns a plan of Home Assistant service calls plus a spoken
confirmation string. Executing the plan is the caller's job.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Named CSS-ish colors we can map to RGB for color-capable lights.
COLORS: dict[str, list[int]] = {
    "red": [255, 0, 0], "green": [0, 255, 0], "blue": [0, 80, 255],
    "purple": [160, 0, 255], "violet": [160, 0, 255], "magenta": [255, 0, 200],
    "pink": [255, 90, 170], "orange": [255, 130, 0], "yellow": [255, 220, 0],
    "cyan": [0, 220, 255], "teal": [0, 200, 180], "white": [255, 255, 255],
}

# Color temperature presets in mireds (lower = cooler/bluer, higher = warmer).
TEMP_WARM = 400
TEMP_NEUTRAL = 300
TEMP_COOL = 160


@dataclass
class Light:
    entity_id: str
    name: str
    room: str = ""
    supports_color: bool = False
    supports_temp: bool = False


@dataclass
class Plan:
    calls: list[dict[str, Any]] = field(default_factory=list)
    spoken: str = ""
    matched: list[str] = field(default_factory=list)   # entity_ids acted on
    understood: bool = True


def _norm(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^\w%\s]", " ", text)          # keep % for "by 50%"
    return re.sub(r"\s+", " ", text)


def _find_percent(text: str) -> int | None:
    m = re.search(r"(\d{1,3})\s*(?:%|percent)", text)
    return max(0, min(100, int(m.group(1)))) if m else None


def _select_targets(text: str, lights: list[Light]) -> tuple[list[Light], str]:
    """Decide which lights a phrase refers to.

    Priority:
      1. "all lights"  -> every light
      2. a specific light whose name appears in the phrase (most specific)
      3. every light in a room named in the phrase
    Returns (targets, scope_label_for_speech).
    """
    if re.search(r"\ball (the )?lights\b|\beverything\b|\ball lights\b", text):
        return lights, "all lights"

    # 2) specific light by name — longest name match wins so "kitchen sink
    #    light" beats the room "kitchen".
    named = sorted(lights, key=lambda l: len(l.name), reverse=True)
    for l in named:
        n = l.name.lower()
        # require the full light name (or its distinctive words) to appear
        if n and n in text:
            return [l], l.name

    # 3) by room
    rooms = {l.room.lower(): l.room for l in lights if l.room}
    for room_lc in sorted(rooms, key=len, reverse=True):
        if room_lc and room_lc in text:
            targets = [l for l in lights if l.room.lower() == room_lc]
            return targets, f"the {rooms[room_lc]} lights"

    # 4) last resort: a partial word match against a single light name
    words = set(text.split())
    for l in named:
        if words & set(l.name.lower().split()):
            return [l], l.name

    return [], ""


def parse(text: str, lights: list[Light]) -> Plan:
    t = _norm(text)
    if not t:
        return Plan(spoken="I didn't catch that.", understood=False)

    targets, scope = _select_targets(t, lights)
    if not targets:
        return Plan(spoken="I couldn't find those lights.", understood=False)

    ids = [l.entity_id for l in targets]
    plan = Plan(matched=ids)

    pct = _find_percent(t)
    wants_color = next((c for c in COLORS if re.search(rf"\b{c}\b", t)), None)
    wants_warm = bool(re.search(r"\bwarm\b|\bsoft\b", t))
    wants_cool = bool(re.search(r"\bcool\b|\bdaylight\b|\bbright white\b", t))

    # ---- OFF -------------------------------------------------------------- #
    if re.search(r"\b(turn off|shut off|switch off|off)\b", t) and not re.search(r"\bturn on\b", t):
        plan.calls.append({"domain": "light", "service": "turn_off",
                            "data": {"entity_id": ids}})
        plan.spoken = f"Turning off {scope}."
        return plan

    # ---- DIM / BRIGHTNESS ------------------------------------------------- #
    # "dim ... by N%" -> reduce to (100 - N). "dim to N%"/"set to N%" -> N.
    if pct is not None and re.search(r"\bdim\b", t) and re.search(r"\bby\b", t):
        brightness = 100 - pct
    elif pct is not None:
        brightness = pct
    else:
        brightness = None

    data: dict[str, Any] = {"entity_id": ids}
    speech_bits: list[str] = []

    if brightness is not None:
        data["brightness_pct"] = brightness
        speech_bits.append(f"{brightness} percent")

    # ---- COLOR / WARMTH --------------------------------------------------- #
    color_targets = [l for l in targets if l.supports_color]
    temp_targets = [l for l in targets if l.supports_temp]

    if wants_color and wants_color != "white":
        # only color-capable lights get an rgb; others fall back to warmth
        if color_targets:
            plan.calls.append({
                "domain": "light", "service": "turn_on",
                "data": {"entity_id": [l.entity_id for l in color_targets],
                         "rgb_color": COLORS[wants_color],
                         **({"brightness_pct": brightness} if brightness is not None else {})},
            })
            speech_bits.append(wants_color)
        # temperature-only lights just take the brightness part
        rest = [l for l in targets if not l.supports_color]
        if rest and brightness is not None:
            plan.calls.append({"domain": "light", "service": "turn_on",
                               "data": {"entity_id": [l.entity_id for l in rest],
                                        "brightness_pct": brightness}})
        plan.spoken = f"Setting {scope} to " + " ".join(speech_bits) + "."
        return plan

    if wants_warm or wants_cool:
        temp = TEMP_WARM if wants_warm else TEMP_COOL
        data["color_temp"] = temp
        speech_bits.append("warm" if wants_warm else "cool white")

    # generic turn_on (with any brightness/temp gathered above)
    plan.calls.append({"domain": "light", "service": "turn_on", "data": data})

    if re.search(r"\bturn on\b|\bon\b", t) and not speech_bits:
        plan.spoken = f"Turning on {scope}."
    elif speech_bits:
        plan.spoken = f"Setting {scope} to " + " ".join(speech_bits) + "."
    else:
        plan.spoken = f"Adjusting {scope}."
    return plan
