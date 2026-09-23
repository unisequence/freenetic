'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-self-update');
const helper = fs.readFileSync(helperPath, 'utf8');
const installer = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];
const preflight = fs.readFileSync(path.join(root, 'app', 'freenetic-preflight.mk'), 'utf8');
const appMakefile = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'Makefile'), 'utf8');
const themeMakefile = fs.readFileSync(path.join(root, 'app', 'luci-theme-freenetic', 'Makefile'), 'utf8');
const themeLogin = fs.readFileSync(path.join(root, 'app', 'luci-theme-freenetic', 'ucode',
	'template', 'themes', 'freenetic', 'sysauth.ut'), 'utf8');
const rootMakefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');

assert.ok(fs.statSync(helperPath).mode & 0o111, 'self-update helper must be executable');
assert.ok(helper.startsWith('#!/bin/sh'), 'self-update helper must be POSIX sh');
assert.doesNotMatch(helper, /^set -u$/m,
	'OpenWrt 24.10 jshn expands optional variables and is incompatible with nounset');
assert.match(helper, /RAW_BASE_URL=https:\/\/raw\.githubusercontent\.com\/unisequence\/freenetic/,
	'installer source repository must be fixed router-side');
assert.match(helper, /RELEASES_BASE_URL=https:\/\/github\.com\/unisequence\/freenetic\/releases\/download/,
	'release asset repository must be fixed router-side');
assert.match(helper, /download_installer\(\)/,
	'updates must use the generated release installer when available');
assert.match(helper, /wget -4 -qO/,
	'updates must prefer IPv4 for release assets when a router has broken IPv6 egress');
assert.match(helper, /GITHUB_API_BASE_URL=https:\/\/api\.github\.com\/repos\/unisequence\/freenetic/,
	'updates must keep a fixed GitHub API endpoint for blocked release redirects');
assert.match(helper, /releases\/assets\/\$asset_id/,
	'updates must support downloading the installer through the GitHub release API');
assert.match(helper, /\$RELEASES_BASE_URL\/\$installer_tag\/install\.sh/,
	'updates must prefer the installer generated beside release assets');
assert.match(helper, /\$RAW_BASE_URL\/\$installer_tag\/install\.sh/,
	'updates must retain a raw-tag fallback for older releases');
assert.match(helper, /0\\\.2\\\.\[0-5\]/,
	'the raw-tag fallback must be limited to releases which predate installer assets');
assert.match(helper, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/,
	'release tags must be constrained to Freenetic semver tags');
assert.match(helper, /mktemp -d \/tmp\/freenetic-self-update\.XXXXXX/,
	'updates must use an isolated staging directory');
assert.match(helper, /cp "\$0" "\$stage_dir\/runner"/,
	'the running updater must survive replacement of its installed package');
assert.match(helper, /grep -Fqx "RELEASE_TAG=\\"\$tag\\""/,
	'downloaded installers must declare the selected release tag exactly');
assert.match(helper, /MAX_INSTALLER_BYTES=262144/,
	'downloaded installer size must be bounded');
assert.match(helper, /sh -n "\$installer"/,
	'downloaded installers must pass a shell syntax check');
assert.match(helper, /FREENETIC_RELEASE_BASE_URL="\$RELEASES_BASE_URL\/\$tag" sh "\$installer"/,
	'asset downloads must stay pinned to the selected GitHub release');
assert.match(helper, /uci -q set "freenetic\.updates\.installed_release=\$tag"/,
	'a successful UI update must persist its release tag');
assert.match(helper, /apk query --fields name,version --format json --installed/,
	'status must read package versions from current apk');
assert.match(helper, /opkg status "\$package_name"/,
	'status must read package versions from legacy opkg');
assert.match(helper, /json_add_array packages/,
	'status must expose installed versions without relying on package-manager-call');
assert.match(helper, /reply_update_error\(\)/,
	'self-update failures must expose structured update diagnostics');
assert.match(helper, /last_installer_stage\(\)/,
	'self-update must identify the last installer stage on failure');
assert.match(helper, /rollback_release\(\)/,
	'self-update must have an automatic rollback path');
assert.match(helper, /preflight_overlay\(\)/,
	'self-update status must expose the same overlay preflight used before installation');
assert.match(helper, /preflight_resources\(\)/,
	'self-update status must expose the same resource preflight used before installation');
assert.match(helper, /json_add_boolean preflight_ok/,
	'self-update status must report whether the read-only preflight passed');
