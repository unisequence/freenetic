'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CORE_PACKAGE_NAMES = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];
const PACKAGE_NAMES = CORE_PACKAGE_NAMES.concat('freenetic-zapret2');

const EXPECTED_FILES = {
	'luci-theme-freenetic': [
		'etc/uci-defaults/30_luci-theme-freenetic',
		'usr/libexec/freenetic-clear-luci-cache',
		'usr/share/rpcd/acl.d/luci-theme-freenetic.json',
		'usr/share/ucode/luci/template/themes/freenetic/footer.ut',
		'usr/share/ucode/luci/template/themes/freenetic/header.ut',
		'usr/share/ucode/luci/template/themes/freenetic/sysauth.ut',
		'www/luci-static/freenetic/cascade.css',
		'www/luci-static/freenetic/favicon.svg',
		'www/luci-static/resources/freenetic-navigation.js',
		'www/luci-static/resources/freenetic-zapret2-tabs.js',
		'www/luci-static/resources/freenetic-rpc.js',
		'www/luci-static/resources/menu-freenetic.js',
		'www/luci-static/resources/settings-freenetic.js'
	],
	'luci-app-freenetic': [
		'etc/config/freenetic',
		'usr/libexec/freenetic-awg-feed',
		'usr/libexec/freenetic-backup-call',
		'usr/libexec/freenetic-diagnostics-bundle',
		'usr/libexec/freenetic-diagnostics-call',
		'usr/libexec/freenetic-ipsec-restart',
		'usr/libexec/freenetic-ipsec-status',
		'usr/libexec/freenetic-mihomo-package',
		'usr/libexec/freenetic-multiwan',
		'usr/libexec/freenetic-mwan-recover',
		'usr/libexec/freenetic-network-restart',
		'usr/libexec/freenetic-openvpn-profile',
		'usr/libexec/freenetic-package-status',
		'usr/libexec/freenetic-pbr-restart',
		'usr/libexec/freenetic-port-probe',
		'usr/libexec/freenetic-self-update',
		'usr/libexec/freenetic-uninstall',
		'usr/libexec/freenetic-wifi-uplink',
		'usr/libexec/freenetic-zapret2',
		'usr/libexec/freenetic-zapret2-package',
		'usr/share/luci/menu.d/zz-luci-freenetic.json',
		'usr/share/rpcd/acl.d/luci-app-freenetic.json',
		'usr/share/freenetic/mihomo/config',
		'usr/share/freenetic/mihomo/default-config.yaml',
		'usr/share/freenetic/mihomo/init',
		'usr/share/rpcd/ucode/mihomo.uc',
		'www/luci-static/resources/freenetic-diagnostics.js',
		'www/luci-static/resources/freenetic-network.js',
		'www/luci-static/resources/freenetic-multiwan-data.js',
		'www/luci-static/resources/freenetic-qrcode.js',
		'www/luci-static/resources/freenetic-ui.js',
		'www/luci-static/resources/freenetic-view-guard.js',
		'www/luci-static/resources/view/network/freenetic-ddns.js',
		'www/luci-static/resources/view/network/freenetic-firewall.js',
		'www/luci-static/resources/view/network/freenetic-mynetworks.js',
		'www/luci-static/resources/view/network/freenetic-multiwan.js',
		'www/luci-static/resources/view/network/freenetic-mihomo.js',
		'www/luci-static/resources/view/network/freenetic-zapret2.js',
		'www/luci-static/resources/view/network/freenetic-other-connections.js',
		'www/luci-static/resources/view/network/freenetic-ports.js',
		'www/luci-static/resources/freenetic-connections-core.js',
		'www/luci-static/resources/freenetic-connections-wireguard.js',
		'www/luci-static/resources/freenetic-connections-openvpn.js',
		'www/luci-static/resources/freenetic-connections-ipsec.js',
		'www/luci-static/resources/view/network/freenetic-portforward.js',
		'www/luci-static/resources/view/network/freenetic-routing.js',
		'www/luci-static/resources/view/network/freenetic-wan.js',
		'www/luci-static/resources/view/network/freenetic-wifi-acl.js',
		'www/luci-static/resources/view/status/freenetic-clients.js',
		'www/luci-static/resources/view/status/freenetic-dashboard.js',
		'www/luci-static/resources/freenetic-dashboard-data.js',
		'www/luci-static/resources/view/status/freenetic-traffic.js',
		'www/luci-static/resources/view/status/freenetic-wifimonitor.js',
		'www/luci-static/resources/view/system/freenetic-apps.js',
		'www/luci-static/resources/view/system/freenetic-diagnostics.js',
		'www/luci-static/resources/view/system/freenetic-system.js'
	],
	'luci-i18n-theme-freenetic-ru': [
		'usr/lib/lua/luci/i18n/freenetic-theme.ru.lmo'
	],
	'luci-i18n-freenetic-ru': [
		'usr/lib/lua/luci/i18n/freenetic.ru.lmo'
	],
	'freenetic-zapret2': [
		'etc/config/zapret2',
		'etc/init.d/zapret2',
		'opt/zapret2/blockcheck2.sh',
		'opt/zapret2/config',
		'opt/zapret2/config.default',
		'opt/zapret2/docs/LICENSE.txt',
		'opt/zapret2/init.d/openwrt/zapret2',
		'opt/zapret2/ip2net/ip2net',
		'opt/zapret2/mdig/mdig',
		'opt/zapret2/nfq2/nfqws2',
		'usr/libexec/zapret2/backend.uc',
		'usr/libexec/zapret2/compiler.sh',
		'usr/libexec/zapret2-init',
		'usr/sbin/nfqws2',
		'usr/share/rpcd/ucode/zapret2.uc',
		'usr/share/zapret2/zapret2-v2-default'
	]
};

