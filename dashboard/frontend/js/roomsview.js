/* =========================================================================
   roomsview.js — the Rooms screen: one card per room with live counts and
   whole-room control.

   Rooms come from the user's own assignments (rooms.js) falling back to the
   Home Assistant area, so this screen reflects however the house is actually
   organised rather than a fixed list. Everything acts on real entities via
   HA.call; there is no local mirror of state to drift out of sync — the card
   re-renders from HA on every state event.
   ========================================================================= */
(function () {
  const nameOf = (e) =>
    (e.attributes && e.attributes.friendly_name) || e.entity_id.split(".")[1];

  function roomsWithLights() {
    const lights = window.HA ? HA.lights() : [];
    const map = new Map();
    lights.forEach((e) => {
      const room = window.Rooms ? Rooms.roomOf(e) : "Unassigned";
      if (!map.has(room)) map.set(room, []);
      map.get(room).push(e);
    });
    // Declared rooms with nothing assigned still deserve a card, so the user
    // can see the room exists and is simply empty.
    (window.Rooms && Rooms.data && Rooms.data.rooms ? Rooms.data.rooms : [])
      .forEach((r) => { if (!map.has(r)) map.set(r, []); });

    return [...map.entries()]
      .sort((a, b) => {
        // Unassigned sinks to the bottom; everything else alphabetical.
        if (a[0] === "Unassigned") return 1;
        if (b[0] === "Unassigned") return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([room, lights]) => ({
        room,
        lights: lights.sort((x, y) => nameOf(x).localeCompare(nameOf(y))),
      }));
  }

  function card({ room, lights }) {
    const on = lights.filter((e) => e.state === "on");
    const el = document.createElement("div");
    el.className = "room-card" + (on.length ? " lit" : "");

    const rows = lights.map((e) => `
      <button class="room-light${e.state === "on" ? " on" : ""}"
              data-entity="${e.entity_id}">
        <span class="rl-dot"></span>
        <span class="rl-name">${nameOf(e)}</span>
      </button>`).join("");

    el.innerHTML = `
      <div class="room-card-head">
        <div>
          <div class="room-name">${room}</div>
          <div class="muted">${
            lights.length
              ? `${on.length} of ${lights.length} on`
              : "No lights assigned"}</div>
        </div>
        ${lights.length ? `
          <div class="room-acts">
            <button class="pill ghost" data-room-off>Off</button>
            <button class="pill" data-room-on>On</button>
          </div>` : ""}
      </div>
      <div class="room-lights">${rows}</div>`;

    const ids = lights.map((e) => e.entity_id);
    el.querySelector("[data-room-on]")?.addEventListener("click", () =>
      HA.call("light", "turn_on", { entity_id: ids }));
    el.querySelector("[data-room-off]")?.addEventListener("click", () =>
      HA.call("light", "turn_off", { entity_id: ids }));
    el.querySelectorAll("[data-entity]").forEach((b) =>
      b.addEventListener("click", () =>
        HA.call("light", "toggle", { entity_id: b.dataset.entity })));

    return el;
  }

  async function render() {
    const host = document.getElementById("rooms-body");
    if (!host) return;
    // Assignments drive the grouping, so make sure they are loaded before the
    // first paint rather than briefly showing everything as Unassigned.
    if (window.Rooms && !(Rooms.data.rooms || []).length) await Rooms.load();
    const groups = roomsWithLights();
    host.innerHTML = "";
    if (!groups.length) {
      host.innerHTML = `<div class="card"><p class="muted">
        No lights found yet. Once Home Assistant reports devices they appear here,
        grouped by room.</p></div>`;
      return;
    }
    const grid = document.createElement("div");
    grid.className = "room-grid";
    groups.forEach((g) => grid.appendChild(card(g)));
    host.appendChild(grid);
  }

  // Re-render on live state so counts and dots track the real lights.
  if (window.HA) HA.onState(() => {
    if (document.getElementById("screen-rooms")?.classList.contains("active")) render();
  });
  if (window.Rooms) Rooms.onChange(() => {
    if (document.getElementById("screen-rooms")?.classList.contains("active")) render();
  });

  document.getElementById("rooms-manage")?.addEventListener("click", () =>
    window.Rooms && Rooms.showManageRooms());

  window.RoomsView = { render };
})();
