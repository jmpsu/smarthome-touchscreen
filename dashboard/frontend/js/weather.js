/* =========================================================================
   weather.js — full Weather screen: current conditions + 7-day forecast.

   Data is Open-Meteo via /api/weather (no API key, no third party in the
   browser). When the feed is unreachable the screen says so plainly instead
   of rendering an empty box, so a network problem never looks like a
   working-but-blank panel.
   ========================================================================= */
(function () {
  const ICON = (code) => {
    if ([0, 1].includes(code)) return "☀";
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

  function problem(host, message) {
    host.innerHTML = `
      <div class="card">
        <div class="card-title">Weather unavailable</div>
        <p class="muted">${message}</p>
        <button class="pill ghost" id="weather-retry">Try again</button>
      </div>`;
    document.getElementById("weather-retry")
      ?.addEventListener("click", () => render());
  }

  async function render() {
    const host = document.getElementById("weather-body");
    if (!host) return;
    host.innerHTML = `<div class="muted">Loading…</div>`;

    let w;
    try {
      w = await (await fetch("/api/weather")).json();
    } catch (e) {
      return problem(host, "Could not reach the panel backend.");
    }

    if (!w.enabled) {
      return problem(host,
        "Set LATITUDE and LONGITUDE in the panel configuration to enable weather.");
    }
    if (w.error || !w.current) {
      return problem(host, `The forecast service did not answer (${w.error || "no data"}).`);
    }

    const c = w.current;
    const place = document.getElementById("weather-place");
    if (place) place.textContent = w.place || "";

    const days = (w.forecast || []).map((d) => `
      <div class="wx-day">
        <div class="wx-dow">${DOW(d.date)}</div>
        <div class="wx-ic">${ICON(d.code)}</div>
        <div class="wx-hi">${d.hi}°</div>
        <div class="wx-lo muted">${d.lo}°</div>
      </div>`).join("");

    const detail = (label, value) =>
      value === undefined || value === null || value === ""
        ? "" : `<div class="wx-detail"><span class="muted">${label}</span><b>${value}</b></div>`;

    host.innerHTML = `
      <div class="wx-now card">
        <div class="wx-now-main">
          <span class="wx-now-ic">${ICON(c.code)}</span>
          <span class="wx-now-temp">${c.temp}°</span>
          <span class="wx-now-sum muted">${c.summary || ""}</span>
        </div>
        <div class="wx-details">
          ${detail("Feels like", c.feels_like !== undefined ? c.feels_like + "°" : "")}
          ${detail("Wind", c.wind ? `${c.wind_dir || ""} ${c.wind} mph`.trim() : "")}
          ${detail("Humidity", c.humidity !== undefined ? c.humidity + "%" : "")}
          ${detail("Gusts", c.gusts !== undefined ? c.gusts + " mph" : "")}
        </div>
      </div>
      <div class="wx-forecast card">${days || '<span class="muted">No forecast returned.</span>'}</div>`;
  }

  window.Weather = { render };
})();
