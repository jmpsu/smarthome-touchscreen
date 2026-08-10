/* =========================================================================
   sky.js — full Sky screen: every celestial event the backend computes.

   /api/celestial is computed locally with Astronomy Engine, so this screen
   works with no network at all. Events are ranked by the backend; the one
   happening soonest leads.
   ========================================================================= */
(function () {
  const ICON = {
    meteor: "☄", moon: "🌙", planet: "🪐", eclipse: "🌑",
    conjunction: "✦", solstice: "☀", equinox: "☀",
  };

  function card(s) {
    const bits = [s.dates_label, s.rate, s.constellation ? `in ${s.constellation}` : ""]
      .filter(Boolean).join(" · ");
    return `
      <div class="sky-card">
        <div class="sky-card-ic">${ICON[s.category] || "✦"}</div>
        <div class="sky-card-body">
          <div class="sky-card-name">${s.name}</div>
          <div class="muted">${bits}</div>
          ${s.where ? `<div class="sky-card-where muted">${s.where}</div>` : ""}
          ${s.description ? `<p class="sky-card-desc">${s.description}</p>` : ""}
        </div>
      </div>`;
  }

  async function render() {
    const host = document.getElementById("sky-body");
    if (!host) return;
    host.innerHTML = `<div class="muted">Loading…</div>`;

    let d;
    try {
      d = await (await fetch("/api/celestial")).json();
    } catch (e) {
      host.innerHTML = `<div class="card"><p class="muted">
        Could not reach the panel backend.</p></div>`;
      return;
    }

    const slides = d.slides || [];
    if (!slides.length) {
      host.innerHTML = `<div class="card"><p class="muted">
        Nothing notable in the sky for the next few weeks.</p></div>`;
      return;
    }
    host.innerHTML = `<div class="sky-list">${slides.map(card).join("")}</div>`;
  }

  window.Sky = { render };
})();
