# Cloudflare Workers Setup

## Complete Worker Implementation

Six serverless workers power all rotating displays, weather, tides, voice commands, and media controls. **Total monthly cost: $0** (free tier).

### Workers Overview

| Worker | Purpose | API Cost | Update Frequency |
|--------|---------|----------|------------------|
| `voice.js` | Parse voice commands (pure JS, zero API) | **Free** | Real-time |
| `weather-live.js` | Current weather + 6-day forecast | **Free** | Hourly cache |
| `tides.js` | NOAA tide predictions by station | **Free** | Daily cache |
| `celestial.js` | Meteor showers, planet oppositions, eclipses | **Free** | Daily cache |
| `twitter.js` | @SurfnWeatherman feed (API or static fallback) | **Free** | 1-hour cache |
| `spotify.js` | Now-playing track + playback controls | **Free** | 10-second cache |

### Deploy to Cloudflare

```bash
npm install -g wrangler
cd workers

# Create KV namespace
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "CACHE" --preview

# Update wrangler.toml with your KV IDs

# Deploy all workers
wrangler deploy voice.js
wrangler deploy weather-live.js
wrangler deploy tides.js
wrangler deploy celestial.js
wrangler deploy twitter.js
wrangler deploy spotify.js
```

### Environment Variables (in Cloudflare Dashboard)

Set these under **Workers → Settings → Environment Variables**:

```
LOCATION_LAT=40.7128
LOCATION_LON=-74.0060
TIDE_STATION=8454000

# Optional (for Twitter API, not required):
TWITTER_BEARER_TOKEN=

# Optional (for Spotify):
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

### Worker Details

#### voice.js
- **Input**: `{text, rooms, lights}`
- **Output**: `{action, entity_id, brightness?, color?}`
- **Cost**: $0 (pure regex parsing, no external API)
- **Examples**:
  - "turn on kitchen lights" → `{action: "turn_on", entity_id: "light.kitchen_main", room: "kitchen"}`
  - "dim to 50%" → `{action: "brightness", entity_id: "light.x", brightness: 128}`
  - "red lights" → `{action: "color", entity_id: "light.x", color: "rgb(255,0,0)"}`

#### weather-live.js
- **Input**: Query params: `?latitude=40.7128&longitude=-74.0060`
- **Output**: `{current: {temp, humidity}, forecast: [{date, high, low}]}`
- **Cost**: $0 (Open-Meteo free tier: 100K requests/month)
- **Cache**: 1 hour (cached in Cloudflare KV)

#### tides.js
- **Input**: Query params: `?station=8454000&month=2026-09`
- **Output**: `{tides: [{t, v, type}]}`
- **Cost**: $0 (NOAA API: unlimited)
- **Cache**: 24 hours
- **Station Lookup**: https://www.noaa.gov/education/noaa-science-school-at-home/ocean-coasts/tides-currents

#### celestial.js
- **Input**: None (pre-computed)
- **Output**: `{events: [{name, date, constellation, description, image, where_to_look}]}`
- **Cost**: $0 (pre-computed daily, no API)
- **Cache**: 24 hours

#### twitter.js
- **Input**: None
- **Output**: `{tweets: [{id, text, created_at, likes}]}`
- **Cost**: $0 with fallback (API optional, static tweets fallback)
- **Cache**: 1 hour
- **Note**: If `TWITTER_BEARER_TOKEN` not set, returns static sample tweets (always works)

#### spotify.js
- **Input**: POST to `/spotify/current` or `/spotify/control/play|pause|next|previous`
- **Output**: `{is_playing, name, artist, image, progress, duration}`
- **Cost**: $0 (Spotify free tier)
- **Auth**: One-time OAuth (refresh token stored in KV)

---

## Integrating Workers with Panel

### Backend Proxy (dashboard/backend/main.py)

The FastAPI backend acts as a proxy:

```python
@app.get("/api/weather")
async def get_weather():
    return await fetch_worker("/weather")

@app.get("/api/tides")
async def get_tides(month: str = None):
    return await fetch_worker("/tides", {"month": month} if month else {})

@app.post("/api/voice/command")
async def voice_command(text: str, dry_run: bool = False):
    # Calls worker, executes action in HA if not dry_run
```

### Frontend Integration

Each worker response is cached and polled by the frontend:

```javascript
// In rotating.js
async function loadWeather() {
    const response = await fetch('/api/weather');
    window.weatherData = await response.json();
}

async function loadTides() {
    const response = await fetch('/api/tides');
    window.tidesData = await response.json();
}

// Etc. for celestial, twitter, spotify
```

---

## Cost Verification (Monthly)

### Request Volume

- **Voice commands**: 100 × $0 = $0
- **Weather**: 1 check/hour = 730 calls, well under 100K free = $0
- **Tides**: 1 check/day = 30 calls, unlimited = $0
- **Celestial**: Pre-computed, 1 call/day = $0
- **Twitter**: 1 check/hour = 730 calls, under 450 free or static fallback = $0
- **Spotify**: 50 checks/day = 1,500 calls, within free tier = $0

### Cloudflare Worker Cost

- **Free tier**: 100,000 requests/month per worker, 3GB KV storage
- **Your usage**: ~3,000 requests/month total
- **Cost**: $0

### External APIs

- Open-Meteo: Free 100K/month
- NOAA Tides: Free unlimited
- Twitter API v2: Free 450/month (or fallback)
- Spotify: Free tier

### TOTAL MONTHLY: **$0**

---

## Troubleshooting

**"Worker timeout"**: Check network connectivity; add timeout handling to fetch calls.

**"Weather returns null"**: Verify `LOCATION_LAT` and `LOCATION_LON` in Cloudflare environment vars.

**"Tides not working"**: NOAA station ID required. Find yours at https://www.noaa.gov/

**"Spotify shows 'Not authenticated'"**: One-time OAuth flow needed. User must visit `/auth/spotify` endpoint once.

**"Twitter feed empty"**: If no API key, worker returns static sample. To use live feed, add `TWITTER_BEARER_TOKEN` to env.

---

## Updating Workers

To deploy changes:

```bash
cd workers
wrangler deploy voice.js
wrangler deploy weather-live.js
# etc.
```

Changes live immediately (no cold start, instant global CDN deployment).
