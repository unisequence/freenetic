'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const menu = JSON.parse(read('app/luci-app-freenetic/root/usr/share/luci/menu.d/zz-luci-freenetic.json'));
const acl = JSON.parse(read('app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'))['luci-app-freenetic'];
const system = read('web/application/htdocs/luci-static/resources/view/system/freenetic-system.js');
const reboot = read('web/application/htdocs/luci-static/resources/view/system/freenetic-reboot.js');
const theme = read('web/theme/htdocs/luci-static/resources/settings-freenetic.js');
const navigation = read('web/theme/htdocs/luci-static/resources/menu-freenetic.js');
const spaNavigation = read('web/theme/htdocs/luci-static/resources/freenetic-navigation.js');
const css = read('web/theme/htdocs/luci-static/freenetic/cascade.css');
const translations = read('app/luci-app-freenetic/po/ru/freenetic.po');
const themeTranslations = read('app/luci-theme-freenetic/po/ru/freenetic-theme.po');

assert.deepEqual(menu['admin/system/reboot'].action, {
	type: 'view', path: 'system/freenetic-reboot'
});
assert.equal(menu['admin/system/reboot'].depends.uci.luci.main.mediaurlbase, '/luci-static/freenetic');
assert.ok(acl.write.ubus.system.includes('reboot'));
assert.ok(acl.write.ubus.luci.includes('setPassword'));
assert.match(reboot, /callReboot\('system', 'reboot'\)/);
assert.match(reboot, /confirmReboot/);
assert.match(system, /renderPasswordCard/);
assert.match(system, /ubusCall\('luci', 'setPassword'/);
assert.match(system, /password\.value !== confirmation\.value/);
assert.match(navigation, /'system\/reboot'/);
assert.match(spaNavigation, /'admin\/system\/reboot':\s*\{\s*view: 'system\/freenetic-reboot'/);
assert.match(theme, /_\('Switch interface'\)/);
assert.match(themeTranslations, /msgid "Switch interface"\nmsgstr "Сменить интерфейс"/);
assert.match(translations, /msgid "Switch interface"\nmsgstr "Сменить интерфейс"/);
assert.match(css, /#packages \.cbi-section-actions \.btn[\s\S]*?white-space: nowrap/);
assert.match(css, /admin-status-logs-syslog[\s\S]*?textarea#syslog/);
assert.match(css, /admin-status-logs-dmesg[\s\S]*?textarea#syslog/);
assert.match(css, /\.fn-reboot-body\s*\{\s*display: grid/);
assert.match(css, /\.fn-reboot-action\s*\{[^}]*width: auto/);
assert.match(css, /body\[data-page="admin-system-reboot"\]\s+#view\s*>\s*\.cbi-page-actions\s*\{\s*display:\s*none/);
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?fn-password-form/);

console.log('UI polish contract: ok');
