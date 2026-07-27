"""Tests for the voice-command parser. Run: python -m pytest (or the __main__)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from backend.voice import parse, Light  # noqa: E402

LIGHTS = [
    Light("light.kitchen_sink", "Kitchen Sink Light", "Kitchen", False, True),
    Light("light.kitchen_ceiling", "Kitchen Ceiling", "Kitchen", True, True),
    Light("light.living_lamp", "Living Room Lamp", "Living Room", True, True),
]


def _one(text):
    return parse(text, LIGHTS)


def test_room_off_hits_all_room_lights():
    p = _one("hey siri turn off the lights in the kitchen")
    assert p.calls[0]["service"] == "turn_off"
    assert set(p.calls[0]["data"]["entity_id"]) == {"light.kitchen_sink", "light.kitchen_ceiling"}


def test_specific_light_beats_room():
    p = _one("turn off kitchen sink light")
    assert p.calls[0]["data"]["entity_id"] == ["light.kitchen_sink"]


def test_dim_by_percent_inverts():
    p = _one("dim lights in the kitchen by 99%")
    assert p.calls[0]["data"]["brightness_pct"] == 1


def test_warm_with_brightness():
    p = _one("change kitchen lights to warm 50%")
    d = p.calls[0]["data"]
    assert d["brightness_pct"] == 50 and d["color_temp"] == 400


def test_all_lights():
    p = _one("turn all lights off")
    assert set(p.calls[0]["data"]["entity_id"]) == {e.entity_id for e in LIGHTS}


def test_color_only_on_capable_light():
    p = _one("change living room lamp to purple")
    assert p.calls[0]["data"]["rgb_color"] == [160, 0, 255]


def test_unknown_target():
    p = _one("turn off the garage lights")
    assert p.understood is False


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("ok:", fn.__name__)
    print(f"\n{len(fns)} tests passed")
