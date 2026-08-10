/**
 * tides-cache.js — Cloudflare Worker
 * Fetches tide data from NOAA (free tier: unlimited)
 * Caches for 24 hours
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const station = url.searchParams.get('station') || '8454000'; // NYC Battery
    const month = url.searchParams.get('month'); // YYYY-MM

    const cacheKey = month ? `tides:${station}:${month}` : `tides:${station}:current`;
    const cached = await env.TIDES_CACHE.get(cacheKey);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json' } });

    try {
      const dates = month ? getMonthDates(month) : getNext7Days();
      const predictions = await fetchNOAATides(station, dates.start, dates.end);

      const result = {
        station,
        tides: predictions,
        range: { start: dates.start, end: dates.end }
      };

      await env.TIDES_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }
};

function getNext7Days() {
  const now = new Date();
  const start = now.toISOString().split('T')[0];
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { start, end };
}

function getMonthDates(month) {
  const [year, m] = month.split('-');
  const start = `${year}-${m}-01`;
  const end = new Date(parseInt(year), parseInt(m), 0).toISOString().split('T')[0];
  return { start, end };
}

async function fetchNOAATides(station, start, end) {
  const response = await fetch(
    `https://api.noaa.gov/api/v1/tides/predictions?station=${station}&begin_date=${start}&end_date=${end}&product=predictions&datum=MLLW&time_zone=lst_ldt&format=json`
  );

  if (!response.ok) throw new Error(`NOAA returned ${response.status}`);
  const data = await response.json();
  return data.predictions || [];
}
