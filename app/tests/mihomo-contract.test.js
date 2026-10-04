'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const helperPath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-mihomo-package');
const helper = read('app/luci-app-freenetic/root/usr/libexec/freenetic-mihomo-package');
const ucode = read('app/luci-app-freenetic/root/usr/share/rpcd/ucode/mihomo.uc');
const service = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/init');
const uci = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/config');
const defaults = read('app/luci-app-freenetic/root/usr/share/freenetic/mihomo/default-config.yaml');
const keepFiles = read('app/luci-app-freenetic/root/lib/upgrade/keep.d/freenetic-mihomo').split('\n');
const deploy = read('app/deploy.sh');
assert.match(deploy, /root\/lib\/upgrade\/keep\.d\/\* \/lib\/upgrade\/keep\.d\//,
	'development deployments must install the Mihomo backup rule');
for (const pathname of [ '/etc/mihomo/config.yaml', '/etc/mihomo/providers/freenetic.txt',
	'/etc/hev-socks5-tunnel/freenetic-mihomo.yml', '/etc/hev-socks5-tunnel/.freenetic-mihomo' ])
	assert.ok(keepFiles.includes(pathname), `${pathname} must survive sysupgrade`);
const view = read('web/application/htdocs/luci-static/resources/view/network/freenetic-mihomo.js');
const applications = read('web/application/htdocs/luci-static/resources/view/system/freenetic-apps.js');
const russian = read('app/luci-app-freenetic/po/ru/freenetic.po');
const acl = JSON.parse(read('app/luci-app-freenetic/root/usr/share/rpcd/acl.d/luci-app-freenetic.json'))['luci-app-freenetic'];
const menuEntries = JSON.parse(read('app/luci-app-freenetic/root/usr/share/luci/menu.d/zz-luci-freenetic.json'));
const menu = menuEntries['admin/services/mihomo'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'Mihomo installer must be executable');
assert.match(helper, /MIHOMO_VERSION=1\.19\.31/, 'Mihomo version must be pinned');
assert.match(helper, /MIHOMO_BASE_URL=https:\/\/github\.com\/MetaCubeX\/mihomo\/releases\/download/);
assert.match(helper, /Mihomo SHA-256 verification failed/);
assert.match(helper, /wget -4/);
assert.match(helper, /gunzip -c/);
assert.match(helper, /df -Pk \/usr\/bin/,
	'Mihomo installation must measure free space on the destination filesystem');
assert.match(helper, /required_kib=\$\(\( \(binary_bytes \+ 1023\) \/ 1024 \+ min_remaining_kib \)\)/,
	'Mihomo installation must reserve space after copying the decompressed binary');
assert.ok(helper.indexOf('required_kib=$((') < helper.indexOf('mv "$stage_dir/mihomo" "$MIHOMO_BIN"'),
	'the space check must run before any binary is copied onto the overlay');
assert.match(helper, /if ! mv "\$stage_dir\/mihomo" "\$MIHOMO_BIN"; then\s*rm -f "\$MIHOMO_BIN"/,
	'a failed cross-filesystem copy must not leave a partial executable');
assert.match(helper, /status\|install\|remove/);
assert.match(helper, /already installed outside Freenetic/);
assert.match(helper, /\[ -e "\$MIHOMO_BIN" \]/);
assert.match(helper, /\[ -e "\$MIHOMO_INIT" \]/);
assert.match(helper, /json_add_boolean config_only/);
assert.match(helper, /config_only=1/);
assert.match(helper, /Keep a pre-existing config-only setup intact/);
assert.match(helper, /Cannot adopt the existing Mihomo configuration/);
const removeFunction = helper.match(/remove_runtime\(\) \{([\s\S]*?)\n\}/)[1];
assert.match(removeFunction, /mihomo\.main\.freenetic_managed/,
	'Mihomo removal must check Freenetic ownership');
assert.match(removeFunction, /Mihomo is not managed by Freenetic/,
	'Mihomo removal must refuse to delete an external installation');
assert.match(removeFunction, /freenetic-mixomo disconnect/,
	'Mihomo removal must disconnect its managed tunnel first');
