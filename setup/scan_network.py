#!/usr/bin/env python3
"""Scan the local network for smart-home devices and write an inventory.

The goal (from the spec) is that "all devices should be scanned thoroughly on
the current network so that everything is primed and ready to be displayed."

We combine three passive/active discovery methods that cover the brands in
play without needing any cloud credentials:

  * mDNS / Zeroconf  -> HomeKit, Matter, Google Cast, WiZ, generic _http._tcp
  * UDP broadcast     -> WiZ bulbs answer a getPilot probe on :38899
  * arp-scan (if root) -> everything with a MAC, mapped to a vendor guess

The output is a JSON file the dashboard reads to show a "discovered devices"
list on the Settings screen, so the user can confirm/label each one. This never
changes device state — it only listens/probes.
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import time
from pathlib import Path

# Vendor OUI prefixes we care about (first 3 MAC octets, lowercase, no colons).
VENDOR_HINTS = {
    "tuya": ["10d561", "68572d", "d81f12", "a092b4", "500291"],
    "wiz":  ["a8bb50", "444f8e", "6c2990"],
    "eufy": ["8c9096", "e0888c", "b8f009"],
}


def _guess_vendor(mac: str) -> str:
    key = mac.lower().replace(":", "")[:6]
    for vendor, prefixes in VENDOR_HINTS.items():
        if key in prefixes:
            return vendor
    return "unknown"


def scan_mdns(timeout: float = 6.0) -> list[dict]:
    """Discover devices advertising common service types via Zeroconf."""
    found: list[dict] = []
    try:
        from zeroconf import ServiceBrowser, Zeroconf, ServiceStateChange
    except Exception:
        return found

    services = [
        "_hap._tcp.local.",        # HomeKit accessories
        "_matter._tcp.local.",     # Matter
        "_matterc._udp.local.",    # Matter commissionable
        "_googlecast._tcp.local.", # Cast
        "_http._tcp.local.",       # generic web UIs (many bulbs/cams)
        "_wiz._tcp.local.",
    ]

    def on_change(zc, service_type, name, state_change):
        if state_change is not ServiceStateChange.Added:
            return
        info = zc.get_service_info(service_type, name, timeout=2000)
        if not info:
            return
        addrs = [socket.inet_ntoa(a) for a in info.addresses if len(a) == 4]
        found.append({
            "source": "mdns",
            "service": service_type.rstrip("."),
            "name": name.split(".")[0],
            "addresses": addrs,
            "port": info.port,
        })

    zc = Zeroconf()
    browsers = [ServiceBrowser(zc, st, handlers=[on_change]) for st in services]
    time.sleep(timeout)
    zc.close()
    return found


def scan_wiz(timeout: float = 3.0) -> list[dict]:
    """WiZ bulbs reply to a UDP getPilot broadcast on port 38899."""
    found: list[dict] = []
    msg = b'{"method":"getPilot","params":{}}'
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(0.5)
    try:
        sock.sendto(msg, ("255.255.255.255", 38899))
        end = time.time() + timeout
        seen = set()
        while time.time() < end:
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            ip = addr[0]
            if ip in seen:
                continue
            seen.add(ip)
            try:
                payload = json.loads(data.decode())
            except Exception:
                payload = {}
            found.append({
                "source": "wiz-udp",
                "vendor": "wiz",
                "name": f"WiZ light @ {ip}",
                "addresses": [ip],
                "mac": payload.get("result", {}).get("mac", ""),
            })
    finally:
        sock.close()
    return found


def scan_arp() -> list[dict]:
    """Use arp-scan for a full L2 sweep (needs root; skipped otherwise)."""
    found: list[dict] = []
    try:
        out = subprocess.run(
            ["sudo", "-n", "arp-scan", "--localnet", "--quiet", "--plain"],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return found
    for line in out.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and "." in parts[0] and ":" in parts[1]:
            ip, mac = parts[0], parts[1]
            found.append({
                "source": "arp",
                "vendor": _guess_vendor(mac),
                "name": f"{_guess_vendor(mac)} device @ {ip}",
                "addresses": [ip],
                "mac": mac,
            })
    return found


def merge(*groups: list[dict]) -> list[dict]:
    """De-duplicate by IP address, keeping the richest record."""
    by_ip: dict[str, dict] = {}
    loose: list[dict] = []
    for group in groups:
        for dev in group:
            ips = dev.get("addresses") or []
            if not ips:
                loose.append(dev)
                continue
            ip = ips[0]
            if ip in by_ip:
                by_ip[ip].update({k: v for k, v in dev.items() if v})
            else:
                by_ip[ip] = dict(dev)
    return list(by_ip.values()) + loose


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="discovered_devices.json")
    ap.add_argument("--timeout", type=float, default=6.0)
    args = ap.parse_args()

    print("[*] mDNS/Zeroconf sweep...")
    mdns = scan_mdns(args.timeout)
    print(f"    found {len(mdns)}")

    print("[*] WiZ UDP broadcast...")
    wiz = scan_wiz()
    print(f"    found {len(wiz)}")

    print("[*] arp-scan L2 sweep (needs root; may be skipped)...")
    arp = scan_arp()
    print(f"    found {len(arp)}")

    devices = merge(mdns, wiz, arp)
    result = {
        "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "count": len(devices),
        "devices": devices,
    }
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(f"[+] Wrote {len(devices)} devices to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
