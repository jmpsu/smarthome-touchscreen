// Weather from Open-Meteo (free, no key required)
export default {
  async fetch(request, env) {
    const { latitude, longitude } = new URL(request.url).searchParams;
    const lat = latitude || env.LOCATION_LAT || '40.7128';
    const lon = longitude || env.LOCATION_LON || '-74.0060';

    const cacheKey = `weather:${lat}:${lon}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached && Date.now() - JSON.parse(cached).timestamp < 3600000) {
      return new Response(cached, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) return new Response(JSON.stringify({ error: 'Weather API error' }), { status: 500 });

    const data = await response.json();
    const result = {
      timestamp: Date.now(),
      current: {
        temp: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        code: data.current.weather_code
      },
      forecast: data.daily.time.slice(0, 6).map((day, i) => ({
        date: day,
        high: data.daily.temperature_2m_max[i],
        low: data.daily.temperature_2m_min[i],
        code: data.daily.weather_code[i]
      }))
    };

    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
};
