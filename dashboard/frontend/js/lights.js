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
  function supportsTemp(e) {
    const modes = (e.attributes && e.attributes.supported_color_modes) || [];
    return modes.includes("color_temp");
  }
  function cycleTemp(e) {
    // step warm ↔ cool through a few mireds so the icon button is useful
    const steps = [153, 250, 370, 500];
    const cur = (e.attributes && e.attributes.color_temp) || 370;
    const next = steps[(steps.findIndex((s) => s >= cur) + 1) % steps.length];
    HA.call("light", "turn_on", { entity_id: e.entity_id, color_temp: next });
  }

  // ---- full light card ---------------------------------------------------
  function card(e) {
    const el = document.createElement("div");
    el.className = "light-card" + (isOn(e) ? " on" : "");
    el.dataset.id = e.entity_id;

    const on = isOn(e);
    el.innerHTML = `
      <div class="lc-top">
        <div class="lc-bulb">☀</div>
        <div class="lc-id">
          <div class="lc-name">${nameOf(e)}</div>
          <div class="lc-room">${on ? brightPct(e) + "%" : (e.state === "unavailable" ? "Unavailable" : "Off")}</div>
        </div>
        <div class="toggle ${on ? "on" : ""}" data-act="toggle"></div>
      </div>
      <div class="lc-controls">
        <input type="range" class="bri" min="0" max="100" value="${brightPct(e)}"
          aria-label="Brightness" ${e.state === "unavailable" ? "disabled" : ""} />
        ${supportsTemp(e) ? `<button class="lc-btn" data-act="temp" title="Color temperature">🌡</button>` : ""}
        ${supportsColor(e) ? `<button class="lc-btn" data-act="color" title="Color">🎨</button>` : ""}
        <button class="lc-btn" data-act="room" title="Assign room">⋯</button>
      </div>
      ${supportsColor(e) ? `<div class="swatches" hidden></div>` : ""}
    `;

    el.querySelector('[data-act="toggle"]').addEventListener("click", () => toggle(e));
    el.querySelector(".lc-bulb").addEventListener("click", () => toggle(e));

    const bri = el.querySelector(".bri");
    const state = el.querySelector(".lc-room");
    bri.addEventListener("input", () => (state.textContent = bri.value + "%"));
    bri.addEventListener("change", () => setBrightness(e, bri.value));

    el.querySelector('[data-act="temp"]')?.addEventListener("click", () => cycleTemp(e));

    if (supportsColor(e)) {
      const sw = el.querySelector(".swatches");
      COLORS.forEach((rgb) => {
        const s = document.createElement("div");
        s.className = "swatch";
        s.style.background = `rgb(${rgb.join(",")})`;
        s.addEventListener("click", () => setColor(e, rgb));
        sw.appendChild(s);
      });
      el.querySelector('[data-act="color"]').addEventListener("click", () =>
        (sw.hidden = !sw.hidden)
      );
    }

    // per-card room assignment picker
    el.querySelector('[data-act="room"]').addEventListener("click", () =>
      openRoomPicker(e)
    );
    return el;
  }

  // small popover picker reusing Rooms.roomSelect
  function openRoomPicker(e) {
    const body = document.getElementById("modal-body");
    body.innerHTML = `<h1 style="margin-bottom:6px">${nameOf(e)}</h1>
      <div class="muted" style="margin-bottom:16px">Assign this light to a room.</div>`;
    const sel = Rooms.roomSelect(Rooms.roomOf(e));
    sel.style.fontSize = "18px";
    sel.addEventListener("change", async () => {
      await Rooms.assign(e.entity_id, sel.value || null);
      document.getElementById("modal").hidden = true;
    });
    body.appendChild(sel);
    document.getElementById("modal").hidden = false;
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

    // group by room (like the reference: Living Room / Kitchen / Bedroom …)
    const byRoom = {};
    lights.forEach((e) => {
      const room = window.Rooms ? Rooms.roomOf(e) : "Unassigned";
      (byRoom[room] = byRoom[room] || []).push(e);
    });
    // ordered rooms first, then any extras, Unassigned last
    const order = (window.Rooms ? Rooms.data.rooms : []).slice();
    const roomNames = Object.keys(byRoom).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99);
    });

    roomNames.forEach((room) => {
      const section = document.createElement("section");
      section.className = "room-section";
      const head = document.createElement("div");
      head.className = "room-head";
      head.innerHTML = `<h2>${room}</h2>
        <span class="room-count">${byRoom[room].length} light${byRoom[room].length > 1 ? "s" : ""}</span>`;
      section.appendChild(head);
      const cards = document.createElement("div");
      cards.className = "light-grid";
      byRoom[room].forEach((e) => cards.appendChild(card(e)));
      section.appendChild(cards);
      grid.appendChild(section);
    });
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

  // header buttons: Add device / Manage rooms
  document.getElementById("add-device")?.addEventListener("click", () =>
    Rooms.showAddDevice()
  );
  document.getElementById("manage-rooms")?.addEventListener("click", () =>
    Rooms.showManageRooms()
  );

  // load room assignments, then re-render whenever rooms or state change
  if (window.Rooms) {
    Rooms.load().then(renderGrid);
    Rooms.onChange(() => { renderGrid(); renderQuick(); });
  }

  // re-render on every state push
  HA.onState(() => {
    renderGrid();
    renderQuick();
    renderScenes();
  });

  window.Lights = { renderGrid, renderQuick, renderScenes };
})();
