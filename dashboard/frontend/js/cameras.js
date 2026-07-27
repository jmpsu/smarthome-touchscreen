/* =========================================================================
   cameras.js — Eufy live views.
   The Eufy cameras are published by MediaMTX (see docker/mediamtx). We prefer
   the low-latency HLS endpoint the browser can play natively; if a camera is
   not streaming we fall back to the still image the backend exposes.
   ========================================================================= */
(function () {
  // MediaMTX serves a ready-made low-latency WebRTC player page at
  // :8889/<path>/  — Chromium plays that reliably (it can't play raw HLS
  // without a JS shim), so we embed it directly.
  const WEBRTC_BASE = `http://${location.hostname}:8889`;

  // Map HA camera entities to their MediaMTX stream path. We derive the path
  // from the entity name; the two default cameras are eufy_front / eufy_back.
  function streamPath(entity) {
    const n = (entity.attributes.friendly_name || entity.entity_id).toLowerCase();
    if (n.includes("front")) return "eufy_front";
    if (n.includes("back")) return "eufy_back";
    // fallback: slug of entity id
    return entity.entity_id.split(".")[1];
  }

  function card(entity) {
    const path = streamPath(entity);
    const el = document.createElement("div");
    el.className = "cam-card";
    // MediaMTX's WebRTC reader page auto-plays the stream muted & fullscreen.
    el.innerHTML = `
      <iframe src="${WEBRTC_BASE}/${path}/" allow="autoplay"
        style="width:100%;height:100%;border:0"></iframe>
      <div class="cam-label">${entity.attributes.friendly_name || path}</div>
      <div class="cam-live">LIVE</div>`;
    // Tap to expand to full screen in the modal.
    el.querySelector(".cam-label").addEventListener("click", () => {
      const body = document.getElementById("modal-body");
      body.innerHTML =
        `<iframe src="${WEBRTC_BASE}/${path}/" allow="autoplay"
           style="width:100%;height:100%;border:0"></iframe>`;
      document.getElementById("modal").hidden = false;
    });
    return el;
  }

  function render() {
    const grid = document.getElementById("cam-grid");
    const empty = document.getElementById("cams-empty");
    const cams = HA.cameras();
    grid.innerHTML = "";
    if (!cams.length) { empty.hidden = false; return; }
    empty.hidden = true;
    cams.forEach((c) => grid.appendChild(card(c)));
  }

  HA.onState(render);
  window.Cameras = { render };
})();
