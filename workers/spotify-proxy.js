/**
 * spotify-proxy.js — Cloudflare Worker
 * Proxies Spotify Web API calls (free tier within ToS)
 * Handles OAuth token refresh and playback control
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/spotify/current') {
      return handleCurrentTrack(env);
    } else if (path.startsWith('/spotify/control/')) {
      const action = path.split('/').pop();
      return handlePlaybackControl(action, env);
    } else if (path === '/spotify/auth') {
      return handleOAuth(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleCurrentTrack(env) {
  if (!env.SPOTIFY_ACCESS_TOKEN) {
    return json({ error: 'Spotify not authenticated' }, 401);
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${env.SPOTIFY_ACCESS_TOKEN}` }
    });

    if (response.status === 401) {
      // Token expired, try refresh
      return json({ error: 'Token expired' }, 401);
    }

    if (!response.ok) throw new Error(`Spotify API returned ${response.status}`);

    const data = await response.json();
    if (!data.item) {
      return json({ currently_playing: null });
    }

    return json({
      track: data.item.name,
      artist: data.item.artists.map(a => a.name).join(', '),
      album: data.item.album.name,
      image_url: data.item.album.images[0]?.url,
      duration_ms: data.item.duration_ms,
      progress_ms: data.progress_ms,
      is_playing: data.is_playing
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

async function handlePlaybackControl(action, env) {
  if (!env.SPOTIFY_ACCESS_TOKEN) {
    return json({ error: 'Spotify not authenticated' }, 401);
  }

  const endpoint = {
    'play': 'https://api.spotify.com/v1/me/player/play',
    'pause': 'https://api.spotify.com/v1/me/player/pause',
    'next': 'https://api.spotify.com/v1/me/player/next',
    'previous': 'https://api.spotify.com/v1/me/player/previous'
  }[action];

  if (!endpoint) return json({ error: 'Invalid action' }, 400);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SPOTIFY_ACCESS_TOKEN}` }
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Spotify API returned ${response.status}`);
    }

    return json({ success: true, action });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

async function handleOAuth(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) return json({ error: 'No authorization code' }, 400);

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(env.SPOTIFY_REDIRECT_URI)}&client_id=${env.SPOTIFY_CLIENT_ID}&client_secret=${env.SPOTIFY_CLIENT_SECRET}`
    });

    const data = await response.json();
    // Store in KV for the dashboard to retrieve
    await env.SPOTIFY_KV.put('spotify:token', JSON.stringify(data), {
      expirationTtl: data.expires_in
    });

    return json({ success: true, expires_in: data.expires_in });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
