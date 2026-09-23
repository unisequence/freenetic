'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const dashboardData = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'freenetic-dashboard-data.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs', 'luci-static',
	'freenetic', 'cascade.css'), 'utf8');
const themeFontDir = path.join(root, 'web', 'theme', 'htdocs', 'luci-static', 'freenetic', 'fonts');
for (const fontAsset of [
	'Anta-Regular.woff2',
	'Anta-OFL.txt',
	'CherryBombOne-Latin.woff2',
	'CherryBombOne-OFL.txt'
]) {
	assert.ok(fs.statSync(path.join(themeFontDir, fontAsset)).size > 0,
		fontAsset + ' must be present and non-empty');
}
assert.match(dashboardData, /updaterPackages\.length \? state\(updaterPackages\)\s*:\s*\n?\s*getFreeneticInstalledPackages\(\)\.then\(state\)/,
	'dashboard must avoid a full package listing when the status helper returned package versions');
assert.match(dashboardData, /freenetic-package-status', FREENETIC_PACKAGE_NAMES, 'json'/,
	'legacy dashboard fallback must use structured package status data');
assert.doesNotMatch(dashboard, /disabled:\s*!updaterReady/,
	'LuCI E() must not render disabled="false", which still disables the check button');
assert.doesNotMatch(dashboard, /disabled:\s*!preflightOk/,
	'LuCI E() must not render disabled="false", which would disable the update confirmation');
assert.match(dashboard, /checkButton\.disabled = !updaterReady/,
	'initial updater availability must be applied through the DOM boolean property');
assert.match(dashboard, /installButton\.style\.display = 'none'/,
	'theme button display rules must not override the hidden update action');
assert.match(dashboard, /installButton\.style\.display = ''/,
	'a compatible release must explicitly reveal the update action');
assert.match(dashboard, /window\.caches\.keys\(\)[\s\S]*window\.caches\.delete\(key\)/,
	'a successful update must clear browser CacheStorage before loading the new theme');