function run(command, args) {
	const result = childProcess.spawnSync(command, args, { encoding: 'utf8' });
	if (result.error)
		throw result.error;
	if (result.status !== 0)
		throw new Error(command + ' failed (' + result.status + '): ' +
			(result.stderr || result.stdout || '').trim());
}

function archiveMatches(filename, packageName, format) {
	if (format === 'apk')
		return filename === packageName + '.apk' ||
			(filename.startsWith(packageName + '-') && filename.endsWith('.apk'));
	if (format === 'ipk')
		return filename.startsWith(packageName + '_') && filename.endsWith('.ipk');
	throw new Error('Unsupported package format: ' + format);
}

function archiveVersion(filename, packageName, format) {
	if (format === 'apk')
		return filename.slice((packageName + '-').length, -'.apk'.length);

	const stem = filename.slice(0, -'.ipk'.length);
	const prefix = packageName + '_';
	const architectureSeparator = stem.lastIndexOf('_');
	if (!stem.startsWith(prefix) || architectureSeparator <= prefix.length)
		throw new Error('Cannot parse IPK version from ' + filename);
	return stem.slice(prefix.length, architectureSeparator);
}

function findArchive(packageRoot, packageName, format, additionalRoots = []) {
	const roots = [ packageRoot ].concat(additionalRoots || [])
		.filter((root, index, all) => root && all.indexOf(root) === index)
		.filter(root => fs.existsSync(root));
	if (!roots.length)
		throw new Error('Package output directory does not exist: ' + packageRoot);

	const candidates = roots.flatMap(root => fs.readdirSync(root, { withFileTypes: true })
		.filter(entry => entry.isFile() && archiveMatches(entry.name, packageName, format))
		.map(entry => path.join(root, entry.name)));
	if (candidates.length !== 1)
		throw new Error('Expected exactly one ' + format.toUpperCase() + ' for ' + packageName +
			', found ' + candidates.length + ': ' + candidates.map(path.basename).join(', '));
	if (fs.statSync(candidates[0]).size === 0)
		throw new Error('Package archive is empty: ' + candidates[0]);
	return candidates[0];
}

function extractArchive(archive, format, apkTool) {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-package-check-'));
	const root = path.join(temporaryDirectory, 'root');
	fs.mkdirSync(root);

	try {
		if (format === 'apk') {
			if (!apkTool || !fs.existsSync(apkTool))
				throw new Error('OpenWrt host apk tool is required for APK inspection: ' + (apkTool || '(not set)'));
			run(apkTool, [ 'extract', '--allow-untrusted', '--no-chown', '--destination', root, archive ]);
		}
		else {
			const packageDirectory = path.join(temporaryDirectory, 'ipk');
			fs.mkdirSync(packageDirectory);
			run('tar', [ '-xzf', archive, '-C', packageDirectory ]);
			const dataArchive = path.join(packageDirectory, 'data.tar.gz');
			if (!fs.existsSync(dataArchive))
				throw new Error('IPK does not contain data.tar.gz: ' + archive);
			run('tar', [ '-xzf', dataArchive, '-C', root ]);
		}

		return { root, temporaryDirectory };
	}
	catch (error) {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		throw error;
	}
}

function walkFiles(directory, relativeDirectory = '') {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const relativePath = path.posix.join(relativeDirectory, entry.name);
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory())
			files.push(...walkFiles(absolutePath, relativePath));
		else if (entry.isFile() || entry.isSymbolicLink())
			files.push(relativePath);
	}
	return files.sort();
}

function requireJson(root, relativePath) {
	try {
		const value = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('JSON root is not an object');
	}
	catch (error) {
		throw new Error('Invalid packaged JSON ' + relativePath + ': ' + error.message);
	}
}

