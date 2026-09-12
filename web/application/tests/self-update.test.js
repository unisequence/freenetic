'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs', 'luci-static',
	'freenetic', 'cascade.css'), 'utf8');
assert.match(dashboard, /packages: updaterPackages\.length \? updaterPackages : packages/,
	'dashboard must use helper package versions when legacy package-manager-call cannot return JSON');
assert.doesNotMatch(dashboard, /disabled:\s*!updaterReady/,
	'LuCI E() must not render disabled="false", which still disables the check button');
assert.match(dashboard, /checkButton\.disabled = !updaterReady/,
	'initial updater availability must be applied through the DOM boolean property');
assert.match(dashboard, /installButton\.style\.display = 'none'/,
	'theme button display rules must not override the hidden update action');
assert.match(dashboard, /installButton\.style\.display = ''/,
	'a compatible release must explicitly reveal the update action');
assert.match(dashboard, /class: 'fn-freenetic-update-panel'/,
	'the dashboard must group Freenetic build details and update controls in one panel');
assert.match(css, /\.fn-freenetic-update-panel\s*\{[\s\S]*?\.fn-update-status-info::before/,
	'the Freenetic update panel must style its overview, controls and status states');
const prefix = dashboard.slice(0, dashboard.indexOf('function svgIcon'));
const helpers = new Function('rpc', prefix +
	'\nreturn { freeneticBuildVersion, compareFreeneticBuilds, freeneticReleasePlan };')({ call() {} });
const formatterSource = dashboard.slice(
	dashboard.indexOf('function freeneticBuildRevision'),
	dashboard.indexOf('function fmtMB')
);
const displayVersion = dashboard.match(/const FREENETIC_DISPLAY_VERSION = '([^']+)'/)[1];
const formatFreeneticVersion = new Function('_', 'FREENETIC_DISPLAY_VERSION', formatterSource +
	'\nreturn formatFreeneticVersion;')(value => value, displayVersion);

const version = '26.300.12345.abc1234';
const packageNames = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];
const installed = build => packageNames.slice(0, 2).map(name => ({ name, version: build }));
const updater = (packageManager, assetSuffix) => ({
	can_update: true,
	package_manager: packageManager,
	asset_suffix: assetSuffix
});
const release = (packageManager, assetSuffix, selectedVersion = version) => {
	const packageSuffix = packageManager === 'apk' ? '-' + assetSuffix + '.apk' : '-all.ipk';
	return {
		tag_name: 'v0.2.2',
		assets: packageNames.map(name => ({ name: name + '-' + selectedVersion + packageSuffix }))
			.concat({ name: 'fnc-' + selectedVersion + '-' + assetSuffix })
	};
};

assert.deepEqual(helpers.freeneticBuildVersion('26.255.53418~deb4b84-r1'), [ 26, 255, 53418 ]);
assert.equal(helpers.compareFreeneticBuilds([ 26, 300, 1 ], [ 26, 255, 60000 ]), 1);
assert.equal(displayVersion, 'v0.2.x-dev',
	'the dashboard development label must identify the service branch without promising its next patch number');
assert.equal(formatFreeneticVersion(installed(version)), 'v0.2.x-dev · abc1234',
	'identical component builds must show one short revision');
assert.equal(formatFreeneticVersion(installed(version), 'v0.2.2'), 'v0.2.2',
	'an update installed from a release must show its release tag instead of a development label');
assert.equal(formatFreeneticVersion(installed(version), 'not-a-release'), 'v0.2.x-dev · abc1234',
	'an invalid persisted release value must not replace the development build identity');
assert.match(formatFreeneticVersion([
	{ name: packageNames[0], version },
	{ name: packageNames[1], version: '26.299.00001~def5678' }
]), /theme abc1234 \/ app def5678/,
	'mismatched component builds must retain their package names');

const apkPlan = helpers.freeneticReleasePlan(
	release('apk', 'aarch64_cortex-a53'),
	updater('apk', 'aarch64_cortex-a53'),
	installed('26.255.53418~deb4b84')
);
assert.equal(apkPlan.compatible, true);
assert.equal(apkPlan.comparison, 1);
assert.equal(apkPlan.required.length, 5);
assert.ok(apkPlan.required.every(name => name.endsWith('-aarch64_cortex-a53.apk') || name.startsWith('fnc-')));

const ipkPlan = helpers.freeneticReleasePlan(
	release('opkg', 'mipsel_24kc'),
	updater('opkg', 'mipsel_24kc'),
	installed('26.255.53418~deb4b84')
);
assert.equal(ipkPlan.compatible, true);
assert.equal(ipkPlan.comparison, 1);
assert.equal(ipkPlan.required.filter(name => name.endsWith('-all.ipk')).length, 4);
assert.ok(ipkPlan.required.includes('fnc-' + version + '-mipsel_24kc'));

const samePlan = helpers.freeneticReleasePlan(
	release('opkg', 'aarch64_cortex-a53'),
	updater('opkg', 'aarch64_cortex-a53'),
	installed(version.replace(/\.abc1234$/, '~abc1234'))
);
assert.equal(samePlan.comparison, 0, 'tilde and dot package revisions must compare as one build');

const incomplete = release('apk', 'aarch64_cortex-a53');
incomplete.assets.pop();
assert.deepEqual(
	helpers.freeneticReleasePlan(incomplete, updater('apk', 'aarch64_cortex-a53'), installed('1.1.1~old')).compatible,
	false,
	'a release without fnc must not be installable'
);

const mixed = release('opkg', 'mipsel_24kc');
mixed.assets[0].name = mixed.assets[0].name.replace(version, '26.299.00001.other');
assert.equal(helpers.freeneticReleasePlan(mixed, updater('opkg', 'mipsel_24kc'), installed('1.1.1~old')).compatible, false,
	'mixed package revisions must not be installable');

const malformedTag = release('apk', 'aarch64_cortex-a53');
malformedTag.tag_name = 'v0.2.2;reboot';
assert.equal(helpers.freeneticReleasePlan(malformedTag, updater('apk', 'aarch64_cortex-a53'), []).reason, 'tag');
assert.equal(helpers.freeneticReleasePlan(release('apk', 'aarch64_cortex-a53'),
	{ can_update: false }, []).reason, 'updater');

console.log('Freenetic dashboard self-update planning: ok');
