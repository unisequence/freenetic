'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const makefile = fs.readFileSync(path.join(root, 'app/freenetic-zapret2/Makefile'), 'utf8');
const helperPath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-zapret2-package');
const helper = fs.readFileSync(helperPath, 'utf8');
const controllerPath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-zapret2');
const controller = fs.readFileSync(controllerPath, 'utf8');
const apps = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/system/freenetic-apps.js'), 'utf8');
const view = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/network/freenetic-zapret2.js'), 'utf8');
const configView = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/zapret2/v4r30/config.js'), 'utf8');
const profilesView = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/zapret2/v4r30/profiles.js'), 'utf8');
const listsView = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/zapret2/v4r30/lists.js'), 'utf8');
const logView = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/zapret2/v4r30/log.js'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root,
	'app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];

assert.match(makefile, /PKG_VERSION:=1\.0\.5\.2/,
	'Zapret2 package must pin an upstream version');
assert.match(fs.readFileSync(path.join(root,
	'app/freenetic-zapret2/files/usr/libexec/zapret2/compiler.sh'), 'utf8'), /ENGINE_VERSION=1\.0\.5\.2/,
	'Zapret2 control-plane metadata must describe the packaged engine version');
assert.match(makefile, /PKG_HASH:=fb3bcf69e7d86b9fa2d60bd53c956ac06d9dcc3adf9392afd84865f1d94b1158/,
	'Zapret2 source archive must be checksum-pinned');
assert.match(makefile, /PKG_LICENSE:=MIT/,
	'Zapret2 package must preserve the upstream MIT license');
assert.match(makefile, /NFQWS2_ENABLE=0/,
	'packaged default configuration must leave NFQWS2 disabled');
assert.match(makefile, /\$\(INSTALL_BIN\).*files\/etc\/init\.d\/zapret2.*\$\(1\)\/etc\/init\.d\/zapret2/,
	'package must install the native procd service');
assert.match(makefile, /files\/etc\/config\/zapret2.*\$\(1\)\/etc\/config\/zapret2/,
	'package must install the versioned native UCI schema');
assert.match(makefile, /binaries\/\$\(ZAPRET2_BIN_ARCH\)\/nfqws2/,
	'package must select the official binary matching the target architecture');
assert.ok(fs.statSync(helperPath).mode & 0o111,
	'Zapret2 release installer must be executable');
assert.match(helper, /manifest="\$stage_dir\/SHA256SUMS\.txt"/,
	'Zapret2 release installer must consume the published release manifest');
assert.match(helper, /actual_hash="\$\(sha256sum "\$destination"/,
	'Zapret2 release installer must verify the published package checksum');
assert.match(helper, /apk --keys-dir "\$keys_dir" add/,
	'Zapret2 APK installation must use the Freenetic release signing key');
assert.match(helper, /freenetic-zapret2-apk-key-\$asset_arch-/,
	'Zapret2 APK installation must select the key belonging to the target build');
assert.match(helper, /mediatek\/filogic[\s\S]*aarch64_cortex-a53[\s\S]*ramips\/mt7621[\s\S]*mipsel_24kc[\s\S]*x86\/64[\s\S]*x86_64/,
	'Zapret2 installer must map all supported targets to their package architectures');
assert.match(apps, /packages: \[ 'zapret2', 'luci-app-zapret2' \][\s\S]*?\[ 'freenetic-zapret2' \][\s\S]*?externallyAvailable: true, installHelper: ZAPRET2_PACKAGE_HELPER/,
	'Applications must prefer the native Zapret2 LuCI pair and retain the signed Freenetic fallback');
assert.ok(acl.write.file['/usr/libexec/freenetic-zapret2-package install'],
	'LuCI must be allowed to invoke the constrained Zapret2 installer');
assert.ok(fs.statSync(controllerPath).mode & 0o111,
	'Zapret2 configuration controller must be executable');
assert.match(controller, /cp -a \/etc\/config\/zapret2 "\$snapshot_dir\/zapret2"/,
	'Zapret2 configuration changes must snapshot the complete UCI file');
assert.match(controller, /set zapret2\.main\.intercept_mode='all'/,
	'the compact UI must use the explicit all-traffic mode rather than an unconfigured mark');
assert.match(controller, /restore_snapshot/,
	'Zapret2 configuration changes must retain a rollback path');
assert.match(controller, /http_default\.enabled[\s\S]*tls_default\.enabled[\s\S]*quic_default\.enabled/,
	'the controller must expose only the three reviewed starter profiles');
assert.match(view, /admin\/services\/zapret2/,
	'Zapret2 entry point must open the installed native LuCI client');
assert.match(apps, /nativeConfigurePath: \[ 'admin', 'services', 'zapret2' \]/,
	'Applications must point the native package at its own LuCI route');
assert.match(configView, /api\.validate\(model\.candidate\(\)\)/,
	'Zapret2 settings must validate the full candidate through ubus');
assert.match(configView, /api\.service\('reload'\)/,
	'Zapret2 settings must apply through the native service API');
assert.match(profilesView, /api\.validate\(model\.candidate\(\)\)/,
	'Zapret2 profiles must validate the full candidate through ubus');
assert.match(listsView, /api\.list(Index|Get|Put|Delete|Clear)/,
	'Zapret2 lists must use the native list API');
assert.match(logView, /api\.log\(/,
	'Zapret2 log must use the native log API');

console.log('Zapret2 package contract: ok');
