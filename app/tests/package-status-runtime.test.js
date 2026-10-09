'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const helper = path.join(__dirname, '..', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-package-status');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-package-status-'));

try {
	const apk = path.join(directory, 'apk');
	fs.writeFileSync(apk, '#!/bin/sh\n' +
		'case "$1" in\n' +
		'  search) printf "luci-app-nut-1.0-r1\\nnutty-1.0-r1\\npbr-1.2-r1\\n" ;;\n' +
		'  info) printf "luci-app-nut\\n" ;;\n' +
		'esac\n');
	fs.chmodSync(apk, 0o755);
	const result = childProcess.spawnSync('sh', [ helper, 'nut', 'luci-app-nut', 'pbr' ], {
		encoding: 'utf8',
		env: { ...process.env, PATH: directory + ':' + process.env.PATH }
	});
	assert.equal(result.status, 0, result.stderr);
	const packages = JSON.parse(result.stdout).packages;
	assert.deepEqual(packages.nut, { installed: false, available: false },
		'a similarly named package must not satisfy an exact apk lookup');
	assert.deepEqual(packages['luci-app-nut'], { installed: true, available: true });
	assert.deepEqual(packages.pbr, { installed: false, available: true });
	console.log('Package status runtime: ok');
}
finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
