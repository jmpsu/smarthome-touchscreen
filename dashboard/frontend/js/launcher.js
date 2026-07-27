/* =========================================================================
   launcher.js — the landing page: grouped app/tool tiles + reminders widget.
   Tiles come from /api/apps (user-editable). A tile either switches to an
   internal screen ("screen:lights") or opens an external tool ("url:https://…"),
   mirroring the reference dashboard's grouped launcher.
   ========================================================================= */
(function () {
  async function loadApps() {
    let data;
    try {
      data = await (await fetch("/api/apps")).json();
    } catch (e) {
      data = { groups: [] };
    }
    renderApps(data);
  }

  function renderApps(data) {
    const host = document.getElementById("launch-apps");
    if (!host) return;
    host.innerHTML = "";
    (data.groups || []).forEach((group) => {
      const col = document.createElement("div");
      col.className = "app-group";
      col.innerHTML = `<div class="app-group-title">${group.name}</div>`;
      const list = document.createElement("div");
      list.className = "app-list";
      (group.tiles || []).forEach((t) => list.appendChild(tile(t)));
      col.appendChild(list);
      host.appendChild(col);
    });
  }

  function tile(t) {
    const el = document.createElement("button");
    el.className = "app-tile";
    el.innerHTML = `
      <span class="app-ic">${t.icon || "▣"}</span>
      <span class="app-meta">
        <span class="app-name">${t.name}</span>
        <span class="app-desc">${t.desc || ""}</span>
      </span>
      <span class="app-dot" title="online"></span>`;
    el.addEventListener("click", () => runAction(t.action));
    return el;
  }

  function runAction(action) {
    if (!action) return;
    if (action.startsWith("screen:")) {
      const s = action.slice(7);
      if (window.App) App.showScreen(s);
    } else if (action.startsWith("url:")) {
      window.open(action.slice(4), "_blank");
    }
  }

  // ---- mini calendar + reminders (reminders stored per-device) ----------
  let celestialCal = [];   // [{date:'YYYY-MM-DD', name, category}]

  async function loadCelestial() {
    try {
      const d = await (await fetch("/api/celestial")).json();
      celestialCal = d.calendar || [];
      renderSky(d.slides || []);
    } catch (e) { /* offline: skip */ }
    renderCalendar();
  }

  function renderSky(slides) {
    const host = document.getElementById("reminders");
    if (!host) return;
    host.parentElement.querySelectorAll(".sky-line").forEach((n) => n.remove());
    if (!slides.length) return;
    const next = slides[0];
    // prepend a "sky tonight" line above reminders
    const line = document.createElement("div");
    line.className = "sky-line";
    line.innerHTML = `<span class="sky-ic">✦</span>
      <span><b>${next.name}</b><br><span class="muted">${next.dates_label} · ${next.where}</span></span>`;
    host.parentElement.insertBefore(line, host);
  }

  function renderCalendar() {
    const host = document.getElementById("mini-cal");
    if (!host) return;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const month = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    // set of day-numbers this month with a celestial peak
    const marks = new Set(
      celestialCal
        .map((c) => new Date(c.date + "T00:00:00"))
        .filter((d) => d.getFullYear() === y && d.getMonth() === m)
        .map((d) => d.getDate())
    );
    let cells = ["S", "M", "T", "W", "T", "F", "S"]
      .map((d) => `<span class="cal-dow">${d}</span>`).join("");
    for (let i = 0; i < first; i++) cells += `<span></span>`;
    for (let d = 1; d <= days; d++) {
      const today = d === now.getDate();
      const sky = marks.has(d);
      cells += `<span class="cal-day ${today ? "today" : ""} ${sky ? "sky" : ""}"
        title="${sky ? "Celestial event" : ""}">${d}</span>`;
    }
    host.innerHTML = `<div class="cal-month">${month}</div><div class="cal-grid">${cells}</div>`;
  }

  const REM_KEY = "smarthome_reminders";
  function getReminders() {
    try { return JSON.parse(localStorage.getItem(REM_KEY) || "[]"); }
    catch { return []; }
  }
  function saveReminders(r) { localStorage.setItem(REM_KEY, JSON.stringify(r)); }

  function renderReminders() {
    const host = document.getElementById("reminders");
    if (!host) return;
    const items = getReminders();
    host.innerHTML =
      items.map((r, i) =>
        `<div class="reminder"><span>${r.text}</span>
          <button class="rem-del" data-i="${i}">✕</button></div>`
      ).join("") +
      `<button class="rem-add" id="rem-add">＋ Add reminder</button>`;
    host.querySelectorAll(".rem-del").forEach((b) =>
      b.addEventListener("click", () => {
        const arr = getReminders(); arr.splice(+b.dataset.i, 1);
        saveReminders(arr); renderReminders();
      })
    );
    document.getElementById("rem-add").addEventListener("click", () => {
      const text = prompt("Reminder:");
      if (text) { const arr = getReminders(); arr.push({ text }); saveReminders(arr); renderReminders(); }
    });
  }

  window.Launcher = {
    load() { loadApps(); renderCalendar(); renderReminders(); loadCelestial(); },
  };
})();