assert.match(helper, /json_add_string overlay_free_mib/,
	'self-update status must report available overlay space');
assert.match(helper, /json_add_string overlay_min_mib/,
	'self-update status must report the target-specific overlay reserve');
assert.match(helper, /json_add_string ram_mib/,
	'self-update status must report available RAM');
assert.match(helper, /json_add_string cpu_cores/,
	'self-update status must report available CPU cores');
assert.match(helper, /x86\/64\) asset_suffix=x86_64/,
	'self-update must select x86_64 release assets for OpenWrt x86/64');
assert.match(helper, /x86\/64\) overlay_min_mib=32/,
	'self-update must apply the x86/64 overlay reserve');
assert.match(helper, /previous_tag="\$\(uci -q get freenetic\.updates\.installed_release/,
	'self-update must capture the previous release before changing packages');
assert.match(helper, /json_add_boolean rollback_attempted/,
	'self-update must report whether rollback was attempted');
assert.match(helper, /json_add_boolean rollback_ok/,
	'self-update must report rollback success separately from update success');
assert.match(helper, /fail_after_mutation\(\)/,
	'package and post-install failures must pass through rollback handling');
assert.match(installer, /stage preflight/,
	'the release installer must report the preflight stage');
assert.match(installer, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/freenetic-install\.XXXXXX"/,
	'the release installer must use an unpredictable private staging directory');
assert.doesNotMatch(installer, /freenetic-install\.\$\$/,
	'the release installer must not use a PID-derived staging path');
assert.match(installer, /stage package_verification/,
	'the release installer must report package verification failures');
assert.match(installer, /stage package_install/,
	'the release installer must report package installation failures');
assert.match(installer, /apk --keys-dir "\$APK_KEYS_DIR" add/,
	'APK installation must verify packages with the pinned release key');
assert.doesNotMatch(installer, /apk add --allow-untrusted/,
	'APK installation must not bypass package signatures');
assert.match(installer, /stage post_install/,
	'the release installer must report post-install failures');
assert.match(installer, /stage smoke_test/,
	'the release installer must report smoke-test failures');
assert.match(dashboard, /freeneticUpdateResult/,
	'dashboard update errors must retain structured helper diagnostics');
assert.match(dashboard, /freenetic-backup-call/,
	'dashboard updates must offer a configuration backup before installation');
assert.match(dashboard, /freenetic-startup-config\.tar\.gz/,
	'pre-update configuration backups must be downloaded to the browser');
assert.match(dashboard, /preflight_ok !== false/,
	'dashboard must not start an update after a failed read-only preflight');
assert.match(dashboard, /Update failed during %s: %s/,
	'dashboard must show the failing update stage');
assert.match(dashboard, /Automatic rollback failed; check the router before retrying\./,
	'dashboard must surface a failed rollback clearly');
assert.match(dashboard, /window\.caches\.keys\(\)[\s\S]*window\.caches\.delete\(key\)/,
	'a successful update must clear browser CacheStorage before loading the new theme');
assert.match(dashboard, /window\.location\.replace\('\/cgi-bin\/luci\/admin\/logout\?_='/,
	'a successful update must end the current LuCI session through the real logout route');
assert.match(dashboard, /window\.setTimeout\(clearBrowserCacheAndLogout, 1200\)/,
	'the successful update must perform cache cleanup and logout without another click');
assert.match(themeLogin, /glob\('\/tmp\/freenetic-clear-site-data\.\*'\)[\s\S]*unlink\(path\)/,
	'the first post-install login must consume the browser-cache marker once');
assert.match(themeLogin, /http\.header\('Clear-Site-Data', '"cache"'\)/,
	'the first post-install login must clear the browser HTTP cache without erasing settings');

assert.deepEqual(acl.read.file['/usr/libexec/freenetic-self-update status'], [ 'exec' ]);
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-self-update install *'], [ 'exec' ]);
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-backup-call'], [ 'exec' ]);
assert.match(preflight, /FREENETIC_VERSION_PATHS:=.*app\/luci-app-freenetic.*app\/luci-theme-freenetic.*web\/application.*web\/theme/,
	'theme and application versions must cover both source trees');
assert.match(appMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'application package must use the shared release revision');
assert.match(themeMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'theme package must use the shared release revision');
assert.match(rootMakefile, /FREENETIC_ROOT="\$\(CURDIR\)"/,
	'package builds must calculate revisions from the Freenetic checkout, not the SDK root');

console.log('Freenetic self-update contract: ok');
