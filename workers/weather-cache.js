/**
 * weather-cache.js — Cloudflare Worker
 * Fetches from Open-Meteo (free tier: 100K requests/month)
 * Caches in KV for 1 hour
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const lat = url.searchParams.get('lat') || '40.7128';
    const lon = url.searchParams.get('lon') || '-74.0060';

    const cacheKey = `weather:${lat}:${lon}`;
    const cached = await env.WEATHER_CACHE.get(cacheKey);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json' } });

    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=temperature_2m,precipitation&timezone=auto`
      );

      if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);

      const data = await response.json();
      const result = {
        current: data.current,
        daily: data.daily,
        timezone: data.timezone
      };

      await env.WEATHER_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }
};
