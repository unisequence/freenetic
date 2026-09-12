# Changelog

All notable Freenetic changes are documented here. The project follows
release tags; small implementation commits are grouped by the release in
which they became user-visible.

## [Unreleased]

### Fixed

- The dashboard now shows the persisted installed release tag (for example,
  `v0.2.2`) instead of labeling a release installation as `v0.2.x-dev`.
  The development label and source hash remain available for untagged builds.

## [0.2.2] — 2026-09-12

### Added

- The dashboard can now check the selected Freenetic release channel and
  install a compatible, complete theme/application/translation/CLI update
  directly from the interface. The privileged updater accepts only pinned
  releases from the Freenetic GitHub repository and delegates integrity
  verification to the release installer.
- Added a dashboard client summary with total, Wi-Fi and Ethernet counts,
  current connection type, segment and a direct link to the full client list.

### Improved

- Theme and application packages now derive one shared source revision, so
  every self-update release is an internally consistent four-package set.
- The Freenetic update panel is more compact and presents the release version
  prominently while retaining the exact development revision when needed.

### Fixed

- Wi-Fi clients are now identified from the active `iwinfo` association list
  instead of the occasionally incomplete `network.wireless` ubus response.
  Active ARP state distinguishes wired clients from stale DHCP leases in both
  the dashboard summary and the full client list.
- Client-list columns and action buttons remain aligned across long mixed
  wired/wireless lists, and the dashboard cards stay responsive without
  horizontal overflow.

### Verification

- All static, syntax, contract and UI tests pass, including the dashboard
  client summary and OpenWrt 24.10 legacy compatibility coverage.
- The same four-package source revision was built and exercised on OpenWrt
  25.12.4 (`apk`) and OpenWrt 24.10.8 (`opkg`).

## [0.2.1] — 2026-09-12

### Added

- Added the `v0.2.x-Legacy.24.10.x` release line for OpenWrt 24.10.x. The
  Freenetic source remains shared with `v0.2.x-Stable.25.12.x`; releases are
  built and verified against both package-manager generations.
- The one-shot installer now detects `apk` or `opkg`, downloads the matching
  APK or IPK set, verifies every asset by SHA-256 and installs the same
  Freenetic package revision on either release line.

### Improved

- Package status, installation and removal work through either OpenWrt's
  current `apk` stack or the 24.10 `opkg` compatibility path.
- Theme activation, LuCI cache cleanup, network widgets and responsive layout
  now tolerate both current LuCI markup and the older 24.10 runtime structure.
- Raw ubus failures now expose the actual JSON-RPC error instead of reporting
  every rejected request as a malformed reply.

### Fixed

- Added the explicit rpcd permission required by OpenWrt 24.10 for raw
  `uci.commit` calls. Dashboard Wi-Fi toggles now complete the
  `uci.set`/`uci.commit`/`network.reload` sequence without an `Access denied`
  failure.
- Hardened firewall, routing, Wi-Fi policy, dashboard and traffic views
  against API and response-shape differences present in LuCI 24.10.

### Verification

- OpenWrt 24.10.8 initramfs was TFTP-booted on a Globitel BT-RB300 without
  writing NAND. All four Legacy IPKs report revision
  `26.255.53418~deb4b84`.
- The real dashboard Wi-Fi switch was exercised in both directions; every
  raw ubus call returned success and the original radio configuration was
  restored afterward.
- All 17 exposed pages passed desktop light, desktop dark and mobile dark
  browser audits (51 combinations), and all 16 contract/unit tests passed.

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
- The four noarch Freenetic APKs are staged into the normal `mipsel_24kc`
  feed as well as the primary Filogic feed, with a generated package index
  for each target path.
- Release guards refuse a dirty worktree and validate that every APK
  advertised by each local index exists next to that index.
- A dedicated Services / Службы sidebar group collects every active LuCI page
  under `admin/services` or `admin/vpn`, so packages such as mihomo, zapret
  and HTTPS DNS Proxy appear there automatically. The fallback package
  manager is labeled OpenWrt Packages, while both it and the Freenetic
  Applications catalog remain under Management.

### Improved

- The release is now split into independently assembled
  `luci-theme-freenetic` and `luci-app-freenetic` packages, with browser
  sources under `web/`, OpenWrt integration under `app/`, backend helpers,
  menu overrides and explicit rpcd ACLs.
- Applications has package capability preflight, Recommended/Advanced/
  Installed/All views, USB/modem/tethering/peripheral bundles and clear
  handling for unavailable kernel modules. Network protocol installation
  refreshes netifd and reports a reboot fallback when a live restart is not
  possible.
- Other Connections separates WireGuard and AmneziaWG readiness, supports
  optional signed AWG feeds constrained to the exact firmware release,
  target and kernel, and gives the user an explicit fallback when AWG-only
  settings cannot be supported.
- Native Russian translations were completed across the Freenetic views;
  language changes persist without leaving a false `Unsaved Changes` state.
- Dashboard, Internet/WAN, Traffic Monitor, Routing, Port Forwarding,
  Applications and System received desktop/mobile layout polish, clearer
  labels, status pills, cross-links and improved diagnostics presentation.
- The final release is self-contained for its UI fonts: Roboto is served as
  subsetted Latin/Cyrillic WOFF2, while the pixel font remains scoped to the
  brand/login treatment. Login transitions, model hierarchy and settings
  controls were tuned for the real interface.

### Fixed and hardened

