# Freenetic

[Русская версия](README.ru.md)

[Releases](docs/RELEASES.md) · [Changelog](docs/CHANGELOG.md)

[Security](docs/SECURITY.md) · [Contributing](docs/CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)

Freenetic is a clean-room reimplementation of Keenetic's UX and CLI on
top of vanilla OpenWrt — not a fork, and not binary-compatible with
proprietary KeeneticOS/NDM. It's a separate layer that reproduces the
familiar Keenetic look and command syntax while talking to
UCI/ubus/rpcd underneath.

> **Disclaimer**: Freenetic is not affiliated with NDM Systems /
> Keenetic and doesn't use their code. The name is a pun (free +
> Keenetic + frenetic), not an attempt to pass as the original product.

Current development hardware is a BT RB300, flashed with plain upstream
OpenWrt — mainline U-Boot, no proprietary components. The release matrix
also builds a generic OpenWrt x86/64 profile.

## Supported hardware

The release packages cover two tested MediaTek families and a generic
OpenWrt x86/64 profile:

| OpenWrt target | CPU ABI | Minimum profile |
|---|---|---|
| `mediatek/filogic` | `aarch64` | 2 cores, 128 MiB RAM, 32 MiB free overlay |
| `ramips/mt7621` | `mipsel_24kc` | 2 cores, 128 MiB RAM, 16 MiB free overlay |
| `x86/64` | `x86_64` | 2 cores, 128 MiB RAM, 32 MiB free overlay |

Other targets are rejected by the package pre-install guard. Before a
development deployment, run the same read-only check over SSH:

```sh
app/check-router.sh root@192.168.1.1
```

The thresholds can be raised for a particular environment with
`FREENETIC_MIN_RAM_MIB`, `FREENETIC_MIN_CPU_CORES`,
`FREENETIC_MIN_OVERLAY_MIB_FILOGIC` and
`FREENETIC_MIN_OVERLAY_MIB_MT7621`, and
`FREENETIC_MIN_OVERLAY_MIB_X86_64` for x86/64.

## Quick install

On a supported OpenWrt router, the current pinned release can be installed
with one POSIX-compatible command:

```sh
wget -qO- 'https://github.com/unisequence/freenetic/releases/latest/download/install.sh' | sh
```

The release installer is generated from the final package matrix: it carries
the exact SHA-256 values for that release's four LuCI packages and the
package-manager/ABI-matched `fnc` binary. It checks the router before changing
it, selects APK or IPK automatically, records the installed release and
installs `fnc` as
`/usr/bin/fnc`. The Russian packages are installed but the current LuCI
language is not changed automatically.

| | |
|---|---|
| ![Login](web/docs/screenshots/login.webp) | ![Dashboard](web/docs/screenshots/dashboard.webp) |
| ![System files](web/docs/screenshots/system.webp) | ![Applications](web/docs/screenshots/applications.webp) |
| ![Other Connections](web/docs/screenshots/other-connections.webp) | ![Routing](web/docs/screenshots/routing.webp) |
| ![Mobile dashboard](web/docs/screenshots/mobile-dashboard.webp) | |

## What's working

**`fnc` CLI** (`cli/`) — an interactive wrapper in the spirit of
`ndmc`, written in C, linking directly against
`libubus`/`libuci`/`libubox` (no new runtime dependencies on the
device). It has its own REPL with a custom line editor, sectioned
`help`, `show version/system/interface/ip/running-config`, an
`interface <name>` context (`ip address`, `ip dhcp client`,
`up`/`down`), `ping`/`traceroute`, `system reboot`, and static routing
(`show ip route`, `ip route`, `no ip route`).

**The web interface** (`web/`) is a from-scratch LuCI interface — not a fork
of a stock theme — reproducing the Keenetic Web look. **The OpenWrt
integration** (`app/`) assembles it into a visual `luci-theme-freenetic`
package and a functional `luci-app-freenetic` package with menus, ACLs and
server-side helpers. The shell is switchable like any other LuCI theme: pick
Bootstrap and it is gone, pick Freenetic back and it returns. Running on real
hardware right now:

