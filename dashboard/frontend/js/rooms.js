/* =========================================================================
   rooms.js — room assignments + on-screen "Add device" / "Manage rooms" flows.
   Exposes a global `Rooms` used by lights.js to group cards by room, and by
   app.js to wire the header buttons.
   ========================================================================= */
(function () {
  const Rooms = {
    data: { rooms: [], assignments: {} },
    _subs: [],
  };

  const modal = () => document.getElementById("modal");
  const modalBody = () => document.getElementById("modal-body");
  const openModal = (html) => { modalBody().innerHTML = html; modal().hidden = false; };
  const closeModal = () => { modal().hidden = true; };

  Rooms.onChange = (cb) => Rooms._subs.push(cb);
  const emit = () => Rooms._subs.forEach((cb) => cb(Rooms.data));

  Rooms.load = async function () {
    try {
      Rooms.data = await (await fetch("/api/rooms")).json();
      emit();
    } catch (e) { console.warn("rooms load failed", e); }
    return Rooms.data;
  };

  // Which room does an entity belong to? local assignment → HA area → Unassigned
  Rooms.roomOf = function (entity) {
    const a = Rooms.data.assignments || {};
    if (a[entity.entity_id]) return a[entity.entity_id];
    const area = entity.attributes && (entity.attributes.room || entity.attributes.area);
    return area || "Unassigned";
  };

  async function post(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }

  Rooms.assign = async function (entity_id, room) {
    Rooms.data = await post("/api/rooms/assign", { entity_id, room });
    emit();
  };

  // ---- "Add device" flow -------------------------------------------------
  Rooms.showAddDevice = async function () {
    openModal(`
      <h1 style="margin-bottom:6px">Add a device</h1>
      <div class="muted" style="margin-bottom:16px">
        Scanning your Wi-Fi for new lights and devices…
      </div>
      <div id="scan-status" class="muted">◌ Scanning (up to a minute)…</div>
      <div id="scan-results" class="disco-list" style="max-height:60vh;margin-top:14px"></div>
      <div style="margin-top:16px" class="muted">
        Some brands (Tuya/SmartLife, Eufy) also need a one-time QR sign-in —
        open <b>Setup → Home Assistant</b> to link the account, then the device
        appears here to assign.
      </div>
    `);
    let res;
    try {
      res = await post("/api/scan", {});
    } catch (e) {
      document.getElementById("scan-status").textContent = "Scan failed: " + e;
      return;
    }
    renderScanResults(res);
  };

  function renderScanResults(res) {
    const status = document.getElementById("scan-status");
    const list = document.getElementById("scan-results");
    if (!status || !list) return;

    // Known HA light/switch entities that aren't assigned yet.
    const assigned = Rooms.data.assignments || {};
    const haDevices = (window.HA ? HA.lights().concat(HA.switches()) : [])
      .map((e) => ({
        entity_id: e.entity_id,
        name: (e.attributes.friendly_name || e.entity_id.split(".")[1]),
        room: assigned[e.entity_id] || "",
        kind: "ha",
      }));

    const discovered = (res.devices || []).map((d) => ({
      name: d.name || (d.addresses || [])[0] || "device",
      ip: (d.addresses || [])[0] || "",
      vendor: d.vendor || d.source || "",
      kind: "net",
    }));

    status.textContent =
      `Found ${haDevices.length} controllable device(s) and ${discovered.length} on the network.`;

    list.innerHTML = "";
    if (haDevices.length) {
      list.insertAdjacentHTML("beforeend",
        `<div class="card-title" style="margin-top:8px">Ready to assign</div>`);
      haDevices.forEach((d) => list.appendChild(assignRow(d)));
    }
    if (discovered.length) {
      list.insertAdjacentHTML("beforeend",
        `<div class="card-title" style="margin-top:16px">Seen on network</div>`);
      discovered.forEach((d) => {
        const row = document.createElement("div");
        row.className = "disco-row";
        row.innerHTML =
          `<span>${d.name} <span class="badge">${d.ip}</span></span>
           <span class="badge">${d.vendor}${d.vendor ? " · " : ""}link in Setup</span>`;
        list.appendChild(row);
      });
    }
    if (!haDevices.length && !discovered.length) {
      list.innerHTML = `<div class="muted">Nothing new found. Link the brand
        account in Setup, then re-scan.</div>`;
    }
  }

  // a row with a room <select> to assign an HA entity
  function assignRow(d) {
    const row = document.createElement("div");
    row.className = "disco-row";
    row.innerHTML = `<span>${d.name}</span>`;
    const sel = roomSelect(d.room);
    sel.addEventListener("change", () => Rooms.assign(d.entity_id, sel.value || null));
    row.appendChild(sel);
    return row;
  }

  function roomSelect(current) {
    const sel = document.createElement("select");
    sel.className = "room-select";
    sel.innerHTML =
      `<option value="">Unassigned</option>` +
      Rooms.data.rooms.map(
        (r) => `<option ${r === current ? "selected" : ""}>${r}</option>`
      ).join("");
    return sel;
  }
  Rooms.roomSelect = roomSelect;

  // ---- "Manage rooms" flow ----------------------------------------------
  Rooms.showManageRooms = function () {
    const rows = Rooms.data.rooms.map(
      (r) => `<div class="disco-row"><span>${r}</span>
        <button class="pill ghost room-del" data-room="${r}">Remove</button></div>`
    ).join("");
    openModal(`
      <h1 style="margin-bottom:16px">Rooms</h1>
      <div class="disco-list" id="room-list">${rows}</div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <input id="new-room" class="text-input" placeholder="New room name" />
        <button class="pill" id="add-room-btn">Add room</button>
      </div>
    `);
    document.getElementById("add-room-btn").addEventListener("click", async () => {
      const name = document.getElementById("new-room").value.trim();
      if (!name) return;
      Rooms.data = await post("/api/rooms/create", { name });
      emit();
      Rooms.showManageRooms();
    });
    modalBody().querySelectorAll(".room-del").forEach((b) =>
      b.addEventListener("click", async () => {
        Rooms.data = await post("/api/rooms/delete", { name: b.dataset.room });
        emit();
        Rooms.showManageRooms();
      })
    );
  };

  window.Rooms = Rooms;
})();
