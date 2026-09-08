# Changelog

All notable Freenetic changes are documented here.

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
