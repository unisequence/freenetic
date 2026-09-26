# Changelog

All notable Freenetic changes are documented here. The project follows
release tags; small implementation commits are grouped by the release in
which they became user-visible.

## [Unreleased]

### Signal

The surface remains familiar.

Beneath it, packets are learning new habits:
split, reorder, and take a different route.

## [0.4.0-beta.1] — 2026-09-26

### Added

- Added a dedicated, responsive router-reboot page with an explicit
  confirmation step and a reminder to save configuration changes.
- Added router administrator password changes to System management, with
  password confirmation and clear success/error feedback.

### Improved

- Restyled the system and kernel log pages, improved mobile layouts, and fixed
  package-manager action buttons so their labels no longer wrap or get cut off.
- Moved Mihomo from Network to Services. The application catalog now
  distinguishes an existing config-only Mihomo setup from an unmanaged
  installation; installing the managed core preserves and adopts that config.
- Lowered the minimum free overlay requirement to 16 MiB for MT7981/Filogic
  and 8 MiB for MT7621, consistently across installer checks, package guards,
  self-update, and documentation.
- Clarified the theme-switch action label and included the reboot page in the
  in-place navigation and deployment paths.

### Verification

- Passed the OpenWrt 24.10.8 and 25.12.5 build matrix across Filogic, MT7621,
  and x86/64, including IPK/APK package checks (six target/release
  combinations).
- Added UI-polish and expanded Mihomo, package-boundary, and self-update
  contract tests for the new behavior.

## [0.4.0-alpha.6] — 2026-09-23

### Added

- Added router-side Mihomo installation and management, including proxy-link
  and subscription conversion, a manual YAML editor, effective-configuration
  export, and optional protected-DNS and TUN blocks.
- Added MagiTrickle as an optional application with its native web interface
  embedded in LuCI and a post-install offer for the Internet Helper domain
  list.
- Added OpenWrt x86/64 support to installer preflight, self-update, dashboard
  release selection, `fnc`, and Zapret2/Mihomo architecture handling.
- Added x86/64 APK and IPK builds to the release matrix, with mirrored noarch
  LuCI packages and pinned OpenWrt SDK checksums.

### Improved

- Applications now offer MagiTrickle after Mihomo or a supported VPN client
  is installed.
- MagiTrickle package setup verifies the repository key, handles the current
  OpenWrt NAT dependency layout, and can retry downloads through the WAN DNS
  resolver when a local encrypted resolver is unavailable.
- The optional Internet Helper list is checked before installation, and an
  existing MagiTrickle configuration is backed up first.

### Verification

- Added x86/64 release-asset, installer-hash and dashboard compatibility
  contracts while retaining the existing ARM64 and MIPSLE release paths.
- Added package, LuCI menu, ACL and post-install list-offer contracts for
  MagiTrickle and expanded Mihomo and release-workflow checks.

### Alpha scope

- The Internet Helper list remains optional and is downloaded only after the
  user accepts the offer. Mihomo and MagiTrickle are installed separately
  from their upstream sources.

## [0.4.0-alpha.5] — 2026-09-20

### Fixed

- Fixed the self-update downloader on routers with a broken or incomplete
  IPv6 route, or networks that block GitHub's release redirect, by preferring
  IPv4 and resolving the pinned installer through the GitHub Releases API.

## [0.4.0-alpha.4] — 2026-09-20

### Fixed

- Fixed the self-update downloader on routers with a broken or incomplete
  IPv6 route by preferring IPv4 for pinned GitHub release assets, while
  retaining a fallback for IPv6-only and older wget environments.

## [0.4.0-alpha.3] — 2026-09-20

### Fixed

- Fixed OpenWrt 24.10 SDK preparation so Zapret2's `firewall4`, `nftables`
  and `curl` dependencies are installed before the package graph is resolved.
- Fixed package-content verification for target-specific IPKs while retaining
  the shared noarch package layout used by the SDK.

### Verification

- Added a release-workflow contract that guards the dependency feed setup for
  both supported package formats.

## [0.4.0-alpha.2] — 2026-09-20

### Added

- Added the official Zapret2 1.0.5.2 runtime as the architecture-specific
  `freenetic-zapret2` package, disabled by default and shipped with its
  OpenWrt integration and license notices.
- Added a Freenetic entry point for Zapret2 that uses the native LuCI page
  when available and keeps a versioned compatibility client for older
  installations.
- Added a compact Zapret2 workspace for strategies, runtime settings,
  scripts, lists, Blockcheck2 and debug logs.

### Improved