assert.doesNotMatch(removeFunction, /rm -f[^\n]*\$MIHOMO_CONFIG/,
	'Mihomo removal must preserve a possibly pre-existing UCI configuration');
assert.match(removeFunction, /uci -q delete mihomo\.main\.freenetic_managed[\s\S]*uci -q commit mihomo/,
	'Mihomo removal must relinquish its ownership marker');
const installFunction = helper.match(/install_runtime\(\) \{([\s\S]*?)\n\}/)[1];
const installGuard = installFunction.split('target_asset')[0];
assert.match(installGuard, /if \[ -e "\$MIHOMO_BIN" \] \|\| \[ -e "\$MIHOMO_INIT" \]/,
	'A config-only remnant must not block installation');
assert.match(helper, /uci -q set mihomo\.main\.freenetic_managed='1'/);
assert.match(helper, /mediatek\/filogic/);
assert.match(helper, /ramips\/mt7621/);
assert.match(helper, /x86\/64/);
assert.match(helper, /mihomo-linux-amd64-compatible-v1\.19\.31\.gz/);
assert.match(helper, /9e0f11afbf38426b8bd88fdc594678f8161c57eccb4e1b77acb12b493904f1d/);
assert.match(helper, /9061daa6a6b8cbb0491387e5de59663441b637eff0e3d295cec6949478752192/);
assert.match(helper, /04cf9f09671704f839ddbee2e93069dc831a4123a75281e725d1d96ab9ac1afc/);
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
assert.match(ucode, /apply_external_config\(request\)/);
assert.match(ucode, /function apply_external_config\(request\) \{\s*if \(system\(`\[ -x \${BINARY} \] && \[ -x \${INIT} \] && \[ -s \${CONFIG} \]`\) != 0\)/,
	'external Mihomo must not require the Freenetic UCI section');
assert.match(ucode, /current != expected[\s\S]*config_changed/,
	'external apply must reject a config changed since the browser read it');
assert.match(ucode, /BINARY} -d \${HOME} -t -f \${EXTERNAL_CONFIG_TMP}[\s\S]*cp -a \${CONFIG} \${EXTERNAL_CONFIG_BACKUP}[\s\S]*mv \${EXTERNAL_CONFIG_TMP} \${CONFIG}/,
	'external apply must validate before replacing the native config');
assert.match(ucode, /action\.rc != 0[\s\S]*mv \${EXTERNAL_CONFIG_BACKUP} \${CONFIG}/,
	'external apply must restore the native config if Mihomo fails to restart');
assert.match(ucode, /allow_lan, false/);
assert.match(ucode, /web_ui, false/);
assert.match(ucode, /secure_dns: false/);
assert.match(ucode, /dns_policy: ''/);
assert.match(ucode, /https-dns-proxy/);
assert.match(ucode, /auto-redirect: true/);
assert.match(ucode, /dns-hijack/);
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
assert.match(view, /packageStatus && packageStatus\.existing[\s\S]*fs\.read\(EXTERNAL_CONFIG\)/,
	'the external Mihomo page must read the existing YAML for a complete, read-only preview');
