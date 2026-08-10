"""Compute notable astronomical events from the user's coordinates.

Uses **Astronomy Engine** (pure-Python, high precision) to find the newsworthy
sky events over the coming weeks — the kind an astrophotographer tracks:

  * planetary **conjunctions** (e.g. Venus–Jupiter close approaches),
  * planet **oppositions** (Mars/Jupiter/Saturn/Uranus/Neptune),
  * greatest **elongations** of Mercury & Venus,
  * **full / new moons** (incl. supermoon detection) — new moon = darkest skies
    for deep-sky / Milky Way photography,
  * lunar & solar **eclipses**.

For each event we also compute *where to look* — the constellation the object is
in plus its compass direction and altitude at the best moment of the night at
the user's location — so the slide can say e.g. "Look west-southwest, low on the
horizon, in Leo." Everything is derived from lat/long, so it's correct for any
home and any year, with nothing hardcoded.

If Astronomy Engine isn't installed (or lat/long are unset), this module returns
an empty list and the system falls back to the computed meteor showers +
user-added events in ``celestial.py``.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

try:
    import astronomy as A
    _OK = True
except Exception:  # pragma: no cover
    _OK = False

_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

_PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]

# Best-effort real imagery from Wikimedia Commons (public domain / NASA). The UI
# always draws a themed starfield behind these, and falls back to it if a URL is
# unavailable, so a broken link never leaves a slide blank. Users can override
# any event's image via celestial_events.json (see docs/CELESTIAL.md).
def _wm(fname: str) -> str:
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{fname}?width=1280"

_PLANET_IMG = {
    "Mercury": _wm("Mercury_in_color_-_Prockter07-edit1.jpg"),
    "Venus": _wm("Venus_from_Mariner_10.jpg"),
    "Mars": _wm("OSIRIS_Mars_true_color.jpg"),
    "Jupiter": _wm("Jupiter_and_its_shrunken_Great_Red_Spot.jpg"),
    "Saturn": _wm("Saturn_during_Equinox.jpg"),
    "Uranus": _wm("Uranus2.jpg"),
    "Neptune": _wm("Neptune_Full.jpg"),
}
_MOON_IMG = _wm("FullMoon2010.jpg")
_OUTER = {"Mars": 88, "Jupiter": 90, "Saturn": 88, "Uranus": 60, "Neptune": 58}

# Bright-planet pairs we watch for conjunctions (both easily visible).
_PAIRS = [
    ("Venus", "Jupiter"), ("Venus", "Mars"), ("Venus", "Saturn"),
    ("Mars", "Jupiter"), ("Jupiter", "Saturn"), ("Mars", "Saturn"),
    ("Mercury", "Venus"), ("Mercury", "Jupiter"),
]


def _compass(az: float) -> str:
    return _COMPASS[int((az % 360) / 22.5 + 0.5) % 16]


def _alt_band(alt: float) -> str:
    if alt < 15:
        return "low on the horizon"
    if alt < 40:
        return "partway up the sky"
    return "high overhead"


def _iso(t) -> str:
    return t.Utc().date().isoformat()


def _time_of_night(hour_local: int) -> str:
    if hour_local >= 20 or hour_local < 1:
        return "In the evening"
    if 1 <= hour_local < 4:
        return "After midnight"
    return "In the hours before dawn"


def _viewing(body, when, obs, tz) -> dict[str, Any] | None:
    """Best nighttime view of `body` on the date of `when`: direction, altitude,
    constellation, and a human 'best time'. None if it's not up at night."""
    if not _OK:
        return None
    day = when
    # find sunset that evening and the following sunrise
    try:
        sunset = A.SearchRiseSet(A.Body.Sun, obs, A.Direction.Set, day, 1)
        sunrise = A.SearchRiseSet(A.Body.Sun, obs, A.Direction.Rise,
                                  sunset if sunset else day, 1)
    except Exception:
        sunset = sunrise = None
    if not sunset or not sunrise:
        return None

    best = None
    steps = 12
    span = sunrise.ut - sunset.ut
    for i in range(steps + 1):
        t = A.Time(sunset.ut + span * i / steps)
        eq = A.Equator(body, t, obs, True, True)
        hor = A.Horizon(t, obs, eq.ra, eq.dec, A.Refraction.Normal)
        if best is None or hor.altitude > best[0]:
            best = (hor.altitude, hor.azimuth, t, eq)
    if not best or best[0] < 5:
        return None

    alt, az, t, eq = best
    const = A.Constellation(eq.ra, eq.dec).name
    # local hour for the "best time" phrasing
    utc = t.Utc().replace(tzinfo=dt.timezone.utc)
    hour_local = utc.astimezone(tz).hour if tz else utc.hour
    return {
        "where": f"Look {_compass(az).lower()}, {_alt_band(alt)}, in {const}",
        "constellation": const,
        "best_time": _time_of_night(hour_local),
        "altitude": round(alt),
    }