- Added a single Freenetic apply flow for Zapret2 changes with progress
  feedback, native CBI saves and an authoritative page reload after apply.
- Refined strategy editing, multi-select controls, status actions and the
  surrounding cards to match the Freenetic Internet and Applications UI.
- Added package, ACL, helper and release-workflow contracts for the new
  runtime across APK and IPK builds.

### Alpha scope

- Zapret2 is intentionally installed inactive; enabling the service and
  selecting strategies remain explicit user actions.

## [0.4.0-alpha.1] — 2026-09-18

### Added

- Added a first-user Multi-WAN interface with a visual traffic diagram and
  simple modes for one connection, automatic failover and flow balancing.
- Added selection of the active line in one-connection mode, including
  persistent selection across mode changes.
- Added guided second-provider setup through a spare Ethernet port or a nearby
  Wi-Fi network without adopting existing user-managed WWAN sections.
- Added clear runtime states for active, available-but-unused, checking and
  unavailable Internet connections.
- Added policy and traffic-diagram capacity for up to seven managed uplinks,
  including Ethernet, Wi-Fi and modem-backed interfaces.

### Safety and correctness

- Multi-WAN changes use owned UCI sections, a shared mutation lock, snapshots,
  verification and rollback while preserving unrelated mwan3 policies.
- Wi-Fi backup setup now requires DHCP, a non-conflicting subnet and a
  successful mwan3 Internet health check before reporting success.
- Mode changes reload the page after both success and failure so the interface
  always returns to authoritative router state.
- Freenetic-managed uplinks receive distinct route metrics and reject an eighth
  connection instead of silently replacing another provider route.

### Alpha scope

- This preview focuses on IPv4 Multi-WAN behavior. Further compatibility and
  failure-injection testing will continue before beta.

## [0.3.2] — 2026-09-16

### Added

- Added release details to the dashboard update center: published date,
  codename, compatible asset count, bounded release notes and a link to the
  upstream release page. Headings and unordered lists receive lightweight
  formatting; notes are rendered as text and never interpreted as HTML.
- Added a one-click sanitized diagnostic archive from System → Diagnostics.
  The bundle contains bounded board, network, route, storage, package and
  Freenetic log data, uses a private temporary directory and excludes UCI
  dumps, credentials and key material.
- Added a preflight summary to Freenetic self-updates with target, package
  manager, RAM/CPU and overlay-space checks. The install confirmation can
  create and download a private startup-config backup before starting the
  package transaction.

### Fixed

- Disabled release selectors no longer inherit the browser's patterned
  disabled background while an update check is running.

### Improved

- Increased the readability of the update confirmation dialog without
  changing the scale of other LuCI modals.

## [0.3.1] — 2026-09-15

### Added

- Added release-line codenames beside stable build numbers on the dashboard:
  Onyx uses Cherry Bomb One for `v0.2.x`, while Noxium uses Anta for `v0.3.x`.
  Both display fonts are self-hosted, with no external requests; prerelease and
  development builds continue to omit the codename.

## [0.3.0] — 2026-09-15

### Introducing Noxium

- Freenetic 0.3.0 turns the interface layer into a network-control platform:
  physical port roles, isolated routed segments, per-network and per-device
  traffic policy, and Wi-Fi airspace analysis now share one guarded OpenWrt
  configuration model.

### Added

- Added an interactive 2.4/5 GHz airspace map with channel overlap, current
  radio footprint, collision-safe SSID labels and signal-aware channel advice.
- Added physical Ethernet role assignment for WAN, Home, Guest, unused and
  independent routed segments, plus advisory DHCP/PPPoE port discovery.
- Added isolated segment provisioning with DHCP/DNS access, router-service
  isolation, firewall ownership and Direct, Blocked or VPN routing policy.
- Added zone-aware client blocking and port forwarding, including Guest and
  dedicated Ethernet segments.
- Added a guided uninstaller with configuration-preserving and explicitly
  confirmed managed-state cleanup modes.

### Security and correctness

- Freenetic-created UCI objects carry ownership markers; reconciliation and
  full removal preserve foreign sections, custom bridges, WAN6 devices and
  shared DDNS/PBR state.
- Dedicated segments reject access to router services by default, while
  client blocks are ordered ahead of broad ACCEPT rules and target the actual
  source zone.
- VPN policy changes report success only after Policy-Based Routing confirms
  activation. Network, address, route and port-range inputs use shared strict
  validation.
- Root helpers use constrained command boundaries and unpredictable temporary
  paths. Package, native CLI and UCI mutations have rollback-aware failure
  handling.

### Interface and operations

