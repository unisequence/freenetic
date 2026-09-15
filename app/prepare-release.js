'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_NAMES = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];
const TARGETS = {
	filogic: 'aarch64_cortex-a53',
	mt7621: 'mipsel_24kc'
};

function fail(message) {
	throw new Error(message);
}

function sha256(filePath) {
	return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileHash(releaseDir, name) {
	const filePath = path.join(releaseDir, name);
	if (!fs.existsSync(filePath))
		fail(`release asset is missing: ${name}`);
	return sha256(filePath);
}

function replaceAssignment(source, name, value) {
	const pattern = new RegExp(`(^[ \\t]*${name}=\\")[^\\"\\n]*(\\"[ \\t]*$)`, 'm');
	if (!pattern.test(source))
		fail(`installer assignment is missing: ${name}`);
	return source.replace(pattern, `$1${value}$2`);
}

function replaceTargetAssignment(source, target, name, value) {
	const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const block = new RegExp(`(^[ \\t]*${escapedTarget}\\)[\\s\\S]*?)(^[ \\t]*;;[ \\t]*$)`, 'm');
	const match = source.match(block);
	if (!match)
		fail(`installer target block is missing: ${target}`);
	const assignment = new RegExp(`(^[ \\t]*${name}=\\")[^\\"\\n]*(\\"[ \\t]*$)`, 'm');
	if (!assignment.test(match[1]))
		fail(`installer assignment is missing in ${target}: ${name}`);
	const body = match[1].replace(assignment, `$1${value}$2`);
	return source.slice(0, match.index) + body + match[2] + source.slice(match.index + match[0].length);
}

function releaseHashes(releaseDir, assetVersion) {
	const apk = Object.fromEntries(PACKAGE_NAMES.map(name => [
		name,
		fileHash(releaseDir, `${name}-${assetVersion}-${TARGETS.filogic}.apk`)
	]));
	const ipk = Object.fromEntries(PACKAGE_NAMES.map(name => [
		name,
		fileHash(releaseDir, `${name}-${assetVersion}-all.ipk`)
	]));
	const fnc = {
		filogic: {
			apk: fileHash(releaseDir, `fnc-${assetVersion}-${TARGETS.filogic}-apk`),
			ipk: fileHash(releaseDir, `fnc-${assetVersion}-${TARGETS.filogic}-ipk`)
		},
		mt7621: {
			apk: fileHash(releaseDir, `fnc-${assetVersion}-${TARGETS.mt7621}-apk`),
			ipk: fileHash(releaseDir, `fnc-${assetVersion}-${TARGETS.mt7621}-ipk`)
		}
	};

	for (const name of PACKAGE_NAMES) {
		const mirror = fileHash(releaseDir, `${name}-${assetVersion}-${TARGETS.mt7621}.apk`);
		if (mirror !== apk[name])
			fail(`APK target mirror differs for ${name}`);
	}

	const apkKey = fileHash(releaseDir, `freenetic-apk-release-key-${assetVersion}.pem`);
	return { apk, apkKey, ipk, fnc };
}

function patchInstaller(template, tag, assetVersion, hashes) {
	let installer = template;
	installer = replaceAssignment(installer, 'RELEASE_TAG', tag);
	installer = replaceAssignment(installer, 'ASSET_VERSION', assetVersion);
	installer = replaceTargetAssignment(installer, 'mediatek/filogic', 'fnc_sha256_apk', hashes.fnc.filogic.apk);
	installer = replaceTargetAssignment(installer, 'mediatek/filogic', 'fnc_sha256_ipk', hashes.fnc.filogic.ipk);
	installer = replaceTargetAssignment(installer, 'ramips/mt7621', 'fnc_sha256_apk', hashes.fnc.mt7621.apk);
	installer = replaceTargetAssignment(installer, 'ramips/mt7621', 'fnc_sha256_ipk', hashes.fnc.mt7621.ipk);
	installer = replaceTargetAssignment(installer, 'apk', 'apk_key_sha256', hashes.apkKey);

	for (const name of PACKAGE_NAMES) {
		const variable = name === 'luci-theme-freenetic' ? 'theme_sha256' :
			name === 'luci-app-freenetic' ? 'app_sha256' :
			name === 'luci-i18n-theme-freenetic-ru' ? 'theme_ru_sha256' : 'app_ru_sha256';
		installer = replaceTargetAssignment(installer, 'apk', variable, hashes.apk[name]);
		installer = replaceTargetAssignment(installer, 'opkg', variable, hashes.ipk[name]);
	}

	installer = installer.replace(
		/https:\/\/(?:raw\.githubusercontent\.com\/unisequence\/freenetic\/[^']+|github\.com\/unisequence\/freenetic\/releases\/download\/[^']+)\/install\.sh/g,
		`https://github.com/unisequence/freenetic/releases/download/${tag}/install.sh`
	);
	return installer;
}

function changelogSection(changelog, tag) {
	const version = tag.replace(/^v/, '');
	const lines = changelog.split(/\r?\n/);
	const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\b`);
	const start = lines.findIndex(line => heading.test(line) || line.startsWith(`## [${version}]`));
	if (start < 0)
		fail(`changelog has no section for ${tag}`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index++) {
		if (/^## /.test(lines[index])) {
			end = index;
			break;
		}
	}
	const section = lines.slice(start, end).join('\n').trim();
	if (!section)
		fail(`changelog section for ${tag} is empty`);
	return `${section}\n`;
}

function writeManifest(releaseDir) {
	const names = fs.readdirSync(releaseDir).filter(name => name !== 'SHA256SUMS.txt').sort();
	if (!names.length)
		fail('release directory has no assets');
	const lines = names.map(name => {
		const filePath = path.join(releaseDir, name);
		if (!fs.statSync(filePath).isFile())
			fail(`release directory entry is not a file: ${name}`);
		return `${sha256(filePath)}  ./${name}`;
	});
	fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
	return names;
}

function prepareRelease({ releaseDir, templatePath, changelogPath, notesPath, tag, assetVersion }) {
	if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(tag))
		fail(`invalid release tag: ${tag}`);
	if (!/^[0-9]{2}\.[0-9]{3}\.[0-9]+\.[0-9a-f]+$/.test(assetVersion))
		fail(`invalid asset version: ${assetVersion}`);
	const hashes = releaseHashes(releaseDir, assetVersion);
	const installer = patchInstaller(fs.readFileSync(templatePath, 'utf8'), tag, assetVersion, hashes);
	const installerPath = path.join(releaseDir, 'install.sh');
	fs.writeFileSync(installerPath, installer, { mode: 0o755 });
	fs.chmodSync(installerPath, 0o755);
	const names = writeManifest(releaseDir);
	fs.writeFileSync(notesPath, changelogSection(fs.readFileSync(changelogPath, 'utf8'), tag));
	return { assetCount: names.length + 1, installerPath, manifestPath: path.join(releaseDir, 'SHA256SUMS.txt') };
}

if (require.main === module) {
	const [releaseDir, templatePath, changelogPath, notesPath, tag, assetVersion] = process.argv.slice(2);
	if (!releaseDir || !templatePath || !changelogPath || !notesPath || !tag || !assetVersion) {
		console.error('usage: node app/prepare-release.js RELEASE_DIR INSTALLER CHANGELOG NOTES TAG ASSET_VERSION');
		process.exit(2);
	}
	try {
		const result = prepareRelease({ releaseDir, templatePath, changelogPath, notesPath, tag, assetVersion });
		console.log(`Release assets: ${result.assetCount}`);
		console.log(`Installer: ${result.installerPath}`);
		console.log(`Manifest: ${result.manifestPath}`);
	} catch (error) {
		console.error(`Release preparation failed: ${error.message}`);
		process.exit(1);
	}
}

module.exports = { changelogSection, patchInstaller, prepareRelease, releaseHashes, sha256, writeManifest };
