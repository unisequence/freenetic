# Compatibility matrix

This matrix separates what Freenetic has actually exercised from what the
package layout is intended to support. A supported target is not the same as
every device in that target family being tested.

## Status meanings

- **Developer tested** — package/CLI build and local contract checks were run
  against the stated OpenWrt SDK or buildroot.
- **User tested** — the Freenetic UI or installer was used on real hardware;
  the tested feature set is listed explicitly.
- **Expected compatible** — the release preflight and package/ABI rules allow
  the profile, but a real-device test is still wanted.
- **Known issues** — current limitations or areas that need device testing.

## Developer tested

| OpenWrt | Target/subtarget | Package format | Evidence |
|---|---|---|---|
| 24.10.8 | `mediatek/filogic` | IPK / `opkg` | official SDK package build, package contents/index, aarch64 CLI build |
| 24.10.8 | `ramips/mt7621` | IPK / `opkg` | SDK package/CLI compatibility job and mipsel CLI build |
| 25.12.5 | `mediatek/filogic` | APK / `apk` | official SDK package build, package contents/index, aarch64 CLI build |
| 25.12.5 | `ramips/mt7621` | APK / `apk` | official SDK package/CLI compatibility job and mipsel CLI build |
| 24.10.8 | `x86/64` | IPK / `opkg` | official SDK package/CLI compatibility job and x86_64 CLI build |
| 25.12.5 | `x86/64` | APK / `apk` | official SDK package/CLI compatibility job and x86_64 CLI build |
| local 24.10 buildroot | `mediatek/filogic` | IPK / `opkg` | complete `make release` including index validation |
| local 25.12 buildroot | `mediatek/filogic` | APK / `apk` | complete `make release`, MT7621 mirror and index validation |

## User tested

| Device | OpenWrt profile | Tested path |
|---|---|---|
| Globitel BT-RB300 | 24.10.8, `mediatek/filogic`, aarch64 | initramfs boot, package deployment, Freenetic UI smoke test, Wi-Fi toggle in both directions, configuration restored afterward |
| Globitel BT-RB300 | SNAPSHOT `r0+36055-4d9e2a8a08`, `mediatek/filogic`, aarch64, APK | `0.3.0` GA candidate: signed-package install, LuCI/assets, helper boundaries, isolated Ethernet segment and fw4 runtime, safe/full uninstall ownership, cache/session reset, repeat install, reboot persistence and byte-identical configuration restore |
| Globitel BT-RB300 | 25.12.5, `mediatek/filogic`, aarch64, APK | `0.4.0` fresh install and local `0.4.1` fixes: UI routes and package lifecycle, service and sysupgrade backup checks. No firmware upgrade or LAN/WAN reassignment was performed. |
| Globitel BT-RB300 | 25.12.5, `mediatek/filogic`, aarch64, APK | Local `0.4.2` candidate: five APK upgrades, LuCI authentication response, WAN and DNS; Zapret2 removal rollback, uninstall rollback and successful full uninstall, Mixomo shared HEV service state, and Mihomo DNS apply/rollback. Full uninstall removed two test-owned mwan3/HEV sections; after reinstall, all 22 saved config files matched their pretest hashes. Active secondary-WAN failover was not exercised because the router has one connected uplink. |

The real-device list should grow only from reproducible reports. Add the
OpenWrt version, target/subtarget, device, RAM and the Freenetic features
actually used; do not turn a target-level build into a claim about every
device in that family.

## Expected compatible

- OpenWrt 24.10.x on `mediatek/filogic` and `ramips/mt7621`, with IPK/
  `opkg`, a supported ABI and the package preflight resource minimums.
- OpenWrt 25.12.x on published APK target profiles, with the matching `fnc`
  ABI artifact and the package preflight resource minimums.
- OpenWrt 24.10.x and 25.12.x on `x86/64`, with the matching `x86_64` `fnc`
  artifact and the package preflight resource minimums.
- Other OpenWrt targets are not part of the `0.4.x` release promise, even if
  their LuCI JavaScript happens to render.

Check the concrete release assets and the router preflight before installing.

## Known issues and boundaries

- The `0.4.x` line does not contain MWS/mesh orchestration. Multi-WAN is
  available, but device tests have not covered every combination of uplink,
  VPN and optional traffic service.
- `fnc` still uses the private SONAME compatibility shim where the two
  supported OpenWrt lines expose different library dates. The shim does not
  replace or alter system libraries; broader ABI coverage remains future work.
- APK release packages are checked against a release-specific public key whose
  digest is pinned in the generated installer. OpenWrt's system keys remain in
  scope for dependencies. IPK payloads are still authenticated by installer-
  pinned SHA-256 rather than an independent package signature.
- GitHub Actions publishes keyless Sigstore/SLSA provenance for every release
  asset. This attests the manifest and payloads without storing a long-lived
  signing secret in the repository; signed Git tags still require a separately
  managed maintainer key.
- There is no QEMU/OpenWrt virtual smoke environment yet. SDK/buildroot checks
  catch packaging and ABI regressions, while real-device reports catch runtime
  differences.
- Optional third-party VPN protocols and kernel modules remain firmware-
  dependent. Freenetic should report unavailable capabilities instead of
  claiming that every LuCI package is portable across targets.
