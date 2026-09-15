'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const installer = fs.readFileSync(path.join(__dirname, '../../install.sh'), 'utf8');

assert(installer.startsWith('#!/bin/sh'), 'installer must be POSIX sh');
for (const marker of [
	"mediatek/filogic",
	"ramips/mt7621",
	"aarch64_cortex-a53",
	"mipsel_24kc",
	"luci-theme-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-app-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-theme-freenetic-${ASSET_VERSION}-all.ipk",
	"luci-app-freenetic-${ASSET_VERSION}-all.ipk",
	"luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-all.ipk",
	"luci-i18n-freenetic-ru-${ASSET_VERSION}-all.ipk",
	"FNC_BIN=\"fnc-${ASSET_VERSION}-${target_suffix}-${fnc_variant}\"",
	"sha256sum",
	"APK_RELEASE_KEY=\"freenetic-apk-release-key-${ASSET_VERSION}.pem\"",
	"apk --keys-dir \"$APK_KEYS_DIR\" add",
	"opkg install",
	"neither apk nor opkg is installed",
	"link_runtime_library",
	"LD_LIBRARY_PATH=\"/usr/lib/freenetic:/lib:/usr/lib",
	"/usr/lib/freenetic/fnc.bin",
	"/usr/bin/fnc",
	"/tmp/luci-indexcache*",
	"/etc/init.d/rpcd",
	"fnc show version",
	"freenetic.updates.installed_release=$RELEASE_TAG",
	"uci -q commit freenetic"
]) {
	assert(installer.includes(marker), `installer is missing: ${marker}`);
}

assert.match(installer, /^RELEASE_TAG="v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?"$/m,
	'release installer must carry a semver release tag');
assert.match(installer, /^ASSET_VERSION="[0-9]{2}\.[0-9]{3}\.[0-9]+\.[0-9a-f]+"$/m,
	'release installer must carry the OpenWrt-derived asset version');
for (const name of [ 'theme_sha256', 'app_sha256', 'theme_ru_sha256', 'app_ru_sha256',
	'fnc_sha256_apk', 'fnc_sha256_ipk' ]) {
	assert.strictEqual((installer.match(new RegExp(`${name}="[0-9a-f]{64}"`, 'g')) || []).length, 2,
		`${name} must be pinned for APK and IPK/target variants`);
}
assert.match(installer, /apk_key_sha256="[0-9a-f]{64}"/,
	'the APK signing key must be pinned by the generated installer');
assert.ok(installer.indexOf('stage fnc_preflight') < installer.indexOf('stage package_install'),
	'fnc ABI validation must complete before LuCI packages are changed');
assert.ok(installer.indexOf('"$FNC_STAGED_DIR/fnc.bin" show version') < installer.indexOf('stage package_install'),
	'the target binary must actually start against staged aliases before package installation');
assert.match(installer, /FNC_STAGED="\$\(mktemp \/usr\/bin\/\.fnc\.freenetic\.XXXXXX/,
	'the root-owned fnc launcher must use an unpredictable same-filesystem temporary path');
assert.doesNotMatch(installer, /\/tmp\/\.fnc\.freenetic\.\$\$/,
	'the installer must not use a PID-derived root temporary file');
assert.ok(installer.indexOf('stage native_snapshot') < installer.indexOf('stage package_install'),
	'native files must be snapshotted before the package transaction');
assert.ok(installer.indexOf('stage smoke_test') < installer.indexOf('stage package_install'),
	'all fallible native validation must finish before the package transaction');
assert.ok(installer.indexOf('stage state_commit') < installer.indexOf('stage package_install'),
	'fallible update-state persistence must finish before the package transaction');
assert.match(installer, /PERSISTENT_MUTATION_STARTED:-0[\s\S]*INSTALL_COMMITTED:-0[\s\S]*rolling back native files and update state/,
	'a pre-commit failure must restore the native and UCI snapshot');
const afterPackageCommit = installer.slice(installer.indexOf('INSTALL_COMMITTED=1',
	installer.indexOf('stage package_install')));
assert.doesNotMatch(afterPackageCommit, /\bfail\s+"/,
	'post-commit maintenance must be best-effort and cannot turn success into partial-install failure');

for (const name of [
	'fnc_ubus_lib_apk="libubus.so.20251202"',
	'fnc_ubox_lib_apk="libubox.so.20260213"',
	'fnc_blobmsg_lib_apk="libblobmsg_json.so.20260213"',
	'fnc_ubus_lib_ipk="libubus.so.20250102"',
	'fnc_ubox_lib_ipk="libubox.so.20240329"',
	'fnc_blobmsg_lib_ipk="libblobmsg_json.so.20240329"'
]) {
	assert(installer.includes(name), `installer is missing manager-specific runtime pin: ${name}`);
}

const checksumCount = (installer.match(/download_checked /g) || []).length;
assert.strictEqual(checksumCount, 6, 'installer must verify five payloads and the APK signing key');

console.log('installer contract: ok');
