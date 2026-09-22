'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const helperPath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-mihomo-package');
const helper = read('app/luci-app-freenetic/root/usr/libexec/freenetic-mihomo-package');
const ucode = read('app/luci-app-freenetic/root/usr/share/rpcd/ucode/mihomo.uc');
const service = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/init');
const uci = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/config');
const defaults = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/default-config.yaml');
const view = read('web/application/htdocs/luci-static/resources/view/network/freenetic-mihomo.js');
const applications = read('web/application/htdocs/luci-static/resources/view/system/freenetic-apps.js');
const acl = JSON.parse(read('app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'))['luci-app-freenetic'];
const menu = JSON.parse(read('app/luci-app-freenetic/root/usr/share/luci/menu.d/zz-luci-freenetic.json'))['admin/network/mihomo'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'Mihomo installer must be executable');
assert.match(helper, /MIHOMO_VERSION=1\.19\.31/, 'Mihomo version must be pinned');
assert.match(helper, /MIHOMO_BASE_URL=https:\/\/github\.com\/MetaCubeX\/mihomo\/releases\/download/);
assert.match(helper, /Mihomo SHA-256 verification failed/);
assert.match(helper, /wget -4/);
assert.match(helper, /gunzip -c/);
assert.match(helper, /status\|install\|remove/);
assert.match(helper, /already installed outside Freenetic/);
assert.match(helper, /\[ -e "\$MIHOMO_BIN" \]/);
assert.match(helper, /\[ -e "\$MIHOMO_INIT" \]/);
assert.match(helper, /\[ -e "\$MIHOMO_CONFIG" \]/);
assert.match(helper, /partial runtime so a later retry is safe/);
assert.match(helper, /mediatek\/filogic/);
assert.match(helper, /ramips\/mt7621/);
assert.match(helper, /9e0f11afbf38426b8bd88fdc594678f8161c57eccb4e1b77acb12b493904f1d/);
assert.match(helper, /9061daa6a6b8cbb0491387e5de59663441b637eff0e3d295cec6949478752192/);
assert.doesNotMatch(helper, /\binstall -m\b/, 'The router image may not ship the install applet');

assert.match(uci, /option freenetic_managed '1'/);
assert.match(uci, /option enabled '0'/, 'Mihomo must not start immediately after package installation');
assert.match(service, /start_service\(\)/);
assert.match(service, /procd_set_param command[\s\S]*mihomo/);
assert.match(service, /procd_set_param respawn/);
assert.match(defaults, /^allow-lan: false$/m);
assert.match(defaults, /MATCH,DIRECT/);

assert.match(ucode, /const MAX_INPUT = 1024 \* 1024/);
assert.match(ucode, /source_mode == 'subscriptions'/);
assert.match(ucode, /type: http/);
assert.match(ucode, /format: uri/);
assert.match(ucode, /external-controller: 127\.0\.0\.1:9090/);
assert.match(ucode, /return \{ 'mihomo': methods \}/);
assert.match(ucode, /rollback_stage/);
assert.match(ucode, /apply_raw_config/);
assert.match(ucode, /-t -f/);
assert.match(ucode, /config_data/);
assert.match(ucode, /allow_lan, false/);
assert.match(ucode, /web_ui, false/);
assert.match(ucode, /support-x25519mlkem768/,
	'Mihomo provider imports must handle current Reality handshakes');
assert.match(ucode, /network == "xhttp"/,
	'Reality compatibility overrides must stay scoped to XHTTP nodes');
assert.doesNotMatch(ucode, /text \+= '      - DIRECT\\n'/,
	'DIRECT must not silently become the default instead of the configured provider');

assert.match(view, /proxy links/i);
assert.match(view, /subscriptions/i);
assert.match(view, /apiCall\('apply'/);
assert.match(view, /apiCall\('apply_raw'/);
assert.match(view, /apiCall\('config'/);
assert.match(view, /fields\.manualConfig\.value = this\.configText/);
assert.match(view, /showEffectiveConfig/);
assert.match(view, /proxy-providers:/);
assert.match(view, /Download YAML/);
assert.match(view, /apiCall\('service'/);
assert.match(view, /Open Applications/);
assert.match(applications, /id: 'mihomo'/);
assert.match(applications, /freenetic-mihomo-package/);
assert.match(applications, /Installed outside Freenetic/);
assert.match(applications, /Managed elsewhere/);

assert.deepEqual(menu.action, { type: 'view', path: 'network/freenetic-mihomo' });
assert.deepEqual(menu.depends.acl, [ 'luci-app-freenetic' ]);
assert.equal(menu.depends.uci.mihomo.main.freenetic_managed, '1');
assert.deepEqual(acl.read.ubus.mihomo, [ 'status', 'config', 'logs' ]);
assert.deepEqual(acl.write.ubus.mihomo, [ 'apply', 'apply_raw', 'service' ]);
assert.ok(acl.read.file['/usr/libexec/freenetic-mihomo-package status']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mihomo-package install']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mihomo-package remove']);

console.log('Mihomo contract: ok');
