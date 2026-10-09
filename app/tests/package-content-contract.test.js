'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const checker = require('../check-package-contents.js');

assert.equal(checker.archiveVersion(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'apk'),
	'26.256.50513~5091025');
assert.equal(checker.archiveVersion(
	'luci-app-freenetic_26.256.50513~5091025_all.ipk', 'luci-app-freenetic', 'ipk'),
	'26.256.50513~5091025');
assert.equal(checker.archiveMatches(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'apk'), true);
assert.equal(checker.archiveMatches(
	'luci-app-freenetic_26.256.50513~5091025_all.ipk', 'luci-app-freenetic', 'ipk'), true);
assert.equal(checker.archiveMatches(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'ipk'), false);

const packageRoots = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-package-content-contract-'));
try {
	const primaryRoot = path.join(packageRoots, 'packages', 'aarch64_cortex-a53', 'base');
	const targetRoot = path.join(packageRoots, 'targets', 'mediatek', 'filogic', 'packages');
	fs.mkdirSync(primaryRoot, { recursive: true });
	fs.mkdirSync(targetRoot, { recursive: true });
	fs.writeFileSync(path.join(targetRoot, 'freenetic-zapret2_1.0.5.2-2_aarch64_cortex-a53.ipk'), 'ipk');
	assert.match(
		checker.findArchive(primaryRoot, 'freenetic-zapret2', 'ipk', [ targetRoot ]),
		/freenetic-zapret2_1\.0\.5\.2-2_aarch64_cortex-a53\.ipk$/,
		'target-specific IPKs must be found beside noarch package output'
	);
	fs.writeFileSync(path.join(primaryRoot, 'luci-app-freenetic-1.apk'), 'first');
	fs.writeFileSync(path.join(primaryRoot, 'luci-app-freenetic-2.apk'), 'second');
	assert.throws(() => checker.findArchive(primaryRoot, 'luci-app-freenetic', 'apk'),
		/Expected exactly one APK for luci-app-freenetic, found 2: luci-app-freenetic-1\.apk, luci-app-freenetic-2\.apk/,
		'multiple build artifacts must produce a useful error');
}
finally {
	fs.rmSync(packageRoots, { recursive: true, force: true });
}

for (const packageName of checker.PACKAGE_NAMES) {
	assert.ok(checker.EXPECTED_FILES[packageName].length > 0,
		packageName + ' must have a package content contract');
}

console.log('package content contract: ok');
