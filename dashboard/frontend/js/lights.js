/* =========================================================================
   lights.js — unified light grid + quick tiles.
   Every light/switch (Tuya, WiZ, Monster, Marvelight, SmartLife...) is treated
   identically here, so they look like one native family — the spec's goal.
   ========================================================================= */
(function () {
  const COLORS = [
    [255, 255, 255], [255, 214, 170], [255, 138, 76], [255, 76, 96],
    [190, 96, 255], [76, 168, 255], [76, 255, 196], [120, 255, 120],
  ];

  const brightPct = (e) => {
    const b = e.attributes && e.attributes.brightness;
    return b == null ? (isOn(e) ? 100 : 0) : Math.round((b / 255) * 100);
  };
  const isOn = (e) => e.state === "on";
  const roomOf = (e) =>
    (e.attributes && (e.attributes.room || e.attributes.area)) || "";
  const nameOf = (e) =>
    (e.attributes && e.attributes.friendly_name) || e.entity_id.split(".")[1];

  function supportsColor(e) {
    const modes = (e.attributes && e.attributes.supported_color_modes) || [];
    return modes.some((m) => ["rgb", "rgbw", "hs", "xy", "rgbww"].includes(m));
  }

  // ---- control actions ---------------------------------------------------
  function toggle(e) {
    HA.call("light", isOn(e) ? "turn_off" : "turn_on", { entity_id: e.entity_id });
  }
  function setBrightness(e, pct) {
    HA.call("light", "turn_on", {
      entity_id: e.entity_id,
      brightness_pct: Number(pct),
    });
  }
  function setColor(e, rgb) {
    HA.call("light", "turn_on", { entity_id: e.entity_id, rgb_color: rgb });
  }

  // ---- full light card ---------------------------------------------------
  function card(e) {
    const el = document.createElement("div");
    el.className = "light-card" + (isOn(e) ? " on" : "");
    el.dataset.id = e.entity_id;

    const room = roomOf(e);
    el.innerHTML = `
      <div class="lc-top">
        <div>
          <div class="lc-name">${nameOf(e)}</div>
          ${room ? `<div class="lc-room">${room}</div>` : ""}
        </div>
        <div class="lc-bulb">☀</div>
      </div>
      <div class="lc-toggle-row">
        <div class="toggle ${isOn(e) ? "on" : ""}" data-act="toggle"></div>
      </div>
      <div class="slider-wrap">
        <label>Brightness <span class="bri-val">${brightPct(e)}%</span></label>
        <input type="range" class="bri" min="0" max="100" value="${brightPct(e)}" />
      </div>
      ${supportsColor(e) ? `<div class="swatches"></div>` : ""}
    `;

    el.querySelector('[data-act="toggle"]').addEventListener("click", () => toggle(e));
    el.querySelector(".lc-bulb").addEventListener("click", () => toggle(e));

    const bri = el.querySelector(".bri");
    const briVal = el.querySelector(".bri-val");
    bri.addEventListener("input", () => (briVal.textContent = bri.value + "%"));
    bri.addEventListener("change", () => setBrightness(e, bri.value));

    if (supportsColor(e)) {
      const sw = el.querySelector(".swatches");
      COLORS.forEach((rgb) => {
        const s = document.createElement("div");
        s.className = "swatch";
        s.style.background = `rgb(${rgb.join(",")})`;
        s.addEventListener("click", () => setColor(e, rgb));
        sw.appendChild(s);
      });
    }
    return el;
  }

  // ---- quick tile (home screen) -----------------------------------------
  function tile(e) {
    const el = document.createElement("div");
    el.className = "qtile" + (isOn(e) ? " on" : "");
    el.innerHTML = `
      <div class="qicon">☀</div>
      <div>
        <div class="qname">${nameOf(e)}</div>
        <div class="qstate">${isOn(e) ? brightPct(e) + "%" : "Off"}</div>
      </div>`;
    el.addEventListener("click", () => toggle(e));
    return el;
  }

  function renderGrid() {
    const grid = document.getElementById("light-grid");
    const empty = document.getElementById("lights-empty");
    const lights = HA.lights().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    grid.innerHTML = "";
    if (!lights.length) { empty.hidden = false; return; }
    empty.hidden = true;
    lights.forEach((e) => grid.appendChild(card(e)));
  }

  function renderQuick() {
    const grid = document.getElementById("quick-grid");
    const lights = HA.lights().slice(0, 6);
    grid.innerHTML = "";
    lights.forEach((e) => grid.appendChild(tile(e)));
  }

  function renderScenes() {
    const grid = document.getElementById("scene-grid");
    const empty = document.getElementById("scenes-empty");
    const scenes = HA.scenes();
    grid.innerHTML = "";
    if (!scenes.length) { empty.hidden = false; return; }
    empty.hidden = true;
    scenes.forEach((s) => {
      const el = document.createElement("div");
      el.className = "scene-card";
      el.innerHTML = `<div class="si">✦</div><div class="lc-name">${
        s.attributes.friendly_name || s.entity_id.split(".")[1]
      }</div>`;
      el.addEventListener("click", () =>
        HA.call("scene", "turn_on", { entity_id: s.entity_id })
      );
      grid.appendChild(el);
    });
  }

  // all on / off
  document.getElementById("all-on")?.addEventListener("click", () =>
    HA.call("light", "turn_on", { entity_id: "all" })
  );
  document.getElementById("all-off")?.addEventListener("click", () =>
    HA.call("light", "turn_off", { entity_id: "all" })
  );

  // re-render on every state push
  HA.onState(() => {
    renderGrid();
    renderQuick();
    renderScenes();
  });

  window.Lights = { renderGrid, renderQuick, renderScenes };
})();
