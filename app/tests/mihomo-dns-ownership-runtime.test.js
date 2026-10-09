'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root,
	'app/luci-app-freenetic/root/usr/share/rpcd/ucode/mihomo.uc'), 'utf8');
function extract(name) {
	const body = source.match(new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
	assert.ok(body, `${name} must exist`);
	return body;
}
const code = [ extract('https_dns_stage'), extract('https_dns_rollback') ].join('\n');
const values = {
	'https-dns-proxy': { config: { proxy_server: 'https://operator.example/dns', listen_addr: '0.0.0.0' } },
	mihomo: { main: {} }
};
let available = true;
let failCommit = false;
const cursor = () => ({
	get: (pkg, section, key) => values[pkg]?.[section]?.[key],
	set: (pkg, section, key, value) => { values[pkg] ??= {}; values[pkg][section] ??= {}; values[pkg][section][key] = value; },
	commit: pkg => { if (pkg === 'mihomo' && failCommit) { failCommit = false; throw new Error('injected commit failure'); } }
});
const api = new Function('cursor', 'path_exists', 'executable', 'HTTPS_DNS_CONFIG', 'HTTPS_DNS_INIT',
	'read_text', 'CONFIG_BACKUP', 'CONFIG', 'config_value', 'int', 'failure',
	`${code}\nreturn { https_dns_stage, https_dns_rollback };`)(
	cursor, () => available, () => available, '/etc/config/https-dns-proxy',
	'/etc/init.d/https-dns-proxy', pathname => pathname.endsWith('.previous') ?
		'mixed-port: 7990\n' : 'mixed-port: 7890\n',
	'/etc/mihomo/.config.yaml.previous', '/etc/mihomo/config.yaml',
	(text, name, fallback) => text.match(/^mixed-port: (\d+)/m)?.[1] || fallback,
	Number, (code, message) => ({ ok: false, error: { code, message } }));

const initial = api.https_dns_stage(true, 7890);
assert.equal(initial.changed, true);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'http://127.0.0.1:7890');
assert.equal(values.mihomo.main.freenetic_dns_proxy_previous, 'https://operator.example/dns');
assert.equal(values.mihomo.main.freenetic_dns_proxy_applied, 'http://127.0.0.1:7890');

api.https_dns_stage(true, 7990);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'http://127.0.0.1:7990');
assert.equal(values.mihomo.main.freenetic_dns_proxy_previous, 'https://operator.example/dns');

values['https-dns-proxy'].config.proxy_server = 'https://edited.example/dns';
const refused = api.https_dns_stage(true, 8080);
assert.equal(refused.ok, false);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'https://edited.example/dns',
	'Freenetic must not overwrite an operator edit when reapplying Mihomo');
const released = api.https_dns_stage(false, 0);
assert.equal(released.proxy_changed, false);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'https://edited.example/dns',
	'operator changes must survive Freenetic disabling secure DNS');
assert.equal(values.mihomo.main.freenetic_dns_proxy_managed, '0');

values['https-dns-proxy'].config.proxy_server = 'https://operator.example/dns';
values['https-dns-proxy'].config.listen_addr = '0.0.0.0';
failCommit = true;
const failed = api.https_dns_stage(true, 7890);
assert.equal(failed.ok, false);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'https://operator.example/dns',
	'a failed second UCI commit must restore the first package');

values.mihomo.main.freenetic_dns_proxy_managed = '1';
values.mihomo.main.freenetic_dns_proxy_applied = '';
values.mihomo.main.freenetic_dns_proxy_previous = 'https://operator.example/dns';
values.mihomo.main.freenetic_dns_listen_previous = '0.0.0.0';
values['https-dns-proxy'].config.proxy_server = 'http://127.0.0.1:7890';
values['https-dns-proxy'].config.listen_addr = '127.0.0.1';
const legacy = api.https_dns_stage(false, 0);
assert.equal(legacy.proxy_changed, true);
assert.equal(values['https-dns-proxy'].config.proxy_server, 'https://operator.example/dns',
	'legacy removal must use the live Mihomo port, even if a stale apply backup exists');

values.mihomo.main.freenetic_dns_proxy_managed = '1';
available = false;
const missing = api.https_dns_stage(false, 0);
assert.equal(missing.changed, true);
assert.equal(values.mihomo.main.freenetic_dns_proxy_managed, '0',
	'a missing optional proxy must not leave stale Mihomo ownership');

console.log('Mihomo DNS ownership runtime: ok');
