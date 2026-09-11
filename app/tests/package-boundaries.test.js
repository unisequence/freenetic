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

const themeRpc = path.join(themeWeb, 'htdocs', 'luci-static', 'resources', 'freenetic-rpc.js');
const applicationRpc = path.join(applicationWeb, 'htdocs', 'luci-static', 'resources', 'freenetic-rpc.js');
const themeCacheHelper = path.join(themePackage, 'root', 'usr', 'libexec', 'freenetic-clear-luci-cache');
const applicationCacheHelper = path.join(applicationPackage, 'root', 'usr', 'libexec', 'freenetic-clear-luci-cache');
assert.ok(fs.existsSync(themeRpc), 'theme must ship its direct runtime RPC helper');
assert.ok(!fs.existsSync(applicationRpc), 'application must not duplicate the theme RPC helper');
assert.ok(fs.existsSync(themeCacheHelper), 'theme must ship the cache helper used by its settings drawer');
assert.ok(fs.statSync(themeCacheHelper).mode & 0o111, 'theme cache helper must be executable');
assert.ok(!fs.existsSync(applicationCacheHelper), 'application must not duplicate the theme cache helper');

const themeFiles = installPaths(themePackage, themeWeb, true);
const applicationFiles = installPaths(applicationPackage, applicationWeb, false);
const collisions = themeFiles.filter(filename => applicationFiles.includes(filename));
assert.deepEqual(collisions, [], 'theme and application packages must not own the same files');

const themeMakefile = fs.readFileSync(path.join(themePackage, 'Makefile'), 'utf8');
const applicationMakefile = fs.readFileSync(path.join(applicationPackage, 'Makefile'), 'utf8');
const preflightMakefile = fs.readFileSync(path.join(root, 'app', 'freenetic-preflight.mk'), 'utf8');
const deployScript = fs.readFileSync(path.join(root, 'app', 'deploy.sh'), 'utf8');
const routerPreflightPath = path.join(root, 'app', 'check-router.sh');
const routerPreflight = fs.readFileSync(routerPreflightPath, 'utf8');
assert.ok(fs.statSync(routerPreflightPath).mode & 0o111, 'router preflight must be executable');
assert.match(routerPreflight, /mediatek\/filogic/, 'host preflight must support Filogic');
assert.match(routerPreflight, /ramips\/mt7621/, 'host preflight must support MT7621');
assert.match(routerPreflight, /FREENETIC_MIN_OVERLAY_MIB_MT7621/, 'MT7621 threshold must be configurable');
assert.match(preflightMakefile, /mediatek\/filogic/, 'preflight must support the primary MediaTek target');
assert.match(preflightMakefile, /ramips\/mt7621/, 'preflight must support MT7621');
assert.match(preflightMakefile, /min_overlay_kib=32768/, 'Filogic needs the larger overlay reserve');
assert.match(preflightMakefile, /min_overlay_kib=16384/, 'MT7621 needs its own overlay reserve');
assert.match(preflightMakefile, /at least 128 MiB RAM/, 'preflight must reject low-memory routers');
assert.match(deployScript, /check-router\.sh/, 'development deployment must run the hardware preflight');
assert.match(themeMakefile, /Package\/luci-theme-freenetic\/preinst/, 'theme APK must guard direct installs');
assert.match(applicationMakefile, /Package\/luci-app-freenetic\/preinst/, 'application APK must guard direct installs');
assert.match(themeMakefile, /^LUCI_BASENAME:=theme-freenetic$/m,
	'theme translations must use a package basename distinct from the application');
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
assert.match(navigationSource, /'system\/system', 'system\/diagnostics'/,
	'diagnostics must stay inside the Management sidebar group');
assert.match(navigationSource, /'system\/diagnostics', 'system\/package-manager',\s*'system\/applications'/,
	'Software and the Freenetic application catalog must stay inside Management');
assert.match(navigationSource, /title: 'Services', icon: 'services', paths: \[\]/,
	'Services must be reserved for dynamically discovered service packages');
assert.match(navigationSource, /'system\/package-manager': 'OpenWrt Packages'/,
	'the stock package manager must have an explicit OpenWrt fallback label');
assert.match(navigationSource, /entry\.section\.name !== 'services' && entry\.section\.name !== 'vpn'/,
	'all stock and third-party service namespaces must be collected dynamically');
assert.match(navigationSource, /'network\/diagnostics'/,
	'the stock diagnostics entry must not create a duplicate More item');
assert.match(navigationSource, /title: 'More'/,
	'the catch-all sidebar group must use a user-facing name');

const themeAclPath = path.join(themePackage, 'root', 'usr', 'share', 'rpcd',
	'acl.d', 'luci-theme-freenetic.json');
const themeAcl = JSON.parse(fs.readFileSync(themeAclPath, 'utf8'))['luci-theme-freenetic'];
assert.deepEqual(themeAcl.read, { uci: [ 'luci' ] });
assert.deepEqual(themeAcl.write, {
	uci: [ 'luci' ],
	file: {
		'/usr/libexec/freenetic-clear-luci-cache': [ 'exec' ]
	}
});

const themeCatalogPath = path.join(themePackage, 'po', 'ru', 'freenetic-theme.po');
const applicationCatalogPath = path.join(applicationPackage, 'po', 'ru', 'freenetic.po');
assert.ok(fs.existsSync(themeCatalogPath), 'theme needs its own Russian catalog');
assert.ok(fs.existsSync(applicationCatalogPath), 'application catalog must remain in place');
const themeCatalog = fs.readFileSync(themeCatalogPath, 'utf8');
const catalogIds = new Set([...themeCatalog.matchAll(/^msgid "((?:\\.|[^"])*)"$/gm)]
	.map(match => match[1].replace(/\\"/g, '"')));
assert.match(themeCatalog, /msgid "Services"\nmsgstr "Службы"/,
	'the Services sidebar label must have the requested Russian translation');
const themeMessages = new Set();
for (const filename of walk(themeWeb).filter(filename => /\.(?:js|ut)$/.test(filename))) {
	const source = fs.readFileSync(filename, 'utf8');
	for (const pattern of [ /_\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, /_\(\s*"((?:\\.|[^"\\])*)"\s*\)/g ]) {
		for (const match of source.matchAll(pattern))
			themeMessages.add(match[1].replace(/\\'/g, "'").replace(/\\"/g, '"'));
	}
}
assert.deepEqual([...themeMessages].filter(message => !catalogIds.has(message)).sort(), [],
	'theme catalog must cover every static theme translation');
assert.ok(catalogIds.has('More'), 'theme catalog must translate the dynamic More navigation label');

const clientsSource = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-clients.js'), 'utf8');
assert.match(clientsSource, /typeof mac === 'string' \? mac\.trim\(\)\.toUpperCase\(\) : ''/,
	'Client List must tolerate non-string MAC values from ubus');
assert.doesNotMatch(clientsSource, /\(mac \|\| ''\)\.toUpperCase\(\)/,
	'Client List must not call toUpperCase on an unvalidated ubus value');

console.log(`package boundaries: ok (${themeFiles.length} theme files, ${applicationFiles.length} application files)`);