def _body(name: str):
    return getattr(A.Body, name)


def _separation(b1, b2, t, obs) -> float:
    e1 = A.Equator(b1, t, obs, True, True)
    e2 = A.Equator(b2, t, obs, True, True)
    return A.AngleBetween(e1.vec, e2.vec)


def compute_events(today: dt.date, lat: float, lon: float,
                   window_days: int = 45, tz=None) -> list[dict[str, Any]]:
    if not _OK or lat is None or lon is None:
        return []
    obs = A.Observer(lat, lon, 0)
    t0 = A.Time.Make(today.year, today.month, today.day, 0, 0, 0)
    horizon_date = today + dt.timedelta(days=window_days)
    events: list[dict[str, Any]] = []

    def in_window(t) -> bool:
        return today <= t.Utc().date() <= horizon_date

    # ---- moon phases (full / new) + supermoon ---------------------------- #
    try:
        mq = A.SearchMoonQuarter(t0)
        for _ in range(6):
            if mq.time.Utc().date() > horizon_date:
                break
            if mq.quarter in (0, 2) and in_window(mq.time):
                is_full = mq.quarter == 2
                # supermoon: full moon within ~1 day of perigee & close
                supermoon = False
                if is_full:
                    ap = A.SearchLunarApsis(A.Time(mq.time.ut - 2))
                    if (ap.kind == A.ApsisKind.Pericenter
                            and abs(ap.time.ut - mq.time.ut) < 1.5
                            and ap.dist_km < 361000):
                        supermoon = True
                view = _viewing(A.Body.Moon, mq.time, obs, tz) or {}
                events.append({
                    "id": f"moon-{_iso(mq.time)}",
                    "category": "moon",
                    "name": ("Supermoon" if supermoon else
                             "Full Moon" if is_full else "New Moon"),
                    "peak_date": _iso(mq.time),
                    "dates_label": mq.time.Utc().strftime("%b %-d"),
                    "rate": "Naked-eye" if is_full else "Darkest skies",
                    "score": 72 if supermoon else (45 if is_full else 50),
                    "where": (view.get("where") if is_full
                              else "Moonless night — ideal for the Milky Way and deep-sky targets; face away from city lights"),
                    "best_time": view.get("best_time", "All night") if is_full else "Late evening to pre-dawn",
                    "constellation": view.get("constellation", ""),
                    "description": (
                        "The Moon is full and rides the sky all night — great for "
                        "lunar close-ups, though its glare washes out faint objects."
                        if is_full and not supermoon else
                        "A supermoon: a full Moon near its closest approach, appearing "
                        "slightly larger and brighter than usual." if supermoon else
                        "New Moon means the darkest skies of the month — the best "
                        "window for photographing the Milky Way, galaxies and nebulae."),
                    "image_url": _MOON_IMG if is_full else "",
                    "credit": "NASA / Gregory H. Revera" if is_full else "",
                })
            mq = A.NextMoonQuarter(mq)
    except Exception:
        pass

    # ---- planet oppositions ---------------------------------------------- #
    for name, score in _OUTER.items():
        try:
            t = A.SearchRelativeLongitude(_body(name), 180.0, t0)
            if t and in_window(t):
                view = _viewing(_body(name), t.Utc().date(), obs, tz) or {}
                events.append({
                    "id": f"opp-{name}-{_iso(t)}",
                    "category": "planet",
                    "name": f"{name} at Opposition",
                    "peak_date": _iso(t),
                    "dates_label": t.Utc().strftime("%b %-d"),
                    "rate": "Brightest & up all night",
                    "score": score,
                    "where": view.get("where", f"Look for {name} opposite the Sun"),
                    "best_time": view.get("best_time", "All night"),
                    "constellation": view.get("constellation", ""),
                    "description": (
                        f"{name} reaches opposition — Earth passes between it and the "
                        f"Sun, so {name} is at its closest, brightest, and visible all "
                        f"night. The ideal time to image it."),
                    "image_url": _PLANET_IMG.get(name, ""), "credit": "NASA",
                })
        except Exception:
            pass

    # ---- greatest elongations (Mercury, Venus) --------------------------- #
    for name in ("Mercury", "Venus"):
        try:
            e = A.SearchMaxElongation(_body(name), t0)
            if e and in_window(e.time):
                vis = "evening" if e.visibility == A.Visibility.Evening else "morning"
                view = _viewing(_body(name), e.time.Utc().date(), obs, tz) or {}
                events.append({
                    "id": f"elong-{name}-{_iso(e.time)}",
                    "category": "planet",
                    "name": f"{name} at Greatest {vis.title()} Elongation",
                    "peak_date": _iso(e.time),
                    "dates_label": e.time.Utc().strftime("%b %-d"),
                    "rate": f"{round(e.elongation)}° from the Sun",
                    "score": 58,
                    "where": view.get("where",
                                      f"Look {'west after sunset' if vis == 'evening' else 'east before sunrise'} for {name}"),
                    "best_time": ("Just after sunset" if vis == "evening"
                                  else "Just before sunrise"),
                    "constellation": view.get("constellation", ""),
                    "description": (
                        f"{name} stands at its greatest angular distance from the Sun "
                        f"({round(e.elongation)}°), highest above the {'evening' if vis=='evening' else 'morning'} "
                        f"horizon and easiest to catch in the twilight."),
                    "image_url": _PLANET_IMG.get(name, ""), "credit": "NASA",
                })
        except Exception:
            pass

    # ---- bright-planet conjunctions -------------------------------------- #
    for a_name, b_name in _PAIRS:
        try:
            ba, bb = _body(a_name), _body(b_name)
            samples = []
            for d in range(window_days + 1):
                t = A.Time(t0.ut + d)
                samples.append((d, _separation(ba, bb, t, obs)))
            # find the local minimum separation
            dmin, sep_min = min(samples, key=lambda x: x[1])
            if sep_min <= 4.0 and 0 < dmin <= window_days:
                # refine to the hour
                best_t, best_sep = A.Time(t0.ut + dmin), sep_min
                for h in range(-24, 25):
                    t = A.Time(t0.ut + dmin + h / 24.0)
                    s = _separation(ba, bb, t, obs)
                    if s < best_sep:
                        best_sep, best_t = s, t
                if in_window(best_t):
                    bright = a_name if a_name == "Venus" else (
                        "Jupiter" if "Jupiter" in (a_name, b_name) else a_name)
                    view = _viewing(_body(bright), best_t.Utc().date(), obs, tz) or {}
                    score = 90 if best_sep < 1 else 80 if best_sep < 2 else 70
                    events.append({
                        "id": f"conj-{a_name}-{b_name}-{_iso(best_t)}",
                        "category": "planet",
                        "name": f"{a_name}–{b_name} Conjunction",
                        "peak_date": _iso(best_t),
                        "dates_label": best_t.Utc().strftime("%b %-d"),
                        "rate": f"{best_sep:.1f}° apart",
                        "score": score,
                        "where": view.get("where",
                                          f"Look for the {a_name}–{b_name} pairing"),
                        "best_time": view.get("best_time", "Around twilight"),
                        "constellation": view.get("constellation", ""),
                        "description": (
                            f"{a_name} and {b_name} pass just {best_sep:.1f}° apart — a "
                            f"striking close pairing of two bright planets, easy to frame "
                            f"together in a single wide shot."),
                        "image_url": _PLANET_IMG.get(bright, ""), "credit": "NASA",
                    })
        except Exception:
            pass

    # ---- eclipses -------------------------------------------------------- #
    try:
        le = A.SearchLunarEclipse(t0)
        if le and in_window(le.peak):
            kind = str(le.kind).split(".")[-1].lower()
            view = _viewing(A.Body.Moon, le.peak.Utc().date(), obs, tz) or {}
            events.append({
                "id": f"lunecl-{_iso(le.peak)}",
                "category": "eclipse",
                "name": f"{kind.title()} Lunar Eclipse",
                "peak_date": _iso(le.peak),
                "dates_label": le.peak.Utc().strftime("%b %-d"),
                "rate": "Visible where the Moon is up",
                "score": 95,
                "where": view.get("where", "Wherever the Moon is above the horizon"),
                "best_time": view.get("best_time", "Around mid-eclipse"),
                "constellation": view.get("constellation", ""),
                "description": (
                    f"A {kind} lunar eclipse: Earth's shadow falls across the Moon. "
                    f"Safe to watch with the naked eye and a rewarding, slow-moving "
                    f"target for photography as the Moon reddens."),
                "image_url": "", "credit": "",
            })
    except Exception:
        pass
    try:
        se = A.SearchGlobalSolarEclipse(t0)
        if se and in_window(se.peak):
            kind = str(se.kind).split(".")[-1].lower()
            events.append({
                "id": f"solecl-{_iso(se.peak)}",
                "category": "eclipse",
                "name": f"{kind.title()} Solar Eclipse",
                "peak_date": _iso(se.peak),
                "dates_label": se.peak.Utc().strftime("%b %-d"),
                "rate": "Region-dependent",
                "score": 96,
                "where": "Along the eclipse path — check local circumstances; NEVER look at the Sun without a certified solar filter",
                "best_time": "Local eclipse time",
                "constellation": "",
                "description": (
                    f"A {kind} solar eclipse. Visibility and coverage depend on your "
                    f"location. Photograph the Sun ONLY with a proper solar filter."),
                "image_url": "", "credit": "",
            })
    except Exception:
        pass

    return events
