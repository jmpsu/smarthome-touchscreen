/* =========================================================================
   ha.js — Home Assistant real-time client (via the backend WS proxy)
   Exposes a tiny global `HA` with:
     HA.connect()               open the socket, auth, subscribe to state
     HA.onState(cb)             called with the full entity map on every change
     HA.call(domain, service, data)   fire a service (REST, token stays server-side)
     HA.entities                current entity map { entity_id: stateObj }
   ========================================================================= */
(function () {
  const HA = {
    entities: {},
    _subs: [],
    _ws: null,
    _id: 1,
    _ready: false,
  };

  function emit() { HA._subs.forEach((cb) => cb(HA.entities)); }

  HA.onState = (cb) => { HA._subs.push(cb); if (HA._ready) cb(HA.entities); };

  // Demo / no-HA mode: poll the REST snapshot instead of the live websocket,
  // so the full UI populates and every control reflects immediately.
  HA.usePolling = function (intervalMs) {
    const tick = async () => {
      await loadSnapshot();
      HA._ready = true;
      emit();
    };
    tick();
    setInterval(tick, intervalMs || 1500);
  };

  HA.connect = function () {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ha-ws`);
    HA._ws = ws;

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "auth_ok":
          // load full snapshot, then subscribe to incremental changes
          await loadSnapshot();
          send({ type: "subscribe_events", event_type: "state_changed" });
          HA._ready = true;
          emit();
          break;
        case "event":
          if (msg.event && msg.event.event_type === "state_changed") {
            const { entity_id, new_state } = msg.event.data;
            if (new_state) HA.entities[entity_id] = new_state;
            else delete HA.entities[entity_id];
            emit();
          }
          break;
        case "proxy_error":
          console.warn("HA proxy error:", msg.error);
          break;
      }
    };

    ws.onclose = () => {
      HA._ready = false;
      setTimeout(HA.connect, 3000); // auto-reconnect
    };
    ws.onerror = () => ws.close();
  };

  function send(obj) {
    obj.id = HA._id++;
    HA._ws.send(JSON.stringify(obj));
    return obj.id;
  }

  async function loadSnapshot() {
    try {
      const res = await fetch("/api/states");
      const states = await res.json();
      if (Array.isArray(states)) {
        HA.entities = {};
        states.forEach((s) => (HA.entities[s.entity_id] = s));
      }
    } catch (e) {
      console.warn("snapshot failed", e);
    }
  }

  HA.call = async function (domain, service, data) {
    try {
      const res = await fetch(`/api/service/${domain}/${service}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
      });
      return await res.json();
    } catch (e) {
      console.warn("service call failed", e);
      return { ok: false, error: String(e) };
    }
  };

  // convenience helpers for lights
  HA.lights = () =>
    Object.values(HA.entities).filter((e) => e.entity_id.startsWith("light."));
  HA.switches = () =>
    Object.values(HA.entities).filter((e) => e.entity_id.startsWith("switch."));
  HA.cameras = () =>
    Object.values(HA.entities).filter((e) => e.entity_id.startsWith("camera."));
  HA.scenes = () =>
    Object.values(HA.entities).filter((e) => e.entity_id.startsWith("scene."));

  window.HA = HA;
})();
