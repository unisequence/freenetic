'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const themePackage = path.join(root, 'app', 'luci-theme-freenetic');
const applicationPackage = path.join(root, 'app', 'luci-app-freenetic');
const themeWeb = path.join(root, 'web', 'theme');
const applicationWeb = path.join(root, 'web', 'application');

function walk(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const item = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(item) : [ item ];
	});
}

function installPaths(packageDirectory, webDirectory, includeUcode) {
	const paths = [];
	const addTree = (directory, prefix) => {
		for (const filename of walk(directory))
			paths.push(path.posix.join(prefix, path.relative(directory, filename)));
	};

	addTree(path.join(webDirectory, 'htdocs'), '/www');
	if (includeUcode)
		addTree(path.join(webDirectory, 'ucode'), '/usr/share/ucode/luci');
	addTree(path.join(packageDirectory, 'root'), '/');
	return paths.sort();
}

assert.equal(fs.readlinkSync(path.join(themePackage, 'htdocs')), '../../web/theme/htdocs');
assert.equal(fs.readlinkSync(path.join(themePackage, 'ucode')), '../../web/theme/ucode');
assert.equal(fs.readlinkSync(path.join(applicationPackage, 'htdocs')), '../../web/application/htdocs');

assert.ok(!fs.existsSync(path.join(themeWeb, 'htdocs', 'luci-static', 'resources', 'view')),
	'theme must not ship router management views');
assert.ok(!fs.existsSync(path.join(applicationWeb, 'htdocs', 'luci-static', 'freenetic')),
	'application must not ship theme CSS or fonts');
assert.ok(!fs.existsSync(path.join(applicationWeb, 'ucode')),
	'application must not ship theme templates');

const themeFiles = installPaths(themePackage, themeWeb, true);
const applicationFiles = installPaths(applicationPackage, applicationWeb, false);
const collisions = themeFiles.filter(filename => applicationFiles.includes(filename));
assert.deepEqual(collisions, [], 'theme and application packages must not own the same files');

const themeMakefile = fs.readFileSync(path.join(themePackage, 'Makefile'), 'utf8');
const applicationMakefile = fs.readFileSync(path.join(applicationPackage, 'Makefile'), 'utf8');
assert.doesNotMatch(themeMakefile, /luci-app-package-manager/,
	'theme must not depend on application services');
assert.match(applicationMakefile, /LUCI_DEPENDS:=.*\+luci-theme-freenetic/,
	'application must depend on the matching theme');
assert.match(applicationMakefile, /LUCI_DEPENDS:=.*\+luci-app-package-manager/,
	'application must declare its package manager dependency');

const menuPath = path.join(applicationPackage, 'root', 'usr', 'share', 'luci',
	'menu.d', 'zz-luci-freenetic.json');
const menu = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
for (const entry of Object.values(menu))
	assert.deepEqual(entry.depends.acl, [ 'luci-app-freenetic' ]);

const navigationSource = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'resources', 'menu-freenetic.js'), 'utf8');
assert.match(navigationSource, /'system\/system', 'system\/diagnostics', 'system\/applications'/,
	'diagnostics must stay inside the Management sidebar group');
assert.match(navigationSource, /'network\/diagnostics'/,
	'the stock diagnostics entry must not create a duplicate Unsorted item');

const themeAclPath = path.join(themePackage, 'root', 'usr', 'share', 'rpcd',
	'acl.d', 'luci-theme-freenetic.json');
const themeAcl = JSON.parse(fs.readFileSync(themeAclPath, 'utf8'))['luci-theme-freenetic'];
assert.deepEqual(themeAcl.read, { uci: [ 'luci' ] });
assert.deepEqual(themeAcl.write, { uci: [ 'luci' ] });

console.log(`package boundaries: ok (${themeFiles.length} theme files, ${applicationFiles.length} application files)`);
