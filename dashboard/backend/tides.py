"""Fetch + parse tide / solunar / sun-moon data for the rotating displays.

Source of truth is tidespro.com (the pages named in the spec):

  * TIDES_WEEK_URL   -> "Next 7 Days" table          (rotating display 1)
  * derived summary  -> "Tides" chart + next tides    (rotating display 2)
  * derived summary  -> "Solunars & Sun/Moon Times"   (rotating display 3)
  * TIDES_MONTH_URL  -> Jupiter Inlet month table      (drill-down on tap)

We scrape the HTML tables with BeautifulSoup and normalize them into JSON the
frontend renders in the dark theme. Results are cached for 15 minutes so the
panel is snappy and we stay polite to the source. If the site is unreachable,
the last good cache is served and the UI shows a subtle "offline" note.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from bs4 import BeautifulSoup

# Personal, user-configured sources — empty means the tide panels are hidden.
WEEK_URL = os.getenv("TIDES_WEEK_URL", "").strip()
MONTH_URL = os.getenv("TIDES_MONTH_URL", "").strip()
CACHE_TTL = 15 * 60  # seconds
_UA = {"User-Agent": "SmartHomeTouchscreen/1.0 (+local kiosk)"}


@dataclass
class _CacheEntry:
    data: Any = None
    fetched_at: float = 0.0


_cache: dict[str, _CacheEntry] = {}


async def _get_html(url: str) -> str:
    async with httpx.AsyncClient(timeout=15, headers=_UA, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.text


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _parse_week(html: str) -> list[dict[str, Any]]:
    """Parse the 'Next 7 Days' table into one row per day.

    Columns observed on tidespro: Day | Moon | 1st..4th Tide | Sun | Major
    Solunars | Minor Solunars. Each tide cell holds a time + a High/Low arrow +
    a height. We keep it resilient: we read whatever tide cells exist.
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    days: list[dict[str, Any]] = []
    if not table:
        return days

    rows = table.find_all("tr")
    for tr in rows[1:]:  # skip header
        cells = tr.find_all(["td", "th"])
        if len(cells) < 3:
            continue
        day = _clean(cells[0].get_text())
        if not day:
            continue
        # moon phase often shown as a percentage in cell 1
        moon = _clean(cells[1].get_text())
        tides: list[dict[str, str]] = []
        # tide cells: look for a High/Low indicator (arrow or word) + ft
        for cell in cells[2:6]:
            txt = _clean(cell.get_text(" "))
            if not txt:
                continue
            m_time = re.search(r"(\d{1,2}:\d{2}\s*[AP]M)", txt, re.I)
            m_ft = re.search(r"(-?\d+\.?\d*)\s*ft", txt, re.I)
            is_high = ("high" in txt.lower()) or ("▲" in txt) or ("blue" in cell.get("class", []))
            is_low = ("low" in txt.lower()) or ("▼" in txt)
            tides.append({
                "time": m_time.group(1) if m_time else "",
                "height_ft": m_ft.group(1) if m_ft else "",
                "type": "high" if is_high and not is_low else ("low" if is_low else ""),
            })
        sun = _clean(cells[6].get_text(" ")) if len(cells) > 6 else ""
        major = _clean(cells[7].get_text(" ")) if len(cells) > 7 else ""
        minor = _clean(cells[8].get_text(" ")) if len(cells) > 8 else ""
        days.append({
            "day": day,
            "moon": moon,
            "tides": tides,
            "sun": sun,
            "major_solunar": major,
            "minor_solunar": minor,
        })
    return days


def _next_tides(week: list[dict[str, Any]], limit: int = 6) -> list[dict[str, str]]:
    """Flatten the next few high/low events for the 'Tides' display 2 table."""
    out: list[dict[str, str]] = []
    for d in week:
        for t in d["tides"]:
            if t["time"]:
                out.append({
                    "day": d["day"],
                    "time": t["time"],
                    "type": t["type"] or "",
                    "height_ft": t["height_ft"],
                })
            if len(out) >= limit:
                return out
    return out


def _solunar_summary(week: list[dict[str, Any]]) -> dict[str, Any]:
    """Build display 3 (Solunars & Sun/Moon) from today's row."""
    if not week:
        return {}
    today = week[0]
    sun = today.get("sun", "")
    times = re.findall(r"(\d{1,2}:\d{2}\s*[AP]M)", sun, re.I)
    return {
        "moon": today.get("moon", ""),
        "major_solunar": today.get("major_solunar", ""),
        "minor_solunar": today.get("minor_solunar", ""),
        "sunrise": times[0] if len(times) > 0 else "",
        "sunset": times[1] if len(times) > 1 else "",
    }


def _parse_month(html: str) -> dict[str, Any]:
    """Parse the month table for the drill-down view."""
    soup = BeautifulSoup(html, "html.parser")
    title = _clean(soup.find(["h1", "h2"]).get_text()) if soup.find(["h1", "h2"]) else "Month"
    table = soup.find("table")
    rows: list[dict[str, Any]] = []
    if table:
        for tr in table.find_all("tr")[1:]:
            cells = [_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
            if cells and cells[0]:
                rows.append({"cells": cells})
    return {"title": title, "rows": rows, "source": MONTH_URL}


async def _cached(key: str, coro) -> Any:
    entry = _cache.get(key)
    now = time.time()
    if entry and (now - entry.fetched_at) < CACHE_TTL:
        return entry.data
    try:
        data = await coro()
        _cache[key] = _CacheEntry(data=data, fetched_at=now)
        return data
    except Exception:
        if entry:  # serve stale on failure
            return entry.data
        raise


async def get_displays() -> dict[str, Any]:
    """Everything the three rotating displays need, in one payload.

    Returns {"enabled": False} when the user hasn't configured a tide location,
    so the frontend simply omits the tide/solunar panels.
    """
    if not WEEK_URL:
        return {"enabled": False}

    async def build():
        week = _parse_week(await _get_html(WEEK_URL))
        return {
            "enabled": True,
            "display1_next7days": week,
            "display2_tides": {
                "next_tides": _next_tides(week),
                "summary": _summary_sentence(week),
            },
            "display3_solunar": _solunar_summary(week),
            "source": WEEK_URL,
        }
    return await _cached("displays", build)


async def get_month() -> dict[str, Any]:
    if not MONTH_URL:
        return {"enabled": False, "title": "", "rows": []}
    return await _cached("month", lambda: _month())


async def _month() -> dict[str, Any]:
    return _parse_month(await _get_html(MONTH_URL))


def _summary_sentence(week: list[dict[str, Any]]) -> str:
    """A short 'tide is currently rising/falling' style line for display 2."""
    nxt = _next_tides(week, limit=1)
    if not nxt:
        return ""
    n = nxt[0]
    trend = "rising" if n["type"] == "high" else "falling"
    return (f"Tide is {trend}. Next {n['type'] or 'tide'} "
            f"{n['height_ft']} ft at {n['time']}.")
