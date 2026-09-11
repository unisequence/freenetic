# Changelog

All notable Freenetic changes are documented here.

## [Unreleased]

No changes yet.

## [0.2.0] — 2026-09-11

### Added

- Other Connections now includes native L2TP/IPsec and route-based
  IKEv2/IPsec editors backed by OpenWrt network UCI and strongSwan. L2TP
  uses xl2tpd with PPP credentials; IKEv2 supports PSK and EAP-MSCHAPv2,
  XFRM interface IDs, traffic selectors and automatic service reloads.
- L2TP/IPsec and IKEv2/IPsec cards now expose strongSwan runtime state,
  bounded read-only diagnostics and a manual reconnect action. The status
  helper reports active security associations, loaded connections and recent
  relevant logs without returning private keys or passwords.
- Dashboard summary cards now link directly to their full native views for
  Internet, traffic, Wi‑Fi, network, port and system details, including the
  same in-place SPA navigation on mobile.
- Other Connections now supports native OpenVPN profiles: import, edit,
  export, enable/disable and delete are backed by a protected router-side
  profile file and a regular `proto openvpn` network interface. OpenVPN
  tunnels are available to Access & Routing Policy alongside WireGuard.
- Release packages now run a hardware preflight and accept only
  `mediatek/filogic` (`aarch64`) and `ramips/mt7621` (`mipsel_24kc`) routers
  with at least two CPU cores, 128 MiB RAM and the target-specific free-space
  reserve. The same check is available as `app/check-router.sh`, and `fnc` is
  cross-compiled for both supported ABIs.

## [0.2.0-alpha.3] — 2026-09-09

### Added

- Other Connections view with native WireGuard and AmneziaWG interface/peer
  editing, configuration import/export and live tunnel status where the
  corresponding LuCI protocol is installed.
- Optional signed AmneziaWG feed integration for both `apk` and `opkg`,
  constrained to the router's exact OpenWrt release and target/kernel.
- Explicit compatibility choice when an AWG configuration is imported or
  saved without AWG support: install the feed or remove AWG-only parameters
  before continuing as standard WireGuard.
- Applications now preflight the small set of required package names and mark
  features unavailable when this firmware has no compatible kernel module,
  instead of sending an avoidable failing install request.
- Installing a network protocol package now restarts netifd so its new
  protocol handler is available immediately; WireGuard and AmneziaWG report
  a reboot fallback if the service cannot be restarted.
- Applications now have Recommended, Advanced networking, Installed and All
  views; advanced traffic tools are separated from the default catalog and
  are marked with an explanatory warning.
- Applications now include USB storage, modem (QMI/MBIM/PPP), tethering and
  peripheral bundles; firmware-specific USB kernel modules are preflighted
  before installation.
- Native Dynamic DNS page for ddns-scripts profiles, including provider/domain,
  IPv4/IPv6 source, credentials, per-profile update and service-state display.
- Native Wi-Fi ACL page for per-SSID allow/deny lists, using OpenWrt's
  standard `macfilter`/`maclist` options with Client List integration.
- Access & Routing Policy for Home/Guest segments, with Direct (WAN), VPN
  tunnel and Block Internet modes; individual device overrides match MAC
  addresses and can supersede a Freenetic segment policy.

### Improved

- Other Connections now presents WireGuard and AmneziaWG as separate protocol
  cards, with an independent readiness state and action for each one.
- Native Freenetic views now have a complete Russian translation, and the
  language selector persists changes without leaving an `Unsaved Changes`
  rollback state.
- Applications, Internet, Dashboard, Traffic Monitor, Routing, Port
  Forwarding and System views received additional desktop/mobile polish and
  clearer labels.

### Fixed

- Network package installation now refreshes the active netifd protocol state
  immediately, with an explicit reboot fallback when a restart is unavailable.
- Initial dashboard metrics no longer show a stale high CPU sample while the
  first live measurement is loading.

### Compatibility notes

- Existing OpenWrt UCI, ubus, rpcd, netifd, firewall4 and apk configuration
  remains unchanged.
- AWG support remains optional and is only offered when matching firmware
  packages are available for the device's exact release and target.
- Other OpenWrt targets are intentionally rejected by the package pre-install
  guard; the release is scoped to the two MediaTek profiles above.

### Verification

- `make check` passes, including JavaScript, shell, JSON, policy, unit checks
  and CLI cross-compilation for both aarch64 and mipsel.
- `make check-package` builds the theme, application and both Russian
  translation APKs; the package metadata includes the hardware pre-install
  guard.
- `app/check-router.sh` passes on the BT RB300 test router
  (`192.168.1.1`), and the current source was deployed and smoke-tested with
  the Russian interface enabled.

## [0.2.0-alpha.2] — 2026-09-08

This release turns Freenetic from a collection of custom LuCI pages into a
more cohesive router interface while keeping OpenWrt and LuCI compatibility.

### Added

- SPA-style navigation between native Freenetic views using the History API.
  The shell, sidebar, settings panel and authenticated session stay in place
  while only the active view is replaced.
- Lifecycle cleanup for view pollers, SSE streams, timers and page-specific
  event handlers when navigating between views.
- IPv4/IPv6 route switching and route-list import from Windows route files or
  compatible text files, with interface selection and route management actions.
- Authenticated live status streaming for Dashboard and Traffic Monitor, with
  polling fallback for older browsers or router images.
- Responsive mobile navigation and settings drawers, including touch-friendly
  layouts and closed drawers on a fresh login.
- Freenetic favicon and a clearer visual separation of System, Freenetic and
  Device information groups.

### Improved

- Internet, WAN and diagnostic information now uses human-oriented labels and
  consistent status pills (`DHCP`, `WAN`, `Connection type`, `Gateway`, `DNS`).
- Dashboard, Traffic Monitor, Routing, Port Forwarding and My Networks views
  received substantial desktop and mobile layout refinements.
- System Updates now exposes the Freenetic release channel and repository link.
- Native Freenetic pages remain theme-aware and fall back to stock LuCI routes
  when the Freenetic theme is not active.

### Compatibility notes

- Freenetic still uses the normal OpenWrt UCI, ubus, rpcd, netifd, firewall4
  and apk stack; this release introduces no configuration migration.
- Only native Freenetic routes use in-place navigation. Stock LuCI pages,
  downloads, logout and external links continue with normal browser navigation.
- This is an alpha release. DDNS, Wi-Fi ACL, IntelliQoS, additional ISP
  connection types and several stock LuCI integrations are still pending.

### Verification

- `make check` passes, including JavaScript, shell, JSON, policy, unit and CLI
  cross-compilation checks.
- The release candidate was deployed and smoke-tested on the BT RB300 test
  router (`192.168.1.1`).

## [0.2.0-alpha.1] — 2026-09-06

- Initial alpha release of the split `luci-theme-freenetic` and
  `luci-app-freenetic` packages with the Freenetic web interface, diagnostics
  and OpenWrt integration.
