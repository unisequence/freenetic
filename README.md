# Freenetic

[Русская версия](README.ru.md)

Freenetic is a clean-room reimplementation of Keenetic's UX and CLI on
top of vanilla OpenWrt — not a fork, and not binary-compatible with
proprietary KeeneticOS/NDM. It's a separate layer that reproduces the
familiar Keenetic look and command syntax while talking to
UCI/ubus/rpcd underneath.

> **Disclaimer**: Freenetic is not affiliated with NDM Systems /
> Keenetic and doesn't use their code. The name is a pun (free +
> Keenetic + frenetic), not an attempt to pass as the original product.

Development hardware is a Tenbay WR3000K (MediaTek MT7981), flashed
with plain upstream OpenWrt — mainline U-Boot, no proprietary
components.

| | |
|---|---|
| ![Login](docs/screenshots/login.webp) | ![Dashboard](docs/screenshots/dashboard.webp) |
| ![System files](docs/screenshots/system.webp) | ![Applications](docs/screenshots/applications.webp) |

## What's working

**`fnc` CLI** (`cli/`) — an interactive wrapper in the spirit of
`ndmc`, written in C, linking directly against
`libubus`/`libuci`/`libubox` (no new runtime dependencies on the
device). It has its own REPL with a custom line editor, sectioned
`help`, `show version/system/interface/ip/running-config`, an
`interface <name>` context (`ip address`, `ip dhcp client`,
`up`/`down`), `ping`/`traceroute`, `system reboot`, and static routing
(`show ip route`, `ip route`, `no ip route`).

**`luci-theme-freenetic`** (`luci-theme-freenetic/`) is a from-scratch
LuCI theme — not a fork of the stock ones — that reproduces the
Keenetic Web look, and it's switchable like any other LuCI theme: pick
Bootstrap and it's gone, pick Freenetic back and everything returns.
Running on real hardware right now:

- Dashboard, Traffic Monitor, Wi-Fi Monitor
- Internet (multi-WAN)
- My Networks & Wi-Fi — Home/Guest network with a real backend behind
  it (separate subnet, DHCP, firewall isolation), plus Client List
- Network Rules: Port Forwarding, Firewall
- Management: System (firmware download/flash, config+package backup,
  bootloader partition dumps), Applications (an install catalog built
  on top of `apk`)

Not built yet: DDNS, Wi-Fi ACL, IntelliQoS, Mobile/DSL/Wireless ISP
connection types, the application traffic analyzer, a diagnostics
page, and cross-links between cards.

## Roadmap

Right now the priority is finishing UX parity with KeeneticOS across
LuCI and `fnc`. After that: mesh compatibility with real Keenetic
devices (the `mws` protocol) — a clean-room implementation based on
passive traffic analysis between actual Keenetic hardware, not on
donor binary code. Hasn't started yet.

## Layout

- `cli/` — `fnc` source.
- `luci-theme-freenetic/` — the LuCI theme.

## Credits

A good chunk of `luci-theme-freenetic` and `fnc` was written together
with [Claude Code](https://github.com/claude)
([Anthropic](https://www.anthropic.com/)).
