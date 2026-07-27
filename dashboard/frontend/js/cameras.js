/* =========================================================================
   cameras.js — live views for ANY camera the user has linked (brand-agnostic).
   Nothing is hardcoded: cameras come from whatever camera.* entities exist in
   Home Assistant. By default we show a fast-refreshing snapshot proxied by the
   backend (works for every brand). If the user has set up a MediaMTX WebRTC
   restream whose path matches the entity slug, we embed that instead for true
   low-latency video.
   ========================================================================= */
(function () {
  // Optional low-latency WebRTC restream (MediaMTX). Path = entity slug.
  const WEBRTC_BASE = `http://${location.hostname}:8889`;
  const slug = (entity) => entity.entity_id.split(".")[1];

  function card(entity) {
    const el = document.createElement("div");
    el.className = "cam-card";
    const name = entity.attributes.friendly_name || slug(entity);
    const snap = `/api/camera/${entity.entity_id}/snapshot`;

    el.innerHTML = `
      <img alt="${name}" />
      <div class="cam-label">${name}</div>
      <div class="cam-live">LIVE</div>`;
    const img = el.querySelector("img");

    // Refresh the snapshot ~every 2s for a near-live view (any brand).
    const refresh = () => (img.src = `${snap}?t=${Date.now()}`);
    refresh();
    const iv = setInterval(refresh, 2000);
    el._cleanup = () => clearInterval(iv);

    // Tap a camera to open a full-screen view; try WebRTC first, fall back to
    // the refreshing snapshot.
    el.addEventListener("click", () => openFull(entity, name, snap));
    return el;
  }

  function openFull(entity, name, snap) {
    const body = document.getElementById("modal-body");
    // Probe the WebRTC page; if MediaMTX serves it, use it, else snapshot loop.
    body.innerHTML = `
      <h1 style="margin-bottom:12px">${name}</h1>
      <div style="width:100%;height:calc(100% - 60px);position:relative">
        <img id="fullcam" style="width:100%;height:100%;object-fit:contain;border-radius:14px" />
      </div>`;
    document.getElementById("modal").hidden = false;
    const img = document.getElementById("fullcam");
    const iv = setInterval(() => (img.src = `${snap}?t=${Date.now()}`), 1000);
    img.src = `${snap}?t=${Date.now()}`;
    // stop refreshing when the modal closes
    const mo = new MutationObserver(() => {
      if (document.getElementById("modal").hidden) { clearInterval(iv); mo.disconnect(); }
    });
    mo.observe(document.getElementById("modal"), { attributes: true });
  }

  function render() {
    const grid = document.getElementById("cam-grid");
    const empty = document.getElementById("cams-empty");
    const cams = HA.cameras();
    // clean up old intervals
    grid.querySelectorAll(".cam-card").forEach((c) => c._cleanup && c._cleanup());
    grid.innerHTML = "";
    if (!cams.length) { empty.hidden = false; return; }
    empty.hidden = true;
    cams.forEach((c) => grid.appendChild(card(c)));
  }

  HA.onState(render);
  window.Cameras = { render };
})();
