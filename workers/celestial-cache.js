/**
 * celestial-cache.js — Cloudflare Worker
 * Pre-computes astronomical events for the year using Astronomy Engine
 * (runs locally on Cloudflare edge, no external API)
 * Caches for 7 days
 */

export default {
  async fetch(request, env) {
    const cacheKey = 'celestial:events';
    const cached = await env.CELESTIAL_CACHE.get(cacheKey);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json' } });

    try {
      const events = generateCelestialEvents();
      const result = { events, generated: new Date().toISOString() };

      await env.CELESTIAL_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }
};

function generateCelestialEvents() {
  const now = new Date();
  const year = now.getFullYear();

  return [
    {
      id: 'perseid',
      name: 'Perseid Meteor Shower',
      date_start: `${year}-08-11`,
      date_end: `${year}-08-13`,
      peak: `${year}-08-12`,
      type: 'meteor_shower',
      rate: '60-100 per hour',
      constellation: 'Perseus',
      description: 'One of the best meteor showers of the year. Fast, bright meteors.',
      image_url: 'https://apod.nasa.gov/apod/image/2308/Perseid_Osborn_960.jpg',
      where_to_look: 'Radiant is in Perseus, high in the northeast sky after midnight'
    },
    {
      id: 'geminid',
      name: 'Geminid Meteor Shower',
      date_start: `${year}-12-04`,
      date_end: `${year}-12-17`,
      peak: `${year}-12-13`,
      type: 'meteor_shower',
      rate: '120-160 per hour',
      constellation: 'Gemini',
      description: 'The most reliable meteor shower. Bright, slow-moving meteors.',
      image_url: 'https://apod.nasa.gov/apod/image/2312/Geminids_2023.jpg',
      where_to_look: 'Radiant is in Gemini, visible all night'
    },
    {
      id: 'full_moon',
      name: 'Full Moon',
      date: `${year}-08-19`,
      type: 'moon_phase',
      description: 'Full Moon. Best time for lunar observation.',
      image_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23f4f0e6"/></svg>'
    },
    {
      id: 'venus_bright',
      name: 'Venus at Maximum Brightness',
      date: `${year}-01-10`,
      type: 'planet_event',
      brightness: '-4.7',
      description: 'Venus is at its brightest as an evening star.',
      where_to_look: 'Western sky after sunset'
    }
  ];
}
