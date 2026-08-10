"""User-editable voice rules — the engine behind Settings → Voice.

Nothing about the wording is fixed. A *rule* is a list of phrase templates the
user invents plus the action they perform. Two slots may appear in a template:

    {target}   any room or light name        e.g. "the couch lamp", "kitchen"
    {value}    a number or a colour          e.g. "20", "20 percent", "red"

At parse time each template is compiled to a regex, every rule is scored
against the phrase, and the best-scoring match wins. Scoring is by how much
*literal* (non-slot) text the template matched, so "dim the {target} to
{value}" beats a looser "{target} {value}" on the same sentence.

The same rule set is compiled to Home Assistant ``custom_sentences`` YAML by
:func:`build_ha_sentences`, which is what the "Build Siri phrases" button
produces: drop that file into Home Assistant and Assist — and therefore Siri
on a HomePod — answers to the user's own wording.

Pure and dependency-free so it can be unit tested without a running server.
"""
from __future__ import annotations

import re
from typing import Any

from .voice import COLORS, TEMP_COOL, TEMP_NEUTRAL, TEMP_WARM, Light, Plan, _select_targets

# --------------------------------------------------------------------------- #
# Catalogue of actions a rule can perform. The UI renders this as the dropdown
# on each rule, so adding an entry here adds it to the picker.
# --------------------------------------------------------------------------- #
ACTIONS: dict[str, dict[str, Any]] = {
    "turn_on":        {"label": "Turn on",        "needs": []},
    "turn_off":       {"label": "Turn off",       "needs": []},
    "toggle":         {"label": "Toggle",         "needs": []},
    "set_brightness": {"label": "Set brightness", "needs": ["value"]},
    "set_color":      {"label": "Set color",      "needs": ["value"]},
    "set_warmth":     {"label": "Set warmth",     "needs": ["value"]},
    "run_scene":      {"label": "Run scene",      "needs": ["scene"]},
    "play_music":     {"label": "Play music",     "needs": []},
    "pause_music":    {"label": "Pause music",    "needs": []},
    "next_track":     {"label": "Next track",     "needs": []},
}

# Shipped as the starting rule set. Every phrase here is editable or removable
# from the UI — these are defaults, not hardcoded behaviour.
DEFAULT_RULES: dict[str, Any] = {
    "rules": [
        {"action": "turn_on", "phrases": [
            "turn on the {target}", "{target} on", "light up the {target}",
            "hit the {target}"]},
        {"action": "turn_off", "phrases": [
            "turn off the {target}", "{target} off", "kill the {target}",
            "douse the {target}"]},
        {"action": "set_brightness", "phrases": [
            "set the {target} to {value} percent", "dim the {target} to {value}",
            "{target} at {value}"]},
        {"action": "set_color", "phrases": [
            "make the {target} {value}", "turn the {target} {value}",
            "{target} to {value}"]},
        {"action": "run_scene", "scene": "Movie", "phrases": [
            "movie time", "movie mode", "theater mode"]},
        {"action": "run_scene", "scene": "Good Night", "phrases": [
            "good night", "bedtime", "lights out everywhere"]},
        {"action": "play_music", "phrases": [
            "play music", "put on some music", "start the tunes"]},
        {"action": "pause_music", "phrases": [
            "pause the music", "stop the music", "quiet"]},
    ]
}

_SLOT_RE = re.compile(r"\{(target|value)\}")


