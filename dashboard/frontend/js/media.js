/* =========================================================================
   media.js — now-playing + playback control for any HA media_player
   (Spotify or otherwise). Brand-agnostic: it binds to the first active
   media_player entity, preferring Spotify. All control goes through HA
   services, so the token stays server-side.
   ========================================================================= */
(function () {
  function players() {
    return HA.cameras && Object.values(HA.entities)
      .filter((e) => e.entity_id.startsWith("media_player."));
  }

  function pick() {
    const ps = players() || [];
    // prefer a spotify player that's playing/paused, else any non-idle, else first
    return (
      ps.find((e) => e.entity_id.includes("spotify") && e.state !== "off") ||
      ps.find((e) => ["playing", "paused"].includes(e.state)) ||
      ps[0]
    );
  }

  const call = (service, entity, data = {}) =>
    HA.call("media_player", service, { entity_id: entity, ...data });

  function render() {
    const body = document.getElementById("music-body");
    const empty = document.getElementById("music-empty");
    if (!body) return;
    const p = pick();
    if (!p) { body.innerHTML = ""; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;

    const a = p.attributes || {};
    const art = a.entity_picture ? `/api/camera_passthrough` : "";
    const playing = p.state === "playing";
    const title = a.media_title || "Nothing playing";
    const artist = a.media_artist || a.media_album_name || "";
    const vol = Math.round((a.volume_level ?? 0.3) * 100);
    // entity_picture from Spotify is an absolute Spotify CDN URL — use directly.
    const cover = a.entity_picture && a.entity_picture.startsWith("http")
      ? a.entity_picture : "";

    body.innerHTML = `
      <div class="np">
        <div class="np-art">${cover ? `<img src="${cover}" alt="">` : "♫"}</div>
        <div class="np-info">
          <div class="np-title">${title}</div>
          <div class="np-artist">${artist}</div>
          <div class="np-controls">
            <button class="np-btn" data-a="prev">⏮</button>
            <button class="np-btn np-play" data-a="play">${playing ? "⏸" : "▶"}</button>
            <button class="np-btn" data-a="next">⏭</button>
          </div>
          <div class="np-vol">
            <span>🔈</span>
            <input type="range" min="0" max="100" value="${vol}" class="np-volume" />
            <span>🔊</span>
          </div>
          <div class="np-src muted">${a.source || p.attributes.friendly_name || ""}</div>
        </div>
      </div>`;

    body.querySelector('[data-a="prev"]').onclick = () => call("media_previous_track", p.entity_id);
    body.querySelector('[data-a="next"]').onclick = () => call("media_next_track", p.entity_id);
    body.querySelector('[data-a="play"]').onclick = () =>
      call(playing ? "media_pause" : "media_play", p.entity_id);
    const v = body.querySelector(".np-volume");
    v.onchange = () => call("volume_set", p.entity_id, { volume_level: v.value / 100 });
  }

  HA.onState(render);
  window.Media = { render };
})();
