'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const helperPath = 'app/luci-app-freenetic/root/usr/libexec/freenetic-sysupgrade';
const helper = read(helperPath);
const fallback = read('app/luci-app-freenetic/root/usr/share/freenetic/sysupgrade/theme-fallback');
const firstBoot = read('app/luci-app-freenetic/root/etc/uci-defaults/99_freenetic-sysupgrade');
const keep = read('app/luci-app-freenetic/root/lib/upgrade/keep.d/freenetic-ui-fallback');
const view = read('web/application/htdocs/luci-static/resources/view/system/freenetic-system.js');
const config = read('app/luci-app-freenetic/root/etc/config/freenetic');
const acl = JSON.parse(read('app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'))['luci-app-freenetic'];

assert.ok(fs.statSync(path.join(root, helperPath)).mode & 0o111, 'the backup helper must be executable');
assert.match(config, /option preserve_ui_on_upgrade '1'/);
for (const action of [ 'status', 'enable', 'disable', 'sync' ]) {
	const permission = `/usr/libexec/freenetic-sysupgrade ${action}`;
	const grants = action === 'status' ? acl.read.file : acl.write.file;
	assert.deepEqual(grants[permission], [ 'exec' ], `${action} must have an exact ACL grant`);
}
assert.match(helper, /\[ -n "\$path" \] \|\| continue/,
	'blank package inventory lines must never become a backup of /');
assert.match(helper, /Refusing broad sysupgrade backup path/,
	'root and other broad directories must be rejected');
assert.match(helper, /\[ ! -d "\$path" \] \|\| \[ -L "\$path" \] \|\| continue/,
	'package inventory directories must not pull unrelated files into the archive');
assert.match(helper, /# BEGIN FREENETIC UI \(managed\)/);
assert.match(helper, /# END FREENETIC UI \(managed\)/);
assert.match(helper, /collect_package_paths/);
assert.match(helper, /collect_development_paths/);
assert.match(helper, /\/usr\/bin\/fnc/);
assert.match(helper, /\/usr\/lib\/freenetic/);
assert.match(helper, /uci commit freenetic/);
assert.match(keep, /^\/etc\/config\/freenetic$/m);
assert.match(keep, /^\/etc\/freenetic$/m);
assert.match(keep, /^\/etc\/openvpn\/freenetic$/m);
assert.match(keep, /^\/etc\/init\.d\/freenetic-ui-fallback$/m);
assert.match(keep, /^\/etc\/rc\.d\/S15freenetic-ui-fallback$/m);
assert.match(helper, /ln -s \.\.\/init\.d\/freenetic-ui-fallback/);
assert.match(firstBoot, /freenetic-sysupgrade sync/);
assert.match(fallback, /luci\.main\.mediaurlbase=\/luci-static\/bootstrap/);
assert.match(fallback, /delete luci\.themes\.Freenetic/);
assert.match(view, /Keep Freenetic after an OpenWrt upgrade/);
assert.match(view, /SYSUPGRADE_HELPER, \[ wanted \? 'enable' : 'disable' \]/);
assert.doesNotMatch(view, /The theme is preserved across the upgrade\./);

console.log('sysupgrade preservation contract: ok');
