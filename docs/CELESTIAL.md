# Celestial events

The panel automatically surfaces the **one or two major celestial events** worth
photographing in the **next ~month**, and rotates them through the info slides
alongside tides/weather. Peak dates are also dotted on the homepage calendar,
and the next event shows as a "sky tonight" line.

## How it works

- **Precise astronomical events are computed** (`dashboard/backend/astro.py`)
  with the [Astronomy Engine](https://github.com/cosinekitty/astronomy) library
  from your latitude/longitude — so the calendar finds the genuinely newsworthy
  events, not a canned list:
  - planetary **conjunctions** (e.g. Venus–Jupiter close approaches),
  - planet **oppositions** (Mars/Jupiter/Saturn/Uranus/Neptune),
  - greatest **elongations** of Mercury & Venus,
  - **full / new moons** (with supermoon detection; new moon = darkest skies for
    the Milky Way and deep-sky work),
  - lunar & solar **eclipses**.

  For each, it also computes *where to look* — the constellation plus compass
  direction and altitude at the best moment of the night **at your location**.
  This is all derived from coordinates, so it's correct for any home and any
  year. (If coordinates aren't set, this layer is skipped.)
- **Meteor showers are also computed** (`celestial.py`) from their well-known
  annual peaks — Quadrantids, Lyrids, Eta/Delta Aquariids, Perseids, Orionids,
  Leonids, Geminids, Ursids — so there's almost always something upcoming even
  with no coordinates.
- Everything is merged and ranked by significance and soonest peak. The **top
  few become rotating slides**; the **homepage calendar lists them all** (next
  ~45 days) with peak-date dots.
- Each slide shows the **date range leading to the peak**, a **concise
  description**, **where to look** (anchored to a common constellation +
  direction), and the **best viewing time** — e.g. *"Perseids · Jul 29 – Aug 15
  (peak Aug 12) · Look northeast toward Perseus · Best: after midnight until
  dawn."* Tap a slide for the full detail card.
- Behind the text, the UI draws a **themed starfield** matched to the event type
  (meteor streaks, galaxy glow, planet disk, moon, eclipse). Computed planet and
  moon events also carry a **best-effort real photo** (NASA/Wikimedia); if a URL
  is unavailable the starfield shows instead, so a slide is never blank. Supply
  or override any event's photo with `image_url` (see below).

## Adding one-off events (alignments, eclipses, galaxies, comets)

One-off events vary year to year, so we **never fabricate their dates**. Add them
yourself in a `celestial_events.json` file at the project root (next to `.env`).
Copy the template to start:

```bash
cp celestial_events.example.json celestial_events.json
```

Each entry:

| Field | Meaning |
|-------|---------|
| `name` | Event title shown on the slide |
| `category` | `meteor` \| `planet` \| `galaxy` \| `moon` \| `comet` \| `eclipse` (picks the themed background) |
| `peak_date` | `YYYY-MM-DD` — when it's best |
| `dates_label` | Human date range, e.g. "Early–mid November" |
| `where` | Where to look, anchored to a constellation + direction |
| `best_time` | Best viewing window |
| `rate` | Short significance note (e.g. "Naked-eye under dark skies") |
| `score` | Ranking weight vs. other events (meteor showers use their rate, ~10–120) |
| `description` | 1–3 sentence concise description |
| `image_url` | Optional URL to a high-quality photo (e.g. a NASA/ESO/Wikimedia image). Leave blank for the themed starfield. |
| `credit` | Optional image credit line |

The example file includes an **Andromeda Galaxy** autumn-visibility entry and a
**planetary alignment** entry showing the exact format. They merge and rank
alongside the computed meteor showers automatically — no restart needed beyond
the 15-minute refresh (or reopen the Home screen).

### Where to get free, high-quality images

Use public-domain / freely licensed astrophotography for `image_url`:
- **NASA APOD** (apod.nasa.gov) and images.nasa.gov — public domain.
- **ESO** (eso.org) and **Wikimedia Commons** — check each image's license.

Paste the direct image URL into `image_url`; the slide fetches it at display
time and falls back to the starfield if it's unavailable.