assert.match(view, /showEffectiveConfig/);
assert.match(view, /proxy-providers:/);
assert.match(view, /Download YAML/);
assert.match(view, /Secure DNS through https-dns-proxy/);
assert.match(view, /Transparent TUN mode/);
assert.match(view, /apiCall\('service'/);
assert.match(view, /Open Applications/);
assert.match(view, /packageStatus\.existing \? this\.renderExternal\(\)/,
	'the Mihomo page must recognize an upstream installation');
assert.match(view, /Open separately/,
	'the upstream installation must link to its own LuCI editor');
assert.match(view, /renderExternal\(\)[\s\S]*admin\/services\/mihomo\/native[\s\S]*fn-mihomo-native-frame[\s\S]*renderExternalParser\(\)/,
	'the upstream interface must remain visible above the Freenetic parser');
assert.match(view, /parserYaml\(sourceMode, source, reservedNames\)[\s\S]*parseProxyUri/,
	'the external parser must reuse local proxy URI conversion');
const externalView = view.slice(view.indexOf('\trenderExternal()'), view.indexOf('\trenderMissing()'));
assert.match(externalView, /_\('Preview'\)/);
assert.match(externalView, /_\('Apply'\)/);
assert.match(externalView, /fn-mihomo-actions' }, \[ preview, apply \]/,
	'preview must appear before the primary apply action');
assert.match(externalView, /apiCall\('apply_external', \{ config: result\.text, expected_config: config \}\)/,
	'apply must send the merged config with the exact source it was based on');
assert.match(externalView, /Use imported proxy directly/,
	'an external config without groups must offer direct routing for one imported proxy');
assert.doesNotMatch(externalView, /_\('Copy'\)/);
assert.match(externalView, /fn-mihomo-converter-grid/,
	'the parser should use a compact responsive input/output layout');
assert.match(externalView, /fn-sr-only[\s\S]*Sources[\s\S]*fn-sr-only[\s\S]*Complete YAML/,
	'the simplified layout must keep accessible field labels');
assert.match(externalView, /fs\.read\(EXTERNAL_CONFIG\)[\s\S]*mergeParserYaml\(config, mode\.value, source\.value, group\.value\)/,
	'preview and apply must merge with the latest router YAML');
assert.match(externalView, /source\.addEventListener\('input', invalidate\)/,
	'editing sources must invalidate the previous YAML preview');
assert.doesNotMatch(externalView, /Convert proxy links or URI subscriptions into a YAML fragment/,
	'the external parser should not repeat obvious explanatory text');
const parserContext = {
	view: { extend: methods => methods }, URL, atob, Uint8Array, TextDecoder,
	uiHelper: { notify() {} },
	_: value => ({ format: (...args) => args.reduce((text, arg) => text.replace('%s', arg), value) })
};
vm.runInNewContext('(function(){' + view.replace('return view.extend({',
	'globalThis.parserYaml = parserYaml;\nglobalThis.mergeParserYaml = mergeParserYaml;\nreturn view.extend({') + '})()', parserContext);
const parsedLinks = parserContext.parserYaml('links',
	'vless://test-id@edge.example:443?security=reality&pbk=test-key&type=xhttp#Alpha\n' +
	'vless://test-id@edge.example:443?security=reality&pbk=test-key&type=xhttp#Alpha');
assert.match(parsedLinks.text, /proxies:[\s\S]*name: "Alpha"[\s\S]*name: "Alpha \(2\)"/,
	'the parser must produce unique proxy names without changing the native config');
assert.match(parsedLinks.text, /network: "xhttp"[\s\S]*support-x25519mlkem768: true/,
	'the parser must preserve the XHTTP Reality compatibility fields');
const parsedSubscription = parserContext.parserYaml('subscriptions', 'https://example.com/subscription?token=test');
assert.match(parsedSubscription.text, /proxy-providers:[\s\S]*format: uri/,
	'URI subscriptions must produce a Mihomo provider fragment');
const link = 'vless://test-id@edge.example:443?security=reality&pbk=test-key&type=xhttp#Alpha';
const emptyGroups = [ 'mixed-port: 7890', 'proxies:', '  - name: "Home"', '    type: direct',
	'proxy-groups:', 'rules:', '  - MATCH,Home', '' ].join('\n');
const withNewGroup = parserContext.mergeParserYaml(emptyGroups, 'links', link, '__create__').text;
assert.match(withNewGroup, /^mixed-port: 7890$/m);
assert.match(withNewGroup, /proxy-groups:\n  - name: "FREENETIC"\n    type: select\n    proxies:\n      - "Home"\n      - "Alpha"/);
assert.match(withNewGroup, /rules:\n  - "MATCH,FREENETIC"/);
assert.equal((withNewGroup.match(/- name:/g) || []).length, 3);
const withNewProviderGroup = parserContext.mergeParserYaml(emptyGroups,
	'subscriptions', 'https://example.com/subscription', '__create__').text;
assert.match(withNewProviderGroup, /proxy-groups:\n  - name: "FREENETIC"\n    type: select\n    proxies:\n      - "Home"\n    use:\n      - "freenetic-1"/);
assert.match(withNewProviderGroup, /rules:\n  - "MATCH,FREENETIC"/);
const directBase = [ 'mixed-port: 7890', 'proxies:', '  - name: "Home"', '    type: direct',
	'rules:', '  - MATCH,Home', '' ].join('\n');
const withDirectProxy = parserContext.mergeParserYaml(directBase, 'links', link, '__direct__').text;
assert.doesNotMatch(withDirectProxy, /proxy-groups:/);
assert.match(withDirectProxy, /rules:\n  - "MATCH,Alpha"/);
assert.equal((withDirectProxy.match(/- name:/g) || []).length, 2);
assert.throws(() => parserContext.mergeParserYaml(directBase, 'links', link + '\n' + link, '__direct__'),
	'direct routing must reject multiple proxy links');
const existingGroup = [ 'mixed-port: 7890', 'proxies:', '  - name: "Alpha"', '    type: direct',
	'proxy-groups:', '  - name: PROXY', '    type: select', '    proxies:', '      - "Alpha"',
	'rules:', '  - MATCH,PROXY', '' ].join('\n');
const withExistingGroup = parserContext.mergeParserYaml(existingGroup, 'links', link, 'PROXY').text;
assert.match(withExistingGroup, /proxy-groups:\n  - name: PROXY\n    type: select\n    proxies:\n      - "Alpha"\n      - "Alpha \(2\)"/);
assert.match(withExistingGroup, /rules:\n  - MATCH,PROXY/);
assert.equal((withExistingGroup.match(/- name:/g) || []).length, 3);
const withProvider = parserContext.mergeParserYaml(existingGroup,
	'subscriptions', 'https://example.com/subscription', 'PROXY').text;
assert.match(withProvider, /proxy-providers:\n  freenetic-1:[\s\S]*format: uri/);
assert.match(withProvider, /proxy-groups:[\s\S]*    use:\n      - "freenetic-1"/);
assert.throws(() => parserContext.mergeParserYaml('proxies: []\nproxy-groups: []\nrules: [MATCH,DIRECT]\n',
	'links', link, '__create__'), /MATCH|unsupported/i, 'unsupported YAML layouts must be rejected');
assert.match(applications, /id: 'mihomo'/);
assert.match(applications, /freenetic-mihomo-package/);
assert.match(applications, /configurePath: \[ 'admin', 'services', 'mihomo' \]/);
assert.match(applications, /nativeConfigurePath: \[ 'admin', 'services', 'mihomo', 'native' \]/);
assert.match(applications, /Installed outside Freenetic/);
assert.match(applications, /Managed elsewhere/);
assert.match(applications, /Configuration found/);
assert.match(applications, /An existing Mihomo configuration will be preserved/);
assert.match(russian, /msgid "Configuration found"\nmsgstr "Найдена конфигурация"/);
assert.match(russian, /msgid "%s An existing Mihomo configuration will be preserved when the core is installed\."\nmsgstr "%s Существующая конфигурация Mihomo будет сохранена при установке ядра\."/);

assert.ok(!menuEntries['admin/network/mihomo'], 'Mihomo must no longer appear under Network');
assert.deepEqual(menu.action, { type: 'view', path: 'network/freenetic-mihomo' });
assert.deepEqual(menu.depends.acl, [ 'luci-app-freenetic' ]);
assert.ok(!menu.depends.uci, 'Mihomo entry must remain visible for upstream installations');
assert.deepEqual(menuEntries['admin/services/mihomo/native'].action,
	{ type: 'view', path: 'mihomo/config' });
assert.deepEqual(menuEntries['admin/services/mihomo/native'].depends.acl,
	[ 'luci-app-mihomo' ]);
assert.deepEqual(acl.read.ubus.mihomo, [ 'status', 'config', 'logs' ]);
assert.deepEqual(acl.read.file['/etc/mihomo/config.yaml'], [ 'read' ]);
assert.deepEqual(acl.write.ubus.mihomo, [ 'apply', 'apply_raw', 'apply_external', 'service' ]);
assert.ok(acl.read.file['/usr/libexec/freenetic-mihomo-package status']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mihomo-package install']);
assert.ok(acl.write.file['/usr/libexec/freenetic-mihomo-package remove']);

console.log('Mihomo contract: ok');
