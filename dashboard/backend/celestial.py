"""Upcoming celestial events for the rotating slides + homepage calendar.

Goal (from the spec): look ~a month ahead, find the one or two *major* events an
astrophotographer would care about (meteor showers, bright-planet oppositions,
notable galaxy/eclipse events), and produce curated slides with:
  * the event name + the dates leading up to (and including) the peak,
  * a concise description,
  * where to look, anchored to a common constellation + rough direction,
  * best viewing time,
  * a hero image (optional per-event URL; the UI always draws a themed starfield
    background so a slide is striking even with no image / offline).

Design choices that keep this honest and generic:
  * **Meteor showers are computed** from their well-known annual peak dates, so
    there is almost always something within the next month, for any year, with
    no hardcoded per-year data to go stale.
  * **One-off events** (a specific planetary alignment, an eclipse, a comet)
    are *not fabricated*. Users add those in ``celestial_events.json`` with an
    explicit date; we merge and rank them alongside the showers.
Selection ranks by significance and soonest peak, then keeps the top 1–2.
"""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field
from typing import Any

from . import astro
from . import store


@dataclass
class Shower:
    id: str
    name: str
    peak_month: int
    peak_day: int
    active_before: int          # days before peak the slide should start showing
    active_after: int           # days after peak still worth viewing
    rate: int                   # approx ZHR — used as the significance score
    constellation: str
    where: str
    best_time: str
    description: str
    image_url: str = ""
    credit: str = ""


# Annual major meteor showers (approximate peaks; radiant constellation fixed).
SHOWERS: list[Shower] = [
    Shower("quadrantids", "Quadrantid Meteor Shower", 1, 3, 10, 2, 110, "Boötes",
           "Look northeast toward Boötes, below the Big Dipper's handle",
           "The hours before dawn",
           "A brief, intense shower with a sharp peak — up to ~110 fast, faint "
           "meteors per hour under dark skies."),
    Shower("lyrids", "Lyrid Meteor Shower", 4, 22, 8, 2, 18, "Lyra",
           "Look high overhead toward Lyra, near the bright star Vega",
           "After midnight until dawn",
           "Fast, bright meteors radiating near Vega; occasional bright fireballs."),
    Shower("eta_aquariids", "Eta Aquariid Meteor Shower", 5, 6, 10, 4, 50, "Aquarius",
           "Look east-southeast toward Aquarius, low near the horizon before dawn",
           "The 1–2 hours before dawn",
           "Debris from Halley's Comet — swift meteors with long, glowing trains, "
           "best from lower latitudes."),
    Shower("delta_aquariids", "Delta Aquariid Meteor Shower", 7, 30, 10, 5, 25, "Aquarius",
           "Look south toward Aquarius, about a third of the way up the sky",
           "After midnight",
           "A long, steady stream of faint meteors that blends into the early "
           "Perseids in late July."),
    Shower("perseids", "Perseid Meteor Shower", 8, 12, 14, 3, 100, "Perseus",
           "Look northeast toward Perseus, rising higher through the night",
           "After midnight until dawn",
           "The year's most popular shower — up to ~100 bright, fast meteors per "
           "hour with frequent fireballs, on warm summer nights."),
    Shower("orionids", "Orionid Meteor Shower", 10, 21, 10, 4, 20, "Orion",
           "Look southeast toward Orion, near the club above Betelgeuse",
           "The hours before dawn",
           "Fast, bright meteors from Halley's Comet, radiating near Orion's raised club."),
    Shower("leonids", "Leonid Meteor Shower", 11, 17, 8, 3, 15, "Leo",
           "Look east toward Leo, near the backward-question-mark 'Sickle'",
           "After midnight until dawn",
           "Very fast meteors capable of bright fireballs; occasionally storms."),
    Shower("geminids", "Geminid Meteor Shower", 12, 14, 12, 2, 120, "Gemini",
           "Look toward Gemini, near the bright stars Castor and Pollux, high in the south",
           "From mid-evening through the night",
           "The most reliable and prolific shower of the year — up to ~120 slow, "
           "bright, often colorful meteors per hour."),
    Shower("ursids", "Ursid Meteor Shower", 12, 22, 6, 2, 10, "Ursa Minor",
           "Look north toward Ursa Minor (the Little Dipper), near Kochab",
           "The hours before dawn",
           "A modest shower near the solstice, circumpolar for northern viewers."),
]


