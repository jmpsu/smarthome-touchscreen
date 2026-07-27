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
  let cfg = { rotate_seconds: 10, x_account: "SurfnWeatherman", tides_month_url: "" };
  let data = null;
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
      if (r.ok) { data = await r.json(); build(); }
    } catch (e) { console.warn("displays load failed", e); }
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
    if (!data) return;
    const track = $("#rotator-track");
    const dots = $("#rotator-dots");
    track.innerHTML = "";
    dots.innerHTML = "";
    panels.length = 0;

    const defs = [
      { kind: "tides", html: panelNext7(data.display1_next7days) },
      { kind: "tides", html: panelTides(data.display2_tides || {}) },
      { kind: "tides", html: panelSolunar(data.display3_solunar || {}) },
      { kind: "x", html: panelX() },
    ];

    defs.forEach((def, i) => {
      const p = document.createElement("div");
      p.className = "rot-panel" + (i === 0 ? " show" : "");
      p.innerHTML = def.html;
      p.addEventListener("click", () => onTap(def.kind));
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

  function onTap(kind) {
    if (kind === "x") {
      window.open(`https://x.com/${cfg.x_account}`, "_blank");
    } else {
      openMonth();
    }
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
