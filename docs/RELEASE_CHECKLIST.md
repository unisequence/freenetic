# Freenetic release checklist

Freenetic releases are built from immutable tagged source. Stable release lines
remain feature-frozen, while a new alpha line may introduce guarded features
with an explicitly documented preview scope.

## Before release

- [ ] The change belongs in the target release line and maturity stage.
- [ ] The release commit contains the complete change and the worktree is clean.
- [ ] `make check` passes, including both supported CLI ABIs when their
      toolchains are present.
- [ ] `git diff --check` passes.
- [ ] Any ownership or helper change has a regression/contract test.
- [ ] The changelog describes the user-visible behavior and compatibility
      impact.
- [ ] Prerelease tags use the dotted form (`vX.Y.Z-alpha.N`, `-beta.N`, or
      `-rc.N`) so release titles remain anonymous until the stable reveal.
- [ ] Unrevealed release names are absent from shipped assets, release notes,
      branch names and every commit reachable from the public tag.

## Package and CLI verification

Run the checks against both supported package-manager generations:

```sh
make check OPENWRT_DIR=/path/to/openwrt-24.10 DL_DIR=/path/to/openwrt-24.10/dl
make release OPENWRT_DIR=/path/to/openwrt-24.10 DL_DIR=/path/to/openwrt-24.10/dl

make check OPENWRT_DIR=/path/to/openwrt-25.12 DL_DIR=/path/to/openwrt-25.12/dl
make release OPENWRT_DIR=/path/to/openwrt-25.12 DL_DIR=/path/to/openwrt-25.12/dl
```

The expected formats are:

- OpenWrt 24.10.x: four IPK packages for `opkg`;
- OpenWrt 25.12.x: four APK packages for `apk`;
- `fnc`: a target-specific build for every ABI advertised by the release.

For every build, verify that:

- [ ] the package contents contain the ACL, menu, translations and helpers;
- [ ] helpers and CGI entry points have executable permissions;
- [ ] the package index advertises exactly the archives beside it;
- [ ] all four packages use one source revision and release version;
- [ ] the CLI links against the intended OpenWrt ABI;
- [ ] the MT7621 and x86_64 noarch mirrors are present when the release uses APK.

The ABI compatibility shim for `fnc` remains an intentional OpenWrt integration
detail. APK releases must publish their build public key; the generated
installer pins that key by SHA-256 and uses it together with OpenWrt's system
keys instead of bypassing package signature verification.

## Router smoke test

Use a configuration backup and a disposable/test router where possible. The
following is the minimum stable-release path for each relevant OpenWrt line:

- [ ] read-only hardware/ABI preflight passes;
- [ ] fresh install completes and the selected Freenetic release is shown;
- [ ] update from the previous stable release completes;
- [ ] the LuCI shell loads in light, dark and mobile layouts;
- [ ] WAN save and reload work;
- [ ] Wi-Fi enable/disable and save work;
- [ ] firewall rule and port-forward save work;
- [ ] reboot preserves the native configuration and Freenetic metadata;
- [ ] the dashboard updater detects a newer pinned release and can install it;
- [ ] config/package backup and the intended sysupgrade `--test` path behave
      predictably.

For `0.4.x` prereleases, additionally verify that:

- [ ] one-connection mode retains the explicitly selected uplink;
- [ ] failover moves new traffic to the healthy secondary line;
- [ ] balance mode includes every healthy owned IPv4 uplink;
- [ ] an online but unselected line is shown as unused, not failed;
- [ ] a Wi-Fi uplink reports success only after DHCP and mwan3 reachability;
- [ ] simultaneous mode and Wi-Fi operations are rejected by the shared lock;
- [ ] failed Wi-Fi setup restores network, wireless, firewall and mwan3 files;
- [ ] removing Wi-Fi retains the previous mode when enough uplinks remain.

For `0.3.0`, cover a clean install, `0.2.7 → 0.3.0` and the most recent
prerelease → the candidate being tested. A downgrade need not be supported,
but it must fail clearly before leaving a partial installation.

## 0.3 network and policy smoke test

Take a configuration backup before this section. Exercise these scenarios on
a disposable/test router and verify the resulting UCI state, not only the UI
notification:

- [ ] a no-op Ethernet apply preserves custom LAN, Guest, WAN and WAN6 devices;
- [ ] WAN↔LAN reassignment either reconnects successfully or rolls back within
      the confirmation window;
- [ ] an independent segment receives a non-overlapping subnet, DHCP/DNS input
      exceptions and `input=REJECT` for other router services;
- [ ] client blocking writes the client's actual firewall source zone,
      including a `freenetic_port_*` zone;
- [ ] a port forward to a Guest or independent-segment client writes the
      matching destination zone and survives editing;
- [ ] Direct and Blocked policies take effect without PBR installed;
- [ ] a VPN policy is reported successful only after the PBR restart helper
      returns `{ "ok": true }`;
- [ ] Wi-Fi airspace scanning handles 2.4/5 GHz, channel 14 and 20/40/80/160 MHz
      overlap calculations without changing radio configuration;
- [ ] reboot preserves port roles, firewall ownership markers, traffic
      policies and the selected release channel.

## Preservation and security regression pass

- [ ] foreign UCI sections and unknown options survive a Freenetic save;
- [ ] automatic reconciliation removes only `freenetic_managed=1` objects;
- [ ] explicit Delete actions clearly state what native objects they remove;
- [ ] WireGuard/AmneziaWG peer round-trip preserves foreign options;
- [ ] hidden/advanced options produce a warning in compact editors;
- [ ] helper negative tests cover empty arguments, option-like values,
      traversal, newlines, long values and unexpected Unicode;
- [ ] no new generic `fs.exec()`/shell command boundary was introduced;
- [ ] secrets are absent from diagnostics, logs and release notes.

## Publishing

- [ ] publish from the verified release commit;
- [ ] create and push an annotated release tag from the clean, fully tested
      commit; never move or recreate a published release tag;
- [ ] build artifacts from the tag, not from a local dirty tree;
- [ ] let the tagged GitHub Actions run complete static checks, its package
      matrix, generated installer and 21-asset validation;
- [ ] verify the generated installer, APK signing key, `SHA256SUMS.txt` and
      GitHub/Sigstore provenance attestation;
- [ ] verify that the matching changelog section is present in the release
      notes;
- [ ] attach both package-manager variants and matching `fnc` binaries;
- [ ] record the tested device/target/version in `COMPATIBILITY.md`;
- [ ] verify the generated GitHub release before updating the pinned release.
