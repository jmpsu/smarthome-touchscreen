# Celestial events

The panel automatically surfaces the **one or two major celestial events** worth
photographing in the **next ~month**, and rotates them through the info slides
alongside tides/weather. Peak dates are also dotted on the homepage calendar,
and the next event shows as a "sky tonight" line.

## How it works

- **Meteor showers are computed** (`dashboard/backend/celestial.py`) from their
  well-known annual peaks — Quadrantids, Lyrids, Eta/Delta Aquariids, Perseids,
  Orionids, Leonids, Geminids, Ursids. Because these recur every year, there is
  almost always something within the coming month, for any year, with no
  per-year data to go stale. Events are ranked by significance (peak rate) and
  soonest peak; the top 1–2 become slides.
- Each slide shows the **date range leading to the peak**, a **concise
  description**, **where to look** (anchored to a common constellation +
  direction), and the **best viewing time** — e.g. *"Perseids · Jul 29 – Aug 15
  (peak Aug 12) · Look northeast toward Perseus · Best: after midnight until
  dawn."* Tap a slide for the full detail card.
- Behind the text, the UI draws a **themed starfield** matched to the event type
  (meteor streaks, galaxy glow, planet disk, moon, eclipse), so a slide is
  visually striking even offline. Supply a real photo per event with `image_url`
  (see below) and it renders behind the text, with the starfield as fallback.

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
