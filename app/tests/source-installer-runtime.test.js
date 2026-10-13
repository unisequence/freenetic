'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256 } = require('../prepare-release');
const installer = path.resolve(__dirname, '../../install.sh');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-source-installer-'));
const payload = path.join(temp, 'release-installer');
const manifest = path.join(temp, 'manifest');
const marker = path.join(temp, 'installed');
const tag = fs.readFileSync(installer, 'utf8').match(/^RELEASE_TAG="([^"]+)"$/m)[1];
try {
	fs.writeFileSync(path.join(temp, 'wget'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
 case "$1" in -qO) destination=$2; shift 2;; -T) shift 2;; -4) shift;; *) url=$1; shift;; esac
done
case "$url" in
 */install.sh) cp "$TEST_PAYLOAD" "$destination";;
 */SHA256SUMS.txt) cp "$TEST_MANIFEST" "$destination";;
 *) exit 1;;
esac
`, { mode: 0o700 });
	function run(options = {}) {
		fs.rmSync(marker, { force: true });
		fs.writeFileSync(payload, `#!/bin/sh\nRELEASE_TAG="${options.tag || tag}"\nSOURCE_INSTALLER="${options.source || '0'}"\nprintf installed > "$TEST_MARKER"\nexit ${options.exit || 0}\n`);
		fs.writeFileSync(manifest, `${options.badHash ? '0'.repeat(64) : sha256(payload)}  ./install.sh\n`);
		// v0.2.5's manifest check must accept the raw-tag source installer.
		const check = spawnSync('grep', [ '-Fqx', `RELEASE_TAG="${tag}"`, installer ]);
		assert.equal(check.status, 0);
		return spawnSync('sh', [ installer ], { encoding: 'utf8', env: { ...process.env,
			PATH: temp + ':' + process.env.PATH, TEST_PAYLOAD: payload,
			TEST_MANIFEST: manifest, TEST_MARKER: marker } });
	}
	let result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.readFileSync(marker, 'utf8'), 'installed');
	for (const options of [ { tag: 'v9.9.9' }, { source: '1' }, { badHash: true } ]) {
		result = run(options);
		assert.notEqual(result.status, 0);
		assert.equal(fs.existsSync(marker), false, 'unverified installers must never execute');
	}
	result = run({ exit: 7 });
	assert.equal(result.status, 7, 'the release installer failure must reach the old updater');
	console.log('Source installer bridge runtime: ok');
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