def _mmdd(d: dt.date) -> str:
    return d.strftime("%b %-d")


def _shower_instance(s: Shower, year: int) -> dict[str, Any]:
    peak = dt.date(year, s.peak_month, s.peak_day)
    start = peak - dt.timedelta(days=s.active_before)
    end = peak + dt.timedelta(days=s.active_after)
    return {
        "id": f"{s.id}-{year}",
        "category": "meteor",
        "name": s.name,
        "peak_date": peak.isoformat(),
        "active_start": start.isoformat(),
        "active_end": end.isoformat(),
        "dates_label": f"{_mmdd(start)} – {_mmdd(end)} (peak {_mmdd(peak)})",
        "rate": f"up to {s.rate} meteors/hr",
        "score": s.rate,
        "constellation": s.constellation,
        "where": s.where,
        "best_time": s.best_time,
        "description": s.description,
        "image_url": s.image_url,
        "credit": s.credit,
    }


def _timezone():
    tzname = os.getenv("TIMEZONE", "").strip()
    if not tzname:
        return None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(tzname)
    except Exception:
        return None


def _coords() -> tuple[float | None, float | None]:
    def num(k):
        v = (os.getenv(k, "") or "").strip()
        try:
            f = float(v)
            return f
        except Exception:
            return None
    return num("LATITUDE"), num("LONGITUDE")


def _all_instances(today: dt.date, window_days: int = 45) -> list[dict[str, Any]]:
    """Meteor showers (computed) + astronomically-computed events (from the
    user's coordinates via Astronomy Engine) + user-added one-off events."""
    out: list[dict[str, Any]] = []
    for yr in (today.year, today.year + 1):
        for s in SHOWERS:
            out.append(_shower_instance(s, yr))

    # precisely-computed events (conjunctions, oppositions, eclipses, phases…)
    lat, lon = _coords()
    if lat is not None and lon is not None:
        try:
            out.extend(astro.compute_events(today, lat, lon, window_days, _timezone()))
        except Exception:
            pass

    # user-added one-off events (explicit dates; never fabricated by us)
    for ev in store.load("celestial_events", []):
        ev = dict(ev)
        ev.setdefault("category", "planet")
        ev.setdefault("score", 60)
        peak = ev.get("peak_date")
        if peak:
            ev.setdefault("active_start",
                          (dt.date.fromisoformat(peak) - dt.timedelta(days=14)).isoformat())
            ev.setdefault("active_end", peak)
            ev.setdefault("dates_label", _mmdd(dt.date.fromisoformat(peak)))
        out.append(ev)
    return out


def upcoming(today: dt.date | None = None, window_days: int = 30,
             limit: int = 3) -> dict[str, Any]:
    """Curated slides for events peaking within `window_days`, plus a full
    calendar list of all notable peaks (~45 days) for the homepage calendar."""
    today = today or dt.date.today()
    horizon = today + dt.timedelta(days=window_days)

    instances = _all_instances(today, window_days=45)

    # slides: events whose active window is open now OR whose peak is within the
    # horizon, and not already well past.
    active: list[dict[str, Any]] = []
    for ev in instances:
        try:
            peak = dt.date.fromisoformat(ev["peak_date"])
            end = dt.date.fromisoformat(ev.get("active_end", ev["peak_date"]))
        except Exception:
            continue
        if end < today:
            continue
        if peak <= horizon:
            ev = dict(ev)
            ev["days_until_peak"] = (peak - today).days
            active.append(ev)

    # rank: highest significance first, then soonest peak
    active.sort(key=lambda e: (-e.get("score", 0), e["days_until_peak"]))
    slides = active[:limit]

    # calendar: peaks within ~45 days for mini-cal dots
    cal_h = today + dt.timedelta(days=45)
    calendar = sorted(
        ({"date": e["peak_date"], "name": e["name"], "category": e["category"]}
         for e in instances
         if today <= dt.date.fromisoformat(e["peak_date"]) <= cal_h),
        key=lambda x: x["date"],
    )
    return {"slides": slides, "calendar": calendar}
