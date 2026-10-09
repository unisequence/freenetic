'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/view/network/freenetic-ports.js'), 'utf8');
const method = source.match(/\brestartPbr\(\) \{[\s\S]*?\n\t\},/m)?.[0];
assert.ok(method);

(async () => {
	let enabled = '1';
	let calls = 0;
	const restart = new Function('uci', 'fs', 'sectionName', 'PBR_RESTART_HELPER', '_',
		`return ({ ${method} }).restartPbr;`)(
		{ get: () => enabled },
		{ exec_direct: async () => { calls++; return { ok: true, installed: true }; } },
		() => 'config', '/usr/libexec/freenetic-pbr-restart', value => value);
	const page = { pbrConfig: { enabled: '0' } }; // stale render-time value
	await restart.call(page);
	assert.equal(calls, 1, 'newly enabled PBR must restart after apply');
	enabled = '0';
	await restart.call(page);
	assert.equal(calls, 1, 'disabled PBR must stay stopped');
	console.log('Ethernet PBR restart runtime: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
