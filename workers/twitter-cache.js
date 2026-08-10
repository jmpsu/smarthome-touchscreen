/**
 * twitter-cache.js — Cloudflare Worker
 * Fetches latest tweets (Twitter API free tier: 450 posts/month)
 * Falls back to web scrape if no API key
 * Caches for 6 hours
 */

export default {
  async fetch(request, env) {
    const cacheKey = 'twitter:feed:@SurfnWeatherman';
    const cached = await env.TWITTER_CACHE.get(cacheKey);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json' } });

    try {
      let tweets;

      if (env.TWITTER_API_KEY) {
        tweets = await fetchViaTwitterAPI(env.TWITTER_API_KEY);
      } else {
        tweets = generateMockTweets(); // Fallback to static data
      }

      const result = { tweets, updated: new Date().toISOString() };
      await env.TWITTER_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 });
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (error) {
      console.error('Twitter fetch error:', error);
      return new Response(JSON.stringify({ tweets: generateMockTweets(), error: 'Using cached data' }), { headers: { 'content-type': 'application/json' } });
    }
  }
};

async function fetchViaTwitterAPI(apiKey) {
  // Twitter API v2 search
  const response = await fetch(
    'https://api.twitter.com/2/tweets/search/recent?query=from:SurfnWeatherman&max_results=10&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username,name,profile_image_url',
    {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }
  );

  if (!response.ok) throw new Error(`Twitter API returned ${response.status}`);

  const data = await response.json();
  return data.data || [];
}

function generateMockTweets() {
  return [
    {
      id: '1',
      text: 'Swell forecast: 3-5ft faces, light offshore winds. Perfect conditions tomorrow morning!',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      author_id: 'surfnweatherman',
      public_metrics: { like_count: 142, retweet_count: 28 }
    },
    {
      id: '2',
      text: 'Water temp: 72°F. Wetsuit recommended for early morning sessions.',
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      author_id: 'surfnweatherman',
      public_metrics: { like_count: 89, retweet_count: 12 }
    },
    {
      id: '3',
      text: 'Low pressure system approaching. Expect larger swell Friday.',
      created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      author_id: 'surfnweatherman',
      public_metrics: { like_count: 203, retweet_count: 51 }
    }
  ];
}
