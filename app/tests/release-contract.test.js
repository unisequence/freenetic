'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const release = require(path.join(root, 'app', 'check-release.js'));
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-release-contract-'));
const version = '1.2.3-test';
const indexDirectory = path.join(packageRoot, 'test-arch', 'base');

try {
	fs.mkdirSync(indexDirectory, { recursive: true });
	fs.writeFileSync(path.join(indexDirectory, 'index.json'), JSON.stringify({
		packages: Object.fromEntries(release.PACKAGE_NAMES.map(name => [ name, version ]))
	}));
	for (const name of release.PACKAGE_NAMES)
		fs.writeFileSync(path.join(indexDirectory, name + '-' + version + '.apk'), 'apk fixture');

	const verified = release.verifyPackageIndexes(packageRoot);
	assert.equal(verified.length, release.PACKAGE_NAMES.length);
	assert.deepEqual(verified.map(entry => entry.name).sort(), release.PACKAGE_NAMES.slice().sort());

	fs.unlinkSync(path.join(indexDirectory, 'luci-app-freenetic-' + version + '.apk'));
	assert.throws(() => release.verifyPackageIndexes(packageRoot), /is missing/,
		'a stale index must be rejected when its advertised APK is gone');
}
finally {
	fs.rmSync(packageRoot, { recursive: true, force: true });
}

assert.match(makefile, /^check-release-tree:/m,
	'the release flow must reject an uncommitted source tree');
assert.match(makefile, /^check-package-index:/m,
	'the release flow must check index/archive consistency');
assert.match(makefile, /^stage-mt7621-packages:/m,
	'the release flow must stage noarch APKs for the MT7621 feed');
assert.match(makefile, /FREENETIC_MT7621_PACKAGE_ARCH := mipsel_24kc/,
	'MT7621 packages must use the mipsel_24kc feed directory');
assert.match(makefile, /CONFIG_PACKAGE_luci-i18n-theme-freenetic-ru=m/,
	'package checks must build the theme translation APK');
assert.match(makefile, /CONFIG_PACKAGE_luci-i18n-freenetic-ru=m/,
	'package checks must build the application translation APK');
assert.match(makefile, /^release: check-release-tree check-package$/m,
	'the release target must run the clean-tree guard before package/index generation');
assert.match(makefile, /stage-mt7621-packages OPENWRT_DIR=/,
	'the release target must generate the MT7621 package index');

console.log('release integrity contract: ok');
