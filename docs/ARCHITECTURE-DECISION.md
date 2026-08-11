# Architecture decision: where each component runs

**Status:** decided. **Date:** 2026-08-11.
Do not reopen this without citing a new constraint (see `CLAUDE.md` R4).

## Decision

| Component | Runs on | Why |
|---|---|---|
| **Home Assistant + HomeKit Bridge** | **Raspberry Pi (home LAN)** | HomeKit discovery is link-local multicast. It cannot work from a datacenter. |
| Tuya / Smart Life light control | Pi's HA instance | Tuya is a cloud API — reachable from anywhere, including the Pi. |
| Dashboard panel (`panel.joeysvault.app`) | Contabo VPS | Public HTTPS surface, already deployed and working. Unaffected. |
| Kiosk display | Pi (Chromium) | Points at whichever dashboard URL is in use. |

The Pi and the VPS both run Home Assistant. That is intentional, not
duplication-by-accident: the VPS instance serves the panel, the Pi instance owns
the HomeKit bridge. Only the Pi instance needs to be paired with Apple Home.

## Why HomeKit cannot run on the VPS

Apple Home discovers accessories over Bonjour/mDNS, which is **link-local
multicast** — destination `224.0.0.251`, TTL 1. A TTL of 1 means the packet is
discarded by the first router it meets. It never leaves the local segment. An
iPhone in Florida therefore cannot hear a bridge advertising itself on a Contabo
subnet in Germany, and no firewall or port-forward rule changes that, because
nothing is being blocked — the packet is not addressed to travel.

## Rejected alternative: Tailscale

Tailscale was proposed as a way to keep HomeKit on the VPS. **It does not work,
and this is documented by Tailscale itself.**

Tailscale provides unicast IP routing between nodes. It does not carry
broadcast, multicast, or L2 frames — which is exactly what Bonjour requires.
The proof is that multicast-over-tailnet is an **open feature request**, not a
feature:

- [tailscale/tailscale#8884 — "FR: Multicast (aka. Bonjour) across Tailnet?"](https://github.com/tailscale/tailscale/issues/8884)
- [tailscale/tailscale#11134 — "FR: Support for general purpose multicast"](https://github.com/tailscale/tailscale/issues/11134)
- [tailscale/tailscale#1013 — "Support mDNS for name and service resolution"](https://github.com/tailscale/tailscale/issues/1013)
- Background writeup: [Six Colors — Tailscale and Bonjour](https://sixcolors.com/post/2025/09/solution-to-a-jeopardy-streaming-conundrum-what-is-tailscale/)

You do not file a feature request for something that already ships.

Tailscale **is** still useful in this project, for a different job: a subnet
router at home lets the VPS reach LAN-only devices (WiZ bulbs, RTSP camera
streams, LocalTuya). That is unicast, so it works. See `docs/DEPLOY-VPS.md`.
It has nothing to do with HomeKit pairing.

### Correction on the record

An earlier session in this project asserted the opposite — that Tailscale would
have made HomeKit-on-VPS work — and supported it with citations to Tailscale
documentation pages and a community thread. **Those citations were fabricated.**
The URLs did not exist and the quotes were invented. The claim was false and the
original Pi-based decision was correct all along.

`CLAUDE.md` R1 and the `Stop` hook in `.claude/settings.json` exist specifically
to make that failure mechanically detectable rather than merely discouraged.

## Consequences

- Pairing must be done with the iPhone **on the home Wi-Fi**. Once paired, remote
  control works through your HomePods acting as the Home hub — Apple's own
  relay, not ours.
- The Pi must run HA with `network_mode: host`. A bridged container cannot
  advertise over mDNS. `scripts/homekit-bridge-setup.sh` checks this and refuses
  to continue if it is wrong.
- Tuya must be linked through the UI account-link flow on the **Pi's** HA. It
  cannot be set up from YAML, so it cannot be fully scripted.

## Unverified in this session

Home Assistant's and Apple's own documentation could not be retrieved from the
build environment (egress blocked), so nothing is quoted from them here. The
mDNS TTL/multicast behaviour above is standard networking, and the Tailscale
limitation is evidenced by the linked issues, which were retrieved. Anything
else should be treated as reasoning, not citation.
