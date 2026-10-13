'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname,
	'../luci-app-freenetic/root/usr/libexec/freenetic-multiwan'), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-multiwan-'));
const config = path.join(temp, 'mwan3.json');
const stockHttps = { type: 'rule', dest_port: '443', proto: 'tcp', sticky: '1', use_policy: 'balanced' };
const fixture = () => ({
	network: {
		wan: { type: 'interface' },
		fnwwan: { type: 'interface', freenetic_managed: '1', freenetic_scope: 'wifi-uplink' }
	},
	mwan3: {
		wan: { type: 'interface', enabled: '1', family: 'ipv4' },
		fnwwan: { type: 'interface', enabled: '1', family: 'ipv4' },
		https: { ...stockHttps },
		balanced: { type: 'policy', use_member: [ 'wan_m1_w3', 'wanb_m1_w3' ] },
		default_rule_v4: { type: 'rule', family: 'ipv4', dest_ip: '0.0.0.0/0', use_policy: 'balanced' }
	}
});
function executable(name, text) {
	fs.writeFileSync(path.join(temp, name), text, { mode: 0o700 });
}
try {
	executable('uci', `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.TEST_CONFIG;
const state = JSON.parse(fs.readFileSync(file));
const [command, arg = ''] = process.argv.slice(2).filter(x => x !== '-q');
const [key, value] = arg.split('=');
const [pkg, section, option] = key.split('.');
const item = state[pkg]?.[section];
if (command === 'get') {
 const result = option ? item?.[option] : item?.type;
 if (result === undefined) process.exit(1);
 console.log(Array.isArray(result) ? result.join(' ') : result);
} else if (command === 'show') {
 for (const [name, entry] of Object.entries(state[pkg] || {})) {
  if (section && section !== name) continue;
  console.log(pkg + '.' + name + '=' + entry.type);
  for (const [opt, val] of Object.entries(entry))
   if (opt !== 'type') console.log(pkg + '.' + name + '.' + opt + "='" + val + "'");
 }
} else if (command === 'set') {
 state[pkg] ||= {};
 if (!option) state[pkg][section] ||= { type: value };
 else state[pkg][section][option] = value;
} else if (command === 'delete') {
 if (option) delete item[option]; else delete state[pkg][section];
} else if (command === 'add_list') {
 item[option] ||= []; item[option].push(value);
}
fs.writeFileSync(file, JSON.stringify(state));
`);
	executable('id', '#!/bin/sh\necho 0\n');
	executable('logger', '#!/bin/sh\nexit 0\n');
	// Primary is offline; only the Wi-Fi connectivity probe succeeds.
	executable('mwan3', '#!/bin/sh\n[ "$1:$2" = use:fnwwan ]\n');
	executable('service', '#!/bin/sh\n[ "${TEST_RELOAD_FAIL:-0}" != 1 ]\n');
	fs.writeFileSync(path.join(temp, 'jshn.sh'), `
json_init() { fields=; }
json_add_boolean() { fields="$fields\\\"$1\\\":$2,"; }
json_add_string() { fields="$fields\\\"$1\\\":\\\"$2\\\","; }
json_dump() { printf '{%s}\\n' "\${fields%,}"; }
`);
	const helper = path.join(temp, 'helper');
	fs.writeFileSync(helper, source
		.replace('/usr/share/libubox/jshn.sh', path.join(temp, 'jshn.sh'))
		.replaceAll('/etc/config/mwan3', config)
		.replaceAll('/etc/init.d/mwan3', path.join(temp, 'service'))
		.replaceAll('/tmp/freenetic-mwan-mutation.lock', path.join(temp, 'lock')));
	function run(state, failReload = false) {
		fs.writeFileSync(config, JSON.stringify(state));
		const result = spawnSync('sh', [ helper, 'apply', 'single', 'fnwwan' ], {
			encoding: 'utf8', env: { ...process.env, PATH: temp + ':' + process.env.PATH,
				TEST_CONFIG: config, TEST_RELOAD_FAIL: failReload ? '1' : '0' }
		});
		assert.equal(result.status, 0, result.stderr);
		return { reply: JSON.parse(result.stdout), state: JSON.parse(fs.readFileSync(config)) };
	}
	let result = run(fixture());
	assert.equal(result.reply.ok, 1);
	assert.equal(result.state.mwan3.https, undefined);
	assert.equal(result.state.mwan3.default_rule_v4.use_policy, 'fn_s4');
	assert.equal(result.state.mwan3.fn_s4_0.interface, 'fnwwan');
	// Model first-match routing: both HTTP and HTTPS must reach the Wi-Fi default.
	for (const port of [ '80', '443' ]) {
		const rules = Object.values(result.state.mwan3).filter(x => x.type === 'rule');
		const rule = rules.find(x => !x.dest_port || x.dest_port === port);
		assert.equal(rule.use_policy, 'fn_s4');
	}
	for (const custom of [ { src_ip: '192.168.64.10' }, { family: 'ipv6' },
		{ use_policy: 'wan_only' }, { sticky: '0' }, { dest_port: '443 8443' } ]) {
		const state = fixture();
		Object.assign(state.mwan3.https, custom);
		result = run(state);
		assert.equal(result.reply.ok, 1);
		assert.deepEqual(result.state.mwan3.https, state.mwan3.https);
	}
	const state = fixture();
	result = run(state, true);
	assert.equal(result.reply.ok, 0);
	assert.equal(result.reply.error_code, 'reload');
	assert.deepEqual(result.state, state, 'failed reload must restore HTTPS and the previous policy');
	console.log('Multi-WAN HTTPS migration runtime: ok');
}
finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
