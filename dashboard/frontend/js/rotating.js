/* =========================================================================
   rotating.js — the rotating information panel.
   Cycles through, each fading over ~0.8s and holding for ROTATE_SECONDS (10s):
     1. "Next 7 Days"          tide table
     2. "Tides"                chart + next tides + rising/falling summary
     3. "Solunars & Sun/Moon"  moon phase, solunar windows, sun times
     4. X feed                 latest @SurfnWeatherman posts (tap -> x.com)
   Tapping any tide/solunar panel opens the Jupiter Inlet MONTH view (modal).
   ========================================================================= */
(function () {
  let cfg = { rotate_seconds: 10, x_account: "", tides_enabled: false, tides_month_url: "" };
  let data = null;
  let celestial = [];   // curated upcoming celestial event slides
  let wx = null;        // weather / conditions / pollen
  let idx = 0;
  let timer = null;
  const panels = []; // {el, kind}

  const $ = (s, r = document) => r.querySelector(s);

  async function init(config) {
    cfg = Object.assign(cfg, config);
    await load();
    build();
    start();
    // refresh tide data every 15 min
    setInterval(load, 15 * 60 * 1000);
  }

  async function load() {
    try {
      const r = await fetch("/api/displays");
      if (r.ok) { data = await r.json(); }
    } catch (e) { console.warn("displays load failed", e); }
    try {
      const c = await fetch("/api/celestial");
      if (c.ok) { celestial = (await c.json()).slides || []; }
    } catch (e) { console.warn("celestial load failed", e); }
    try {
      const w = await fetch("/api/weather");
      if (w.ok) { const j = await w.json(); wx = j.enabled ? j : null; }
    } catch (e) { console.warn("weather load failed", e); }
    build();
  }

  const WICON = (code) => {
    if (code === 0 || code === 1) return "☀";
    if (code === 2) return "⛅";
    if (code === 3) return "☁";
    if ([45, 48].includes(code)) return "🌫";
    if (code >= 51 && code <= 67) return "🌧";
    if (code >= 71 && code <= 77) return "❄";
    if (code >= 80 && code <= 82) return "🌦";
    if (code >= 95) return "⛈";
    return "☁";
  };

  const DOW = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });

  // Current conditions panel
  function panelWeather(w) {
    const c = w.current || {};
    const fc = (w.forecast || []).slice(0, 5).map((d) =>
      `<div class="wx-day"><span>${DOW(d.date)}</span>
        <span class="wx-ic">${WICON(d.code)}</span>
        <span class="wx-hl">${d.hi}°<span class="muted">/${d.lo}°</span></span></div>`
    ).join("");
    return `
      <div class="rot-title">Current Conditions</div>
      <div class="rot-sub">${c.summary || ""}</div>
      <div class="wx-now">
        <div class="wx-big">${WICON(c.code)} ${c.temp}°</div>
        <div class="wx-grid">
          <div><span class="muted">Feels</span> ${c.feels_like}°</div>
          <div><span class="muted">Humidity</span> ${c.humidity}%</div>
          <div><span class="muted">Wind</span> ${c.wind} mph</div>
          <div><span class="muted">UV</span> ${c.uv}</div>
          <div><span class="muted">Pressure</span> ${c.pressure} hPa</div>
          <div><span class="muted">Rain</span> ${c.precip ?? 0} in</div>
        </div>
      </div>
      <div class="wx-forecast">${fc}</div>`;
  }

  // Pollen panel (from the "Current conditions" reference)
  function panelPollen(w) {
    const p = w.pollen || {};
    const row = (name, v, thresh) => {
      const val = v == null ? "n/a" : Math.round(v);
      const lvl = v == null ? "" : v > thresh ? "high" : v > thresh / 2 ? "med" : "low";
      return `<div class="pollen-row"><span>${name}</span>
        <span class="pollen-bar ${lvl}"></span>
        <span class="pollen-val">${val}</span></div>`;
    };
    return `
      <div class="rot-title">Pollen Levels</div>
      <div class="rot-sub">grains/m³ · tap for radar</div>
      <div class="pollen">
        ${row("Grass", p.grass, 18)}
        ${row("Ragweed", p.ragweed, 45)}
        ${row("Tree", p.tree, 75)}
        ${row("Mold", p.mold, 6500)}
      </div>`;
  }

  // Radar panel — Windy embed centered on the user's coordinates
  function panelRadar(w) {
    const { lat, lon } = w.coords || {};
    return `
      <div class="radar-panel">
        <iframe class="radar-frame" loading="lazy"
          src="https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=7&level=surface&overlay=radar&menu=&message=&marker=&calendar=&pressure=&type=map&location=coordinates&detail=&metricWind=mph&metricTemp=%C2%B0F&radarRange=-1"></iframe>
        <div class="radar-cap">Weather Radar</div>
      </div>`;
  }

  // ---- celestial event slide (hero image + where/when to view) ----------
  function panelCelestial(ev) {
    const cat = ev.category || "meteor";
    const hero = ev.image_url
      ? `<img class="cel-img" src="${ev.image_url}" alt=""
           onerror="this.style.display='none'">`
      : "";
    return `
      <div class="celestial-panel cat-${cat}">
        <div class="cel-hero">${hero}</div>
        <div class="cel-body">
          <div class="cel-date">${ev.dates_label || ""}</div>
          <div class="rot-title">${ev.name}</div>
          <div class="cel-where">📍 ${ev.where || ""}</div>
          <div class="cel-meta">${ev.rate || ""}${ev.best_time ? " · Best: " + ev.best_time : ""}</div>
          <div class="cel-desc">${ev.description || ""}</div>
          ${ev.credit ? `<div class="cel-credit">${ev.credit}</div>` : ""}
        </div>
      </div>`;
  }

  function openCelestialDetail(ev) {
    const body = $("#modal-body");
    const cat = ev.category || "meteor";
    const hero = ev.image_url
      ? `<img src="${ev.image_url}" alt="" style="width:100%;height:100%;object-fit:cover"
           onerror="this.style.display='none'">` : "";
    body.innerHTML = `
      <div class="cel-detail cat-${cat}">
        <div class="cel-detail-hero">${hero}</div>
        <div class="cel-detail-text">
          <div class="cel-date">${ev.dates_label || ""}</div>
          <h1>${ev.name}</h1>
          <p class="cel-where">📍 ${ev.where || ""}</p>
          <p class="muted">${ev.rate || ""}${ev.best_time ? " · Best viewing: " + ev.best_time : ""}${ev.constellation ? " · Radiant: " + ev.constellation : ""}</p>
          <p style="margin-top:14px;line-height:1.6">${ev.description || ""}</p>
          ${ev.credit ? `<p class="cel-credit">${ev.credit}</p>` : ""}
        </div>
      </div>`;
    $("#modal").hidden = false;
  }

  // Always-available panel so the rotator is never empty on a fresh install.
  function panelWelcome() {
    return `
      <div class="rot-title">At a glance</div>
      <div class="rot-sub">Your home dashboard</div>
      <div class="welcome-panel">
        <div class="welcome-clock" id="rot-clock">--:--</div>
        <div class="welcome-date" id="rot-date"></div>
        <div class="muted" style="margin-top:14px">
          Add tide, weather or an X feed to this panel in <b>Setup → Info</b>.
        </div>
      </div>`;
  }

  // ---- panel builders ----------------------------------------------------
  function panelNext7(d) {
    const rows = (d || []).map((day) => {
      const tides = day.tides
        .filter((t) => t.time)
        .map(
          (t) =>
            `<span class="${t.type === "high" ? "t-high" : "t-low"}">${
              t.time
            } ${t.height_ft ? t.height_ft + "ft" : ""}</span>`
        )
        .join(" · ");
      return `<tr><td><b>${day.day}</b></td><td>${day.moon || ""}</td><td>${tides}</td></tr>`;
    }).join("");
    return `
      <div class="rot-title">Next 7 Days</div>
      <div class="rot-sub">Hobe Sound · Jupiter Island — tap for month view</div>
      <table class="tide-table">
        <tr><th>Day</th><th>Moon</th><th>Tides</th></tr>${rows}
      </table>`;
  }

  function panelTides(t) {
    const next = (t.next_tides || []).map(
      (n) => `<div class="row"><span>${n.day} ${n.time}</span>
        <span class="${n.type === "high" ? "t-high" : "t-low"}">${
        n.type || ""
      } ${n.height_ft ? n.height_ft + " ft" : ""}</span></div>`
    ).join("");
    return `
      <div class="rot-title">Tides</div>
      <div class="rot-sub">Jupiter Inlet — tap for month view</div>
      ${tideChartSVG(t.next_tides || [])}
      <div class="tide-next">${next}</div>
      <div class="tide-summary">${t.summary || ""}</div>`;
  }

  // A lightweight inline SVG tide curve from the next high/low heights.
  function tideChartSVG(nextTides) {
    const pts = nextTides
      .map((n) => parseFloat(n.height_ft))
      .filter((v) => !isNaN(v));
    if (pts.length < 2) return `<div class="tide-chart"></div>`;
    const w = 520, h = 150, pad = 14;
    const max = Math.max(...pts), min = Math.min(...pts);
    const rng = max - min || 1;
    const step = (w - pad * 2) / (pts.length - 1);
    const coords = pts.map((v, i) => [
      pad + i * step,
      h - pad - ((v - min) / rng) * (h - pad * 2),
    ]);
    // smooth path
    let d = `M ${coords[0][0]},${coords[0][1]}`;
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1], [x1, y1] = coords[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    const area = d + ` L ${coords[coords.length - 1][0]},${h} L ${coords[0][0]},${h} Z`;
    return `
      <svg class="tide-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#4aa8ff" stop-opacity=".45"/>
          <stop offset="1" stop-color="#4aa8ff" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#tg)"/>
        <path d="${d}" fill="none" stroke="#4aa8ff" stroke-width="2.5"/>
        ${coords.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#cfe6ff"/>`).join("")}
      </svg>`;
  }

  function panelSolunar(s) {
    return `
      <div class="rot-title">Solunars &amp; Sun / Moon Times</div>
      <div class="rot-sub">Jupiter Inlet — tap for month view</div>
      <div class="moon-big"><div class="moon-orb"></div>
        <div><div class="k muted">Moon</div><div class="v" style="font-size:26px">${
          s.moon || "—"
        }</div></div></div>
      <div class="solunar-grid">
        <div class="solunar-cell"><div class="k">Major Solunar</div><div class="v">${
          s.major_solunar || "—"
        }</div></div>
        <div class="solunar-cell"><div class="k">Minor Solunar</div><div class="v">${
          s.minor_solunar || "—"
        }</div></div>
        <div class="solunar-cell"><div class="k">Sunrise</div><div class="v">${
          s.sunrise || "—"
        }</div></div>
        <div class="solunar-cell"><div class="k">Sunset</div><div class="v">${
          s.sunset || "—"
        }</div></div>
      </div>`;
  }

  function panelX() {
    const acct = cfg.x_account;
    // Embedded timeline; the whole panel is tappable and links to the profile.
    return `
      <div class="xfeed">
        <div class="rot-title">@${acct}</div>
        <div class="rot-sub">Latest posts — tap to open on X</div>
        <div class="xfeed-scroll">
          <iframe title="X feed" loading="lazy"
            src="https://syndication.twitter.com/srv/timeline-profile/screen-name/${acct}?theme=dark&chrome=noheader%20nofooter%20transparent"></iframe>
        </div>
        <div class="xfeed-cta">Open x.com/${acct} →</div>
      </div>`;
  }

  // ---- assemble + cycle --------------------------------------------------
  function build() {
    const track = $("#rotator-track");
    const dots = $("#rotator-dots");
    if (!track) return;
    track.innerHTML = "";
    dots.innerHTML = "";
    panels.length = 0;

    // Build the panel set dynamically from what the user has configured.
    const defs = [];
    // Weather / radar / pollen
    if (wx) {
      defs.push({ kind: "weather", html: panelWeather(wx) });
      defs.push({ kind: "radar", html: panelRadar(wx) });
      defs.push({ kind: "pollen", html: panelPollen(wx) });
    }
    // Celestial events lead the rotation in the weeks before their peak.
    celestial.forEach((ev) =>
      defs.push({ kind: "celestial", html: panelCelestial(ev), ev })
    );
    if (data && data.enabled) {
      defs.push({ kind: "tides", html: panelNext7(data.display1_next7days) });
      defs.push({ kind: "tides", html: panelTides(data.display2_tides || {}) });
      defs.push({ kind: "tides", html: panelSolunar(data.display3_solunar || {}) });
    }
    if (cfg.x_account) defs.push({ kind: "x", html: panelX() });
    if (!defs.length) defs.push({ kind: "welcome", html: panelWelcome() });

    defs.forEach((def, i) => {
      const p = document.createElement("div");
      p.className = "rot-panel" + (i === 0 ? " show" : "");
      p.innerHTML = def.html;
      p.addEventListener("click", () => onTap(def));
      track.appendChild(p);
      panels.push({ el: p, kind: def.kind });

      const dot = document.createElement("span");
      if (i === 0) dot.className = "on";
      dots.appendChild(dot);
    });
    idx = 0;
  }

  function show(i) {
    panels.forEach((p, k) => p.el.classList.toggle("show", k === i));
    const dots = $("#rotator-dots").children;
    for (let k = 0; k < dots.length; k++) dots[k].classList.toggle("on", k === i);
    idx = i;
  }

  function start() {
    stop();
    timer = setInterval(() => show((idx + 1) % panels.length),
      (cfg.rotate_seconds || 10) * 1000);
  }
  function stop() { if (timer) clearInterval(timer); }

  function onTap(def) {
    if (def.kind === "x") {
      window.open(`https://x.com/${cfg.x_account}`, "_blank");
    } else if (def.kind === "tides") {
      openMonth();
    } else if (def.kind === "celestial") {
      openCelestialDetail(def.ev);
    } else if (["weather", "radar", "pollen"].includes(def.kind)) {
      openRadar();
    }
  }

  function openRadar() {
    if (!wx || !wx.coords) return;
    const { lat, lon } = wx.coords;
    $("#modal-body").innerHTML =
      `<iframe style="width:100%;height:100%;border:0;border-radius:12px"
        src="https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=8&overlay=radar&metricWind=mph&metricTemp=%C2%B0F&type=map"></iframe>`;
    $("#modal").hidden = false;
  }

  // ---- month drill-down modal -------------------------------------------
  async function openMonth() {
    const body = $("#modal-body");
    body.innerHTML = `<h1 style="margin-bottom:12px">Loading month view…</h1>`;
    $("#modal").hidden = false;
    try {
      const r = await fetch("/api/displays/month");
      const m = await r.json();
      const rows = (m.rows || [])
        .map((row) => `<tr>${row.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("");
      body.innerHTML = `
        <h1 style="margin-bottom:6px">${m.title || "Month"}</h1>
        <div class="muted" style="margin-bottom:16px">Tap a row on x.com for detail · source: ${m.source || ""}</div>
        <table class="month-table">${rows}</table>`;
    } catch (e) {
      body.innerHTML = `<h1>Month view unavailable</h1><p class="muted">${e}</p>`;
    }
  }

  window.Rotating = { init, openMonth, stop, start };
})();