- Refined the responsive navigation, top bar, login screen, WAN and diagnostics
  pages, client groups, VPN/DDNS layouts and the stock OpenWrt package manager.
- Wi-Fi settings now preserve driver-specific values and configure channel
  width, country, power and security independently per radio.
- Installation and self-update clear LuCI and browser caches, invalidate the
  previous session and return to login so the new theme loads cleanly.
- Release APKs use a pinned signing key; every one of the 21 release assets is
  covered by SHA-256 and GitHub/Sigstore build provenance. Annotated release
  tags are immutable and are tested before publication.

### Verification

- Static, runtime, ownership, preservation and security contracts pass, with
  CLI cross-builds for `aarch64_cortex-a53` and `mipsel_24kc` and package
  builds for OpenWrt 24.10 IPK and 25.12 APK targets.
- A Globitel BT-RB300 completed fresh installation, package verification,
  Ethernet-segment/firewall tests, safe and managed-state removal, exact
  configuration restoration, browser-cache/session reset and repeated install.

## [0.3.0-beta.2] — 2026-09-15

### Added

- Added a guided Freenetic uninstaller under Management → System. The default
  path removes the interface and native CLI while preserving router settings;
  an explicitly confirmed full cleanup removes only UCI sections carrying the
  `freenetic_managed=1` ownership marker.
- The removal flow selects a stock LuCI theme before package removal, clears
  LuCI and Freenetic browser caches, ends the current session and returns to
  the standard LuCI login page.

### Fixed

- A true fresh install no longer fails while recording its release state when
  `/etc/config/freenetic` does not exist yet. The installer creates the private
  state file before its first UCI write and retains the existing rollback
  behavior on any later failure.
- APK removal now waits for a short-lived package-manager lock and returns the
  relevant package-manager diagnostics instead of a generic failure.
- The post-removal redirect now uses the actual `/cgi-bin/luci/` entry point
  rather than constructing a non-existent `/cgi-bin/admin/` URL.

### Verification

- The safe uninstall path was exercised through rpcd on a Globitel BT-RB300.
  All four Freenetic packages, the native CLI and stale namespaced files were
  removed; Bootstrap, shared OpenWrt dependencies and third-party VPN/PBR
  packages remained installed.
- Network, wireless, DHCP and firewall files remained byte-for-byte identical
  across the safe uninstall. A failed package transaction also restored its
  configuration snapshot and active theme.

## [0.3.0-beta.1] — 2026-09-15

### Release status

- The `0.3.0` feature set is frozen after alpha.4. Beta, RC and stable builds
  accept fixes, tests, compatibility work and restrained interface polish only.
- Release tooling now gives beta and RC builds concealed prerelease titles;
  the `0.3.0` codename remains hidden until the final release.
- The release checklist now covers the Ethernet, routed-segment, firewall,
  PBR and Wi-Fi airspace behavior introduced in `0.3.0`.

### Verification

- The complete static/runtime suite and CLI cross-build passed for
  `aarch64_cortex-a53` and `mipsel_24kc`; the APK package build and content
  validation also passed.
- A Globitel BT-RB300 running an APK-based OpenWrt snapshot passed hardware
  preflight, LuCI/static-asset checks, helper boundary checks, isolated-segment
  network/firewall runtime validation and a reboot-persistence check.
- The isolated-segment smoke test was automatically rolled back and confirmed
  `network`, `firewall` and `dhcp` were restored byte-for-byte. A configuration
  backup was captured before testing.

### Remaining before stable

- Repeat the candidate install as both a clean install and an upgrade from
  `0.2.7`.
- Exercise physical WAN↔LAN reassignment, browser confirmation and automatic
  rollback with cables available on the test router.
- Exercise VPN policy activation with PBR installed on real hardware.

## [0.3.0-alpha.4] — 2026-09-15

### Security

- Client blocking now targets the client's actual firewall zone, including
  dedicated Ethernet segments, instead of silently falling back to the Home
  network zone.
- VPN policy application now fails visibly when Policy-Based Routing cannot be
  restarted; the interface no longer reports a policy as active after a
  structured backend failure.
- Dedicated Ethernet segments deny access to router services by default while
  retaining narrow DHCP and DNS input exceptions.
- Root helpers and the release installer now use unpredictable private
  temporary paths instead of PID-derived filenames.
- APK packages are verified with a release public key pinned by the generated
  installer. Every published asset receives GitHub/Sigstore build provenance.
- The optional AmneziaWG repository key is bundled with the signed Freenetic
  application package and pinned by digest; it is no longer downloaded from
  the same origin as the repository it authenticates.
