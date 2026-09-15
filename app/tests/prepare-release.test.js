'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const prepare = require(path.join(root, 'app', 'prepare-release.js'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-prepare-release-'));
const releaseDir = path.join(temporary, 'assets');
const changelogPath = path.join(temporary, 'CHANGELOG.md');
const notesPath = path.join(temporary, 'release-notes.md');
const assetVersion = '26.257.51426.deadbee';
const tag = 'v9.8.7';
const packageNames = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];

function hash(filePath) {
	return prepare.sha256(filePath);
}

try {
	fs.mkdirSync(releaseDir, { recursive: true });
	fs.writeFileSync(changelogPath, [
		'# Changelog',
		'',
		'## [9.8.7] — 2026-09-14',
		'',
		'### Fixed',
		'',
		'- Generated installers now carry release asset checksums.',
		'',
		'## [9.8.6] — 2026-09-13',
		'',
		'- Older release.',
		''
	].join('\n'));

	for (const name of packageNames) {
		fs.writeFileSync(path.join(releaseDir, `${name}-${assetVersion}-aarch64_cortex-a53.apk`), `${name} APK\n`);
		fs.writeFileSync(path.join(releaseDir, `${name}-${assetVersion}-mipsel_24kc.apk`), `${name} APK\n`);
		fs.writeFileSync(path.join(releaseDir, `${name}-${assetVersion}-all.ipk`), `${name} IPK\n`);
	}
	fs.writeFileSync(path.join(releaseDir, `freenetic-apk-release-key-${assetVersion}.pem`), 'test APK public key\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-aarch64_cortex-a53-apk`), 'filogic apk fnc\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-aarch64_cortex-a53-ipk`), 'filogic ipk fnc\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-mipsel_24kc-apk`), 'mt7621 apk fnc\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-mipsel_24kc-ipk`), 'mt7621 ipk fnc\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-aarch64_cortex-a53`), 'legacy filogic fnc\n');
	fs.writeFileSync(path.join(releaseDir, `fnc-${assetVersion}-mipsel_24kc`), 'legacy mt7621 fnc\n');

	const result = prepare.prepareRelease({
		releaseDir,
		templatePath: path.join(root, 'install.sh'),
		changelogPath,
		notesPath,
		tag,
		assetVersion
	});
	const installerPath = path.join(releaseDir, 'install.sh');
	const installer = fs.readFileSync(installerPath, 'utf8');
	const manifest = fs.readFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), 'utf8');

	assert.equal(result.assetCount, 21, 'release must contain 18 binaries/packages, APK key, installer and manifest');
	assert.ok(fs.statSync(installerPath).mode & 0o111, 'generated installer must be executable');
	assert.match(installer, /RELEASE_TAG="v9\.8\.7"/);
	assert.match(installer, /ASSET_VERSION="26\.257\.51426\.deadbee"/);
	assert.match(installer, /releases\/download\/v9\.8\.7\/install\.sh/);
	assert.match(installer, new RegExp(`apk_key_sha256="${hash(path.join(releaseDir, `freenetic-apk-release-key-${assetVersion}.pem`))}"`));
	const repatched = prepare.patchInstaller(installer, 'v9.8.8', assetVersion, prepare.releaseHashes(releaseDir, assetVersion));
	assert.match(repatched, /releases\/download\/v9\.8\.8\/install\.sh/,
		'preparing an already generated installer must update its release URL');
	assert.doesNotMatch(repatched, /releases\/download\/v9\.8\.7\/install\.sh/,
		'a regenerated installer must not retain the previous release URL');
	assert.match(installer, new RegExp(`theme_sha256="${hash(path.join(releaseDir, `luci-theme-freenetic-${assetVersion}-aarch64_cortex-a53.apk`))}"`));
	assert.match(installer, new RegExp(`app_sha256="${hash(path.join(releaseDir, `luci-app-freenetic-${assetVersion}-all.ipk`))}"`));
	assert.match(installer, new RegExp(`fnc_sha256_apk="${hash(path.join(releaseDir, `fnc-${assetVersion}-aarch64_cortex-a53-apk`))}"`));
	assert.match(installer, new RegExp(`fnc_sha256_ipk="${hash(path.join(releaseDir, `fnc-${assetVersion}-aarch64_cortex-a53-ipk`))}"`));
	assert.match(manifest, /\.\/install\.sh$/m, 'manifest must cover generated installer');
	assert.equal(manifest.trim().split('\n').length, 20, 'manifest must cover every pre-manifest asset');
	assert.match(fs.readFileSync(notesPath, 'utf8'), /## \[9\.8\.7\] — 2026-09-14/);
	assert.match(fs.readFileSync(notesPath, 'utf8'), /Generated installers now carry/);
}
finally {
	fs.rmSync(releaseDir, { recursive: true, force: true });
	fs.rmSync(notesPath, { force: true });
	fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('release preparation contract: ok');