- Dashboard, Traffic Monitor, Wi-Fi Monitor
- Dashboard and Traffic Monitor live metrics use short, microtask-batched
  requests to uhttpd's native ubus endpoint, without holding a CGI worker open
- Internet (multi-WAN)
- My Networks & Wi-Fi — Home/Guest network with a real backend behind
  it (separate subnet, DHCP, firewall isolation), plus Client List
- Network Rules: Port Forwarding, Firewall, Routing (IPv4/IPv6 and DNS routes, including Windows route-file import)
- Other Connections: native WireGuard, OpenVPN, L2TP/IPsec and IKEv2/IPsec
  connections, optional AmneziaWG/AWG configuration import and a signed,
  target-specific package-feed installer for AWG
- Diagnostics: WAN addressing, gateway/DNS state, bounded ping and traceroute
- Services: stock Software/package management, the Freenetic Applications
  catalog and all active LuCI service pages under `admin/services`/`admin/vpn`
  (including packages such as mihomo, zapret and HTTPS DNS Proxy)
- Management: System (firmware download/flash, config+package backup,
  bootloader partition dumps), Dynamic DNS (native `ddns-scripts` profiles)
- Wi-Fi ACL (per-SSID allow/deny lists backed by native OpenWrt
  `macfilter`/`maclist`, with Client List integration)
- Access & Routing Policy for whole network segments or individual devices:
  Direct (WAN), WireGuard/AmneziaWG/OpenVPN/L2TP/IPsec/IKEv2 VPN and Block
  Internet modes

Not built yet: other legacy VPN clients, IntelliQoS,
Mobile/DSL/Wireless ISP connection types, and the application traffic analyzer.

## Roadmap

Right now the priority is finishing UX parity with KeeneticOS across
LuCI and `fnc`. After that: mesh compatibility with real Keenetic
devices (the `mws` protocol) — a clean-room implementation based on
passive traffic analysis between actual Keenetic hardware, not on
donor binary code. Hasn't started yet.

## Layout

- `app/luci-theme-freenetic/` — OpenWrt package for the visual theme shell.
- `app/luci-app-freenetic/` — OpenWrt package for router management views,
  rpcd ACLs, LuCI menus and backend helpers.
- `web/theme/` and `web/application/` — browser sources for those two packages;
  `web/docs/` holds screenshots.
- `cli/` — the standalone C implementation of the `fnc` console client.

Dependencies point one way: each `app/` package links to its matching `web/`
source directory, while `web/` does not know the OpenWrt package layout.
`luci-app-freenetic` depends on `luci-theme-freenetic`; neither web component
is a standalone SPA.

## Development checks

Syntax, policy and unit checks need no OpenWrt buildroot and are also run by
CI:

```sh
make check-static
```

Run the complete local suite, including CLI cross-compilation for Filogic and
MT7621 when both toolchains are present, with an OpenWrt buildroot available
next to this repository (or pass its path explicitly):

```sh
make check OPENWRT_DIR=/path/to/openwrt
```

To build both installable LuCI packages as well:

```sh
make check-package OPENWRT_DIR=/path/to/openwrt DL_DIR=/path/to/openwrt/dl
```

Pushing a clean semver tag (`vX.Y.Z`) runs the pinned OpenWrt 24.10/25.12
matrix in GitHub Actions, including separate `fnc` builds for each target and
package-manager ABI. The release job derives package hashes from the final
matrix, writes them into a generated `install.sh`, commits that installer
to the release tag for raw-URL compatibility, extracts the matching changelog
section as release notes and publishes the packages, matching `fnc` binaries,
installer and `SHA256SUMS.txt` as one GitHub Release.

The package directories in the buildroot must point to the matching package
components:

```sh
ln -s /path/to/freenetic/app/luci-theme-freenetic /path/to/openwrt/package/luci-theme-freenetic
ln -s /path/to/freenetic/app/luci-app-freenetic /path/to/openwrt/package/luci-app-freenetic
```