assert.match(dashboard, /window\.location\.replace\('\/cgi-bin\/luci\/admin\/logout\?_='/,
	'a successful update must end the active LuCI session instead of reloading stale assets');
assert.doesNotMatch(dashboard, /The interface update was installed successfully\. Reload the page to use the new version\./,
	'a successful update must not retain the old cache-preserving completion path');
assert.match(dashboard, /class: 'fn-freenetic-update-panel'/,
	'the dashboard must group Freenetic build details and update controls in one panel');
assert.match(dashboard, /class: 'fn-update-codename fn-update-codename-' \+ codename\.toLowerCase\(\)/,
	'the dashboard must render a stable release codename beside its version');
assert.match(dashboard, /class: 'fn-update-line'/,
	'the dashboard must offer a release-line selector');
assert.match(dashboard, /class: 'fn-update-version'/,
	'the dashboard must offer a concrete release-version selector');
assert.match(dashboard, /freeneticReleaseCandidates\(/,
	'the dashboard must install only a selected compatible release candidate');
assert.match(dashboard, /class: 'fn-update-release-details'/,
	'the dashboard must expose release notes without replacing the compact update controls');
assert.match(dashboard, /class: 'fn-update-preflight fn-update-preflight-'/,
	'the update confirmation must show a read-only preflight summary');
assert.match(dashboard, /Resources: %s MiB RAM · %s CPU cores/,
	'the update confirmation must show the resource preflight summary');
assert.match(dashboard, /class: 'fn-update-backup-option'/,
	'the update confirmation must offer a configuration backup');
assert.match(dashboard, /freenetic-backup-call/,
	'the update flow must create the optional configuration backup before installing');
assert.match(dashboard, /function renderFreeneticReleaseNotes\(/,
	'release notes must have a bounded Markdown-lite renderer');
assert.match(dashboard, /class: 'fn-update-release-note-heading'/,
	'release note headings must be rendered as semantic text elements');
assert.match(css, /\.fn-update-release-notes-content\s*\{[\s\S]*?max-height:\s*160px[\s\S]*?overflow:\s*auto/,
	'release notes must remain bounded when formatted');
assert.match(css, /\.fn-update-release-details\s*\{[\s\S]*?background:\s*var\(--fn-surface\)/,
	'release notes must use the quiet update-card surface instead of the alert fill');
assert.match(dashboardData, /function formatFreeneticReleaseDate\(/,
	'release metadata must format publication dates safely');
assert.match(dashboardData, /function freeneticReleaseNotes\(/,
	'release notes must be truncated before being shown in the dashboard');
assert.match(dashboard, /Install older release/,
	'a selected older release must be explicitly identified as a downgrade');
assert.match(dashboardData, /releases\?per_page=100/,
	'the release query must fetch enough history for both supported release lines');
assert.match(css, /\.fn-freenetic-update-panel\s*\{[\s\S]*?\.fn-update-status-info::before/,
	'the Freenetic update panel must style its overview, controls and status states');
assert.match(css, /@font-face\s*\{[\s\S]*?font-family: "Anta";[\s\S]*?Anta-Regular\.woff2/,
	'the release codename display font must be bundled with the theme');
assert.match(css, /@font-face\s*\{[\s\S]*?font-family: "CherryBombOne";[\s\S]*?CherryBombOne-Latin\.woff2/,
	'the Onyx display font must be bundled with the theme');
assert.match(css, /\.fn-update-codename-noxium\s*\{[\s\S]*?transform: skewX\(-8deg\)/,
	'the regular-only Anta font must receive the intentional codename slant');
assert.match(css, /\.fn-update-version:disabled[\s\S]*?background-image: none/,
	'a disabled release selector must not tile the native chevron background');
const helpers = new Function('baseclass', 'fs', 'uci', 'rpc', '_', dashboardData)(
	{ extend: value => value },
	{ exec_direct() { return Promise.resolve([]); } },
	{ load() { return Promise.resolve(); }, get() { return null; } },
	{ call() { return Promise.resolve({}); } },
	value => value
);
const formatterSource = dashboardData.slice(
	dashboardData.indexOf('function freeneticBuildRevision'),
	dashboardData.indexOf('function fmtMB')
);
const displayVersion = dashboardData.match(/const FREENETIC_DISPLAY_VERSION = '([^']+)'/)[1];
const formatFreeneticVersion = new Function('_', 'FREENETIC_DISPLAY_VERSION', formatterSource +
	'\nreturn formatFreeneticVersion;')(value => value, displayVersion);
const freeneticReleaseCodename = helpers.freeneticReleaseCodename;
assert.ok(helpers.formatFreeneticReleaseDate('2026-09-15T00:00:00Z'),
	'a valid release timestamp must produce a readable date');
assert.equal(helpers.formatFreeneticReleaseDate('not-a-date'), '',
	'an invalid release timestamp must not render a bogus date');
assert.equal(helpers.freeneticReleaseNotes('  first line\r\nsecond line  '), 'first line\nsecond line');
assert.match(helpers.freeneticReleaseNotes('one two three four', 10), /…$/,
	'long release notes must be compacted for the dashboard card');

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
			.concat({ name: 'fnc-' + selectedVersion + '-' + assetSuffix + '-' +
				(packageManager === 'apk' ? 'apk' : 'ipk') })
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
assert.equal(freeneticReleaseCodename('v0.3.0'), 'Noxium',
	'the stable 0.3.0 release must expose its public codename');
assert.equal(freeneticReleaseCodename('v0.2.8'), 'Onyx',
	'patch releases in the stable 0.2 line must retain the Onyx codename');
assert.equal(freeneticReleaseCodename('v0.3.0-alpha.4'), '',
	'prerelease builds must keep the stable codename hidden');
assert.equal(freeneticReleaseCodename('v0.3.1'), 'Noxium',
	'patch releases in the stable 0.3 line must retain the Noxium codename');
assert.equal(freeneticReleaseCodename('v0.4.0'), '',
	'unrevealed release lines must not expose a codename');
assert.equal(helpers.freeneticReleaseLine('v0.3.1'), '0.3');
assert.equal(helpers.freeneticReleaseLine('v0.3.0-beta.2'), '0.3');
assert.equal(helpers.freeneticReleaseLine('not-a-release'), '');
assert.equal(helpers.compareFreeneticReleaseTags('v0.3.1', 'v0.3.0'), 1);
assert.equal(helpers.compareFreeneticReleaseTags('v0.3.0', 'v0.3.0-beta.2'), 1);
assert.equal(helpers.compareFreeneticReleaseTags('v0.3.0-beta.2', 'v0.3.0-beta.1'), 1);
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

const x86Plan = helpers.freeneticReleasePlan(
	release('apk', 'x86_64'),
	updater('apk', 'x86_64'),
	installed('26.255.53418~deb4b84')
);
assert.equal(x86Plan.compatible, true,
	'x86_64 APK releases must be accepted by the dashboard updater');
assert.ok(x86Plan.required.every(name => name.endsWith('-x86_64.apk') || name.startsWith('fnc-')));

const ipkPlan = helpers.freeneticReleasePlan(
	release('opkg', 'mipsel_24kc'),
	updater('opkg', 'mipsel_24kc'),
	installed('26.255.53418~deb4b84')
);
assert.equal(ipkPlan.compatible, true);
assert.equal(ipkPlan.comparison, 1);
assert.equal(ipkPlan.required.filter(name => name.endsWith('-all.ipk')).length, 4);
assert.ok(ipkPlan.required.includes('fnc-' + version + '-mipsel_24kc-ipk'));

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

const newer = release('apk', 'aarch64_cortex-a53', '26.301.00001.new1234');
newer.tag_name = 'v0.3.1';
newer.published_at = '2026-09-15T00:00:00Z';
const olderSameLine = release('apk', 'aarch64_cortex-a53', '26.300.00001.old1234');
olderSameLine.tag_name = 'v0.3.0';
olderSameLine.published_at = '2026-09-16T00:00:00Z';
const onyx = release('apk', 'aarch64_cortex-a53', '26.299.00001.onyx123');
onyx.tag_name = 'v0.2.8';
const beta = release('apk', 'aarch64_cortex-a53', '26.302.00001.beta123');
beta.tag_name = 'v0.3.2-beta.1';
beta.prerelease = true;
const releaseList = [ olderSameLine, beta, onyx, newer ];
const stableAuto = helpers.freeneticReleaseCandidates(releaseList,
	updater('apk', 'aarch64_cortex-a53'), installed('26.300.12345~abc1234'), 'stable', 'auto');
assert.deepEqual(stableAuto.map(candidate => candidate.release.tag_name), [ 'v0.3.1', 'v0.3.0', 'v0.2.8' ],
	'compatible stable releases must be semver-sorted independently of publication timestamps');
assert.equal(stableAuto[0].plan.comparison, 1);
assert.equal(stableAuto[1].plan.comparison, -1);
assert.deepEqual(helpers.freeneticReleaseCandidates(releaseList,
	updater('apk', 'aarch64_cortex-a53'), installed('26.300.12345~abc1234'), 'stable', '0.2')
	.map(candidate => candidate.release.tag_name), [ 'v0.2.8' ],
	'an explicit release line must exclude other stable lines');
assert.deepEqual(helpers.freeneticReleaseCandidates(releaseList,
	updater('apk', 'aarch64_cortex-a53'), installed('26.300.12345~abc1234'), 'beta', '0.3')
	.map(candidate => candidate.release.tag_name), [ 'v0.3.2-beta.1' ],
	'beta selection must include prereleases only from the selected line');

console.log('Freenetic dashboard self-update planning: ok');
