"""End-to-end integration test on the DEMO fleet.

Proves the full pull -> display -> control pipeline works across every brand
(Tuya/WiZ/Monster/Marvelight/SmartLife/Eufy/Spotify) without real credentials.
Run: DEMO_MODE=1 python -m pytest dashboard/backend/tests/test_demo_integration.py
"""
import os
import sys

os.environ["DEMO_MODE"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from starlette.testclient import TestClient  # noqa: E402
from backend import app as m  # noqa: E402

c = TestClient(m.app)


def _states():
    return {e["entity_id"]: e for e in c.get("/api/states").json()}


def test_pull_all_brands():
    st = _states()
    brands = {e["attributes"].get("brand") for e in st.values()}
    assert {"Tuya", "WiZ", "Monster", "Marvelight", "SmartLife", "Eufy"} <= brands
    assert "media_player.spotify" in st
    assert sum(k.startswith("camera.") for k in st) == 2


def test_voice_dim_by_percent():
    r = c.post("/api/voice/command", json={"text": "dim the kitchen lights by 90%"}).json()
    assert r["understood"]
    assert set(r["matched"]) == {"light.kitchen_ceiling", "light.kitchen_sink"}
    st = _states()
    assert st["light.kitchen_ceiling"]["attributes"]["brightness"] == round(10 * 255 / 100)


def test_voice_all_off():
    c.post("/api/voice/command", json={"text": "turn off all lights"})
    st = _states()
    assert all(e["state"] == "off" for k, e in st.items() if k.startswith("light."))


def test_touch_color_control():
    c.post("/api/service/light/turn_on",
           json={"entity_id": "light.living_room_couch", "rgb_color": [160, 0, 255],
                 "brightness_pct": 80})
    e = _states()["light.living_room_couch"]
    assert e["state"] == "on" and e["attributes"]["rgb_color"] == [160, 0, 255]


def test_rooms_grouping_present():
    rooms = {e["attributes"].get("room") for e in _states().values()}
    assert {"Living Room", "Kitchen", "Master Bedroom", "Office"} <= rooms


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn(); print("ok:", fn.__name__)
    print(f"\n{len(fns)} integration tests passed")
