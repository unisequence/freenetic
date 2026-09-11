'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_NAMES = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];
const INDEXED_PACKAGE_NAMES = [ 'luci-theme-freenetic', 'luci-app-freenetic' ];

function walkIndexes(root, indexes = []) {
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name);

		if (entry.isDirectory())
			walkIndexes(entryPath, indexes);
		else if (entry.isFile() && entry.name === 'index.json')
			indexes.push(entryPath);
	}

	return indexes;
}

function packageArchives(packageRoot) {
	const archives = new Map(PACKAGE_NAMES.map(name => [ name, [] ]));
	const walk = directory => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(entryPath);
				continue;
			}

			if (!entry.isFile() || !entry.name.endsWith('.apk'))
				continue;

			for (const name of PACKAGE_NAMES) {
				if (entry.name.startsWith(name + '-'))
					archives.get(name).push(entryPath);
			}
		}
	};

	walk(packageRoot);
	return archives;
}

function packageEntries(packageRoot) {
	if (!fs.existsSync(packageRoot))
		throw new Error('Package output directory does not exist: ' + packageRoot);

	const entries = [];
	for (const indexPath of walkIndexes(packageRoot)) {
		let index;
		try {
			index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
		}
		catch (error) {
			throw new Error('Cannot parse ' + indexPath + ': ' + error.message);
		}

		for (const name of PACKAGE_NAMES) {
			const version = index && index.packages && index.packages[name];
			if (version)
				entries.push({ name, version: String(version), indexPath });
		}
	}

	for (const name of INDEXED_PACKAGE_NAMES) {
		if (!entries.some(entry => entry.name === name))
			throw new Error('No package index advertises ' + name + '. Build the package before releasing.');
	}

	return entries;
}

function verifyPackageIndexes(packageRoot) {
	const errors = [];
	const verified = [];
	const archives = packageArchives(packageRoot);

	for (const entry of packageEntries(packageRoot)) {
		const archive = path.join(path.dirname(entry.indexPath), entry.name + '-' + entry.version + '.apk');
		if (!fs.existsSync(archive)) {
			errors.push(entry.indexPath + ' advertises ' + entry.name + ' ' + entry.version +
				', but ' + path.basename(archive) + ' is missing');
			continue;
		}

		if (fs.statSync(archive).size === 0) {
			errors.push(archive + ' is empty');
			continue;
		}

		verified.push(Object.assign({ archive }, entry));
	}

	for (const name of PACKAGE_NAMES) {
		if (!archives.get(name).length)
			errors.push('No built APK was found for ' + name);
	}

	if (errors.length)
		throw new Error(errors.join('\n'));

	return verified;
}

function main() {
	const packageRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'openwrt-upstream', 'bin'));
	const verified = verifyPackageIndexes(packageRoot);

	console.log('Release package index: ok');
	for (const entry of verified)
		console.log(path.relative(packageRoot, entry.indexPath) + ': ' + entry.name + ' ' + entry.version);
}

if (require.main === module) {
	try {
		main();
	}
	catch (error) {
		console.error('Release package index: failed\n' + error.message);
		process.exitCode = 1;
	}
}

module.exports = { INDEXED_PACKAGE_NAMES, PACKAGE_NAMES, packageArchives, packageEntries, verifyPackageIndexes };
