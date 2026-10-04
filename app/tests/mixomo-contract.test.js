'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const helperPath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-mixomo');
const helper = fs.readFileSync(helperPath, 'utf8');
const magitrickle = fs.readFileSync(path.join(root,
	'app/luci-app-freenetic/root/usr/libexec/freenetic-magitrickle-package'), 'utf8');
const view = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/magitrickle/magitrickle.js'), 'utf8');
const apps = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/system/freenetic-apps.js'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root,
	'app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'Mixomo helper must be executable');
assert.match(helper, /TUN_CONFIG=\/etc\/hev-socks5-tunnel\/freenetic-mihomo\.yml/,
	'the helper must use a dedicated configuration, not replace main.yml');
assert.match(helper, /external_bridge\(\)[\s\S]*\/etc\/hev-socks5-tunnel\/main\.yml[\s\S]*network\.Mihomo\.device/,
	'the upstream Mixomo tunnel must be recognized without adopting its settings');
assert.match(helper, /connect_bridge\(\)[\s\S]*! external_bridge \|\| fail/,
	'connect must refuse to replace an upstream Mixomo tunnel');
assert.match(helper, /disconnect_bridge\(\)[\s\S]*! external_bridge \|\| fail/,
	'disconnect must refuse to remove an upstream Mixomo tunnel');
assert.match(helper, /for section in[\s\S]*owned_section "\$section"/,
	'existing named sections must pass an ownership check');
assert.match(helper, /uci -q changes "\$config"/,
	'pending native UCI edits must not be committed accidentally');
assert.match(helper, /uci -q revert "\$config"[\s\S]*cp -p "\$stage_dir\/\$config"/,
	'failed updates must discard staged UCI deltas and restore the snapshot');
assert.match(helper, /firewall\.\$FORWARD_SECTION\.freenetic_managed=1/,
	'LAN-to-tunnel forwarding must be marked as owned');
assert.match(helper, /if ! bridge_configured; then[\s\S]*any_owned_section[\s\S]*incomplete/,
	'disconnect must refuse an incomplete managed state rather than leave fragments');
assert.doesNotMatch(helper, /uci -q delete firewall\.@|rm -rf \/etc\/mihomo/,
	'the bridge must not remove unrelated network policy or Mihomo data');

const status = childProcess.execFileSync(helperPath, [ 'status' ], { encoding: 'utf8' });
const parsed = JSON.parse(status);
assert.equal(parsed.code, 0, 'status action must return valid JSON without a router runtime');
assert.equal(typeof parsed.bridge_configured, 'boolean');
assert.equal(typeof parsed.bridge_running, 'boolean');
assert.equal(typeof parsed.external_bridge, 'boolean');
assert.equal(typeof parsed.external_running, 'boolean');

assert.match(magitrickle, /freenetic-mixomo disconnect[\s\S]*Cannot remove the managed Mihomo tunnel/,
	'MagiTrickle removal must remove its managed tunnel first');
assert.match(view, /MIXOMO_HELPER[\s\S]*confirmBridge[\s\S]*confirmList/,
	'the service view must expose tunnel controls and the list separately');
assert.match(view, /status\.external_bridge[\s\S]*return;/,
	'the service view must not offer Freenetic tunnel actions for upstream Mixomo');
assert.match(apps, /offerMagiTrickleList[\s\S]*MIXOMO_HELPER[\s\S]*\[ 'connect' \]/,
	'the installation flow must connect Mihomo before offering the list');
assert.match(apps, /status\.bridge_running \|\| status\.external_running/,
	'the app catalog must reuse an already running upstream Mixomo tunnel');
assert.ok(acl.read.file['/usr/libexec/freenetic-mixomo status']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mixomo connect']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mixomo disconnect']);

console.log('Mixomo integration contract: ok');
