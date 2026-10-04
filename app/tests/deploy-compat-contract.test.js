'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(root, 'app', 'deploy.sh'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'app', 'check-router.sh'), 'utf8');

assert.match(deploy, /ROUTER="\$\{FREENETIC_ROUTER:-root@192\.168\.1\.1\}"/,
	'development deployment must support an explicit router target');
assert.match(deploy, /command -v apk/, 'development deployment must detect apk');
assert.match(deploy, /apk info -e luci-app-package-manager/, 'apk deployments must check the package');
assert.match(deploy, /apk add luci-app-package-manager/, 'apk deployments must install the package');
assert.match(deploy, /command -v opkg/, 'development deployment must detect opkg');
assert.match(deploy, /opkg status luci-app-package-manager[\s\S]*\(ok\|user\|hold\)/,
	'opkg deployments must recognize current user-installed status records');
assert.match(deploy, /opkg update/, 'opkg deployments must refresh package indexes when needed');
assert.match(deploy, /opkg install luci-app-package-manager/, 'opkg deployments must install the package');
assert.match(deploy, /Neither apk nor opkg is installed/, 'unsupported package managers must fail clearly');
assert.match(deploy, /touch \/lib\/apk\/db\/installed/,
	'development apk deployments must advance LuCI resource cache versioning');
assert.match(deploy, /touch \/usr\/lib\/opkg\/status/,
	'development opkg deployments must advance LuCI resource cache versioning');
assert.match(deploy, /rm -f \/etc\/hotplug\.d\/iface\/95-freenetic-mwan-recover/,
	'development deployments must remove the obsolete automatic recovery hook');
assert.match(deploy, /sed -i [^\n]+95-freenetic-mwan-recover/,
	'development deployments must stop preserving the obsolete hook across sysupgrade');
assert.match(deploy, /cp \/tmp\/freenetic-pkg\/root\/usr\/libexec\/freenetic-\* \/usr\/libexec\//,
	'development deployments must copy all Freenetic controllers');
assert.match(deploy, /\/usr\/libexec\/freenetic-sysupgrade sync/,
	'development deployments must refresh the optional UI backup after copying controllers');
assert.match(deploy, /cmp -s[\s\S]*luci-app-freenetic\.json[\s\S]*acl_changed=1/,
	'development deployments must notice application ACL changes');
assert.match(deploy, /acl_changed[\s\S]*rpcd restart[\s\S]*rpcd reload/,
	'development deployments must renew sessions only when their ACL snapshot is stale');
assert.match(preflight, /command -v apk/, 'router preflight must detect apk');
assert.match(preflight, /command -v opkg/, 'router preflight must detect opkg');
assert.match(preflight, /package_manager=opkg/, 'router preflight must accept OpenWrt 24.10');
assert.doesNotMatch(preflight, /apk is not installed; this release targets apk-based OpenWrt/,
	'router preflight must not reject opkg-based releases');

console.log('deploy compatibility contract: ok');