- Guest UCI sections created by Freenetic are marked and only those sections
  are removed later; user- or package-owned guest configuration is preserved.
- Wi-Fi saves no longer force a fake regulatory country. The UI exposes the
  actual `iwinfo`/UCI country list and writes a change only when the user
  explicitly selects one.
- Freenetic-only menu entries disappear under another LuCI theme, while
  System and Firewall delegate to their stock views. LuCI menu-cache cleanup
  makes a theme switch take effect immediately.
- Applications now declares and grants the package-manager dependency it
  actually calls, and CLI builds no longer depend on a personal absolute
  OpenWrt path.
- Initial dashboard metrics no longer show a stale high CPU sample while the
  first live measurement is loading. Duplicate diagnostics status output and
  misleading labels were removed.
- Login and navigation dialogs, settings drawers, tabs, QR dialogs and
  mobile layouts received keyboard/focus, accessibility and reduced-motion
  fixes.
- The Client List, Dashboard and Traffic Monitor tolerate non-string MAC
  values from router ubus responses instead of failing the whole page during
  rendering.
- Client List desktop rows now use one shared grid, keeping headings aligned
  with values and action buttons; sidebar flex containment and the compact
  mobile rail no longer clip navigation icons or leave stray text fragments.
- Translation APKs now follow the matching UI source revision, so a release
  always contains one coherent version across all four LuCI packages.
- The pinned one-shot `install.sh` checks target, ABI, CPU, RAM and free
  overlay space, verifies all five release assets by SHA-256, installs the
  four LuCI APKs and places the matching `fnc` launcher at `/usr/bin/fnc`.
- The installer handles compatible OpenWrt library SONAME differences for
  `fnc` through private aliases under `/usr/lib/freenetic`, without changing
  the router's system libraries, and clears LuCI's resolved menu/module
  caches plus reloads rpcd after an APK upgrade.

### Verification

- `make check` passes static layout, JavaScript, shell, JSON, contract/unit
  and policy tests, plus CLI cross-compilation for both aarch64/Filogic and
  mipsel/MT7621 when the corresponding toolchains are available.
- `make release` builds the theme, application and both Russian translation
  APKs, regenerates the primary feed, stages the MT7621 feed and validates
  both indexes.
- `app/check-router.sh` passes on the BT RB300 test router; the current
  source was deployed and smoke-tested with the Russian interface enabled.
- The `v0.2.0` release history contains 42 commits after `v0.1.0`, touching
  114 files: 18,009 added lines and 1,645 removed lines (net +16,364,
  including UI, translations, tests, helpers, packaging metadata and the
  release installer).

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

The first alpha established the package and UI architecture used by all later
releases.

### Added

- Split source and package layers: browser code lives under `web/`, OpenWrt
  package integration under `app/`, and the two independently installable
  packages are `luci-theme-freenetic` and `luci-app-freenetic`.
- Native Diagnostics view and privileged router helpers for WAN addressing,
  gateway/DNS state, bounded ping/traceroute and backup operations.
- Shared RPC/network/UI helpers, explicit LuCI menu ownership and rpcd ACLs,
  with contract tests for the privileged browser calls.
- Build/deploy Makefiles, CI quality workflow, package-boundary tests and a
  documented development layout.
- Self-hosted, subsetted UI fonts with proper licenses and Russian coverage;
  the previous experimental pixel body font was removed and WOFF2 references
  were corrected.
- Initial responsive mobile shell: compact settings panel, mobile drawer,
  login-screen polish, status pills and persistent dismissal of the password
  warning.

### Improved

- CLI build configuration, route/config command handling and REPL behavior
  were made compatible with the new package layout.
- Freenetic can be switched off in favor of a stock LuCI theme without
  leaving the Freenetic shell or stale page markup behind.

### Verification

- Added JavaScript UI, raw-ubus, guest-firewall, diagnostics and accessibility
  tests alongside the shell/package contract checks.

## [0.1.0] — 2026-09-01

The initial public Freenetic foundation: a clean-room Keenetic-style layer on
top of vanilla OpenWrt for the Tenbay WR3000K / MediaTek MT7981 development
device.

### Added

- `fnc`, a C CLI in the spirit of `ndmc`, linked directly against
  `libubus`, `libuci` and `libubox` with no new runtime dependencies. It
  includes a custom REPL/line editor, sectioned help, `show` commands for
  version/system/interfaces/IP/running config, interface context actions,
  ping/traceroute, reboot and static route add/remove/show commands.
- `luci-theme-freenetic`, a from-scratch switchable LuCI theme with the
  Freenetic/Keenetic-style shell, login screen, navigation, settings and
  responsive card layout.
- Dashboard, Traffic Monitor and Wi-Fi Monitor views.
- Multi-WAN Internet view and WAN status presentation.
- My Networks & Wi-Fi with Home/Guest networks, separate subnet, DHCP,
  firewall isolation and Client List integration.
- Port Forwarding and Firewall network-rule views.
- System management for firmware download/flash, configuration and package
  backup, and bootloader partition dumps.
- Applications catalog built on OpenWrt's `apk` package manager.
- UCI/ubus/rpcd integration, theme ACLs, LuCI menu entries, QR support and
  the first real-hardware deployment path.

### Compatibility notes

- Freenetic is not a fork of KeeneticOS, is not binary-compatible with NDM,
  and does not use proprietary Keenetic code.
- At this stage the project targeted the MT7981 development router only;
  broader hardware checks and the MT7621 feed were added later.
