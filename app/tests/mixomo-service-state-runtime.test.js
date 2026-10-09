'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root,
	'app/luci-app-freenetic/root/usr/libexec/freenetic-mixomo'), 'utf8');
const restore = source.match(/^restore_service_state\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(restore);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-mixomo-state-'));
try {
	const fakeService = path.join(temp, 'hev');
	fs.writeFileSync(fakeService, `#!/bin/sh
printf '%s\\n' "$1" >> '${temp}/calls'
`, { mode: 0o700 });
	const script = restore.replaceAll('/etc/init.d/hev-socks5-tunnel', fakeService) + `
restore_service_state 0 0 || exit 11
restore_service_state 1 1 || exit 12
`;
	const result = childProcess.spawnSync('/bin/sh', [ '-c', script ], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(fs.readFileSync(path.join(temp, 'calls'), 'utf8').trim().split('\n'),
		[ 'disable', 'stop', 'enable', 'restart' ]);
}
finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Mixomo service state runtime: ok');