def _norm(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^\w%\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def compile_phrase(template: str) -> tuple[re.Pattern[str], int]:
    """Compile one phrase template to (regex, literal_weight).

    literal_weight is the number of non-slot characters, used to prefer the
    most specific template when several match the same sentence.
    """
    parts: list[str] = []
    literal = 0
    pos = 0
    for m in _SLOT_RE.finditer(template):
        chunk = _norm(template[pos:m.start()])
        if chunk:
            literal += len(chunk)
            parts.append(r"\s*" + r"\s+".join(re.escape(w) for w in chunk.split()))
        slot = m.group(1)
        if slot == "target":
            parts.append(r"\s*(?P<target>.+?)")
        else:
            parts.append(r"\s*(?P<value>[\w%]+(?:\s+[\w%]+)?)")
        pos = m.end()
    tail = _norm(template[pos:])
    if tail:
        literal += len(tail)
        parts.append(r"\s*" + r"\s+".join(re.escape(w) for w in tail.split()))
    return re.compile(r"^\s*" + "".join(parts) + r"\s*$"), literal


def match_rules(phrase: str, rules: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the best-scoring rule match, or None if nothing matches.

    The result carries the rule, plus whatever {target}/{value} text the
    winning template captured.
    """
    text = _norm(phrase)
    if not text:
        return None
    best: dict[str, Any] | None = None
    for rule in rules:
        for template in rule.get("phrases", []):
            pattern, weight = compile_phrase(template)
            m = pattern.match(text)
            if not m:
                continue
            groups = m.groupdict()
            # A template with no literal text at all would match anything;
            # require it to have matched something concrete.
            if weight == 0 and not rule.get("scene"):
                continue
            if best is None or weight > best["weight"]:
                best = {
                    "rule": rule,
                    "weight": weight,
                    "template": template,
                    "target": (groups.get("target") or "").strip(),
                    "value": (groups.get("value") or "").strip(),
                }
    return best


def _brightness_from(value: str) -> int | None:
    m = re.search(r"(\d{1,3})", value or "")
    if not m:
        return None
    return max(0, min(100, int(m.group(1))))


def _color_from(value: str) -> str | None:
    v = (value or "").strip().lower()
    for name in COLORS:
        if re.search(rf"\b{name}\b", v):
            return name
    return None


def plan_for(phrase: str, lights: list[Light], rules: list[dict[str, Any]],
             media_entity: str = "") -> Plan:
    """Turn a spoken phrase into Home Assistant service calls via the rules."""
    hit = match_rules(phrase, rules)
    if hit is None:
        return Plan(spoken="I don't have a rule for that yet.", understood=False)

    rule = hit["rule"]
    action = rule.get("action", "")

    # ---- media actions need no light target -------------------------------
    if action in ("play_music", "pause_music", "next_track"):
        if not media_entity:
            return Plan(spoken="No media player is set up yet.", understood=False)
        service = {"play_music": "media_play", "pause_music": "media_pause",
                   "next_track": "media_next_track"}[action]
        spoken = {"play_music": "Playing music.", "pause_music": "Pausing.",
                  "next_track": "Skipping ahead."}[action]
        return Plan(calls=[{"domain": "media_player", "service": service,
                            "data": {"entity_id": media_entity}}],
                    spoken=spoken, matched=[media_entity])

    # ---- scenes address themselves, not a light target --------------------
    if action == "run_scene":
        scene = rule.get("scene", "")
        if not scene:
            return Plan(spoken="That rule has no scene set.", understood=False)
        slug = re.sub(r"[^a-z0-9_]+", "_", scene.lower()).strip("_")
        entity = f"scene.{slug}"
        return Plan(calls=[{"domain": "scene", "service": "turn_on",
                            "data": {"entity_id": entity}}],
                    spoken=f"Running {scene}.", matched=[entity])

    # ---- everything else acts on lights -----------------------------------
    targets, scope = _select_targets(_norm(hit["target"]), lights)
    if not targets:
        # The rule matched but the spoken target is not a device we know.
        name = hit["target"] or "that"
        return Plan(spoken=f"I couldn't find {name}.", understood=False)

    ids = [l.entity_id for l in targets]

    if action == "turn_off":
        return Plan(calls=[{"domain": "light", "service": "turn_off",
                            "data": {"entity_id": ids}}],
                    spoken=f"Turning off {scope}.", matched=ids)

    if action == "turn_on":
        return Plan(calls=[{"domain": "light", "service": "turn_on",
                            "data": {"entity_id": ids}}],
                    spoken=f"Turning on {scope}.", matched=ids)

    if action == "toggle":
        return Plan(calls=[{"domain": "light", "service": "toggle",
                            "data": {"entity_id": ids}}],
                    spoken=f"Toggling {scope}.", matched=ids)

    if action == "set_brightness":
        pct = _brightness_from(hit["value"])
        if pct is None:
            return Plan(spoken="I need a brightness level.", understood=False)
        return Plan(calls=[{"domain": "light", "service": "turn_on",
                            "data": {"entity_id": ids, "brightness_pct": pct}}],
                    spoken=f"Setting {scope} to {pct} percent.", matched=ids)

    if action == "set_color":
        colour = _color_from(hit["value"])
        if colour is None:
            # "make the couch lamp 40" with no colour word is a brightness ask.
            pct = _brightness_from(hit["value"])
            if pct is not None:
                return Plan(calls=[{"domain": "light", "service": "turn_on",
                                    "data": {"entity_id": ids, "brightness_pct": pct}}],
                            spoken=f"Setting {scope} to {pct} percent.", matched=ids)
            return Plan(spoken="I don't know that colour.", understood=False)
        capable = [l.entity_id for l in targets if l.supports_color]
        if not capable:
            return Plan(spoken=f"{scope} can't change colour.", understood=False)
        return Plan(calls=[{"domain": "light", "service": "turn_on",
                            "data": {"entity_id": capable,
                                     "rgb_color": COLORS[colour]}}],
                    spoken=f"Setting {scope} to {colour}.", matched=capable)

    if action == "set_warmth":
        v = (hit["value"] or "").lower()
        if re.search(r"\bcool|daylight|bright white\b", v):
            mireds, word = TEMP_COOL, "cool white"
        elif re.search(r"\bneutral\b", v):
            mireds, word = TEMP_NEUTRAL, "neutral"
        else:
            mireds, word = TEMP_WARM, "warm"
        capable = [l.entity_id for l in targets if l.supports_temp]
        if not capable:
            return Plan(spoken=f"{scope} can't change warmth.", understood=False)
        return Plan(calls=[{"domain": "light", "service": "turn_on",
                            "data": {"entity_id": capable, "color_temp": mireds}}],
                    spoken=f"Setting {scope} to {word}.", matched=capable)

    return Plan(spoken="That rule isn't wired up yet.", understood=False)


# --------------------------------------------------------------------------- #
# "Build Siri phrases" — compile the rules to Home Assistant custom_sentences.
# --------------------------------------------------------------------------- #
_HA_ACTION_INTENT = {
    "turn_on": "HassTurnOn",
    "turn_off": "HassTurnOff",
    "toggle": "HassTurnOn",
    "set_brightness": "HassLightSet",
    "set_color": "HassLightSet",
    "set_warmth": "HassLightSet",
    "run_scene": "HassTurnOn",
    "play_music": "HassMediaUnpause",
    "pause_music": "HassMediaPause",
    "next_track": "HassMediaNext",
}


def _to_ha_sentence(template: str, scene: str = "") -> str:
    """Rewrite our slot syntax into Home Assistant's sentence syntax."""
    out = template.replace("{target}", "{name}").replace("{value}", "{brightness}")
    if scene:
        out = out.replace("{name}", scene)
    return out.strip()


def build_ha_sentences(rules: list[dict[str, Any]], language: str = "en") -> str:
    """Return the YAML for ``config/custom_sentences/<lang>/panel.yaml``.

    Home Assistant matches these before falling back to its built-ins, so the
    user's own phrasing reaches Assist — and Siri, once the HomeKit bridge or
    a Shortcut is pointed at Assist.
    """
    by_intent: dict[str, list[str]] = {}
    for rule in rules:
        intent = _HA_ACTION_INTENT.get(rule.get("action", ""))
        if not intent:
            continue
        scene = rule.get("scene", "")
        for template in rule.get("phrases", []):
            sentence = _to_ha_sentence(template, scene)
            if sentence:
                by_intent.setdefault(intent, []).append(sentence)

    lines = [
        "# Generated by the SmartHome panel — Settings > Voice > Build Siri phrases.",
        "# Copy to: <home assistant config>/custom_sentences/%s/panel.yaml" % language,
        "# Then restart Home Assistant. Assist (and Siri, via the HomeKit bridge",
        "# or a Shortcut pointed at Assist) will answer to these phrasings.",
        "language: \"%s\"" % language,
        "intents:",
    ]
    if not by_intent:
        lines.append("  {}")
    for intent, sentences in sorted(by_intent.items()):
        lines.append(f"  {intent}:")
        lines.append("    data:")
        lines.append("      - sentences:")
        for s in sorted(set(sentences)):
            lines.append(f"          - \"{s}\"")
    return "\n".join(lines) + "\n"
