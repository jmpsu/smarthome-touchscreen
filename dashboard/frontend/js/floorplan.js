/* =========================================================================
   floorplan.js — top-down home map (data-driven, sleek/transparent).
   Renders rooms from /api/floorplan on a CSS grid. Tapping a room drills into
   a detail view of the lights/devices assigned to that room, with full touch
   controls. The layout is user-editable (Edit layout → JSON) and rooms map to
   the same room assignments used everywhere else, so it stays consistent.
   ========================================================================= */
(function () {
  let plan = null;

  async function load() {
    try {
      plan = await (await fetch("/api/floorplan")).json();
    } catch (e) {
      console.warn("floorplan load failed", e);
      plan = { grid: { cols: 12, rows: 6 }, rooms: [] };
    }
    render();
  }

  // count lights on / total for a room using HA state + room assignments
  function roomStats(roomName) {
    if (!window.HA || !window.Rooms) return { on: 0, total: 0 };
    const lights = HA.lights().filter((e) => Rooms.roomOf(e) === roomName);
    return { on: lights.filter((e) => e.state === "on").length, total: lights.length };
  }

  function render() {
    const host = document.getElementById("floorplan");
    if (!host || !plan) return;
    const { cols, rows } = plan.grid || { cols: 12, rows: 6 };
    host.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    host.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    host.innerHTML = "";

    (plan.rooms || []).forEach((r) => {
      const cell = document.createElement("button");
      cell.className = "fp-room";
      cell.style.gridColumn = `${r.col} / span ${r.w}`;
      cell.style.gridRow = `${r.row} / span ${r.h}`;
      const st = roomStats(r.name);
      cell.innerHTML = `
        <span class="fp-name">${r.name}</span>
        ${st.total ? `<span class="fp-stat ${st.on ? "on" : ""}">${st.on}/${st.total} on</span>` : ""}`;
      if (st.on) cell.classList.add("lit");
      cell.addEventListener("click", () => openRoom(r.name));
      host.appendChild(cell);
    });
  }

  // room detail: the lights assigned to that room, full touch controls
  function openRoom(roomName) {
    const body = document.getElementById("modal-body");
    body.innerHTML = `
      <div class="room-detail-head">
        <h1>${roomName}</h1>
        <button class="pill ghost" id="rd-assign">Assign devices</button>
      </div>
      <div class="light-grid" id="room-detail-grid"></div>
      <div class="empty" id="room-detail-empty" hidden>
        No devices assigned to ${roomName} yet. Tap “Assign devices”.
      </div>`;
    document.getElementById("modal").hidden = false;
    if (window.Lights) Lights.renderRoom(roomName, document.getElementById("room-detail-grid"),
                                         document.getElementById("room-detail-empty"));
    document.getElementById("rd-assign").addEventListener("click", () => {
      if (window.Rooms) Rooms.showAddDevice();
    });
  }

  // simple layout editor (power users): edit the floorplan JSON
  function editLayout() {
    const body = document.getElementById("modal-body");
    body.innerHTML = `
      <h1 style="margin-bottom:8px">Edit floor plan</h1>
      <div class="muted" style="margin-bottom:12px">
        Grid is ${plan.grid.cols}×${plan.grid.rows}. Each room has col, row, w, h.
        Rename rooms to match the names you assign lights to.
      </div>
      <textarea id="fp-json" class="fp-editor">${JSON.stringify(plan, null, 2)}</textarea>
      <div style="margin-top:12px;display:flex;gap:10px">
        <button class="pill" id="fp-save">Save</button>
        <button class="pill ghost" id="fp-cancel">Cancel</button>
      </div>
      <div id="fp-err" class="muted" style="margin-top:8px;color:var(--bad)"></div>`;
    document.getElementById("modal").hidden = false;
    document.getElementById("fp-cancel").addEventListener("click", () =>
      (document.getElementById("modal").hidden = true));
    document.getElementById("fp-save").addEventListener("click", async () => {
      try {
        const next = JSON.parse(document.getElementById("fp-json").value);
        await fetch("/api/floorplan", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        plan = next;
        document.getElementById("modal").hidden = true;
        render();
      } catch (e) {
        document.getElementById("fp-err").textContent = "Invalid JSON: " + e.message;
      }
    });
  }

  document.getElementById("edit-floorplan")?.addEventListener("click", editLayout);

  // re-render stats live as lights change
  if (window.HA) HA.onState(render);
  if (window.Rooms) Rooms.onChange(render);

  window.Floorplan = { load, render, openRoom };
})();