- Network and per-device Internet blocks are placed before pre-existing
  firewall rules, preventing an earlier broad ACCEPT from bypassing the UI's
  reported policy.
- Guest firewall hardening refuses to adopt or rewrite an operator-owned or
  shared zone. Freenetic also changes global PBR state only when it previously
  enabled that state itself.

### Fixed

- Selecting Automatic transmit power now removes a previous explicit wireless
  power limit.
- Adaptive Ethernet probing recognizes both `device` and `ports` board layouts
  used by LuCI and translates structured helper errors instead of exposing raw
  backend messages.
- Release publication no longer moves the version tag after CI. Static checks
  and package builds now validate the same immutable source object that the tag
  continues to reference.
- Every final APK artifact is re-signed independently with the exported
  release key and strictly verified before publication. This avoids retaining
  a transient SDK signature on all but the first package.
- Release publication verifies the remote annotated tag object directly,
  avoiding a false rejection after `actions/checkout` peels its local tag ref
  to the tested commit.
- Release installer generation is idempotent when its template already points
  at a GitHub Release asset.
- WAN VLAN changes preserve Freenetic-created devices referenced by foreign
  interfaces or bridges, and explicit dotted device names are no longer
  mistaken for implicit VLAN notation.
- Per-device Direct policies remain represented by a MAC-scoped firewall rule
  when the optional PBR package is absent.
- The installer snapshots native CLI files and Freenetic update state before
  mutation, rolls them back on pre-commit failure, and treats post-install
  LuCI cache invalidation as best effort.
- The application ACL now grants the exact package-index update and guest
  interface activation commands used by the UI.

### Improved

- Added behavioral tests for dedicated-segment firewall state, per-zone client
  blocking and Policy-Based Routing failure propagation.
- Added ordered firewall/PBR, guest ownership, shared WAN-device, implicit VLAN
  and installer transaction regression coverage from the independent Strix
  security/correctness audit.
- Improved model-name contrast on the login banner without changing the
  Freenetic wordmark.
- Refined the WAN, VPN, DDNS, diagnostics and access-policy layouts, and gave
  the stock OpenWrt package manager a compact responsive package grid.

## [0.3.0-alpha.3] — 2026-09-15

### Release status

- Static checks and all four OpenWrt package jobs passed, including strict APK
  signature verification. Publication then stopped because the checkout action
  had locally replaced the annotated tag ref with its peeled commit before the
  publisher inspected it. No installer or package assets were published for
  this tag; the corrected build is 0.3.0-alpha.4.

## [0.3.0-alpha.2] — 2026-09-15

### Release status

- The immutable source tag is retained for traceability, but release
  publication stopped when CI rejected APK artifacts carrying the SDK's
  transient signature. No installer or package assets were published for this
  tag; the corrected build is 0.3.0-alpha.4.

## [0.3.0-alpha.1] — 2026-09-15

### Added

- Added an interactive Wi-Fi airspace map for 2.4 and 5 GHz with signal-aware
  channel recommendations, overlap visualization, current-radio footprint and
  collision-safe SSID labels.
- Added physical Ethernet port assignment for WAN, Home, Guest, unassigned and
  independent routed segments. Independent segments include DHCP, firewall and
  direct, VPN or blocked Internet policies.
- Added safe DHCP and PPPoE discovery for connected unassigned Ethernet ports.
  Detection remains advisory until the user explicitly confirms and applies a
  new WAN assignment.

### Improved

- WAN ports now have a distinct visual role while link state remains a separate
  status indicator. Port changes use active-link confirmation and an extended
  rollback window.
- Wi-Fi channel width is configured independently per radio, with driver and
  hardware-specific channel, mode, country, power and security values preserved.
- Network forms now share stricter IPv4, IPv6, netmask, route and port-range
  validation without overwriting unsupported existing protocols or actions.
- Client discovery now maps devices to DHCP-backed local segments and excludes
  upstream WAN neighbours such as the provider gateway.
- Application removal preserves packages still required by another installed
  feature, and mDNS reflection is managed through a constrained helper.

### Fixed

- Corrected DDNS command failure reporting, sysupgrade reconnect handling,
  legacy VLAN preservation, empty UCI list cleanup and CLI bounds checks.
- Refined responsive navigation, top-bar separation, client groups, loading
  feedback and Russian interface text.

### Verification

- Static, runtime, ownership, preservation and security contracts pass.
- The CLI cross-build passes for `aarch64_cortex-a53` and `mipsel_24kc`.

## [0.2.7] — 2026-09-15

### Fixed