function verifyPackageContents(packageRoot, format, apkTool, additionalPackageRoots = []) {
	if (!['apk', 'ipk'].includes(format))
		throw new Error('Package format must be apk or ipk');

	const records = [];
	const extracted = [];
	try {
		for (const packageName of PACKAGE_NAMES) {
			/* OpenWrt 24.10 keeps target-specific IPKs in the target feed while
			 * the noarch LuCI packages remain in bin/packages.  APK builds put
			 * both kinds beside each other.  Search the optional target feed only
			 * as a fallback so both layouts use the same content contract. */
			const archive = findArchive(packageRoot, packageName, format,
				packageName === 'freenetic-zapret2' ? additionalPackageRoots : []);
			const version = archiveVersion(path.basename(archive), packageName, format);
			const extraction = extractArchive(archive, format, apkTool);
			const files = walkFiles(extraction.root);
			extracted.push(extraction.temporaryDirectory);

			for (const expectedFile of EXPECTED_FILES[packageName]) {
				if (!files.includes(expectedFile))
					throw new Error(packageName + ' is missing ' + expectedFile);
			}

			for (const packagedFile of files.filter(file => file.startsWith('usr/libexec/') ||
				file.startsWith('www/cgi-bin/'))) {
				const mode = fs.statSync(path.join(extraction.root, packagedFile)).mode;
				if (!(mode & 0o111))
					throw new Error(packageName + ' ships a non-executable helper: ' + packagedFile);
			}

			for (const jsonFile of [
				'usr/share/rpcd/acl.d/luci-theme-freenetic.json',
				'usr/share/rpcd/acl.d/luci-app-freenetic.json',
				'usr/share/luci/menu.d/zz-luci-freenetic.json'
			]) {
				if (files.includes(jsonFile))
					requireJson(extraction.root, jsonFile);
			}

			if (packageName === 'luci-theme-freenetic' && files.some(file =>
				file.startsWith('www/luci-static/resources/view/')))
				throw new Error('Theme package contains application views');
			if (packageName === 'luci-app-freenetic' && (files.some(file =>
				file.startsWith('www/luci-static/freenetic/')) || files.some(file =>
				file.startsWith('usr/share/ucode/luci/'))))
				throw new Error('Application package contains theme-owned files');
			if (packageName === 'freenetic-zapret2') {
				const config = fs.readFileSync(path.join(extraction.root, 'opt/zapret2/config'), 'utf8');
				if (!/^NFQWS2_ENABLE=0$/m.test(config))
					throw new Error('Zapret2 package does not default to the disabled state');
				const uciConfig = fs.readFileSync(path.join(extraction.root, 'etc/config/zapret2'), 'utf8');
				if (!/^\s*option enabled '0'$/m.test(uciConfig))
					throw new Error('Zapret2 native service does not default to the disabled state');
				for (const executable of [
					'etc/init.d/zapret2',
					'opt/zapret2/blockcheck2.sh',
					'opt/zapret2/nfq2/nfqws2',
					'opt/zapret2/ip2net/ip2net',
					'opt/zapret2/mdig/mdig',
					'usr/libexec/zapret2/compiler.sh',
					'usr/libexec/zapret2-init'
				]) {
					if (!(fs.statSync(path.join(extraction.root, executable)).mode & 0o111))
						throw new Error(packageName + ' ships a non-executable runtime file: ' + executable);
				}
			}

			records.push({ name: packageName, version, archive, files });
		}
	}
	finally {
		for (const temporaryDirectory of extracted)
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}

	const versions = new Set(records
		.filter(record => CORE_PACKAGE_NAMES.includes(record.name))
		.map(record => record.version));
	if (versions.size !== 1)
		throw new Error('Freenetic package versions do not match: ' + [...versions].join(', '));

	return records;
}

function main() {
	const packageRoot = path.resolve(process.argv[2] || '');
	const format = process.argv[3] || process.env.FREENETIC_PACKAGE_FORMAT || '';
	const apkTool = process.argv[4] || process.env.FREENETIC_APK_TOOL || '';
	const additionalPackageRoots = process.argv.slice(5).filter(Boolean).map(root => path.resolve(root));
	const records = verifyPackageContents(packageRoot, format, apkTool, additionalPackageRoots);

	console.log('Package contents (' + format + '): ok');
	console.log('Freenetic package version: ' + records[0].version);
	for (const record of records)
		console.log(record.name + ': ' + record.files.length + ' files');
}

if (require.main === module) {
	try {
		main();
	}
	catch (error) {
		console.error('Package contents: failed\n' + error.message);
		process.exitCode = 1;
	}
}

module.exports = {
	CORE_PACKAGE_NAMES,
	EXPECTED_FILES,
	PACKAGE_NAMES,
	archiveMatches,
	archiveVersion,
	findArchive,
	verifyPackageContents
};
