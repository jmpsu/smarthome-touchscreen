/* =========================================================================
   app.js — boots the dashboard: nav, EST clock, screen switching, wiring.
   ========================================================================= */
(function () {
  let CONFIG = { timezone: "America/New_York" };

  // ---- screen navigation -------------------------------------------------
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) =>
      s.classList.toggle("active", s.id === `screen-${name}`)
    );
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.screen === name)
    );
    if (name === "settings") Settings.load();
    if (name === "displays") renderFullDisplays();
    if (name === "launcher" && window.Launcher) Launcher.load();
    if (name === "home-map" && window.Floorplan) Floorplan.load();
    if (name === "music" && window.Media) Media.render();
    if (name === "weather" && window.Weather) Weather.render();
    if (name === "sky" && window.Sky) Sky.render();
  }
  // expose so launcher tiles / floorplan can navigate
  window.App = { showScreen };

  document.querySelectorAll(".nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => showScreen(btn.dataset.screen))
  );

  // ---- EST clock ---------------------------------------------------------
  function tick() {
    const now = new Date();
    const tz = CONFIG.timezone || "America/New_York";
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(now);
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric",
    }).format(now);
    const zone = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "short",
    }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "EST";

    setText("clock-time", time);
    setText("clock-zone", zone);
    setText("home-date", date);
    setText("home-greeting", greeting(now, tz));
    // feed the rotator's welcome panel if it's showing
    setText("rot-clock", time);
    setText("rot-date", date);
  }
  function greeting(now, tz) {
    const h = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now);
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  // ---- full-size versions of the 3 info displays ------------------------
  async function renderFullDisplays() {
    const host = document.getElementById("displays-full");
    host.innerHTML = `<div class="empty">Loading tide &amp; sun data…</div>`;
    try {
      const d = await (await fetch("/api/displays")).json();
      if (!d.enabled) {
        host.innerHTML = `<div class="empty">No tide location set yet.<br><br>
          Add a coastal location in <b>Setup → Info</b> to see the Next 7 Days,
          Tides, and Solunar panels here and in the rotating home panel.</div>`;
        return;
      }
      host.innerHTML = `
        <div class="settings-grid" style="height:calc(100% - 0px)">
          <div class="card" id="fd1"></div>
          <div class="card" id="fd2"></div>
          <div class="card" id="fd3"></div>
        </div>`;
      // reuse the rotator's renderers by faking mini-panels
      document.getElementById("fd1").innerHTML = miniNext7(d.display1_next7days);
      document.getElementById("fd2").innerHTML = miniTides(d.display2_tides || {});
      document.getElementById("fd3").innerHTML = miniSolunar(d.display3_solunar || {});
      host.querySelectorAll(".card").forEach((c) =>
        c.addEventListener("click", () => Rotating.openMonth())
      );
    } catch (e) {
      host.innerHTML = `<div class="empty">Tide data unavailable right now.</div>`;
    }
  }
  const miniNext7 = (days) =>
    `<div class="card-title">Next 7 Days</div>` +
    `<table class="tide-table"><tr><th>Day</th><th>Moon</th><th>Tides</th></tr>` +
    (days || []).map((day) =>
      `<tr><td><b>${day.day}</b></td><td>${day.moon || ""}</td><td>` +
      day.tides.filter((t) => t.time).map((t) =>
        `<span class="${t.type === "high" ? "t-high" : "t-low"}">${t.time}</span>`
      ).join(" · ") + `</td></tr>`
    ).join("") + `</table>`;
  const miniTides = (t) =>
    `<div class="card-title">Tides</div>` +
    (t.next_tides || []).map((n) =>
      `<div class="tide-next"><div class="row"><span>${n.day} ${n.time}</span>` +
      `<span class="${n.type === "high" ? "t-high" : "t-low"}">${n.type} ${n.height_ft} ft</span></div></div>`
    ).join("") + `<div class="tide-summary">${t.summary || ""}</div>`;
  const miniSolunar = (s) =>
    `<div class="card-title">Solunars &amp; Sun / Moon</div>` +
    `<div class="moon-big"><div class="moon-orb"></div><div class="v" style="font-size:24px">${s.moon || "—"}</div></div>` +
    `<div class="solunar-grid" style="margin-top:16px">
       <div class="solunar-cell"><div class="k">Major</div><div class="v">${s.major_solunar || "—"}</div></div>
       <div class="solunar-cell"><div class="k">Minor</div><div class="v">${s.minor_solunar || "—"}</div></div>
       <div class="solunar-cell"><div class="k">Sunrise</div><div class="v">${s.sunrise || "—"}</div></div>
       <div class="solunar-cell"><div class="k">Sunset</div><div class="v">${s.sunset || "—"}</div></div>
     </div>`;

  // ---- modal close -------------------------------------------------------
  document.getElementById("modal-close").addEventListener("click", () =>
    (document.getElementById("modal").hidden = true)
  );
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") document.getElementById("modal").hidden = true;
  });
  document.getElementById("open-month")?.addEventListener("click", () => Rotating.openMonth());

  // ---- boot --------------------------------------------------------------
  async function boot() {
    try {
      CONFIG = await (await fetch("/api/config")).json();
    } catch (e) { console.warn("config load failed", e); }

    tick();
    setInterval(tick, 1000);

    Rotating.init(CONFIG);
    if (window.Launcher) Launcher.load();
    // In demo mode there's no live HA websocket — poll the mock fleet instead.
    if (CONFIG.demo_mode) HA.usePolling(1500);
    else HA.connect();

    // keep the kiosk awake — nudge the browser so the screen never blanks
    setInterval(() => window.scrollTo(0, 0), 30000);
  }

  boot();
})();
