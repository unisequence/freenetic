'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'app/luci-app-freenetic/root/usr/libexec/freenetic-zapret2-package');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-zapret2-remove-'));
const service = path.join(temp, 'zapret2-service');
const state = path.join(temp, 'running');
const bin = path.join(temp, 'bin');
const configDir = path.join(temp, 'etc/config');
const backupRoot = path.join(temp, 'etc/freenetic');
const helper = path.join(temp, 'helper');

try {
	fs.mkdirSync(bin);
	fs.mkdirSync(configDir, { recursive: true });
	fs.writeFileSync(path.join(configDir, 'zapret2'), "config zapret2 'main'\n");
	fs.writeFileSync(path.join(temp, 'jshn.sh'), `
json_init() { JSON='{'; JSON_FIRST=1; }
json_add_int() { [ "$JSON_FIRST" -eq 1 ] || JSON="$JSON,"; JSON="$JSON\\"$1\\":$2"; JSON_FIRST=0; }
json_add_string() { [ "$JSON_FIRST" -eq 1 ] || JSON="$JSON,"; JSON="$JSON\\"$1\\":\\"$2\\""; JSON_FIRST=0; }
json_dump() { printf '%s}\\n' "$JSON"; }
`);
	fs.writeFileSync(service, `#!/bin/sh
case "$1" in
  status) test -f '${state}' ;;
  stop) rm -f '${state}' ;;
  start) : > '${state}' ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
	fs.writeFileSync(path.join(bin, 'apk'), `#!/bin/sh
case "$1 $2" in
  'info -e') exit 0 ;;
  'del freenetic-zapret2') echo 'injected package failure' >&2; exit 1 ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
	let source = fs.readFileSync(sourcePath, 'utf8');
	source = source.replace('JSHN=/usr/share/libubox/jshn.sh', `JSHN=${temp}/jshn.sh`)
		.replaceAll('/etc/init.d/zapret2', service)
		.replaceAll('/etc/freenetic', backupRoot)
		.replaceAll('/etc/config/zapret2', path.join(configDir, 'zapret2'))
		.replaceAll('/opt/zapret2', path.join(temp, 'opt/zapret2'))
		// dash, used by this host test, supports only single-digit FDs.
		.replace('exec 200>/tmp/ipkg.lock', `exec 9>${temp}/ipkg.lock`)
		.replace('flock -x 200', 'flock -x 9');
	fs.writeFileSync(helper, source, { mode: 0o700 });

	for (const initiallyRunning of [ true, false ]) {
		if (initiallyRunning) fs.writeFileSync(state, '');
		else fs.rmSync(state, { force: true });
		const result = childProcess.spawnSync('/bin/sh', [ helper, 'remove' ], {
			encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /"code":1/);
		assert.equal(fs.existsSync(state), initiallyRunning,
			'failed removal must restore exactly the prior running state');
		assert.ok(fs.existsSync(path.join(configDir, 'zapret2')));
	}
}
finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Zapret2 removal failure runtime: ok');