- Other Connections protocol modules now export valid LuCI constructors;
  WireGuard, OpenVPN and IPsec editors load correctly instead of failing with
  `factory yields invalid constructor` on supported OpenWrt releases.
- The Applications catalog now refreshes repository indexes before checking
  availability or installing a feature, so one-click installs work on fresh
  initramfs boots where `opkg` or `apk` has no local package lists yet.
- Installed-package detection now uses Freenetic's structured status helper
  and accepts OpenWrt 24.10 `install user installed` records, so Applications
  and Other Connections retain the correct state after navigation.
- The password visibility button is vertically centered within the login
  password input rather than against the combined label-and-input field.

### Improved

- GitHub Release titles now include the codename of their release line while
  tags remain machine-readable semantic versions.
- Project documentation is grouped under `docs/`, with a public release
  codename table that keeps future names hidden until their line begins.

## [0.2.6] — 2026-09-14

### Improved

- Release builds now generate a checksum-pinned installer and publish the
  matching changelog section as GitHub Release notes.

### Fixed

- Build and publish `fnc` separately for each OpenWrt package-manager/runtime
  ABI; MT7621 APK routers now receive a binary built against the 25.12
  libraries instead of the incompatible 24.10 ABI.
- Release installers now select the matching `fnc` artifact and checksum for
  APK or IPK automatically.
- Architecture-only `fnc` names remain as discovery aliases so routers still
  running an older dashboard can see the update.

## [0.2.5] — 2026-09-14

### Improved

- Mobile navigation now opens as an off-canvas drawer instead of reserving a
  collapsed icon rail and squeezing page content on narrow screens; opening it
  also restores the active section when an old rail scroll offset is present
  and anchors the drawer below the rendered top bar on mobile browsers.
- Browser ubus reads now prefer uhttpd's native endpoint and coalesce calls
  issued in the same microtask without relying on `requestAnimationFrame`;
  the first batch goes straight to the native endpoint without a duplicate
  probe round-trip and falls back to the dispatcher only on transport failure.
- Dashboard dependency classes are preloaded in parallel on the dashboard
  route, and the package-manager update check is rendered after the first
  dashboard paint instead of blocking it.
- Dashboard Wi-Fi radio discovery reuses `network.wireless` interface names
  (and conventional `radioN`/`phyN` mapping) before falling back to
  `iwinfo.phyname`.
- Dashboard and Traffic Monitor use short batched polling requests instead of
  long-running CGI/SSE processes which occupied uhttpd script slots.
- Initial and SPA view loads now show the same full-height CSS loading surface
  with an animated orbit and reduced-motion fallback; it is replaced atomically
  by the rendered cards when the view is ready.

### Fixed

- Traffic Monitor now renders the device chart and legend after conntrack data
  arrives instead of failing on an undefined chart palette.

## [0.2.4] — 2026-09-13

### Improved

- Split the dashboard data/ubus layer from its UI view and split Other
  Connections into protocol-specific WireGuard/AWG, OpenVPN and IPsec LuCI
  modules behind a small dispatcher view.
- GitHub Actions now prepares target-specific release assets on every build and
  publishes a verified 14-asset GitHub Release when a version tag is pushed.

### Verification

- The `testing` branch passes the complete static, contract, runtime and
  OpenWrt SDK matrix checks.

## [0.2.3] — 2026-09-13

### Improved

- Freenetic-created UCI sections now carry an explicit ownership marker across
  guest networking, routes, firewall/port-forward rules, DDNS, DHCP hosts,
  policy routing and IPsec configuration. Automatic cleanup preserves foreign
  sections and unknown options.
- Guest Wi-Fi creation is shared by Dashboard and My Networks and refuses to
  overwrite a foreign section that happens to use a legacy reserved name.
- CI now builds and inspects OpenWrt package artifacts and target-specific CLI
  builds for the 24.10 IPK and 25.12 APK package generations.
- Added the release checklist and compatibility matrix used to distinguish
  SDK/buildroot verification from real-device testing.

### Verification

- Static, syntax, contract and runtime tests pass.
- OpenWrt 24.10.8 IPK and local OpenWrt 25.12 APK release builds pass package
  contents and index validation, including the MT7621 APK mirror.

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

- The dashboard now shows the persisted installed release tag (for example,
  `v0.2.2`) instead of labeling a release installation as `v0.2.x-dev`.
  The development label and source hash remain available for untagged builds.
- The one-shot installer now persists its pinned release tag, so installations
  started from either `main/install.sh` or a tagged installer receive the same
  release identity as updates started from the dashboard.
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
