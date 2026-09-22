'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const helperPath = 'app/luci-app-freenetic/root/usr/libexec/freenetic-magitrickle-package';
const helper = read(helperPath);
const apps = read('web/application/htdocs/luci-static/resources/view/system/freenetic-apps.js');
const wireguard = read('web/application/htdocs/luci-static/resources/freenetic-connections-wireguard.js');
const deploy = read('app/deploy.sh');
const acl = JSON.parse(read('app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'))['luci-app-freenetic'];

assert.ok(fs.statSync(path.join(root, helperPath)).mode & 0o111,
	'MagiTrickle package helper must be executable');
assert.match(helper, /APK_REPOSITORY_BASE=https:\/\/bin\.magitrickle\.dev\/packages\/openwrt\/snapshots-apk/,
	'MagiTrickle helper must use the official APK feed');
assert.match(helper, /OPKG_REPOSITORY_BASE=https:\/\/bin\.magitrickle\.dev\/packages\/openwrt\/snapshots-ipk/,
	'MagiTrickle helper must use the official IPK feed');
assert.match(helper, /APK_KEY_SHA256=/,
	'APK repository key must be pinned');
assert.match(helper, /OPKG_KEY_SHA256=/,
	'IPK repository key must be pinned');
assert.match(helper, /sha256sum[\s\S]*key_hash/,
	'repository keys must be checksum-verified before installation');
assert.match(helper, /apk update[\s\S]*apk add "\$PACKAGE"/,
	'APK installation must refresh and install MagiTrickle from its feed');
assert.match(helper, /opkg update[\s\S]*opkg install "\$PACKAGE"/,
	'IPK installation must refresh and install MagiTrickle from its feed');
assert.match(helper, /\/etc\/init\.d\/magitrickle start/,
	'MagiTrickle must be started through its native init script');
assert.match(helper, /apk del "\$PACKAGE"[\s\S]*opkg remove "\$PACKAGE"/,
	'MagiTrickle removal must support both OpenWrt package managers');

assert.match(apps, /id: 'magitrickle'[\s\S]*?externallyAvailable: true[\s\S]*?installHelper: MAGITRICKLE_PACKAGE_HELPER[\s\S]*?configureUrlPort: 8080/,
	'Applications must expose MagiTrickle through its signed external feed');
for (const id of [ 'mihomo', 'wireguard', 'openvpn', 'pptp', 'l2tp', 'l2tp_ipsec', 'ikev2_ipsec' ])
	assert.match(apps, new RegExp("'" + id + "'"), `MagiTrickle suggestion must cover ${id}`);
assert.match(apps, /shouldOfferMagiTrickle[\s\S]*?offerMagiTrickle/,
	'Applications must offer MagiTrickle after a tunnel or Mihomo installation');
assert.match(apps, /configureUrl \|\| \(configurePath \? L\.url\.apply/,
	'MagiTrickle external UI links must not call LuCI URL generation with a null path');
assert.match(apps, /Route an entire network segment or device through a selected WAN or VPN tunnel\./,
	'PBR description must explain its whole-segment/device routing role');
assert.match(wireguard, /installAwg[\s\S]*?offerMagiTrickle\(\)/,
	'AmneziaWG installation must also offer MagiTrickle');
assert.match(wireguard, /offerMagiTrickle\(\)[\s\S]*?applicationsUrl\('magitrickle'\)/,
	'AmneziaWG users must be able to open the MagiTrickle application card');

assert.ok(acl.read.file['/usr/libexec/freenetic-magitrickle-package status'],
	'LuCI must be allowed to read MagiTrickle status');
assert.ok(acl.write.file['/usr/libexec/freenetic-magitrickle-package install'],
	'LuCI must be allowed to install MagiTrickle');
assert.ok(acl.write.file['/usr/libexec/freenetic-magitrickle-package remove'],
	'LuCI must be allowed to remove MagiTrickle');
assert.match(deploy, /\/usr\/libexec\/freenetic-magitrickle-package/,
	'deployments must persist the MagiTrickle helper across sysupgrades');

console.log('MagiTrickle package contract: ok');
